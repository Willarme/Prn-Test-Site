import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  classifyProblem,
  compareClassification,
  selectClarifier,
} from "@/domain/problem/capabilities";
import { analyzeProblemFixture } from "@/domain/problem/fixture-engine";
import { findPlaybook } from "@/domain/intake/playbooks";
import { engageKillSwitch, resetKillSwitchForTests } from "@/platform/killswitch";
import { recentAgentRuns, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { requirePolicyNumber } from "@/platform/policy/store";

/**
 * A01 STEP 4 — THE PRODUCTION CAPABILITY SURFACE.
 *
 * What is worth proving about a file that mostly composes existing pieces:
 * that the composition did not weaken any of them. The safety gate still runs
 * first, the deterministic answer is still what ships, the governed door is
 * genuinely governed (a kill switch stops it), and the facts it now produces
 * trace to real evidence.
 */
const NOW = "2026-08-25T00:00:00Z";

function ids() {
  let n = 0;
  return () => `t${(n += 1)}`;
}

beforeEach(() => {
  resetKillSwitchForTests();
  resetAgentRunLedgerForTests();
});

describe("A01 — classifyProblem", () => {
  it("the deterministic answer is byte-identical to the shipped analyzer", async () => {
    const input = {
      description: "my kitchen sink is leaking under the cabinet",
      intake_session_id: null,
      problem_family_hint: null,
      now: NOW,
    };
    const direct = analyzeProblemFixture(input);
    const out = await classifyProblem(input, { allow_model: false, new_id: ids() });
    expect(out.ok).toBe(true);
    expect(out.engine).toBe("deterministic");
    expect(out.result?.evidence).toEqual(direct.evidence);
    // Identical except claim_ids, which is the one thing this path adds.
    expect({ ...out.result?.problem, claim_ids: [] }).toEqual(direct.problem);
    expect(out.cost_usd).toBeNull();
  });

  it("A HARD-STOP SAFETY RULE ENDS IT BEFORE ANYTHING ELSE — no record, no facts", async () => {
    const out = await classifyProblem(
      {
        description: "I smell gas in the kitchen and it is getting stronger",
        intake_session_id: null,
        problem_family_hint: null,
        now: NOW,
      },
      { new_id: ids() }
    );
    expect(out.result).toBeNull();
    expect(out.claims).toEqual([]);
    expect(out.derivation).toBeNull();
    expect(out.safety_rule_id).toBe("safety_gas");
    expect(out.fallback_reason).toMatch(/hard stop/);
    // Nothing ran at all: no capability call, so no ledger row.
    expect(recentAgentRuns()).toHaveLength(0);
  });

  it("goes through the GOVERNED DOOR — the kill switch actually stops A01", async () => {
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A01", by: "owner:test", reason: "test pause" });
    const out = await classifyProblem(
      {
        description: "the ac is not cooling at all",
        intake_session_id: null,
        problem_family_hint: null,
        now: NOW,
      },
      { allow_model: false, new_id: ids() }
    );
    expect(out.ok).toBe(false);
    expect(out.result).toBeNull();
    expect(out.claims).toEqual([]);
    expect(out.refusal).toMatch(/blocked/);
    expect(out.fallback_reason).toMatch(/refused/);
  });

  it("records the classification as a claim — the biggest inference is on the ledger too", async () => {
    const out = await classifyProblem(
      {
        description: "the ac is not cooling and the outside unit is silent",
        intake_session_id: null,
        problem_family_hint: null,
        now: NOW,
      },
      { allow_model: false, new_id: ids() }
    );
    const category = out.claims.find((c) => c.predicate === "likely_service_category");
    expect(category).toBeDefined();
    expect(category?.object).toBe("hvac");
    expect(category?.claim_class).toBe("INFERRED");
    expect(category?.provenance).toBe("inferred");
    expect(category?.confidence).toBe("medium");
    expect(category?.evidence_ids).toEqual([out.result?.evidence.evidence_id]);
    expect(category?.privacy_class).toBe("USER_PRIVATE");
  });

  it("turns the homeowner's OWN words into SUPPLIED claims, and only those", async () => {
    const playbook = findPlaybook("pb_hvac_cooling_v1");
    const out = await classifyProblem(
      {
        description: "the ac stopped cooling, the system is about 8 years old",
        intake_session_id: null,
        problem_family_hint: null,
        now: NOW,
      },
      { allow_model: false, new_id: ids(), fields: playbook!.required_fields }
    );
    const supplied = out.claims.filter((c) => c.provenance === "supplied");
    expect(supplied.length).toBeGreaterThan(0);
    for (const c of supplied) {
      expect(c.claim_class).toBe("SUPPLIED");
      // Not something we are confident about — something they said.
      expect(c.confidence).toBeNull();
      // Its value came out of the description, verbatim.
      expect(out.result?.evidence.content.toLowerCase()).toContain(c.object.toLowerCase());
    }
  });

  it("establishes NO supplied claims when no field set is supplied — never guesses", async () => {
    const out = await classifyProblem(
      {
        description: "the ac stopped cooling, the system is about 8 years old",
        intake_session_id: null,
        problem_family_hint: null,
        now: NOW,
      },
      { allow_model: false, new_id: ids() }
    );
    expect(out.claims.every((c) => c.provenance === "inferred")).toBe(true);
  });

  it("writes ONE derivation naming every version that could be blamed", async () => {
    const out = await classifyProblem(
      {
        description: "my roof is leaking after the storm",
        intake_session_id: null,
        problem_family_hint: null,
        now: NOW,
      },
      { allow_model: false, new_id: ids() }
    );
    expect(out.derivation).not.toBeNull();
    expect(out.derivation?.method).toBe("deterministic");
    expect(out.derivation?.capability_key).toBe("classify_home_problem");
    expect(out.derivation?.model_id).toBeNull();
    expect(out.derivation?.prompt_id).toBeNull();
    // Taxonomy AND safety package versions — "which trade list was in force" is
    // exactly the question a wrong classification raises.
    expect(out.derivation?.policy_version).toMatch(/prn_trial_home_services_v1@1/);
    expect(out.derivation?.policy_version).toMatch(/prn_trial_us_v1@2/);
    expect(out.derivation?.claim_ids).toEqual(out.claims.map((c) => c.claim_id));
  });

  it("puts the claim ids on the record it returns", async () => {
    const out = await classifyProblem(
      {
        description: "my roof is leaking after the storm",
        intake_session_id: null,
        problem_family_hint: null,
        now: NOW,
      },
      { allow_model: false, new_id: ids() }
    );
    expect(out.result?.problem.claim_ids).toEqual(out.claims.map((c) => c.claim_id));
    expect(out.result?.problem.claim_ids.length).toBeGreaterThan(0);
  });
});

describe("A01 — selectClarifier", () => {
  const playbook = findPlaybook("pb_hvac_cooling_v1")!;
  const max = requirePolicyNumber("intake.max_clarifying_questions");

  it("selects the playbook's own highest-priority open field", async () => {
    const out = await selectClarifier(
      { playbook, answered_field_keys: [], asked_count: 0, max_questions: max },
      { allow_model: false }
    );
    expect(out.ok).toBe(true);
    expect(out.ask).not.toBeNull();
    expect(out.ask?.priority).toBe("core");
    expect(playbook.required_fields.map((f) => f.field_key)).toContain(out.ask?.field_key);
  });

  it("AT THE CAP NOTHING RUNS — no capability call, no ledger row, no event", async () => {
    const out = await selectClarifier(
      { playbook, answered_field_keys: [], asked_count: max, max_questions: max },
      { allow_model: false }
    );
    expect(out.ask).toBeNull();
    expect(out.reason).toMatch(/ceiling is reached/);
    // "No question was asked" and "a question was asked then suppressed" are
    // different facts, and the ledger should say which.
    expect(recentAgentRuns()).toHaveLength(0);
  });

  it("a kill switch on A01 stops the clarifier too", async () => {
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A01", by: "owner:test", reason: "test pause" });
    const out = await selectClarifier(
      { playbook, answered_field_keys: [], asked_count: 0, max_questions: max },
      { allow_model: false }
    );
    expect(out.ok).toBe(false);
    expect(out.ask).toBeNull();
    expect(out.refusal).toMatch(/blocked/);
  });
});

describe("A01 — re-classification is a comparison, not an overwrite", () => {
  it("reports what changed without writing anything", () => {
    const a = analyzeProblemFixture({
      description: "water is coming through the ceiling",
      intake_session_id: null,
      problem_family_hint: null,
      now: NOW,
    }).problem;
    const b = analyzeProblemFixture({
      description: "my roof is leaking after the storm and shingles came off",
      intake_session_id: null,
      problem_family_hint: null,
      now: NOW,
    }).problem;
    const same = compareClassification(a, a);
    expect(same.changed).toBe(false);
    expect(same.changed_fields).toEqual([]);

    const diff = compareClassification(a, b);
    expect(diff.changed).toBe(true);
    expect(diff.changed_fields).toContain("service_category");
    expect(diff.before.service_category).toBe(a.service_category);
    expect(diff.after.service_category).toBe(b.service_category);
  });
});

describe("A01 — the file it was told not to touch", () => {
  it("fixture-engine.ts keeps both halves and the registry's path bindings hold", () => {
    const engine = readFileSync(join(process.cwd(), "src/domain/problem/fixture-engine.ts"), "utf-8");
    expect(engine).toMatch(/export function analyzeProblemFixture/);
    expect(engine).toMatch(/export function buildJobPacketFixture/);
    const registry = readFileSync(
      join(process.cwd(), "src/platform/capabilities/registry.ts"),
      "utf-8"
    );
    expect(registry).toMatch(
      /analyzeProblemFixture \(FixtureProblemAnalyzer\) @ src\/domain\/problem\/fixture-engine\.ts/
    );
    expect(registry).toMatch(
      /buildJobPacketFixture \(FixtureJobPacketBuilder\) @ src\/domain\/problem\/fixture-engine\.ts/
    );
  });

  /**
   * startIntake is shared by the JSON and multipart entry points. T1-35 S2
   * retains its governed A01 classification and existing model policy gates;
   * homeowner question selection now uses the deterministic shared-fact
   * registry. Packet assembly remains A02's capability boundary.
   */
  it("the live intake path goes THROUGH A01's surface, not around it", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/intake/route.ts"), "utf-8");
    const live = readFileSync(join(process.cwd(), "src/platform/intake/start.ts"), "utf-8");
    expect(live).toMatch(/from "@\/domain\/problem\/capabilities"/);
    expect(live).toMatch(/classifyProblem\(/);
    // T1-35 S2: the two authored banks use shared facts and deterministic
    // selection. Classification keeps A01's governed capability boundary.
    const readiness = readFileSync(join(process.cwd(), "src/platform/intake/readiness.ts"), "utf-8");
    expect(live).toMatch(/clarifierCandidates\(/);
    expect(live).not.toMatch(/selectClarifier\(/);
    expect(readiness).toMatch(/selectQuestionScreen\(/);
    expect(readiness).toMatch(/recordIntakeSelection\(/);
    expect(readiness).not.toMatch(/selectClarifier\(|select_clarifying_questions/);
    // The whole point: no direct CALL to the implementation, which would mean a
    // kill switch on A01 stops nothing. (The name may still appear in the note
    // recording what this path used to do — a check that cannot tell a rule
    // from its own explanation reports the documentation as the violation.)
    for (const source of [route, live]) {
      expect(source).not.toMatch(/analyzeProblemFixture\s*\(/);
      expect(source).not.toMatch(/import .*analyzeProblemFixture/);
    }
    // Classification may consult its alternate through the existing gateway;
    // this source check grants no new model or live-use authorization.
    expect(live).toMatch(/allow_model: true/);
    expect(live).not.toMatch(/allow_model: false/);
  });

  it("A02's packet path still does not import A01's surface", () => {
    for (const file of ["src/platform/intake/complete.ts", "src/domain/problem/packet-assembly.ts"]) {
      const content = readFileSync(join(process.cwd(), file), "utf-8");
      expect(content, file).not.toMatch(/domain\/problem\/capabilities/);
    }
  });
});
