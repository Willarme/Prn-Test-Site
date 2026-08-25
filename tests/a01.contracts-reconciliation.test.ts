import { describe, expect, it } from "vitest";
import {
  DEFAULT_TENANT_ID,
  EvidenceObject,
  ProblemRecord,
} from "@/domain/problem/contracts";
import { analyzeProblemFixture } from "@/domain/problem/fixture-engine";

/**
 * A01 STEP 1 — RECONCILE, DO NOT REDEFINE.
 *
 * The shipped `ProblemRecord` is imported by eleven files and is parity-named
 * against the Build Kit schema. A01's spec proposes different names for the same
 * object. This suite proves the build took the additive route: the established
 * field names are all still there, spelled the way every importer spells them,
 * and the only thing that grew is an optional tenant.
 *
 * If a later change renames one of these, this file fails BEFORE A02's packet
 * assembly and the results page do — which is the point of pinning them.
 */
describe("A01 — ProblemRecord reconciliation", () => {
  const ESTABLISHED_FIELDS = [
    "problem_id",
    "schema_version",
    "status",
    "source_channel",
    "intake_session_id",
    "problem_summary",
    "service_category",
    "service_category_confidence",
    "safety_state",
    "safety_rule_id",
    "evidence_ids",
    "claim_ids",
    "clarifiers_asked",
    "created_at",
    "updated_at",
  ] as const;

  it("keeps every established field name — nothing was renamed to the spec's vocabulary", () => {
    const shape = Object.keys(ProblemRecord.shape);
    for (const field of ESTABLISHED_FIELDS) {
      expect(shape, `${field} is imported by name in eleven files`).toContain(field);
    }
    // The spec's competing names must NOT have appeared alongside them: two
    // spellings of one field is worse than one disputed spelling.
    for (const proposed of [
      "user_language",
      "normalized_class",
      "clarifier_answers",
      "safety_flags",
      "confidence",
    ]) {
      expect(shape, `${proposed} would be a second name for a shipped field`).not.toContain(
        proposed
      );
    }
  });

  it("adds tenant_id as OPTIONAL — a record written before this change still parses", () => {
    const legacy = {
      problem_id: "pr_legacy",
      schema_version: "1.0.0",
      status: "packet_ready",
      source_channel: "web",
      intake_session_id: null,
      problem_summary: "the kitchen tap drips",
      service_category: "plumbing",
      service_category_confidence: "medium",
      safety_state: "normal",
      safety_rule_id: null,
      evidence_ids: ["ev_1"],
      claim_ids: [],
      clarifiers_asked: [],
      created_at: "2026-08-25T00:00:00Z",
      updated_at: null,
    };
    const parsed = ProblemRecord.parse(legacy);
    expect(parsed.tenant_id).toBeUndefined();
    expect(ProblemRecord.parse({ ...legacy, tenant_id: DEFAULT_TENANT_ID }).tenant_id).toBe("prn");
    // An empty tenant is a bug, not a default.
    expect(ProblemRecord.safeParse({ ...legacy, tenant_id: "" }).success).toBe(false);
  });

  it("EvidenceObject took the same optional tenant, and kept `privacy: private` closed", () => {
    expect(Object.keys(EvidenceObject.shape)).toContain("tenant_id");
    const ev = {
      evidence_id: "ev_1",
      kind: "customer_text",
      content: "the tap drips",
      privacy: "private",
      captured_at: "2026-08-25T00:00:00Z",
    };
    expect(EvidenceObject.parse(ev).tenant_id).toBeUndefined();
    // The privacy class is a literal for a reason — it cannot be widened by data.
    expect(EvidenceObject.safeParse({ ...ev, privacy: "public" }).success).toBe(false);
  });

  it("the shipped analyzer's output is unchanged by the extension", () => {
    const out = analyzeProblemFixture({
      description: "my kitchen sink is leaking under the cabinet",
      intake_session_id: null,
      problem_family_hint: null,
      now: "2026-08-25T00:00:00Z",
    });
    expect(out.problem.service_category).toBe("plumbing");
    expect(out.problem.safety_state).toBe("normal");
    // Nothing started writing a tenant into the customer path.
    expect(out.problem.tenant_id).toBeUndefined();
    expect(out.evidence.tenant_id).toBeUndefined();
  });
});
