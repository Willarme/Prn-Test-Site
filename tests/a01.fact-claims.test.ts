import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ClaimClass,
  DerivationRecord,
  FactClaim,
  PrivacyClass,
} from "@/domain/problem/contracts";
import {
  PRIVACY_CLASS_MAPPING,
  assertA01MayWritePrivacyClass,
  claimProvenanceFor,
  newDerivationRecord,
  newFactClaim,
  publicEligibilityFor,
} from "@/domain/problem/claims";

/**
 * A01 STEP 2 — THE MOAT OBJECTS.
 *
 * `FactClaim` and `DerivationRecord` are canon-named durable objects that
 * returned zero hits in src/ before this build. What is worth proving is not
 * that they parse — it is the three rules they exist to make mechanical:
 * a fact cannot exist without evidence, a homeowner's own words cannot be
 * relabelled as our inference, and nothing A01 writes can start life public.
 */
const NOW = "2026-08-25T00:00:00Z";

function claim(overrides: Partial<Parameters<typeof newFactClaim>[0]> = {}) {
  return newFactClaim({
    claim_id: "fc_1",
    problem_id: "pr_1",
    subject: "problem",
    predicate: "affected_system",
    object: "water heater",
    claim_class: "SUPPLIED",
    evidence_ids: ["ev_1"],
    created_at: NOW,
    ...overrides,
  });
}

describe("A01 — FactClaim", () => {
  it("cannot exist without evidence — the schema refuses, with no escape hatch", () => {
    expect(() => claim({ evidence_ids: [] })).toThrow();
    const direct = FactClaim.safeParse({ ...claim(), evidence_ids: [] });
    expect(direct.success).toBe(false);
  });

  it("derives provenance from claim_class in exactly one place, for every class", () => {
    for (const cls of ClaimClass.options) {
      const built = claim({ claim_class: cls });
      expect(built.provenance, cls).toBe(claimProvenanceFor(cls));
    }
    expect(claimProvenanceFor("SUPPLIED")).toBe("supplied");
    expect(claimProvenanceFor("OBSERVED")).toBe("supplied");
    expect(claimProvenanceFor("INFERRED")).toBe("inferred");
    expect(claimProvenanceFor("CALCULATED")).toBe("inferred");
  });

  it("carries a per-fact confidence that is NOT the classification's confidence", () => {
    // An inferred fact is a hypothesis and says so.
    const inferred = claim({ claim_class: "INFERRED", confidence: "low" });
    expect(inferred.confidence).toBe("low");
    // The homeowner's own words are not something we are 60% sure of.
    const supplied = claim({ claim_class: "SUPPLIED", confidence: "high" });
    expect(supplied.confidence).toBeNull();
    // And the field is genuinely separate from ProblemRecord's — different name,
    // different object, different question.
    expect(Object.keys(FactClaim.shape)).toContain("confidence");
    expect(Object.keys(FactClaim.shape)).not.toContain("service_category_confidence");
  });

  it("names the evidence it came from", () => {
    expect(claim({ evidence_ids: ["ev_a", "ev_b"] }).evidence_ids).toEqual(["ev_a", "ev_b"]);
  });

  it("defaults to USER_PRIVATE and offers no way to ask for anything else", () => {
    expect(claim().privacy_class).toBe("USER_PRIVATE");
    expect(claim().public_eligibility).toBe("NO");
    // Privacy is not a parameter of the constructor — the choice is not offered.
    const source = readFileSync(join(process.cwd(), "src/domain/problem/claims.ts"), "utf-8");
    expect(source).not.toMatch(/privacy_class:\s*input\./);
    expect(source).not.toMatch(/function elevate/i);
  });

  it("refuses an elevation outright, per class", () => {
    expect(() => assertA01MayWritePrivacyClass("USER_PRIVATE")).not.toThrow();
    for (const cls of PrivacyClass.options.filter((c) => c !== "USER_PRIVATE")) {
      expect(() => assertA01MayWritePrivacyClass(cls), cls).toThrow(/may not write privacy class/);
    }
  });

  it("records the four-vocabulary mapping as data, and it is total", () => {
    for (const cls of PrivacyClass.options) {
      const row = PRIVACY_CLASS_MAPPING.find((r) => r.privacy_class === cls);
      expect(row, `${cls} has no mapping row`).toBeDefined();
      expect(publicEligibilityFor(cls)).toBe(row?.public_eligibility);
    }
    // Only the private tier has an EvidenceObject counterpart: raw evidence is
    // always private, so the other two rows must be null rather than invented.
    expect(PRIVACY_CLASS_MAPPING.filter((r) => r.evidence_privacy !== null)).toHaveLength(1);
  });
});

describe("A01 — DerivationRecord", () => {
  it("records what produced a claim, with every version that could be blamed", () => {
    const d = newDerivationRecord({
      derivation_id: "dr_1",
      problem_id: "pr_1",
      claim_ids: ["fc_1"],
      method: "model",
      capability_key: "classify_home_problem",
      model_id: "vendor/model-x",
      prompt_id: "a01.classify_home_problem",
      prompt_version: "1.0.0",
      schema_contract_version: "1.0.0",
      policy_version: "vocabulary@1",
      input_evidence_ids: ["ev_1"],
      agent_run_id: "ar_1",
      created_at: NOW,
    });
    expect(DerivationRecord.parse(d)).toEqual(d);
    expect(d.method).toBe("model");
    expect(d.prompt_version).toBe("1.0.0");
    expect(d.agent_run_id).toBe("ar_1");
  });

  it("the deterministic path names no model rather than inventing one", () => {
    const d = newDerivationRecord({
      derivation_id: "dr_2",
      problem_id: "pr_1",
      claim_ids: [],
      method: "deterministic",
      capability_key: "classify_home_problem",
      input_evidence_ids: ["ev_1"],
      created_at: NOW,
    });
    expect(d.model_id).toBeNull();
    expect(d.prompt_id).toBeNull();
    expect(d.method).toBe("deterministic");
  });
});

describe("A01 — the hand-offs it declines this wave (HO-1 / HO-5)", () => {
  it("writes nothing into source_fact_bundle_ids, and imports no search contract", () => {
    for (const file of ["src/domain/problem/claims.ts", "src/domain/problem/contracts.ts"]) {
      const source = readFileSync(join(process.cwd(), file), "utf-8");
      expect(source, file).not.toMatch(/source_fact_bundle_ids\s*[:=]/);
      expect(source, file).not.toMatch(/from "@\/domain\/search/);
    }
  });
});
