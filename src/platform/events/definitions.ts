import { z } from "zod";
import { IsoDateTime } from "@/domain/shared/primitives";
import { dictionaryConfig } from "@/platform/events/config";
import { PrivacyClass } from "@/platform/events/envelope";

/**
 * A08 Metric & Event Steward — the two registry row shapes (spec §4, build
 * step 1). STRICT by construction: an unknown key is a rejection, matching the
 * build kit's `additionalProperties: false` JSON-Schema convention.
 *
 * WHAT A08 EXTENDS, NOT WHAT IT CREATES (Loop Spec Audit condition 1). The
 * EventEnvelope in envelope.ts is LIVE, imported by /api/intake and
 * /api/feature-interest, and is the CONTRACT OF RECORD (condition 2). Its
 * nested actor{} / source{} / versions{} / result{} groups and its
 * `context: Record<string,string>` are NOT flattened or renamed here — 14A
 * §18.1 names GROUPS, so the shipped nested shape is at least as faithful a
 * reading as the spec's flat field list, and the flat list is superseded.
 *
 * NO `payload` FIELD (condition 3 / pre-answer 9). The A08 spec's own §11
 * concedes `payload` is the prompt's proposal and is absent from 14A §18.1.
 * Adding it to a shipped envelope would be, by A08's own most important rule,
 * a change to an already-registered definition requiring approval — A08 does
 * not exempt itself on day one. Wave 0 uses the existing `context` record
 * (string→string, commented "never raw PII"). `payload_schema_ref` therefore
 * ships NULL on every seeded row; `payload` is revisited only when every
 * EventDefinition carries a real schema ref, so free-form data can never land
 * unvalidated in an append-only store whose update/delete are revoked
 * (migration 00004).
 */

export const DefinitionStatus = z.enum(["proposed", "approved", "deprecated"]);
export type DefinitionStatus = z.infer<typeof DefinitionStatus>;

/**
 * RETENTION CLASS — placeholder values ONLY (condition 13 / pre-answer 11).
 * A08 §7: A08 "enforces the presence of, not decides the content of" retention
 * classes, so the field is REQUIRED and its only shipped value is the literal
 * "TBD". §11's contradictory "values are your call — choose and document them"
 * is struck.
 *
 * TODO-ASK-OWNER: real retention values interact with the append-only consent
 * ledger and OD-3 (consent wording, unwritten). Once an event is in
 * `event_envelope`, update and delete are REVOKED at the database level
 * (migration 00004) — so a retention policy cannot be implemented by deletion
 * later without a deliberate design. Do not populate this field with real
 * classes until that design exists.
 */
export const RETENTION_CLASS_PLACEHOLDER = "TBD" as const;

/**
 * PRIVACY CLASS — the shipped three-value enum, NO fourth vocabulary
 * (condition 13 / pre-answer 12). Compendium trap 14 records two other live
 * vocabularies (C13 §N's four public-record tiers, 22A §4.1's five-value
 * enum); no mapping exists and neither references the other.
 *
 * TODO-ASK-OWNER (named open decision, A08 §10): A08 is the natural owner of
 * that reconciliation, but it has publication and legal consequences, not just
 * schema ones, and belongs in a separate deliberate pass with Joshua. Until
 * then every seeded definition inherits emit.ts's own default, "internal" —
 * that is an inherited default, NOT an A08 classification judgement.
 */
export { PrivacyClass };

/**
 * Envelope field paths an EventDefinition may declare REQUIRED. Top-level keys
 * of the shipped envelope, plus `context.<key>` paths for the canonical *_id
 * context keys. Anything else is a rejection — a definition cannot require a
 * field the envelope does not have.
 */
export const ENVELOPE_TOP_LEVEL_FIELDS = [
  "event_id",
  "tenant_id",
  "event_name",
  "event_version",
  "occurred_at",
  "actor",
  "guest_session_id",
  "context",
  "source",
  "versions",
  "result",
  "privacy_class",
  "trace_id",
  "agent_run_id",
  "action_request_id",
] as const;

const REQUIRED_FIELD_PATH = z.string().refine(
  (path) =>
    (ENVELOPE_TOP_LEVEL_FIELDS as readonly string[]).includes(path) ||
    /^context\.[a-z][a-z0-9_]*$/.test(path),
  { message: "must be an envelope top-level field or a context.<key> path" }
);

/**
 * TRACE_ID — the §4-vs-§9 contradiction, resolved (condition 16). §4 marks
 * trace_id optional, §9 step 2 says a missing trace_id "must fail loudly", and
 * emit.ts defaults it to null. ONE ruling: the shipped envelope wins — trace_id
 * is a required KEY that is NULLABLE, so it is NOT globally mandatory. A
 * definition that genuinely needs joinability lists "trace_id" in
 * `required_envelope_fields`, and then validateAndEmit rejects a null one FOR
 * THAT EVENT. No Wave-0 seed lists it, because nothing in the repo produces a
 * trace_id yet — which is also the honest reason §8's Data-joinability KPI
 * reads near 0% today. Making it globally mandatory would have blocked every
 * live emission on day one.
 */

export const EventDefinition = z
  .object({
    event_name: z.string().min(1),
    definition_version: z.number().int().min(1),
    description: z.string().min(1),
    /** e.g. "A08", or a domain like "packet" where no agent owns it yet. */
    owning_agent_or_domain: z.string().min(1),
    required_envelope_fields: z.array(REQUIRED_FIELD_PATH),
    /** NULL until `payload` exists — see the header note on condition 3. */
    payload_schema_ref: z.string().min(1).nullable(),
    privacy_class: PrivacyClass,
    /** Required field, placeholder values only. See RETENTION_CLASS_PLACEHOLDER. */
    retention_class: z.string().min(1),
    status: DefinitionStatus,
    /** Alias forward to the replacing name. Never deleted, never reused. */
    deprecated_by: z.string().min(1).optional(),
    first_seen_at: IsoDateTime.optional(),
    approved_by: z.string().min(1).optional(),
    approved_at: IsoDateTime.optional(),
    /**
     * Reserved — white-label approval condition (a), 2026-08-24. Default
     * "prn"; NO tenant logic, routing or UI exists around it (condition 4).
     */
    tenant_id: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((def, ctx) => {
    if (!dictionaryConfig().event_name_pattern.test(def.event_name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["event_name"],
        message: `event_name must match the configured naming convention ${dictionaryConfig().event_name_pattern}`,
      });
    }
    if (def.status === "deprecated" && !def.deprecated_by) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deprecated_by"],
        message: "a deprecated definition must alias forward — history is never simply deleted",
      });
    }
  });
export type EventDefinition = z.infer<typeof EventDefinition>;

/**
 * Metric shape class. "rate" and "ratio" REQUIRE a denominator_event — this is
 * "blocks silent denominator drift", the single most load-bearing sentence in
 * A08's mandate (14A §12/§18).
 *
 * "TBD" exists so a metric KEY can be registered before its owner has defined
 * what it measures — which is exactly the state of the eleven 14A §18.3 owner
 * gauges (condition 9 / pre-answer 7). A TBD metric can never be `approved`.
 */
export const MetricType = z.enum(["count", "rate", "ratio", "duration", "amount", "TBD"]);
export type MetricType = z.infer<typeof MetricType>;

export const MetricDefinition = z
  .object({
    metric_key: z.string().min(1),
    definition_version: z.number().int().min(1),
    display_name: z.string().min(1),
    /** Human-readable. No formula DSL exists; canon specifies no syntax. */
    formula_description: z.string().min(1),
    metric_type: MetricType,
    /** event_name values this metric is computed from. */
    source_events: z.array(z.string().min(1)),
    /** REQUIRED for any rate/ratio metric — enforced below. */
    denominator_event: z.string().min(1).optional(),
    /** e.g. "rolling_7d". Exact enum TBD — canon fixes none. */
    window: z.string().min(1),
    segments: z.array(z.string().min(1)).optional(),
    /** Any target is a business commitment — see the target rule below. */
    target: z.number().optional(),
    target_is_test_figure: z.boolean().optional(),
    status: DefinitionStatus,
    superseded_by: z.string().min(1).optional(),
    owning_kpi_tree: z.string().min(1).optional(),
    /** Reserved — white-label condition (a). Default "prn"; NO tenant logic. */
    tenant_id: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((def, ctx) => {
    if (!dictionaryConfig().metric_key_pattern.test(def.metric_key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metric_key"],
        message: "metric_key must be flat or dotted snake_case",
      });
    }
    if ((def.metric_type === "rate" || def.metric_type === "ratio") && !def.denominator_event) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["denominator_event"],
        message:
          "a rate/ratio metric must name its denominator_event — blocks silent denominator drift",
      });
    }
    if (def.status === "approved" && def.metric_type === "TBD") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metric_type"],
        message: "a metric whose type is TBD cannot be approved — its meaning is undefined",
      });
    }
    if (def.status === "approved" && def.source_events.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_events"],
        message: "an approved metric must name at least one source event — no untraceable numbers",
      });
    }
    /**
     * Hard canon rule 4 restated for metrics: a target IS a business
     * commitment. A08 may never "invent or backfill a metric target/number and
     * present it as owner-approved when it was not" (§7). If a target is ever
     * set during the trial it must be TEST-labeled.
     */
    if (def.target !== undefined && def.target_is_test_figure !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target"],
        message: "a trial target must be TEST-labeled (target_is_test_figure: true)",
      });
    }
    if (def.status === "deprecated" && !def.superseded_by) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["superseded_by"],
        message: "a deprecated metric must name its successor — history is never simply deleted",
      });
    }
  });
export type MetricDefinition = z.infer<typeof MetricDefinition>;

/** Return shape of the metric-lineage capability (spec §4). */
export interface MetricLineage {
  metric_key: string;
  /** Full version history, oldest first. Never pruned. */
  definition_versions: MetricDefinition[];
  /** Each source event and the EventDefinition version it resolves to now. */
  source_event_chain: {
    event_name: string;
    /** null when the metric names an event the dictionary does not carry. */
    definition_version: number | null;
    status: DefinitionStatus | "unregistered";
    /** true when this event is the metric's denominator. */
    is_denominator: boolean;
  }[];
}

/**
 * BREAKING vs ADDITIVE — the rule set (pre-answer 3, "a pure engineering rule
 * with no business content"). Every BREAKING change gets a backward-compat
 * analysis attached to its Approval Center item.
 *
 *  BREAKING: removing a field, changing a field's type, renaming a required
 *  field, narrowing an enum, changing a MetricDefinition's denominator_event,
 *  changing its window, removing a source_event.
 *
 *  ADDITIVE: adding an optional field, widening an enum, adding a
 *  source_event, editing display_name or description.
 */
export type ChangeClass = "additive" | "breaking";

export interface CompatibilityAnalysis {
  change_class: ChangeClass;
  /** One line per detected difference, most severe first. */
  differences: string[];
}

function arrayRemovals(before: readonly string[], after: readonly string[]): string[] {
  return before.filter((v) => !after.includes(v));
}

function arrayAdditions(before: readonly string[], after: readonly string[]): string[] {
  return after.filter((v) => !before.includes(v));
}

export function analyzeEventChange(
  before: EventDefinition,
  after: EventDefinition
): CompatibilityAnalysis {
  const breaking: string[] = [];
  const additive: string[] = [];

  for (const removed of arrayRemovals(before.required_envelope_fields, after.required_envelope_fields)) {
    breaking.push(`required field removed: ${removed}`);
  }
  for (const added of arrayAdditions(before.required_envelope_fields, after.required_envelope_fields)) {
    // Newly REQUIRING a field breaks every existing producer that omits it.
    breaking.push(`field newly required: ${added}`);
  }
  if (before.privacy_class !== after.privacy_class) {
    breaking.push(`privacy_class changed: ${before.privacy_class} -> ${after.privacy_class}`);
  }
  if (before.retention_class !== after.retention_class) {
    breaking.push(`retention_class changed: ${before.retention_class} -> ${after.retention_class}`);
  }
  if (before.payload_schema_ref !== after.payload_schema_ref) {
    breaking.push(
      `payload_schema_ref changed: ${before.payload_schema_ref ?? "null"} -> ${after.payload_schema_ref ?? "null"}`
    );
  }
  if (before.status !== after.status) {
    if (after.status === "deprecated") breaking.push(`status changed: ${before.status} -> deprecated`);
    else additive.push(`status changed: ${before.status} -> ${after.status}`);
  }
  if (before.description !== after.description) additive.push("description edited");
  if (before.owning_agent_or_domain !== after.owning_agent_or_domain) {
    additive.push(
      `owner changed: ${before.owning_agent_or_domain} -> ${after.owning_agent_or_domain}`
    );
  }

  return {
    change_class: breaking.length > 0 ? "breaking" : "additive",
    differences: [...breaking, ...additive],
  };
}

export function analyzeMetricChange(
  before: MetricDefinition,
  after: MetricDefinition
): CompatibilityAnalysis {
  const breaking: string[] = [];
  const additive: string[] = [];

  if (before.denominator_event !== after.denominator_event) {
    breaking.push(
      `denominator_event changed: ${before.denominator_event ?? "none"} -> ${after.denominator_event ?? "none"}`
    );
  }
  if (before.window !== after.window) {
    breaking.push(`window changed: ${before.window} -> ${after.window}`);
  }
  if (before.metric_type !== after.metric_type) {
    breaking.push(`metric_type changed: ${before.metric_type} -> ${after.metric_type}`);
  }
  for (const removed of arrayRemovals(before.source_events, after.source_events)) {
    breaking.push(`source_event removed: ${removed}`);
  }
  for (const added of arrayAdditions(before.source_events, after.source_events)) {
    additive.push(`source_event added: ${added}`);
  }
  if (before.formula_description !== after.formula_description) {
    breaking.push("formula_description changed — a silent KPI redefinition otherwise");
  }
  if (before.target !== after.target) {
    breaking.push(`target changed: ${before.target ?? "none"} -> ${after.target ?? "none"}`);
  }
  if (before.status !== after.status) {
    if (after.status === "deprecated") breaking.push(`status changed: ${before.status} -> deprecated`);
    else additive.push(`status changed: ${before.status} -> ${after.status}`);
  }
  if (before.display_name !== after.display_name) additive.push("display_name edited");
  for (const added of arrayAdditions(before.segments ?? [], after.segments ?? [])) {
    additive.push(`segment added: ${added}`);
  }
  for (const removed of arrayRemovals(before.segments ?? [], after.segments ?? [])) {
    breaking.push(`segment removed: ${removed}`);
  }

  return {
    change_class: breaking.length > 0 ? "breaking" : "additive",
    differences: [...breaking, ...additive],
  };
}
