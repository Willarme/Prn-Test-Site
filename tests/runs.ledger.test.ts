import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import {
  AgentRunRecord,
  recentAgentRuns,
  recordAgentRun,
  resetAgentRunLedgerForTests,
} from "@/platform/runs/ledger";

/**
 * A00 §9 step 3 — Agent Run Ledger proof case: the intake route's real
 * classify_problem call writes EXACTLY ONE AgentRunRecord, without changing
 * the route's observable output (the intake-flow suite still covers that).
 */
let intakePost: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-ledger-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  ({ POST: intakePost } = await import("@/app/api/intake/route"));
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

beforeEach(() => {
  resetAgentRunLedgerForTests();
});

function intakeRequest(description: string) {
  return new Request("http://localhost/api/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description,
      disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: {
        page_id: null,
        intent_cluster_id: null,
        search_opportunity_id: null,
        problem_family_hint: null,
        experiment_id: null,
        variant: null,
        referrer: null,
        landing_path: "/start",
      },
    }),
  });
}

describe("A00 agent run ledger", () => {
  it("writes exactly one well-formed AgentRunRecord for the intake classify_problem call", async () => {
    const res = await intakePost(intakeRequest("The AC won't turn on since yesterday evening"));
    expect(res.status).toBe(200);

    const runs = recentAgentRuns();
    /**
     * A09 (Data Quality, 2026-08-24) also writes ONE row per guarded journey
     * write — its ingest validation batch, which is a separate agent RUN, not a
     * second row for A01's. The pin this test carries is "one row per agent
     * run, never one per event", so it scopes to A01 and pins A09's single row
     * alongside: a THIRD writer, or a second row from either, still fails here.
     */
    const a01Runs = runs.filter((r) => r.agent_id === "A01");
    expect(a01Runs.length).toBe(1);
    expect(runs.filter((r) => r.agent_id === "A09").length).toBe(1);
    expect(runs.length).toBe(2);
    const run = a01Runs[0];
    expect(AgentRunRecord.safeParse(run).success).toBe(true);
    expect(run.agent_id).toBe("A01");
    expect(run.trigger).toBe("request");
    expect(run.tool_provider).toBe("deterministic-stand-in");
    expect(run.capabilities_used).toEqual(["classify_problem"]);
    expect(run.tenant_id).toBe("prn"); // reserved field, default only — no tenant logic
    expect(run.cost_usd).toBe(0); // deterministic path costs nothing
    expect(run.run_id).toMatch(/^ar_/);
  });

  it("references customer data by ID only — the description never enters the ledger", async () => {
    const marker = "MY PIPE EXPLODED IN THE PURPLE BATHROOM last night";
    await intakePost(intakeRequest(marker));
    const serialized = JSON.stringify(recentAgentRuns());
    expect(serialized).not.toContain("PURPLE BATHROOM");
    expect(serialized).not.toContain(marker);
  });

  it("a safety-halted intake produces no run record (analysis never ran)", async () => {
    const res = await intakePost(intakeRequest("It smells like gas near the stove"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request_id).toBeNull();
    expect(recentAgentRuns().length).toBe(0);
  });

  it("recordAgentRun never throws when the durable store is missing (fail-soft)", async () => {
    // A provider that simulates a broken client / missing table.
    const explodingProvider = () => {
      throw new Error("simulated connection failure");
    };
    const record = await recordAgentRun(
      {
        agent_id: "A01",
        trigger: "request",
        input_ids: ["rq_test"],
        capabilities_used: ["classify_problem"],
        tool_provider: "deterministic-stand-in",
        outputs_summary: { problem_id: "pr_test" },
      },
      explodingProvider as never
    );
    expect(record.run_id).toMatch(/^ar_/);
    expect(recentAgentRuns().length).toBe(1);
  });

  it("records validate and default tenant_id to 'prn' (reserved field only)", async () => {
    const record = await recordAgentRun({
      agent_id: "A02",
      trigger: "request",
      input_ids: [],
      capabilities_used: ["build_job_packet"],
      outputs_summary: null,
    });
    expect(AgentRunRecord.safeParse(record).success).toBe(true);
    expect(record.tenant_id).toBe("prn");
    expect(recentAgentRuns().length).toBe(1);
  });
});
