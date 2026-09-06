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
import { loadJourneyContext } from "@/platform/intake/complete";
import { readIntakeEffort } from "@/platform/intake/effort";
import { intakeReadiness } from "@/platform/intake/readiness";

/**
 * A00 §9 step 3 — Agent Run Ledger proof case: the intake route's real
 * governed capability calls write EXACTLY ONE AgentRunRecord EACH, without
 * changing the route's observable output (the intake-flow suite still covers
 * that).
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

    const { request_id } = await res.json();
    const runs = recentAgentRuns();
    // T1-35 S2 uses deterministic screen selection with its own durable
    // zero-cost decision receipt. A01 classification, its governed model
    // alternate, A02 packet assembly and A09 validation still record one row
    // per actual run. Reading/emitting questions must not invent model runs.
    const emitted = await intakeReadiness((await loadJourneyContext(request_id))!, true);
    expect(emitted.screen.questions.length).toBeGreaterThan(0);
    expect(recentAgentRuns()).toEqual(runs);
    const effort = await readIntakeEffort({ request_id, tenant_id: "prn" });
    const selections = effort.attempts.filter(a => a.operation.kind === "selection");
    expect(selections).toHaveLength(1);
    expect(selections[0].operation.selection_decisions).toEqual(emitted.screen.decisions);
    expect(selections[0].charged_units).toBe(0);
    const a01Runs = runs.filter((r) => r.agent_id === "A01");
    const classifyRuns = a01Runs.filter((r) => r.capabilities_used.includes("classify_home_problem"));
    const clarifierRuns = a01Runs.filter((r) => r.capabilities_used.includes("select_next_clarifier"));
    const modelClassifyRuns = a01Runs.filter((r) => r.capabilities_used.includes("classify_problem"));
    const modelClarifierRuns = a01Runs.filter((r) =>
      r.capabilities_used.includes("select_clarifying_questions")
    );
    expect(classifyRuns.length).toBe(1);
    expect(clarifierRuns).toHaveLength(0);
    expect(modelClassifyRuns.length).toBe(classifyRuns.length);
    expect(modelClarifierRuns).toHaveLength(0);
    // Every A01 row is accounted for; duplicate or new callers still fail.
    expect(a01Runs.length).toBe(
      classifyRuns.length +
        clarifierRuns.length +
        modelClassifyRuns.length +
        modelClarifierRuns.length
    );
    expect(runs.filter((r) => r.agent_id === "A02").length).toBe(1);
    expect(runs.filter((r) => r.agent_id === "A09").length).toBe(1);
    expect(runs.length).toBe(a01Runs.length + 2);
    const a02Run = runs.find((r) => r.agent_id === "A02")!;
    expect(a02Run.capabilities_used).toEqual(["generate_job_packet"]);
    expect(a02Run.cost_usd).toBe(0);
    expect(a02Run.tool_provider).toBe("deterministic-stand-in");
    const run = classifyRuns[0];
    expect(AgentRunRecord.safeParse(run).success).toBe(true);
    expect(run.agent_id).toBe("A01");
    expect(run.trigger).toBe("request");
    expect(run.tool_provider).toBe("deterministic-stand-in");
    // The resolved canonical key, observed — not the alias the route asserted.
    expect(run.capabilities_used).toEqual(["classify_home_problem"]);
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
