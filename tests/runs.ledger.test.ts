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
import { readDevDb } from "@/platform/stores/dev-db";

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

    const runs = recentAgentRuns();
    /**
     * A09 (Data Quality, 2026-08-24) also writes ONE row per guarded journey
     * write — its ingest validation batch, which is a separate agent RUN, not a
     * second row for A01's. The pin this test carries is "one row per agent
     * run, never one per event", so it scopes to A01 and pins A09's single row
     * alongside: a THIRD writer, or a second row from either, still fails here.
     */
    /**
     * A02 (Job Packet, 2026-08-25) is the THIRD writer, and its row is the
     * point of that build rather than a leak past this pin: building the packet
     * used to be a plain function call that produced no ledger row at all, so a
     * kill switch on A02 stopped nothing. One row per agent run still holds —
     * A01 classifies, A02 builds the packet, A09 validates the write, and a
     * FOURTH writer or a second row from any of them still fails here.
     */
    /**
     * A01'S ROWS ARE NOW THE GATEWAY'S, AND THERE IS MORE THAN ONE (finding 1,
     * 2026-08-25). The route used to hand-write a single A01 row asserting
     * `capabilities_used: ["classify_problem"]` and a provider it had not
     * observed, because A01 ran as a plain function call. The live path now goes
     * through A01's capability surface, so every row below was written by
     * `capability_call` from what actually happened: ONE classification, then
     * one row per clarifying question A01 selected under the ceiling.
     *
     * THE PIN IS UNCHANGED IN SUBSTANCE — one ledger row per agent RUN, never
     * one per event, and no writer nobody accounted for. It is expressed against
     * the run count A01 actually performs rather than a literal, so it still
     * fails on a second row for one run, and it is now checked against the
     * emitted `intake.clarifier_asked` envelopes: a selection that left a ledger
     * row but no instrument (or the reverse) fails here.
     */
    /**
     * A FOURTH AND FIFTH ACCOUNTED KIND, 2026-09-05 (campaign track F1). The
     * model-backed alternates are now consulted (Josh's test-environment
     * clearance, "use them now"; Melissa's countersign T0-03 open), and each
     * consultation is its own AI-gateway ledger row: `classify_problem` beside
     * the deterministic `classify_home_problem`, and `select_clarifying_questions`
     * beside each `select_next_clarifier`. Those rows are the POINT of the
     * ledger — a model consulted about a customer's words and refused, or ran,
     * and either way it is written down. The pin is unchanged in substance: one
     * row per agent RUN, never one per event, and still no writer nobody
     * accounted for.
     */
    const a01Runs = runs.filter((r) => r.agent_id === "A01");
    const classifyRuns = a01Runs.filter((r) => r.capabilities_used.includes("classify_home_problem"));
    const clarifierRuns = a01Runs.filter((r) => r.capabilities_used.includes("select_next_clarifier"));
    const modelClassifyRuns = a01Runs.filter((r) => r.capabilities_used.includes("classify_problem"));
    const modelClarifierRuns = a01Runs.filter((r) =>
      r.capabilities_used.includes("select_clarifying_questions")
    );
    const asked = readDevDb().events.filter((e) => e.event_name === "intake.clarifier_asked");
    expect(classifyRuns.length).toBe(1);
    expect(clarifierRuns.length).toBe(asked.length);
    expect(clarifierRuns.length).toBeGreaterThan(0);
    // One alternate consulted per classification, and never more alternates
    // than deterministic passes: `selectClarifier` refuses at its own ceiling
    // BEFORE the alternate is reached, so the last pass of a capped loop can
    // leave a deterministic row with no alternate beside it. Fewer model calls
    // than passes is the safe direction; more would mean an unaccounted call.
    expect(modelClassifyRuns.length).toBe(classifyRuns.length);
    expect(modelClarifierRuns.length).toBeLessThanOrEqual(clarifierRuns.length);
    // Every A01 row is one of those four — no unaccounted A01 run.
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
