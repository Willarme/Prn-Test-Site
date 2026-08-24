import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import {
  cleanConsentEvent,
  cleanEventEnvelope,
  cleanJobPacket,
  cleanProblemRecord,
  cleanSearchOpportunity,
} from "@/platform/quality/fixtures";
import {
  INVARIANT_RULES,
  INVARIANT_RULE_SET_VERSION,
  evaluateSubject,
  findRule,
  rulesFor,
  type InvariantContext,
  type QualitySubject,
} from "@/platform/quality/invariants";
import { DetailCode, EntityType, Severity } from "@/platform/quality/types";

/**
 * A09 §9 step 1 failable check: "each rule has at least one unit test with a
 * deliberately-broken fixture that proves the rule catches the break, and one
 * clean fixture that proves it doesn't false-positive."
 *
 * Both halves matter equally. A rule that catches everything is not a rule, it
 * is an outage — and a false positive in this agent quarantines a real
 * homeowner's record.
 */

function fires(subject: QualitySubject, ruleId: string, ctx: InvariantContext = {}): boolean {
  return evaluateSubject(subject, ctx).some((e) => e.rule.rule_id === ruleId);
}

function problem(record = cleanProblemRecord()): QualitySubject {
  return { entity_type: "problem_record", entity_id: record.problem_id, record };
}
function packet(record = cleanJobPacket()): QualitySubject {
  return { entity_type: "job_packet", entity_id: record.job_packet_id, record };
}
function opportunity(record = cleanSearchOpportunity()): QualitySubject {
  return { entity_type: "search_opportunity", entity_id: record.search_opportunity_id, record };
}
function envelope(record = cleanEventEnvelope()): QualitySubject {
  return { entity_type: "event_envelope", entity_id: record.event_id, record };
}
function consent(record = cleanConsentEvent()): QualitySubject {
  return { entity_type: "consent_event", entity_id: record.consent_event_id, record };
}
function pageSpec(status = SAMPLE_PAGE_SPEC.status): QualitySubject {
  const record = { ...SAMPLE_PAGE_SPEC, status };
  return { entity_type: "page_spec", entity_id: record.page_spec_id, record };
}

/** Resolver that says "yes, everything exists" — the clean-world context. */
const allExist: InvariantContext = { exists: () => true, is_registered_event_name: () => true };

describe("A09 invariant rule set — shape and versioning", () => {
  it("is versioned as a set and per rule", () => {
    expect(INVARIANT_RULE_SET_VERSION).toBeGreaterThanOrEqual(1);
    for (const r of INVARIANT_RULES) {
      expect(r.rule_version, r.rule_id).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(r.rule_version), r.rule_id).toBe(true);
    }
  });

  it("has unique rule ids", () => {
    const ids = INVARIANT_RULES.map((r) => r.rule_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries the reserved tenant_id default on every rule, with no tenant logic", () => {
    for (const r of INVARIANT_RULES) expect(r.tenant_id, r.rule_id).toBe("prn");
  });

  it("declares a valid entity type and severity on every rule", () => {
    for (const r of INVARIANT_RULES) {
      expect(EntityType.safeParse(r.applies_to).success, r.rule_id).toBe(true);
      expect(Severity.safeParse(r.severity_default).success, r.rule_id).toBe(true);
    }
  });

  it("gives every rule a real human description — that is where the words live, not on the finding", () => {
    for (const r of INVARIANT_RULES) {
      expect(r.description.length, r.rule_id).toBeGreaterThan(60);
    }
  });

  it("covers every entity type A09 declares it watches, except the pure link target", () => {
    const covered = new Set(INVARIANT_RULES.map((r) => r.applies_to));
    for (const type of [
      "problem_record",
      "job_packet",
      "search_opportunity",
      "page_spec",
      "event_envelope",
      "consent_event",
    ] as const) {
      expect(covered.has(type), `no rule watches ${type}`).toBe(true);
    }
  });

  it("marks the consent ledger detect-only and nothing else", () => {
    for (const r of INVARIANT_RULES) {
      expect(r.detect_only, r.rule_id).toBe(r.applies_to === "consent_event");
    }
  });

  it("names an owner only where the rule genuinely knows one — null, never a guess", () => {
    for (const r of INVARIANT_RULES) {
      expect(r.declared_owner === null || /^A\d\d$/.test(r.declared_owner), r.rule_id).toBe(true);
    }
  });
});

describe("problem_record.required_ids", () => {
  it("catches a blank problem_id (broken fixture)", () => {
    expect(fires(problem(cleanProblemRecord({ problem_id: "  " })), "problem_record.required_ids")).toBe(true);
  });
  it("catches a blank evidence id (broken fixture)", () => {
    expect(
      fires(problem(cleanProblemRecord({ evidence_ids: ["ev_1", ""] })), "problem_record.required_ids")
    ).toBe(true);
  });
  it("catches a blank claim id (broken fixture)", () => {
    expect(
      fires(problem(cleanProblemRecord({ claim_ids: [" "] })), "problem_record.required_ids")
    ).toBe(true);
  });
  it("does not fire on the clean fixture", () => {
    expect(fires(problem(), "problem_record.required_ids")).toBe(false);
  });
  it("does not fire on a clean record with no evidence yet", () => {
    expect(
      fires(problem(cleanProblemRecord({ evidence_ids: [] })), "problem_record.required_ids")
    ).toBe(false);
  });
});

describe("problem_record.packet_ready_requires_session", () => {
  const RULE = "problem_record.packet_ready_requires_session";
  it("catches packet_ready with no intake session (broken fixture)", () => {
    expect(fires(problem(cleanProblemRecord({ intake_session_id: null })), RULE)).toBe(true);
  });
  it("catches closed with no intake session (broken fixture)", () => {
    expect(
      fires(problem(cleanProblemRecord({ status: "closed", intake_session_id: null })), RULE)
    ).toBe(true);
  });
  it("does not fire on the clean fixture", () => {
    expect(fires(problem(), RULE)).toBe(false);
  });
  it("does not fire on a draft that legitimately has no session yet", () => {
    expect(
      fires(problem(cleanProblemRecord({ status: "draft", intake_session_id: null })), RULE)
    ).toBe(false);
  });
});

describe("problem_record.legal_transition", () => {
  const RULE = "problem_record.legal_transition";
  it("catches a backwards transition (broken fixture)", () => {
    expect(fires(problem(cleanProblemRecord({ status: "draft" })), RULE, { previous_status: "closed" })).toBe(true);
  });
  it("catches an unknown previous status (broken fixture)", () => {
    expect(fires(problem(), RULE, { previous_status: "zombie" })).toBe(true);
  });
  it("does not fire on a legal forward transition", () => {
    expect(fires(problem(), RULE, { previous_status: "clarifying" })).toBe(false);
  });
  it("does not fire when the caller does not know the previous status", () => {
    expect(fires(problem(), RULE, {})).toBe(false);
    expect(fires(problem(), RULE, { previous_status: null })).toBe(false);
  });
  it("does not fire when the status did not change", () => {
    expect(fires(problem(), RULE, { previous_status: "packet_ready" })).toBe(false);
  });
});

describe("problem_record.duplicate_candidate (flag only, never a merge)", () => {
  const RULE = "problem_record.duplicate_candidate";
  it("flags a sibling sharing the intake session (broken fixture)", () => {
    const evals = evaluateSubject(problem(), { duplicate_sibling_ids: ["pr_other_0002"] });
    const hit = evals.find((e) => e.rule.rule_id === RULE);
    expect(hit).toBeDefined();
    expect(hit!.violation.related_entity_ids).toEqual(["pr_other_0002"]);
  });
  it("does not fire on the clean fixture with no siblings", () => {
    expect(fires(problem(), RULE)).toBe(false);
    expect(fires(problem(), RULE, { duplicate_sibling_ids: [] })).toBe(false);
  });
  it("stays low severity — a duplicate is a question for a human, not a quarantine", () => {
    expect(findRule(RULE)!.severity_default).toBe("low");
  });
  it("caps related ids so a sweep cannot dump a table into a finding", () => {
    const many = Array.from({ length: 60 }, (_, i) => `pr_${i}`);
    const evals = evaluateSubject(problem(), { duplicate_sibling_ids: many });
    const hit = evals.find((e) => e.rule.rule_id === RULE)!;
    expect(hit.violation.related_entity_ids!.length).toBe(25);
  });
});

describe("job_packet.problem_link", () => {
  const RULE = "job_packet.problem_link";
  it("catches a dangling problem reference (broken fixture)", () => {
    expect(fires(packet(), RULE, { exists: () => false })).toBe(true);
  });
  it("catches a blank problem_id (broken fixture)", () => {
    expect(fires(packet(cleanJobPacket({ problem_id: "" })), RULE, allExist)).toBe(true);
  });
  it("does not fire on the clean fixture with a resolving reference", () => {
    expect(fires(packet(), RULE, allExist)).toBe(false);
  });
  it("does not fire when the caller cannot resolve — unknown is not a violation", () => {
    expect(fires(packet(), RULE, { exists: () => undefined })).toBe(false);
    expect(fires(packet(), RULE, {})).toBe(false);
  });
});

describe("job_packet.version_positive", () => {
  const RULE = "job_packet.version_positive";
  it("catches version 0 (broken fixture)", () => {
    expect(fires(packet(cleanJobPacket({ packet_version: 0 })), RULE, allExist)).toBe(true);
  });
  it("catches a fractional version (broken fixture)", () => {
    expect(fires(packet(cleanJobPacket({ packet_version: 1.5 })), RULE, allExist)).toBe(true);
  });
  it("does not fire on the clean fixture", () => {
    expect(fires(packet(), RULE, allExist)).toBe(false);
  });
});

describe("search_opportunity.legal_transition", () => {
  const RULE = "search_opportunity.legal_transition";
  it("catches a resurrection from retired (broken fixture)", () => {
    expect(
      fires(opportunity(cleanSearchOpportunity({ status: "approved" })), RULE, {
        previous_status: "retired",
      })
    ).toBe(true);
  });
  it("catches approved -> candidate, which un-decides an owner decision (broken fixture)", () => {
    expect(fires(opportunity(), RULE, { previous_status: "approved" })).toBe(true);
  });
  it("does not fire on candidate -> approved", () => {
    expect(
      fires(opportunity(cleanSearchOpportunity({ status: "approved" })), RULE, {
        previous_status: "candidate",
      })
    ).toBe(false);
  });
  it("does not fire on the clean fixture with no known previous status", () => {
    expect(fires(opportunity(), RULE)).toBe(false);
  });
});

describe("page_spec.legal_transition", () => {
  const RULE = "page_spec.legal_transition";
  it("catches STAGED -> PUBLISHED, which would skip the owner gate (broken fixture)", () => {
    expect(fires(pageSpec("PUBLISHED"), RULE, { previous_status: "STAGED" })).toBe(true);
  });
  it("catches anything out of RETIRED (broken fixture)", () => {
    expect(fires(pageSpec("STAGED"), RULE, { previous_status: "RETIRED" })).toBe(true);
  });
  it("does not fire on QA_PASS -> PUBLISHED, the owner's own legal move", () => {
    expect(fires(pageSpec("PUBLISHED"), RULE, { previous_status: "QA_PASS" })).toBe(false);
  });
  it("does not fire on the clean shipped sample spec", () => {
    expect(fires(pageSpec(), RULE, allExist)).toBe(false);
  });
});

describe("event_envelope.entity_linkage", () => {
  const RULE = "event_envelope.entity_linkage";
  it("catches a dangling problem_id in context (broken fixture)", () => {
    expect(fires(envelope(), RULE, { exists: () => false, is_registered_event_name: () => true })).toBe(true);
  });
  it("does not fire on the clean fixture", () => {
    expect(fires(envelope(), RULE, allExist)).toBe(false);
  });
  it("does not fire on an event whose context names no entity", () => {
    expect(
      fires(envelope(cleanEventEnvelope({ context: {} })), RULE, { exists: () => false })
    ).toBe(false);
  });
});

describe("event_envelope.name_registered (schema drift, handed to A08)", () => {
  const RULE = "event_envelope.name_registered";
  it("catches an unregistered name (broken fixture)", () => {
    expect(
      fires(envelope(), RULE, { exists: () => true, is_registered_event_name: () => false })
    ).toBe(true);
  });
  it("does not fire on the clean fixture", () => {
    expect(fires(envelope(), RULE, allExist)).toBe(false);
  });
  it("names A08 as the owner — A09 flags naming drift, it never renames", () => {
    expect(findRule(RULE)!.declared_owner).toBe("A08");
  });
});

describe("consent_event.required_ids (detect only, permanently)", () => {
  const RULE = "consent_event.required_ids";
  it("catches a missing disclosure version (broken fixture)", () => {
    expect(fires(consent(cleanConsentEvent({ disclosure_version_id: "" })), RULE)).toBe(true);
  });
  it("catches consent with no subject at all (broken fixture)", () => {
    expect(
      fires(
        consent(cleanConsentEvent({ person_id: null, guest_session_id: null, problem_id: null })),
        RULE
      )
    ).toBe(true);
  });
  it("does not fire on the clean fixture", () => {
    expect(fires(consent(), RULE)).toBe(false);
  });
  it("is detect-only — the consent ledger is never a repair target", () => {
    expect(findRule(RULE)!.detect_only).toBe(true);
  });
});

describe("evaluateSubject contract", () => {
  it("runs only the rules that apply to the subject", () => {
    for (const e of evaluateSubject(problem(cleanProblemRecord({ problem_id: "" })))) {
      expect(e.rule.applies_to).toBe("problem_record");
    }
  });

  it("returns nothing for a clean world across every entity type", () => {
    expect(evaluateSubject(problem(), allExist)).toEqual([]);
    expect(evaluateSubject(packet(), allExist)).toEqual([]);
    expect(evaluateSubject(opportunity(), allExist)).toEqual([]);
    expect(evaluateSubject(pageSpec(), allExist)).toEqual([]);
    expect(evaluateSubject(envelope(), allExist)).toEqual([]);
    expect(evaluateSubject(consent(), allExist)).toEqual([]);
  });

  it("contains a throwing rule instead of taking the caller down", () => {
    const exploding: InvariantContext = {
      exists: () => {
        throw new Error("resolver exploded");
      },
    };
    const evals = evaluateSubject(packet(), exploding);
    expect(evals.some((e) => e.violation.detail_code === "rule_threw_during_evaluation")).toBe(true);
  });

  it("emits only bounded detail codes — no rule can produce a sentence", () => {
    const broken: QualitySubject[] = [
      problem(cleanProblemRecord({ problem_id: "" })),
      problem(cleanProblemRecord({ intake_session_id: null })),
      packet(cleanJobPacket({ packet_version: 0 })),
      consent(cleanConsentEvent({ disclosure_version_id: "" })),
    ];
    for (const subject of broken) {
      for (const e of evaluateSubject(subject, { exists: () => false })) {
        expect(DetailCode.safeParse(e.violation.detail_code).success, e.violation.detail_code).toBe(
          true
        );
      }
    }
  });

  it("has no rules for a type nothing watches, without throwing", () => {
    expect(rulesFor("intake_session")).toEqual([]);
  });
});

/**
 * Condition 9, enforced by reading the file rather than by trusting the prose:
 * the finding shapes must contain no escape hatch through which raw customer
 * evidence could travel into an admin page's serialized props.
 */
describe("no-raw-evidence, enforced structurally", () => {
  const typesSource = readFileSync(
    join(process.cwd(), "src", "platform", "quality", "types.ts"),
    "utf-8"
  );

  it("declares no unknown/any field anywhere in the record shapes", () => {
    const code = typesSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(/z\.unknown\(\)/);
    expect(code).not.toMatch(/z\.any\(\)/);
    expect(code).not.toMatch(/z\.record\(/);
  });

  it("makes every record shape strict, so an extra key is a rejection", () => {
    const strictCount = (typesSource.match(/\.strict\(\)/g) ?? []).length;
    expect(strictCount).toBeGreaterThanOrEqual(5);
  });

  it("rejects a detail_code carrying free text, a URL or consent wording", () => {
    for (const bad of [
      "the customer said the unit smells like burning",
      "https://example.com/photo.jpg",
      "Consent granted under disclosure v2",
      "UPPERCASE_CODE",
      "code with spaces",
      "a".repeat(49),
    ]) {
      expect(DetailCode.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("accepts the bounded codes the rules actually emit", () => {
    for (const good of ["missing_problem_id", "dangling_problem_reference", "backwards_status_transition"]) {
      expect(DetailCode.safeParse(good).success, good).toBe(true);
    }
  });
});
