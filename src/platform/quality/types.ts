import { z } from "zod";
import { IsoDateTime } from "@/domain/shared/primitives";

/**
 * A09 Data Quality & Reconciliation — the record shapes.
 *
 * NO RAW EVIDENCE, ENFORCED IN THE TYPES (Loop Spec Audit condition 9). The
 * A09 spec §7 says in prose that issue records "reference entity IDs and never
 * reproduce raw customer evidence" — but §4's proposed `detail?: string` and
 * `expected: unknown` / `actual: unknown` structurally permit exactly that, and
 * these records render into an admin page's serialized props. So the prose is
 * replaced by structure:
 *
 *   - every schema here is `.strict()`: an unknown key is a parse REJECTION,
 *     so no caller can smuggle a field in;
 *   - there is no `unknown`, no `any`, and no free-text field anywhere in this
 *     file — a test asserts that by reading the file;
 *   - what a finding may carry is: bounded ENUMS (entity_type, kind, severity,
 *     check_kind, status, basis), IDs, NUMBERS, and one short machine-readable
 *     `detail_code` constrained by regex to lowercase snake_case, max 48 chars.
 *     A sentence, a photo URL, a consent paragraph or a customer's own words
 *     cannot be represented in that shape at all.
 *
 * Human-readable explanation lives on the RULE (invariants.ts `description`),
 * which is authored code, never customer data — so the admin view can still say
 * what went wrong without any record carrying what the customer said.
 *
 * TENANT_ID (condition 4). Every record type carries the optional reserved
 * `tenant_id`, default "prn", matching approvals/center.ts, runs/ledger.ts,
 * events/emit.ts and killswitch/index.ts. No tenant logic exists.
 */

/**
 * Severity vocabulary. Pre-answer 8 checked and found NO conflicting convention
 * in src/ — `severity` appears nowhere else in the codebase. Deliberately kept
 * separate from the R0-R6 risk-class scale in capabilities/contracts.ts, which
 * governs CAPABILITY risk, not issue severity; collapsing one into the other
 * would give two different questions one answer.
 */
export const Severity = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof Severity>;

/** Severities that quarantine by default (§3 step 4). */
export const QUARANTINING_SEVERITIES: readonly Severity[] = ["critical", "high"];

/**
 * Entity types A09 watches. A CLOSED enum, not a free-form table name: an
 * open string here would let a finding name any table, including one holding
 * customer evidence, and would defeat the read-scope declaration in the agent
 * registry.
 */
export const EntityType = z.enum([
  "problem_record",
  "job_packet",
  "search_opportunity",
  "page_spec",
  "intake_session",
  "event_envelope",
  /**
   * READ-ONLY, DETECT-ONLY, PERMANENTLY. The consent ledger is append-only at
   * the database level and belongs to the customer (pre-answer 9, adopted as a
   * hard rule). A09 may raise a finding against it; A09 may never repair,
   * merge, quarantine-by-alteration or otherwise write to it. Enforced in
   * repairs.ts and pinned by a never-do test.
   */
  "consent_event",
]);
export type EntityType = z.infer<typeof EntityType>;

/** Entity types no repair may ever target, whatever the allow-list says. */
export const NEVER_REPAIRABLE_ENTITY_TYPES: readonly EntityType[] = ["consent_event"];

/** What kind of check produced a finding. */
export const CheckKind = z.enum([
  "required_field",
  "legal_transition",
  "event_linkage",
  "referential",
  "duplicate",
  "schema_drift",
  "cross_source_total",
]);
export type CheckKind = z.infer<typeof CheckKind>;

/**
 * THE ONE DISCRIMINATOR (pre-answer 4). One table, one RLS policy, one
 * tenant_id, one quarantine join, one cockpit query — the shapes do not
 * diverge, so two tables would only buy two of everything.
 */
export const FindingKind = z.enum(["data_quality_issue", "reconciliation_mismatch"]);
export type FindingKind = z.infer<typeof FindingKind>;

/** Which trigger produced the finding. */
export const FindingSource = z.enum([
  "ingest",
  "reconciliation",
  "deploy_check",
  "metric_anomaly",
]);
export type FindingSource = z.infer<typeof FindingSource>;

/**
 * Finding lifecycle. Status is not mutated in place: a transition APPENDS a new
 * `finding_version` row (migration 00010 revokes update and delete), exactly as
 * the event/metric dictionary does. The current status is the highest version.
 */
export const FindingStatus = z.enum([
  "open",
  "repair_proposed",
  "repair_executed",
  "repair_verified",
  "rejected",
  "wont_fix",
]);
export type FindingStatus = z.infer<typeof FindingStatus>;

/**
 * A short machine-readable code naming WHAT was wrong — the only non-enum,
 * non-numeric, non-id field a finding carries, and it is not free text: the
 * regex admits lowercase snake_case up to 48 characters and nothing else. No
 * spaces, no punctuation, no `://`, no capitals, no sentence.
 */
export const DetailCode = z
  .string()
  .regex(/^[a-z][a-z0-9_]{2,47}$/, "detail_code must be lowercase snake_case, 3-48 chars");

/**
 * How `suspected_owner` was arrived at. NEVER FABRICATED (§9 step 2): the only
 * evidence A09 has is the Agent Run Ledger, so when the ledger carries no run
 * that touched this record, the owner is `null` and the basis says so. A
 * plausible-looking guess would be worse than an honest blank — it would send a
 * human to the wrong agent with the confidence of a lookup.
 */
export const RootHypothesisBasis = z.enum([
  "last_agent_run_ledger_write",
  "rule_declared_owner",
  "no_agent_run_found",
]);
export type RootHypothesisBasis = z.infer<typeof RootHypothesisBasis>;

export const RootHypothesis = z
  .object({
    /** "model_assisted" is reserved for a later, gated capability (§3). A09 wires no model. */
    method: z.literal("deterministic"),
    /** agent_id, or null when nothing in the ledger supports naming one. */
    suspected_owner: z.string().min(1).nullable(),
    basis: RootHypothesisBasis,
    /** The AgentRunRecord this was read from, when there was one. */
    agent_run_id: z.string().min(1).nullable(),
  })
  .strict();
export type RootHypothesis = z.infer<typeof RootHypothesis>;

/**
 * ONE finding record. `kind` discriminates a rule failure from a cross-source
 * mismatch; both feed one queue, one cockpit line and one Approval Center.
 */
export const QualityFinding = z
  .object({
    issue_id: z.string().min(1),
    /** Append-only lifecycle: a status change is a new version, never an update. */
    finding_version: z.number().int().min(1),
    /** Reserved — white-label condition (a). Default "prn"; NO tenant logic. */
    tenant_id: z.string().min(1),
    kind: FindingKind,
    source: FindingSource,
    check_kind: CheckKind,
    rule_id: z.string().min(1),
    rule_version: z.number().int().min(1),
    entity_type: EntityType,
    /** The subject's own id. An ID, never a copy of the record. */
    entity_id: z.string().min(1),
    /** Other entities implicated — IDs only, bounded so a sweep cannot dump a table. */
    related_entity_ids: z.array(z.string().min(1)).max(25),
    severity: Severity,
    detail_code: DetailCode,
    /** Cross-source checks only: the two independently-derived counts. */
    expected_count: z.number().int().nullable(),
    observed_count: z.number().int().nullable(),
    /** Percentage delta between the two totals, when both exist. */
    delta_pct: z.number().nullable(),
    /** From the tolerances knob, when one applied. */
    tolerance_applied: z.number().nullable(),
    root_hypothesis: RootHypothesis,
    quarantined: z.boolean(),
    status: FindingStatus,
    created_at: IsoDateTime,
    resolved_at: IsoDateTime.nullable(),
  })
  .strict();
export type QualityFinding = z.infer<typeof QualityFinding>;

/**
 * Quarantine marker — ITS OWN RECORD, referencing the original row (condition
 * 10). Never a column added to a watched table: a separate marker avoids schema
 * changes and RLS-policy edits on live customer tables, avoids touching the
 * append-only consent ledger's shape at all, and is the cleaner per-client
 * story. Nothing is ever deleted; the original row is untouched.
 */
export const QuarantineStatus = z.enum(["active", "released"]);
export type QuarantineStatus = z.infer<typeof QuarantineStatus>;

export const QuarantineMarker = z
  .object({
    marker_id: z.string().min(1),
    tenant_id: z.string().min(1),
    entity_type: EntityType,
    entity_id: z.string().min(1),
    /** The finding that caused it. Every marker has a reason with a paper trail. */
    issue_id: z.string().min(1),
    reason_code: DetailCode,
    severity: Severity,
    status: QuarantineStatus,
    applied_at: IsoDateTime,
    released_at: IsoDateTime.nullable(),
    /** Owner identifier for a release. Releases are human acts. */
    released_by: z.string().min(1).nullable(),
  })
  .strict();
export type QuarantineMarker = z.infer<typeof QuarantineMarker>;

/**
 * Repair records. `reversible` is `true` by literal type, not by convention:
 * canon's guardrail is that repairs are reversible, so a proposal that cannot
 * describe its own reversal cannot be constructed.
 */
export const RepairProposal = z
  .object({
    proposal_id: z.string().min(1),
    tenant_id: z.string().min(1),
    issue_id: z.string().min(1),
    /** Must match a declared RepairKind id in repairs.ts. */
    repair_kind: z.string().min(1),
    entity_type: EntityType,
    entity_id: z.string().min(1),
    /** Which field the repair would write — a declared field name, not a value. */
    target_field: z.string().min(1),
    /**
     * The simulation, as bounded facts: what changes, how many rows, and
     * whether the rule that raised the finding would then pass. NOT a dump of
     * before/after record contents — that would carry customer evidence into an
     * admin page's props, which is what condition 9 forbids.
     */
    simulated_rows_affected: z.number().int().min(0),
    simulated_rule_passes_after: z.boolean(),
    simulation_detail_code: DetailCode,
    reversible: z.literal(true),
    /** false ONLY for an explicitly owner-enabled allow-list class. Ships true. */
    requires_approval: z.boolean(),
    /** The Approval Center item this was filed as. */
    approval_id: z.string().min(1).nullable(),
    proposed_at: IsoDateTime,
  })
  .strict();
export type RepairProposal = z.infer<typeof RepairProposal>;

export const RepairExecution = z
  .object({
    execution_id: z.string().min(1),
    tenant_id: z.string().min(1),
    proposal_id: z.string().min(1),
    issue_id: z.string().min(1),
    repair_kind: z.string().min(1),
    /** "owner" plus the resolver's identifier; never "system" while the allow-list is empty. */
    executed_by: z.string().min(1),
    executed_at: IsoDateTime,
    rows_affected: z.number().int().min(0),
    verified: z.boolean(),
    verified_at: IsoDateTime.nullable(),
    /** Set when this execution UNDOES a prior one. */
    rollback_of: z.string().min(1).nullable(),
    executed_at_reversal_token: z.string().min(1),
  })
  .strict();
export type RepairExecution = z.infer<typeof RepairExecution>;

/**
 * The exact prior value a repair overwrote, so a reversal can restore it
 * BYTE-FOR-BYTE rather than approximately. ID ARRAYS ONLY — every declared
 * repair kind touches an id list and nothing else, which is what lets the
 * snapshot stay inside the no-raw-evidence contract. A repair that needed to
 * snapshot free text could not be declared at all, and that is the intended
 * ceiling on what A09 is ever allowed to repair.
 */
export const RepairReversalSnapshot = z
  .object({
    reversal_token: z.string().min(1),
    tenant_id: z.string().min(1),
    entity_type: EntityType,
    entity_id: z.string().min(1),
    target_field: z.string().min(1),
    /** Bounded, and allowed to contain "" — restoring a blank id exactly is the point. */
    previous_ids: z.array(z.string().max(128)).max(200),
    captured_at: IsoDateTime,
  })
  .strict();
export type RepairReversalSnapshot = z.infer<typeof RepairReversalSnapshot>;

/**
 * FAIL-LOUD WRITE RESULT — a DELIBERATE DIVERGENCE from the platform's
 * fail-soft default (Loop Spec Audit condition 7), documented here because it
 * is the one place A09 refuses an approved platform contract.
 *
 * db/client.ts makes every platform write fail-soft "by contract", and that is
 * right for telemetry: a lost `page.viewed` costs a data point. It is WRONG
 * here and inverts the agent's purpose. A swallowed issue write leaves bad data
 * feeding KPIs while the run reports clean — a data-quality system that loses
 * its own findings is worse than no data-quality system, because it
 * manufactures the confidence it was built to withhold.
 *
 * So an issue write and a quarantine write return a discriminated union the
 * caller CANNOT ignore without a type error, log at console.error (not warn),
 * and count the failure onto the Agent Run Ledger row. They still never THROW —
 * the customer's journey is not A09's to break — and a run whose own writes did
 * not land reports "could not verify", never "clean".
 */
export type QualityWriteResult<T> =
  | { ok: true; record: T }
  | { ok: false; error: string; record: T };
