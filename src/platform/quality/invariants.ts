import type { JobPacket, ProblemRecord } from "@/domain/problem/contracts";
import type { ConsentEvent } from "@/domain/privacy/contracts";
import type { SearchOpportunity } from "@/domain/search/contracts";
import { canTransition, type PageLifecycleStatus } from "@/domain/search/lifecycle";
import type { PageSpec } from "@/domain/search/pages";
import type { IntakeSession } from "@/domain/intake/contracts";
import type { EventEnvelope } from "@/platform/events/envelope";
import type { CheckKind, EntityType, Severity } from "@/platform/quality/types";

/**
 * A09 build step 1 — THE TRIAL INVARIANTS (§9 step 1): required IDs, legal
 * state transitions per object type, event-to-entity linkage.
 *
 * RULES ARE DATA AND CODE, AND THEY ARE VERSIONED. Each rule carries a stable
 * `rule_id` and its own `rule_version`, and the set carries
 * INVARIANT_RULE_SET_VERSION. A finding stores both, so a finding raised last
 * month can still be read against the rule as it was written — the same
 * discipline A08 applies to definitions, for the same reason: a rule that
 * changes meaning silently makes its own history unreadable.
 *
 * DETERMINISTIC, NO MODEL, EVER IN THIS PATH (§3). Every check below is a
 * field comparison, an enum membership test, a state-machine lookup or a set
 * join. A09 runs inline on writes; a model here would be a cost and latency
 * mistake even if one were wired anywhere else in the repo, and none is.
 *
 * A RULE NEVER MUTATES ITS SUBJECT and never reads outside it: the only
 * outside knowledge a check may use arrives on `InvariantContext`, which the
 * caller supplies. That keeps every rule unit-testable against a fixture with
 * no database, which is what makes the "one deliberately-broken fixture and one
 * clean fixture per rule" requirement affordable.
 *
 * WHAT A RULE MAY REPORT. A violation carries a `detail_code` (bounded
 * snake_case) and optional related IDs — never a message, never a value read
 * off the record. The human-readable half is the rule's own `description`,
 * which is authored code, so the admin view explains the failure without any
 * stored record carrying customer text (condition 9).
 */

export const INVARIANT_RULE_SET_VERSION = 1;

/** The subject under check, discriminated so each rule is narrowly typed. */
export type QualitySubject =
  | { entity_type: "problem_record"; entity_id: string; record: ProblemRecord }
  | { entity_type: "job_packet"; entity_id: string; record: JobPacket }
  | { entity_type: "search_opportunity"; entity_id: string; record: SearchOpportunity }
  | { entity_type: "page_spec"; entity_id: string; record: PageSpec }
  | { entity_type: "intake_session"; entity_id: string; record: IntakeSession & { request_id: string } }
  | { entity_type: "event_envelope"; entity_id: string; record: EventEnvelope }
  | { entity_type: "consent_event"; entity_id: string; record: ConsentEvent };

type RecordFor<T extends EntityType> = Extract<QualitySubject, { entity_type: T }>["record"];

/**
 * Everything a check may know beyond its own subject. Supplied by the caller
 * (the ingest guard or the reconciliation pass) so rules stay pure.
 */
export interface InvariantContext {
  /** Does this id resolve to a real row? Defaults to "unknown, do not judge". */
  exists?: (type: EntityType, id: string) => boolean | undefined;
  /** The subject's status before this write, when the caller knows it. */
  previous_status?: string | null;
  /** Is this event name in A08's approved dictionary? Schema-drift check. */
  is_registered_event_name?: (name: string) => boolean;
  /**
   * Sibling records that share the subject's duplicate fingerprint. FLAG ONLY:
   * A09 never merges (§7), and what counts as a duplicate homeowner problem is
   * an owner decision, not an engineering one — see the DUPLICATE rule below.
   */
  duplicate_sibling_ids?: readonly string[];
}

export interface RuleViolation {
  detail_code: string;
  /** Overrides the rule's default when the same rule can fail more or less badly. */
  severity?: Severity;
  related_entity_ids?: string[];
}

export interface InvariantRule<T extends EntityType = EntityType> {
  rule_id: string;
  rule_version: number;
  /** Reserved — white-label condition (a). Default "prn"; NO tenant logic. */
  tenant_id?: string;
  applies_to: T;
  kind: CheckKind;
  /** The human half. Authored code, shown in the admin drill-down — never customer data. */
  description: string;
  severity_default: Severity;
  /** An agent_id when the rule genuinely knows the owner; null is honest. */
  declared_owner: string | null;
  /**
   * True when a finding from this rule may never lead to a repair, whatever
   * the allow-list says. Set on the consent ledger, permanently.
   */
  detect_only: boolean;
  check(record: RecordFor<T>, ctx: InvariantContext): RuleViolation | null;
}

function rule<T extends EntityType>(def: InvariantRule<T>): InvariantRule<T> {
  return { tenant_id: "prn", ...def };
}

/** Legal ProblemRecord status progression (#14A §10.2 status enum). */
const PROBLEM_STATUS_ORDER = ["draft", "clarifying", "packet_ready", "closed"] as const;

/** Legal SearchOpportunity owner-decision transitions (domain/search/contracts.ts). */
const OPPORTUNITY_TRANSITIONS: Record<string, readonly string[]> = {
  candidate: ["approved", "watch", "merged", "rejected", "retired"],
  watch: ["candidate", "approved", "merged", "rejected", "retired"],
  approved: ["merged", "retired", "rejected"],
  merged: ["retired"],
  rejected: ["retired"],
  retired: [],
};

/** Context keys that name another entity, and the type each names. */
const LINKAGE_KEYS: readonly { key: string; type: EntityType }[] = [
  { key: "problem_id", type: "problem_record" },
  { key: "job_packet_id", type: "job_packet" },
  { key: "page_id", type: "page_spec" },
  { key: "search_opportunity_id", type: "search_opportunity" },
  { key: "intake_session_id", type: "intake_session" },
];

const problemRequiredIds = rule<"problem_record">({
  rule_id: "problem_record.required_ids",
  rule_version: 1,
  applies_to: "problem_record",
  kind: "required_field",
  description:
    "A ProblemRecord must carry its own id, and every evidence/claim id it lists must be a non-empty id. A record whose evidence list contains a blank id has lost the pointer to the customer's own material — the packet built from it cannot cite what it was built from.",
  severity_default: "critical",
  declared_owner: "A01",
  detect_only: false,
  check(record) {
    if (!record.problem_id || record.problem_id.trim().length === 0) {
      return { detail_code: "missing_problem_id" };
    }
    if (record.evidence_ids.some((id) => !id || id.trim().length === 0)) {
      return { detail_code: "blank_evidence_id" };
    }
    if (record.claim_ids.some((id) => !id || id.trim().length === 0)) {
      return { detail_code: "blank_claim_id" };
    }
    return null;
  },
});

const problemPacketReadyLink = rule<"problem_record">({
  rule_id: "problem_record.packet_ready_requires_session",
  rule_version: 1,
  applies_to: "problem_record",
  kind: "required_field",
  description:
    "A ProblemRecord in packet_ready or closed must reference the intake session it came from. Without that link the journey cannot be reassembled, so the homeowner's own request and their packet stop being provably the same thing.",
  severity_default: "high",
  declared_owner: "A01",
  detect_only: false,
  check(record) {
    const needsSession = record.status === "packet_ready" || record.status === "closed";
    if (needsSession && record.intake_session_id === null) {
      return { detail_code: "packet_ready_without_intake_session" };
    }
    return null;
  },
});

const problemLegalTransition = rule<"problem_record">({
  rule_id: "problem_record.legal_transition",
  rule_version: 1,
  applies_to: "problem_record",
  kind: "legal_transition",
  description:
    "A ProblemRecord moves forward through draft -> clarifying -> packet_ready -> closed and never backwards. A record that has gone backwards is in a state the journey cannot produce, so something wrote it out of band.",
  severity_default: "high",
  declared_owner: "A01",
  detect_only: false,
  check(record, ctx) {
    const previous = ctx.previous_status;
    if (previous === undefined || previous === null) return null;
    const from = PROBLEM_STATUS_ORDER.indexOf(previous as (typeof PROBLEM_STATUS_ORDER)[number]);
    const to = PROBLEM_STATUS_ORDER.indexOf(record.status);
    if (from === -1) return { detail_code: "unknown_previous_status" };
    if (to < from) return { detail_code: "backwards_status_transition" };
    return null;
  },
});

/**
 * DUPLICATE DETECTION — FLAG ONLY, ZERO MERGE CAPABILITY (pre-answer 11,
 * melissa-park).
 *
 * TODO-ASK-OWNER (Melissa): what counts as a duplicate homeowner problem, and
 * what happens to the homeowner when two of their records are merged? No such
 * rule exists anywhere in the corpus. Whether the same house describing the
 * same symptom twice in a day is one problem or two is a homeowner-behaviour
 * judgement with direct consequences for their history, their packet and their
 * record. The fingerprint below is deliberately the NARROWEST defensible one —
 * two records claiming the same intake session — which is a structural
 * impossibility rather than a judgement about sameness. It is not a definition
 * of "duplicate" and must not be treated as one.
 */
const problemDuplicateCandidate = rule<"problem_record">({
  rule_id: "problem_record.duplicate_candidate",
  rule_version: 1,
  applies_to: "problem_record",
  kind: "duplicate",
  description:
    "Two ProblemRecords claim the same intake session. Flagged for a human only — A09 never merges identities, and what counts as a duplicate homeowner problem is an owner decision that has not been made.",
  severity_default: "low",
  declared_owner: null,
  detect_only: false,
  check(_record, ctx) {
    const siblings = ctx.duplicate_sibling_ids ?? [];
    if (siblings.length === 0) return null;
    return {
      detail_code: "same_intake_session_candidate",
      related_entity_ids: [...siblings].slice(0, 25),
    };
  },
});

const packetProblemLink = rule<"job_packet">({
  rule_id: "job_packet.problem_link",
  rule_version: 1,
  applies_to: "job_packet",
  kind: "referential",
  description:
    "Every JobPacket must reference a ProblemRecord that exists. A packet whose problem_id resolves to nothing is a document about a request the system cannot find — the exact 'confidently wrong' artefact A09 exists to catch.",
  severity_default: "critical",
  declared_owner: "A02",
  detect_only: false,
  check(record, ctx) {
    if (!record.problem_id || record.problem_id.trim().length === 0) {
      return { detail_code: "missing_problem_id" };
    }
    const resolved = ctx.exists?.("problem_record", record.problem_id);
    // `undefined` means the caller could not resolve it — unknown is not a
    // violation. A09 never reports a failure it did not actually observe.
    if (resolved === false) {
      return { detail_code: "dangling_problem_reference", related_entity_ids: [record.problem_id] };
    }
    return null;
  },
});

const packetVersionMonotonic = rule<"job_packet">({
  rule_id: "job_packet.version_positive",
  rule_version: 1,
  applies_to: "job_packet",
  kind: "required_field",
  description:
    "A JobPacket version is a positive integer. Version zero or negative breaks the newest-version-wins read rule, so the customer could be served an older packet than the one that was generated for them.",
  severity_default: "high",
  declared_owner: "A02",
  detect_only: false,
  check(record) {
    if (!Number.isInteger(record.packet_version) || record.packet_version < 1) {
      return { detail_code: "non_positive_packet_version" };
    }
    return null;
  },
});

const opportunityLegalTransition = rule<"search_opportunity">({
  rule_id: "search_opportunity.legal_transition",
  rule_version: 1,
  applies_to: "search_opportunity",
  kind: "legal_transition",
  description:
    "A SearchOpportunity's owner-decision status follows the declared machine and retired is terminal. The status field is the OWNER's decision, distinct from the agent's recommendation; a status that moved illegally means something wrote a decision the owner did not make.",
  severity_default: "medium",
  declared_owner: "A04",
  detect_only: false,
  check(record, ctx) {
    const previous = ctx.previous_status;
    if (previous === undefined || previous === null) return null;
    const allowed = OPPORTUNITY_TRANSITIONS[previous];
    if (!allowed) return { detail_code: "unknown_previous_status" };
    if (previous === record.status) return null;
    if (!allowed.includes(record.status)) {
      return { detail_code: "illegal_opportunity_transition" };
    }
    return null;
  },
});

const pageSpecLegalTransition = rule<"page_spec">({
  rule_id: "page_spec.legal_transition",
  rule_version: 1,
  applies_to: "page_spec",
  kind: "legal_transition",
  description:
    "A PageSpec follows the frozen 7-state page lifecycle (domain/search/lifecycle.ts). A09 READS this state machine and never writes it: QA_PASS -> PUBLISHED is the owner's decision, never an agent's, and A09 may not publish, unpublish or retire anything it finds wrong.",
  severity_default: "high",
  declared_owner: "A05",
  detect_only: false,
  check(record, ctx) {
    const previous = ctx.previous_status;
    if (previous === undefined || previous === null) return null;
    if (previous === record.status) return null;
    if (!canTransition(previous as PageLifecycleStatus, record.status)) {
      return { detail_code: "illegal_page_lifecycle_transition" };
    }
    return null;
  },
});

const eventEntityLinkage = rule<"event_envelope">({
  rule_id: "event_envelope.entity_linkage",
  rule_version: 1,
  applies_to: "event_envelope",
  kind: "event_linkage",
  description:
    "An event whose context names an entity must name one that exists. A dangling reference is how a KPI ends up counting events for records nobody can open — the tracking looks healthy while the number means nothing.",
  severity_default: "medium",
  declared_owner: "A08",
  detect_only: false,
  check(record, ctx) {
    for (const { key, type } of LINKAGE_KEYS) {
      const value = record.context?.[key];
      if (typeof value !== "string" || value.length === 0) continue;
      if (ctx.exists?.(type, value) === false) {
        return { detail_code: "dangling_event_entity_reference", related_entity_ids: [value] };
      }
    }
    return null;
  },
});

const eventNameRegistered = rule<"event_envelope">({
  rule_id: "event_envelope.name_registered",
  rule_version: 1,
  applies_to: "event_envelope",
  kind: "schema_drift",
  description:
    "Every stored event name resolves to an approved EventDefinition in A08's dictionary. An unregistered name in the live stream is definitional drift, not a data defect — the finding is handed to A08, who owns naming; A09 never renames anything itself.",
  severity_default: "medium",
  declared_owner: "A08",
  detect_only: false,
  check(record, ctx) {
    const known = ctx.is_registered_event_name?.(record.event_name);
    if (known === false) return { detail_code: "unregistered_event_name" };
    return null;
  },
});

/**
 * CONSENT LEDGER — DETECT ONLY, PERMANENTLY (pre-answer 9, adopted as a hard
 * rule). A09 may raise this finding; A09 may never repair, merge or alter
 * anything in the consent ledger, automatically or with approval. The rule only
 * ever restricts A09 and never enables anything, so adopting it cannot be the
 * wrong call at build time; discovering later that an agent edited the consent
 * ledger is not a recoverable mistake. `detect_only: true` is enforced in
 * repairs.ts and pinned by a never-do test.
 */
const consentRequiredIds = rule<"consent_event">({
  rule_id: "consent_event.required_ids",
  rule_version: 1,
  applies_to: "consent_event",
  kind: "required_field",
  description:
    "A consent event must name the disclosure version it was given against and at least one subject (person, guest session or problem). DETECT ONLY: the consent ledger is append-only and belongs to the customer, so this finding always routes to the human exception queue and never to any repair path.",
  severity_default: "critical",
  declared_owner: null,
  detect_only: true,
  check(record) {
    if (!record.disclosure_version_id || record.disclosure_version_id.trim().length === 0) {
      return { detail_code: "missing_disclosure_version" };
    }
    if (
      record.person_id === null &&
      record.guest_session_id === null &&
      record.problem_id === null
    ) {
      return { detail_code: "consent_without_subject" };
    }
    return null;
  },
});

/** The versioned rule set. Order is stable so run reports are comparable. */
export const INVARIANT_RULES: readonly InvariantRule<EntityType>[] = [
  problemRequiredIds,
  problemPacketReadyLink,
  problemLegalTransition,
  problemDuplicateCandidate,
  packetProblemLink,
  packetVersionMonotonic,
  opportunityLegalTransition,
  pageSpecLegalTransition,
  eventEntityLinkage,
  eventNameRegistered,
  consentRequiredIds,
] as InvariantRule<EntityType>[];

export function rulesFor(entityType: EntityType): InvariantRule<EntityType>[] {
  return INVARIANT_RULES.filter((r) => r.applies_to === entityType);
}

export function findRule(ruleId: string): InvariantRule<EntityType> | null {
  return INVARIANT_RULES.find((r) => r.rule_id === ruleId) ?? null;
}

export interface RuleEvaluation {
  rule: InvariantRule<EntityType>;
  violation: RuleViolation;
}

/**
 * Run every rule that applies to this subject. Pure: no writes, no I/O, no
 * throwing — a rule that throws is contained and reported as its own finding
 * rather than taking the caller down, because a broken RULE must not become a
 * broken customer journey.
 */
export function evaluateSubject(
  subject: QualitySubject,
  ctx: InvariantContext = {}
): RuleEvaluation[] {
  const out: RuleEvaluation[] = [];
  for (const r of rulesFor(subject.entity_type)) {
    try {
      const violation = (r as InvariantRule).check(subject.record as never, ctx);
      if (violation) out.push({ rule: r, violation });
    } catch {
      out.push({
        rule: r,
        violation: { detail_code: "rule_threw_during_evaluation", severity: "low" },
      });
    }
  }
  return out;
}
