import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { engageKillSwitch, releaseKillSwitch } from "@/platform/killswitch";
import { readDevDb } from "@/platform/stores/dev-db";
import { runtimeStore } from "@/platform/stores/runtime";

/**
 * A01'S PRODUCTION SURFACE, PROVEN BY DRIVING THE REAL ROUTE.
 *
 * ─── WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────
 *
 * A01's surface shipped with a full test suite and ZERO live callers. Every one
 * of those tests called `classifyProblem` directly, so all of them passed while
 * the running app produced no FactClaim, no DerivationRecord (`claim_ids: []`
 * on every stored record) and could not fire either of the two instruments A01
 * owns. Reading the code proved the surface worked; nothing proved it was
 * REACHED.
 *
 * So every assertion below goes through `POST /api/intake` — the same entry the
 * browser posts to — and then reads the persisted records back out of the
 * store. Nothing here imports A01's surface, on purpose: a test that called it
 * would be measuring the same thing the old suite already measured.
 *
 * ─── AND THE OTHER HALF: THE HOMEOWNER'S JOURNEY IS UNCHANGED ──────────────
 *
 * The last case pins the customer-visible response shape and the packet's own
 * words, because "richer records behind it" is only true if the thing in front
 * of it did not move.
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

  it("both A01 instruments fire on the live path — and neither carries the homeowner's words", async () => {
    const marker = "the PURPLE THERMOSTAT in the hallway is blank and the AC won't start";
    const j = await driveJourney(marker);

    const facts = j.events.filter(
      (e) => e.event_name === "problem.fact_extracted" && e.context.problem_id === j.problem.problem_id
    );
    const asked = j.events.filter(
      (e) => e.event_name === "intake.clarifier_asked" && e.context.request_id === j.body.request_id
    );
    // Neither of these could fire anywhere in the running app before this wiring.
    expect(facts.length).toBe(j.problem.claim_ids.length);
    expect(asked.length).toBeGreaterThan(0);

    // The fact envelope carries ids and classifications — never the claim's value.
    for (const e of facts) {
      expect(e.context.claim_id).toMatch(/^fc_/);
      expect(e.context.claim_class).toBeTruthy();
      expect(e.privacy_class).toBe("internal");
    }
    // The clarifier envelope carries the field key; the question's own words
    // live in the playbook and the answer lives in the IntakeAnswer row.
    for (const e of asked) {
      expect(e.context.field_key).toBeTruthy();
      expect(e.context.playbook_id).toBeTruthy();
    }
    expect(JSON.stringify([...facts, ...asked])).not.toContain("PURPLE THERMOSTAT");
  });

  it("the questions asked stay inside A01's configured ceiling and are never repeated", async () => {
    const j = await driveJourney("AC blowing warm air, nothing else seems wrong");
    const asked = j.events.filter(
      (e) => e.event_name === "intake.clarifier_asked" && e.context.request_id === j.body.request_id
    );
    const keys = asked.map((e) => e.context.field_key);
    expect(new Set(keys).size).toBe(keys.length); // no question selected twice
    for (const e of asked) {
      expect(Number(e.context.asked_count)).toBeLessThan(Number(e.context.max_questions));
    }
    expect(keys.length).toBeLessThanOrEqual(Number(asked[0].context.max_questions));
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
