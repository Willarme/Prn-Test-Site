import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import {
  DefinitionStatus,
  EventDefinition,
  MetricDefinition,
  RETENTION_CLASS_PLACEHOLDER,
} from "@/platform/events/definitions";
import {
  A09_EVENT_NAMES,
  CORE_EVENT_NAMES,
  EVENT_NAMES,
  LOOP_SEAM_EVENT_NAMES,
  PLATFORM_EVENT_NAMES,
  SLICE_EVENT_NAMES,
  STEWARD_EVENT_NAMES,
} from "@/platform/events/names";

/**
 * A08 — THE DICTIONARY ITSELF (spec §9 step 3: "create initial trial event
 * dictionary before traffic").
 *
 * AUTHORITY MODEL (pre-answer 10). This registry is the authority; names.ts is
 * the seed artifact plus the compile-time union derived from it, so TypeScript
 * keeps catching typos while the dictionary becomes data. A white-label
 * deployment swaps a seed file, not agent code.
 *
 * VERSIONING. Definitions are APPEND-ONLY: a change is a NEW version row, never
 * an overwrite ("no silent KPI redefinition", canon verbatim), and nothing is
 * ever hard-deleted ("historical versions remain queryable", canon verbatim).
 * Deprecation writes a new version with status `deprecated` and a forward
 * alias; the old versions stay readable forever.
 *
 * PERSISTENCE. Designed for `event_definition` / `metric_definition`
 * (supabase/migrations/00009_event_metric_registry.sql — WRITTEN, NOT APPLIED).
 * Until applied, writes are FAIL-SOFT exactly as every other A00 platform write
 * is by contract (db/client.ts): the in-process registry is authoritative, the
 * database miss is logged once, and no caller's outcome changes. Every function
 * that touches the database ACCEPTS a PlatformClientProvider (condition 5) —
 * this module never imports the service client's internals directly.
 *
 * THE REGISTRY IS NEVER PUBLIC (§7). No unauthenticated route may read it, and
 * tests/client-boundary.test.ts forbids any "use client" file from importing
 * anything under platform/events/**.
 */

interface EventSeed {
  description: string;
  owner: string;
  required?: string[];
}

/**
 * MELISSA-PARK — DO NOT WRITE SEMANTICS FOR THESE (condition 10 /
 * pre-answer 8). trust.*, home_person.* and customer_lite.* are canon names
 * from 14A §18.2, so they seed as approved NAMES — but a description of what
 * `trust.good_neighbor_contributed` MEANS is a product decision wearing a
 * schema costume. Trust Network mechanics (Master Todo T2-04) and House Memory
 * naming/field-scope/retention (T2-05) are both decision-dock items awaiting
 * Melissa, and each unlocks 25-29 downstream items.
 *
 * TODO-ASK-OWNER (Melissa): replace this placeholder with real descriptions
 * only after T2-04 and T2-05 are decided. Anything written here before then is
 * an invented product mechanic.
 */
const RESERVED_DESCRIPTION =
  "reserved — mechanics undecided (Master Todo T2-04 Trust Network / T2-05 House Memory, awaiting Melissa)";

const RESERVED_PREFIXES = ["trust.", "home_person.", "customer_lite."] as const;

function isReserved(name: string): boolean {
  return RESERVED_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Seed descriptions. Deliberately MECHANICAL — each one restates what the name
 * says plus, where one exists, the surface in this repo that emits it. A08
 * registers names; it does not author product meaning.
 */
const EVENT_SEEDS: Record<string, EventSeed> = {
  // ---- #14A §18.2 core -----------------------------------------------------
  "page.viewed": { description: "A page was viewed.", owner: "page" },
  "intake.started": { description: "A homeowner began an intake.", owner: "intake" },
  "intake.evidence_added": { description: "Evidence was attached to an intake.", owner: "intake" },
  "intake.clarifier_asked": {
    description: "A clarifying question was asked during intake.",
    owner: "intake",
  },
  "intake.clarifier_answered": {
    description: "A clarifying question was answered during intake.",
    owner: "intake",
  },
  "safety.triggered": { description: "A safety rule fired on intake content.", owner: "safety" },
  "problem.created": { description: "A problem record was created.", owner: "problem" },
  "problem.updated": { description: "A problem record was updated.", owner: "problem" },
  "packet.generated": {
    description: "A job packet was produced for a problem record.",
    owner: "packet",
  },
  "packet.viewed": { description: "A job packet was viewed.", owner: "packet" },
  "packet.downloaded": { description: "A job packet was downloaded.", owner: "packet" },
  "packet.share_opened": { description: "A shared job-packet link was opened.", owner: "packet" },
  "customer_lite.claim_offered": { description: RESERVED_DESCRIPTION, owner: "customer_lite" },
  "customer_lite.claimed": { description: RESERVED_DESCRIPTION, owner: "customer_lite" },
  "trust.request_created": { description: RESERVED_DESCRIPTION, owner: "trust" },
  "trust.share_opened": { description: RESERVED_DESCRIPTION, owner: "trust" },
  "trust.response_submitted": { description: RESERVED_DESCRIPTION, owner: "trust" },
  "trust.no_provider": { description: RESERVED_DESCRIPTION, owner: "trust" },
  "trust.good_neighbor_offered": { description: RESERVED_DESCRIPTION, owner: "trust" },
  "trust.good_neighbor_contributed": { description: RESERVED_DESCRIPTION, owner: "trust" },
  "trust.good_neighbor_skipped": { description: RESERVED_DESCRIPTION, owner: "trust" },
  "home_person.offer_shown": { description: RESERVED_DESCRIPTION, owner: "home_person" },
  "home_person.saved": { description: RESERVED_DESCRIPTION, owner: "home_person" },
  "provider.autocomplete_selected": {
    description: "A provider was selected from autocomplete.",
    owner: "provider",
  },
  "provider.manual_created": {
    description: "A provider record was created by hand.",
    owner: "provider",
  },
  "provider.match_candidate": {
    description: "A provider was proposed as a match candidate.",
    owner: "provider",
  },
  "provider.merged": { description: "Two provider records were merged.", owner: "provider" },
  "provider.review_required": {
    description: "A provider record was flagged for human review.",
    owner: "provider",
  },
  "provider.recommendation_shown": {
    description: "A provider recommendation was shown.",
    owner: "provider",
  },
  "provider.show_another": {
    description: "A different provider recommendation was requested.",
    owner: "provider",
  },
  "feature_lab.viewed": { description: "A feature-lab concept was viewed.", owner: "feature_lab" },
  "feature_lab.cta": {
    description: "A feature-lab call to action was activated.",
    owner: "feature_lab",
  },
  "feature_lab.thumb": {
    description: "A feature-lab thumbs signal was given.",
    owner: "feature_lab",
  },
  "feature_lab.email": {
    description: "An email address was submitted on a feature-lab concept.",
    owner: "feature_lab",
  },
  "consent.granted": {
    description: "Consent was granted against a disclosure version.",
    owner: "consent",
  },
  "consent.revoked": { description: "Consent was revoked.", owner: "consent" },
  "message.sent": { description: "An outbound message was sent.", owner: "message" },
  "message.delivered": { description: "An outbound message was delivered.", owner: "message" },
  "message.failed": { description: "An outbound message failed.", owner: "message" },
  "message.opted_out": { description: "A recipient opted out of messages.", owner: "message" },
  "page.draft_created": { description: "A page draft was created.", owner: "page" },
  "page.qa_passed": { description: "A page passed QA.", owner: "page" },
  "page.published": { description: "A page was published.", owner: "page" },
  "capability.invoked": {
    description: "A registered capability was invoked through the AI/Tool Gateway.",
    owner: "capability",
  },
  "capability.denied": {
    description: "A capability call was denied before it ran.",
    owner: "capability",
  },
  "action.requested": { description: "An external-effect action was requested.", owner: "action" },
  "action.attempted": { description: "An external-effect action was attempted.", owner: "action" },
  "action.reconciled": {
    description: "An external-effect action was reconciled against its real-world outcome.",
    owner: "action",
  },
  "agent.run_started": { description: "An agent run started.", owner: "agent" },
  "agent.run_completed": { description: "An agent run completed.", owner: "agent" },
  "agent.run_failed": { description: "An agent run failed.", owner: "agent" },
  "data_quality.issue_detected": {
    description: "A data-quality issue was detected.",
    owner: "A09",
  },
  "data_quality.quarantined": {
    description: "A record was quarantined by data quality.",
    owner: "A09",
  },
  "ai_readiness.check_completed": {
    description: "An AI-readiness check completed.",
    owner: "ai_readiness",
  },
  "ai_readiness.regression_blocked": {
    description: "An AI-readiness regression was blocked.",
    owner: "ai_readiness",
  },
  "transition_signal.recorded": {
    description: "A transition signal was recorded.",
    owner: "transition_signal",
  },

  // ---- Door-slice additions (already live) ---------------------------------
  "seo.opportunity_created": {
    description: "A search opportunity was created.",
    owner: "seo",
  },
  "seo.opportunity_scored": { description: "A search opportunity was scored.", owner: "seo" },
  "seo.metrics_refreshed": {
    description: "Search metrics were refreshed for an opportunity set.",
    owner: "seo",
  },
  "seo.search_console_ingested": {
    description: "Search Console data was ingested.",
    owner: "seo",
  },
  "seo.budget_exhausted": {
    description: "A search-data budget cap was reached.",
    owner: "seo",
  },
  "page.staged": { description: "A page was staged.", owner: "page" },
  "page.qa_failed": { description: "A page failed QA.", owner: "page" },
  "page.refreshed": { description: "A page was refreshed.", owner: "page" },
  "page.retired": { description: "A page was retired.", owner: "page" },
  "economics.cost_recorded": {
    description: "A cost figure was recorded. TEST-labeled during the trial.",
    owner: "economics",
  },
  "economics.revenue_recorded": {
    description: "A revenue figure was recorded. TEST-labeled during the trial.",
    owner: "economics",
  },

  // ---- A00 platform, RATIFIED by A08 (pre-answer 14) -----------------------
  "platform.kill_switch_engaged": {
    description:
      "A kill switch was engaged. The switch is mutable state, so the toggle is evented to keep the history append-only.",
    owner: "A00",
  },
  "platform.kill_switch_released": {
    description:
      "A kill switch was released. The switch is mutable state, so the toggle is evented to keep the history append-only.",
    owner: "A00",
  },

  // ---- A08's own six ------------------------------------------------------
  "schema.proposed": {
    description: "A new event or metric definition was proposed to the dictionary.",
    owner: "A08",
  },
  "schema.approved": {
    description: "An event or metric definition was registered as approved.",
    owner: "A08",
  },
  "event.deprecated": {
    description: "An event definition was deprecated and aliased forward. Never deleted.",
    owner: "A08",
  },
  "metric.created": { description: "A metric definition was created.", owner: "A08" },
  "metric.versioned": {
    description: "A metric definition gained a new version.",
    owner: "A08",
  },
  "compatibility.failed": {
    description: "A proposed change failed the backward-compatibility check.",
    owner: "A08",
  },

  // ---- Loop-seam registrations (coherence report) --------------------------
  "seo.opportunity_accepted": {
    description:
      "The owner accepted a search opportunity. The owner's decision, distinct from the agent's recommendation.",
    owner: "A04",
  },
  "seo.opportunity_rejected": {
    description: "The owner rejected a search opportunity.",
    owner: "A04",
  },
  "seo.opportunity_deferred": {
    description: "The owner deferred a decision on a search opportunity.",
    owner: "A04",
  },
  "page.defect_found": {
    description: "A defect was found on a page. Prefixed from A06's unprefixed spelling.",
    owner: "A06",
  },
  "page.defect_repaired": {
    description: "A page defect was repaired. Prefixed from A06's unprefixed spelling.",
    owner: "A06",
  },
  "seo.page_performance_recorded": {
    description:
      "Per-page search performance for one window. THE RETURN-LEG CARRIER: registered with no producer today so the loop can close later without a schema change. Numeric context values are strings — the shipped envelope's context is Record<string,string> and no payload field exists (condition 3).",
    owner: "seo",
    required: [
      "context.page_id",
      "context.search_opportunity_id",
      "context.window",
      "context.impressions",
      "context.clicks",
      "context.avg_position",
      "context.source",
    ],
  },

  // ---- A09 data-quality additions (see names.ts A09_EVENT_NAMES) -----------
  // Registered inside the existing `data_quality.` domain rather than as
  // canon doc 20's parallel `repair.*` family. Every one requires
  // context.issue_id so a repair event can always be joined back to the
  // finding it belongs to — an unjoinable repair record is exactly the
  // "confidently wrong" state A09 exists to prevent.
  "data_quality.quarantine_released": {
    description:
      "A quarantine marker was released, returning its record to KPI reads. The marker's status is mutable, so both edges are evented to keep the history append-only.",
    owner: "A09",
    required: ["context.issue_id", "context.entity_type", "context.entity_id"],
  },
  "data_quality.repair_proposed": {
    description:
      "A repair was proposed for a data-quality finding and filed to the Approval Center. Proposing is never executing.",
    owner: "A09",
    required: ["context.issue_id", "context.repair_kind"],
  },
  "data_quality.repair_executed": {
    description:
      "An owner-approved repair was executed. Reversible by contract; the reversal state travels on the execution record.",
    owner: "A09",
    required: ["context.issue_id", "context.repair_kind"],
  },
  "data_quality.repair_verified": {
    description:
      "An executed repair was re-checked against the rule that raised the finding and passed. Canon doc 20 spells this `repair_verified`; the dot is restored to satisfy the shipped domain.action convention.",
    owner: "A09",
    required: ["context.issue_id", "context.repair_kind"],
  },
};

/**
 * THE ELEVEN TRIAL OWNER GAUGES (14A §18.3) — KEYS ONLY, status `proposed`
 * (condition 9 / pre-answer 7, a melissa-park item).
 *
 * TODO-ASK-OWNER (Melissa): the formula, denominator, window, segments and
 * target for every one of these. "Useful Outcome Rate" is a judgement about
 * what counts as useful to a homeowner; "Trust Conversion" and "Provider
 * Decision Relief" are homeowner-psychology and provider-economics
 * definitions; a target number is a business commitment. Registering them
 * `approved` would force exactly the invention §7 forbids.
 *
 * What this DOES satisfy: §9 step 5's real requirement — A07 can register its
 * KPI tree THROUGH the builder rather than around it, because the keys exist
 * and are versionable today.
 */
const OWNER_GAUGE_FORMULA = "TBD — owner definition required";

const OWNER_GAUGE_SEEDS: { metric_key: string; display_name: string }[] = [
  { metric_key: "qualified_demand_health", display_name: "Qualified Demand Health" },
  { metric_key: "useful_outcome_rate", display_name: "Useful Outcome Rate" },
  { metric_key: "intake_friction", display_name: "Intake Friction" },
  { metric_key: "packet_use", display_name: "Packet Use" },
  { metric_key: "trust_conversion", display_name: "Trust Conversion" },
  { metric_key: "provider_decision_relief", display_name: "Provider Decision Relief" },
  { metric_key: "future_feature_pull", display_name: "Future Feature Pull" },
  { metric_key: "search_proof", display_name: "Search Proof" },
  { metric_key: "data_moat_yield", display_name: "Data Moat Yield" },
  { metric_key: "system_autonomy", display_name: "System / Autonomy" },
  { metric_key: "ai_native_readiness", display_name: "AI-Native Readiness" },
];

/**
 * THE CENSUS, counted from the file rather than from any document
 * (2026-08-24). The Loop Spec Audit describes the shipped dictionary as "68
 * shipped names: 55 core 14A §18.2 + 11 SLICE_EVENT_NAMES + 2 PLATFORM
 * provisional". The repo actually ships 69: CORE_EVENT_NAMES has 56 entries,
 * not 55. Nothing turns on the difference — every shipped name is seeded
 * either way — but the record should be true, and the counts below are pinned
 * by a test so an accidental name addition cannot slip in unnoticed.
 *
 *   core_14a   56   (#14A §18.2, of which 11 are reserved-semantics names:
 *                    7 trust.*, 2 home_person.*, 2 customer_lite.*)
 *   door_slice 11   live and already emitting
 *   platform    2   A00's, ratified by A08
 *   steward     6   A08's own
 *   loop_seam   6   registered for A04/A05/A06 ahead of their builds
 *   a09         4   A09's repair/quarantine lifecycle (2026-08-24) — see the
 *                   A09_EVENT_NAMES note in names.ts. DELIBERATE census change:
 *                   the pinned counts moved from 81 to 85 because four names
 *                   were added on purpose, not because a name slipped in.
 *   ----------------
 *   total      85   EventDefinitions, all seeded `approved` at version 1
 *              11   MetricDefinitions, all seeded `proposed` at version 1
 */
export const SEED_CENSUS = {
  core_14a: 56,
  door_slice: 11,
  platform: 2,
  steward: 6,
  loop_seam: 6,
  a09: 4,
  owner_gauges: 11,
} as const;

/** Which seed group a name came from — provenance the audit digest reports. */
export type SeedGroup =
  | "core_14a"
  | "door_slice"
  | "platform"
  | "steward"
  | "loop_seam"
  | "a09";

export function seedGroupOf(name: string): SeedGroup {
  if ((CORE_EVENT_NAMES as readonly string[]).includes(name)) return "core_14a";
  if ((SLICE_EVENT_NAMES as readonly string[]).includes(name)) return "door_slice";
  if ((PLATFORM_EVENT_NAMES as readonly string[]).includes(name)) return "platform";
  if ((STEWARD_EVENT_NAMES as readonly string[]).includes(name)) return "steward";
  if ((LOOP_SEAM_EVENT_NAMES as readonly string[]).includes(name)) return "loop_seam";
  if ((A09_EVENT_NAMES as readonly string[]).includes(name)) return "a09";
  return "core_14a";
}

// ---------------------------------------------------------------------------
// In-process registry
// ---------------------------------------------------------------------------

const eventVersions = new Map<string, EventDefinition[]>();
const metricVersions = new Map<string, MetricDefinition[]>();
let seeded = false;

let missLogged = false;
function logMiss(reason: string): void {
  if (missLogged) return;
  missLogged = true;
  console.warn(
    `[a08-dictionary] durable registry unavailable (${reason}) — definitions are in-process only. ` +
      "Apply supabase/migrations/00009_event_metric_registry.sql to enable persistence."
  );
}

/**
 * Build every seeded row. Idempotent and synchronous — the dictionary must be
 * readable before any traffic, without awaiting a database that may not exist.
 */
export function seedDictionary(): void {
  if (seeded) return;
  for (const name of EVENT_NAMES) {
    const seed = EVENT_SEEDS[name];
    if (!seed) {
      // A name in names.ts with no seed row is a build error a test catches.
      throw new Error(`[a08] no dictionary seed for event name "${name}"`);
    }
    const def = EventDefinition.parse({
      event_name: name,
      definition_version: 1,
      description: seed.description,
      owning_agent_or_domain: seed.owner,
      required_envelope_fields: seed.required ?? [],
      payload_schema_ref: null,
      // Inherited from emit.ts's own default — NOT an A08 classification
      // judgement (§7: A08 enforces presence, not content).
      privacy_class: "internal",
      retention_class: RETENTION_CLASS_PLACEHOLDER,
      status: "approved",
      approved_by: "A08",
      tenant_id: "prn",
    });
    eventVersions.set(name, [def]);
  }
  for (const gauge of OWNER_GAUGE_SEEDS) {
    const def = MetricDefinition.parse({
      metric_key: gauge.metric_key,
      definition_version: 1,
      display_name: gauge.display_name,
      formula_description: OWNER_GAUGE_FORMULA,
      metric_type: "TBD",
      source_events: [],
      metric_window: "TBD",
      status: "proposed",
      tenant_id: "prn",
    });
    metricVersions.set(gauge.metric_key, [def]);
  }
  seeded = true;
}

function ensureSeeded(): void {
  if (!seeded) seedDictionary();
}

/** Test seam — clears the registry AND the seed flag. */
export function resetDictionaryForTests(): void {
  eventVersions.clear();
  metricVersions.clear();
  seeded = false;
  missLogged = false;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every version of one event name, oldest first. Never pruned. */
export function eventDefinitionHistory(eventName: string): EventDefinition[] {
  ensureSeeded();
  return [...(eventVersions.get(eventName) ?? [])];
}

/** The current (highest) version of one event definition, or null. */
export function currentEventDefinition(eventName: string): EventDefinition | null {
  const history = eventDefinitionHistory(eventName);
  return history.length > 0 ? history[history.length - 1] : null;
}

export function metricDefinitionHistory(metricKey: string): MetricDefinition[] {
  ensureSeeded();
  return [...(metricVersions.get(metricKey) ?? [])];
}

export function currentMetricDefinition(metricKey: string): MetricDefinition | null {
  const history = metricDefinitionHistory(metricKey);
  return history.length > 0 ? history[history.length - 1] : null;
}

export function listEventDefinitions(status?: DefinitionStatus): EventDefinition[] {
  ensureSeeded();
  const out: EventDefinition[] = [];
  for (const history of eventVersions.values()) {
    const current = history[history.length - 1];
    if (!status || current.status === status) out.push(current);
  }
  return out;
}

export function listMetricDefinitions(status?: DefinitionStatus): MetricDefinition[] {
  ensureSeeded();
  const out: MetricDefinition[] = [];
  for (const history of metricVersions.values()) {
    const current = history[history.length - 1];
    if (!status || current.status === status) out.push(current);
  }
  return out;
}

/** Names by status — the dictionary census the audit digest reports. */
export function dictionaryCensus(): {
  events: Record<DefinitionStatus, number>;
  metrics: Record<DefinitionStatus, number>;
  event_versions_total: number;
  metric_versions_total: number;
} {
  ensureSeeded();
  const events: Record<DefinitionStatus, number> = { proposed: 0, approved: 0, deprecated: 0 };
  const metrics: Record<DefinitionStatus, number> = { proposed: 0, approved: 0, deprecated: 0 };
  let eventVersionsTotal = 0;
  let metricVersionsTotal = 0;
  for (const history of eventVersions.values()) {
    events[history[history.length - 1].status] += 1;
    eventVersionsTotal += history.length;
  }
  for (const history of metricVersions.values()) {
    metrics[history[history.length - 1].status] += 1;
    metricVersionsTotal += history.length;
  }
  return {
    events,
    metrics,
    event_versions_total: eventVersionsTotal,
    metric_versions_total: metricVersionsTotal,
  };
}

// ---------------------------------------------------------------------------
// Writes — append-only, fail-soft, client-injectable
// ---------------------------------------------------------------------------

async function persistEvent(
  def: EventDefinition,
  clientProvider: PlatformClientProvider
): Promise<void> {
  try {
    const client = clientProvider();
    if (!client) {
      logMiss("no database configured");
      return;
    }
    const { error } = await client.from("event_definition").insert({
      event_name: def.event_name,
      definition_version: def.definition_version,
      tenant_id: def.tenant_id ?? "prn",
      description: def.description,
      owning_agent_or_domain: def.owning_agent_or_domain,
      required_envelope_fields: def.required_envelope_fields,
      payload_schema_ref: def.payload_schema_ref,
      privacy_class: def.privacy_class,
      retention_class: def.retention_class,
      status: def.status,
      deprecated_by: def.deprecated_by ?? null,
      first_seen_at: def.first_seen_at ?? null,
      approved_by: def.approved_by ?? null,
      approved_at: def.approved_at ?? null,
    });
    if (error) logMiss(error.message);
  } catch (err) {
    logMiss(err instanceof Error ? err.message : String(err));
  }
}

async function persistMetric(
  def: MetricDefinition,
  clientProvider: PlatformClientProvider
): Promise<void> {
  try {
    const client = clientProvider();
    if (!client) {
      logMiss("no database configured");
      return;
    }
    const { error } = await client.from("metric_definition").insert({
      metric_key: def.metric_key,
      definition_version: def.definition_version,
      tenant_id: def.tenant_id ?? "prn",
      display_name: def.display_name,
      formula_description: def.formula_description,
      metric_type: def.metric_type,
      source_events: def.source_events,
      denominator_event: def.denominator_event ?? null,
      metric_window: def.metric_window,
      segments: def.segments ?? null,
      target: def.target ?? null,
      target_is_test_figure: def.target_is_test_figure ?? null,
      status: def.status,
      superseded_by: def.superseded_by ?? null,
      owning_kpi_tree: def.owning_kpi_tree ?? null,
    });
    if (error) logMiss(error.message);
  } catch (err) {
    logMiss(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Append ONE new version of an event definition. The caller supplies the row
 * WITHOUT `definition_version`; this assigns the next one, so a version can
 * never be overwritten or reused.
 */
export async function appendEventDefinitionVersion(
  input: Omit<EventDefinition, "definition_version">,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<EventDefinition> {
  ensureSeeded();
  const history = eventVersions.get(input.event_name) ?? [];
  const def = EventDefinition.parse({
    ...input,
    definition_version: history.length + 1,
  });
  eventVersions.set(input.event_name, [...history, def]);
  await persistEvent(def, clientProvider);
  return def;
}

export async function appendMetricDefinitionVersion(
  input: Omit<MetricDefinition, "definition_version">,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<MetricDefinition> {
  ensureSeeded();
  const history = metricVersions.get(input.metric_key) ?? [];
  const def = MetricDefinition.parse({
    ...input,
    definition_version: history.length + 1,
  });
  metricVersions.set(input.metric_key, [...history, def]);
  await persistMetric(def, clientProvider);
  return def;
}

/**
 * Write the whole seeded dictionary through to the durable registry. Fail-soft
 * and idempotent at the row level (the table's primary key is
 * (name, definition_version)). Migration 00009 is applied 2026-08-25, so this is now a
 * one-call backfill any caller can run against the live registry; nothing calls
 * it automatically, because seeding a durable dictionary is an act with a date
 * on it and not a side effect of importing a module.
 */
export async function persistSeededDictionary(
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<{ events: number; metrics: number }> {
  ensureSeeded();
  let events = 0;
  let metrics = 0;
  for (const history of eventVersions.values()) {
    for (const def of history) {
      await persistEvent(def, clientProvider);
      events += 1;
    }
  }
  for (const history of metricVersions.values()) {
    for (const def of history) {
      await persistMetric(def, clientProvider);
      metrics += 1;
    }
  }
  return { events, metrics };
}

export { RESERVED_DESCRIPTION, OWNER_GAUGE_FORMULA, OWNER_GAUGE_SEEDS, isReserved };
