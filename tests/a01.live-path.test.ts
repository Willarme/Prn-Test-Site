import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { engageKillSwitch, releaseKillSwitch } from "@/platform/killswitch";
import { readDevDb } from "@/platform/stores/dev-db";
import { runtimeStore } from "@/platform/stores/runtime";
import { QUESTION_COSTS, READINESS_POLICY_VERSION } from "@/domain/intake/readiness";
import { loadJourneyContext } from "@/platform/intake/complete";
import { MAX_INTAKE_EFFORT, readIntakeEffort } from "@/platform/intake/effort";
import { intakeReadiness } from "@/platform/intake/readiness";

/**
 * Drive POST /api/intake and read the persisted claims, derivation and packet.
 * T1-35 S1/S2 retains governed A01 classification and replaces live clarifier
 * model calls with shared-fact deterministic selection. The question cases
 * invoke the same durable read model as the complete page; they do not claim
 * browser or model-provider acceptance. The response and literal homeowner
 * wording remain pinned independently of the richer internal records.
 */
let intakePost: (req: Request) => Promise<Response>;

const AC = "The AC won't turn on since yesterday evening and the house is getting hot";

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a01-live-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  ({ POST: intakePost } = await import("@/app/api/intake/route"));
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

function intakeRequest(description: string) {
  return new Request("http://localhost/api/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description,
      disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: {
        page_id: "page_ac_not_turning_on",
        intent_cluster_id: "ic_hvac_no_power",
        search_opportunity_id: null,
        problem_family_hint: "hvac",
        experiment_id: null,
        variant: null,
        referrer: null,
        landing_path: "/problems/ac-not-turning-on",
      },
    }),
  });
}

/** Drive one real journey and hand back what the store now holds for it. */
async function driveJourney(description: string) {
  const res = await intakePost(intakeRequest(description));
  expect(res.status).toBe(200);
  const body = await res.json();
  const db = readDevDb();
  const session = db.intake_sessions.find((s) => s.request_id === body.request_id)!;
  const problem = db.problems.find((p) => p.intake_session_id === session.intake_session_id)!;
  const store = runtimeStore();
  return {
    body,
    problem,
    evidence: db.evidence.filter((e) => problem.evidence_ids.includes(e.evidence_id)),
    packet: db.packets.filter((k) => k.problem_id === problem.problem_id),
    events: db.events,
    claims: await store.listClaims(problem.problem_id),
    derivations: await store.listDerivations(problem.problem_id),
  };
}

describe("A01 — a real customer journey produces durable facts", () => {
  it("the stored ProblemRecord carries claim_ids, and every one resolves to a persisted FactClaim", async () => {
    const j = await driveJourney(AC);

    // The finding, inverted: this array was `[]` on every record the app ever wrote.
    expect(j.problem.claim_ids.length).toBeGreaterThan(0);
    expect(j.claims.length).toBe(j.problem.claim_ids.length);
    expect(j.claims.map((c) => c.claim_id).sort()).toEqual([...j.problem.claim_ids].sort());

    // A claim with no evidence is an invented fact. Every one points at
    // evidence that was written in the same journey.
    const evidenceIds = new Set(j.evidence.map((e) => e.evidence_id));
    for (const claim of j.claims) {
      expect(claim.evidence_ids.length).toBeGreaterThan(0);
      for (const id of claim.evidence_ids) expect(evidenceIds.has(id)).toBe(true);
    }

    // The classification itself is on the claim ledger — the single most
    // consequential inference A01 makes, labelled as one.
    const inferred = j.claims.find((c) => c.predicate === "likely_service_category")!;
    expect(inferred).toBeDefined();
    expect(inferred.claim_class).toBe("INFERRED");
    expect(inferred.object).toBe("hvac");

    // And the homeowner's own words are SUPPLIED, not inferred: the AC playbook
    // asks when it started, and this description answers it.
    const supplied = j.claims.filter((c) => c.claim_class === "SUPPLIED");
    expect(supplied.length).toBeGreaterThan(0);
    expect(supplied.map((c) => c.predicate)).toContain("symptom_timing");
    // Supplied facts carry no confidence: the homeowner told us a thing, not a
    // probability.
    for (const c of supplied) expect(c.confidence).toBeNull();
  });

  it("one DerivationRecord is persisted, naming the run and the versions that produced the claims", async () => {
    const j = await driveJourney("The AC runs but blows warm air, started this morning");

    expect(j.derivations.length).toBe(1);
    const derivation = j.derivations[0];
    expect(derivation.problem_id).toBe(j.problem.problem_id);
    // It names exactly the claims of that journey — no more, no fewer.
    expect([...derivation.claim_ids].sort()).toEqual([...j.problem.claim_ids].sort());
    // Deterministic path: a method, no model, and the versions that could later
    // be blamed for a wrong classification.
    expect(derivation.method).toBe("deterministic");
    expect(derivation.capability_key).toBe("classify_home_problem");
    expect(derivation.model_id).toBeNull();
    expect(derivation.prompt_id).toBeNull();
    expect(derivation.policy_version).toBeTruthy();
    expect(derivation.input_evidence_ids.length).toBeGreaterThan(0);
    // Joinable to the Agent Run Ledger row the governed call wrote.
    expect(derivation.agent_run_id).toMatch(/^ar_/);
  });

  it("classification facts and deterministic screen decisions persist without the homeowner's words", async () => {
    const marker = "the PURPLE THERMOSTAT in the hallway is blank and the AC won't start";
    const j = await driveJourney(marker);

    const facts = j.events.filter(
      (e) => e.event_name === "problem.fact_extracted" && e.context.problem_id === j.problem.problem_id
    );
    const asked = j.events.filter(
      (e) => e.event_name === "intake.clarifier_asked" && e.context.request_id === j.body.request_id
    );
    expect(facts.length).toBe(j.problem.claim_ids.length);
    // T1-35 S2 records the emitted screen in the durable effort ledger. The
    // legacy model clarifier instrument is not evidence of this new path.
    expect(asked).toEqual([]);
    const ctx = (await loadJourneyContext(j.body.request_id))!;
    const emitted = await intakeReadiness(ctx, true); // same read model as /complete
    expect(emitted.screen.questions.length).toBeGreaterThan(0);
    const ledger = await readIntakeEffort({ request_id: j.body.request_id, tenant_id: "prn" });
    const selections = ledger.attempts.filter(a => a.operation.kind === "selection");
    expect(selections).toHaveLength(1);
    expect(selections[0].accepted).toBe(true);
    expect(selections[0].charged_units).toBe(0);
    expect(selections[0].operation.selection_decisions).toEqual(emitted.screen.decisions);
    expect(emitted.screen.decisions.map(d => d.question_id)).toEqual(emitted.screen.questions.map(q => q.question_id));
    for (const decision of emitted.screen.decisions) {
      expect(decision.policy_version).toBe(READINESS_POLICY_VERSION);
      expect(decision.fills_fields.length).toBeGreaterThan(0);
      expect(decision.fills_fields.filter(field => decision.already_populated_fields.includes(field))).toEqual([]);
    }

    // The fact envelope carries ids and classifications — never the claim's value.
    for (const e of facts) {
      expect(e.context.claim_id).toMatch(/^fc_/);
      expect(e.context.claim_class).toBeTruthy();
      expect(e.privacy_class).toBe("internal");
    }
    expect(JSON.stringify([facts, selections])).not.toContain("PURPLE THERMOSTAT");
  });

  it("reloading the emitted screen is idempotent, excludes supplied facts, and stays within effort", async () => {
    const j = await driveJourney("My Carrier AC is 9 years old and started blowing warm air yesterday");
    const ctx = (await loadJourneyContext(j.body.request_id))!;
    const first = await intakeReadiness(ctx, true);
    const second = await intakeReadiness((await loadJourneyContext(j.body.request_id))!, true);
    expect(first.screen.questions.length).toBeGreaterThan(0);
    expect(second.screen).toEqual(first.screen);
    const targets = first.screen.questions.flatMap(q => q.fills_fields);
    expect(new Set(targets).size).toBe(targets.length);
    expect(first.facts.fields.symptom_timing?.value).toBeTruthy();
    expect(targets).not.toContain("symptom_timing");
    const ledger = await readIntakeEffort({ request_id: j.body.request_id, tenant_id: "prn" });
    expect(ledger.attempts.filter(a => a.operation.kind === "selection")).toHaveLength(1);
    expect(ledger.effort_spent).toBe(QUESTION_COSTS.free_text);
    expect(ledger.attempts.reduce((sum, a) => sum + a.charged_units, 0)).toBe(ledger.effort_spent);
    expect(first.screen.projected_effort).toBe(ledger.effort_spent + first.screen.questions.reduce((sum, q) => sum + QUESTION_COSTS[q.input_type], 0));
    expect(first.screen.projected_effort).toBeLessThanOrEqual(MAX_INTAKE_EFFORT);
  });

  it("the classification really went through the governed door", async () => {
    const j = await driveJourney("The furnace is making a loud grinding noise");
    const invoked = j.events.filter(
      (e) => e.event_name === "capability.invoked" && e.context.capability === "classify_home_problem"
    );
    expect(invoked.length).toBeGreaterThan(0);
  });

  it("A KILL SWITCH ON A01 STOPS THE LIVE INTAKE — the proof the door is real", async () => {
    const before = readDevDb().problems.length;
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A01", by: "owner:test", reason: "test pause" });
    try {
      const res = await intakePost(intakeRequest("The AC won't turn on at all"));
      expect(res.status).toBe(503);
      const body = await res.json();
      // The customer keeps their text and is told honestly — never a fallback
      // to the implementation, which would mean the switch stopped nothing.
      expect(body.error).toMatch(/your text is still here/i);
      expect(readDevDb().problems.length).toBe(before);
    } finally {
      await releaseKillSwitch({ scope: "AGENT", scope_ref: "A01", by: "owner:test" });
    }
  });

  it("NOTHING THE HOMEOWNER SEES MOVED — same response shape, same packet words", async () => {
    const j = await driveJourney(AC);
    expect(j.body.request_id).toMatch(/^rq_/);
    expect(j.body.next).toBe(`/complete/${j.body.request_id}`);
    expect(j.body.safety).toBeNull();
    expect(Object.keys(j.body).sort()).toEqual(["next", "request_id", "safety"]);

    // One packet, version 1, and the customer's own sentence inside it verbatim.
    expect(j.packet.length).toBe(1);
    expect(j.packet[0].packet_version).toBe(1);
    expect(j.packet[0].summary_plain).toContain(AC);
    expect(j.packet[0].engine).toBe("fixture");
    // A02 now has a real claim basis to record, where it previously had none.
    expect(j.packet[0].claim_basis?.length).toBe(j.problem.claim_ids.length);
  });
});
