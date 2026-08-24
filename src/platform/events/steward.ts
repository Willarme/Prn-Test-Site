import { queueApproval, type ApprovalItem } from "@/platform/approvals/center";
import type { ApprovalKind } from "@/platform/approvals/kinds";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { dictionaryConfig, nameDistance } from "@/platform/events/config";
import {
  analyzeEventChange,
  analyzeMetricChange,
  EventDefinition,
  MetricDefinition,
  type CompatibilityAnalysis,
  type MetricLineage,
} from "@/platform/events/definitions";
import {
  appendEventDefinitionVersion,
  appendMetricDefinitionVersion,
  currentEventDefinition,
  currentMetricDefinition,
  dictionaryCensus,
  listEventDefinitions,
  listMetricDefinitions,
  metricDefinitionHistory,
} from "@/platform/events/dictionary";
import { emitPlatformEvent, type PlatformEventInput } from "@/platform/events/emit";
import type { EventEnvelope } from "@/platform/events/envelope";
import { EVENT_NAMES, type EventName } from "@/platform/events/names";
import { checkKillSwitch } from "@/platform/killswitch";
import { recordAgentRun, type AgentRunRecord } from "@/platform/runs/ledger";

/**
 * A08 Metric & Event Steward — the standing validation library every agent
 * calls (spec §4, §9 step 4). Deterministic end to end: name-format checks,
 * exact and near-duplicate detection, required-field checks, denominator
 * checks, backward-compatibility diffing and lineage traversal are all
 * rule-based. NO MODEL, EVER, IN THIS PATH — A08 is called synchronously on
 * every event any agent emits, so a model here would be a cost and latency
 * mistake regardless of whether one is wired anywhere else (§3, §7).
 *
 * WRAPS, NEVER RUNS BESIDE (Loop I/O): validateAndEmit calls the shipped
 * emitPlatformEvent. There is one emit path in this codebase, not two.
 *
 * FAIL-OPEN / FAIL-CLOSED — the split ruling (pre-answer 2):
 *   STORAGE   — already settled doctrine from the approved A00: fail-soft,
 *               emit never throws, a storage miss is logged and swallowed.
 *   VALIDATION in the customer path — FAIL OPEN. A metric-steward hiccup must
 *               never block a homeowner mid-intake. An event whose name has no
 *               approved definition is still recorded, marked
 *               `undefined_event: "true"` so §8's undefined-event-rate KPI has
 *               a real numerator instead of a structural zero.
 *   REGISTRY WRITES — FAIL CLOSED. A proposal cannot register while the
 *               validator is paused or degraded. A hiccup must never quietly
 *               register a definition.
 *
 * BLOCKED ATTEMPTS ARE COUNTED (condition 16). A name absent from names.ts
 * cannot be emitted at all — the shipped envelope's z.enum is the contract of
 * record and A08 will not weaken it to let an unknown string through. Those
 * attempts are counted, not silently dropped, so the undefined-event KPI reads
 * something true rather than a structural zero.
 *
 * LEDGER PER RUN, NOT PER EVENT (condition 7 / pre-answer 13). validateAndEmit
 * writes NO ledger row — /api/intake alone emits several events per request and
 * page.viewed fires per pageview, so a row per event is unbounded write
 * amplification against A00's per-run semantics. Counters accumulate in
 * process; `runValidationBatch` and `runScheduledDictionaryAudit` each write
 * exactly ONE row. Events are already their own append-only record in
 * event_envelope.
 */

const A08 = "A08";

/** Capability labels for the ledger — deterministic, no gateway call. */
const A08_CAPABILITIES = ["dictionary.validate", "dictionary.register"] as const;

// ---------------------------------------------------------------------------
// Counters — the batch/audit read model. Never a per-event ledger row.
// ---------------------------------------------------------------------------

export interface StewardCounters {
  events_validated: number;
  events_emitted: number;
  /** Emitted fail-open with an `undefined_event` marker. KPI numerator. */
  events_emitted_undefined: number;
  /** Emitted while A08 was paused — recorded, unvalidated, marked. */
  events_emitted_unvalidated: number;
  /** Name absent from the canonical dictionary: cannot be emitted. KPI numerator. */
  emissions_blocked_unregistered: number;
  /** Required envelope field missing: rejected loudly, never a partial row. */
  emissions_blocked_missing_field: number;
  definitions_auto_registered: number;
  changes_routed_to_approval: number;
  near_duplicate_flags: number;
  compatibility_failures: number;
  registry_writes_refused_paused: number;
}

function zeroCounters(): StewardCounters {
  return {
    events_validated: 0,
    events_emitted: 0,
    events_emitted_undefined: 0,
    events_emitted_unvalidated: 0,
    emissions_blocked_unregistered: 0,
    emissions_blocked_missing_field: 0,
    definitions_auto_registered: 0,
    changes_routed_to_approval: 0,
    near_duplicate_flags: 0,
    compatibility_failures: 0,
    registry_writes_refused_paused: 0,
  };
}

let counters = zeroCounters();

/** Names auto-registered since the last flush — the audit digest lists them. */
let autoRegistered: string[] = [];

export function stewardCounters(): Readonly<StewardCounters> {
  return counters;
}

export function resetStewardForTests(): void {
  counters = zeroCounters();
  autoRegistered = [];
  pendingChanges.clear();
}

function isCanonicalName(name: string): name is EventName {
  return (EVENT_NAMES as readonly string[]).includes(name);
}

// ---------------------------------------------------------------------------
// validateAndEmit — Stage B on the hot path
// ---------------------------------------------------------------------------

export interface ValidateAndEmitInput extends Omit<PlatformEventInput, "event_name"> {
  /** Deliberately widened to `string`: an unregistered name must be TESTABLE. */
  event_name: string;
}

export interface ValidateAndEmitResult {
  status: "emitted" | "emitted_undefined" | "emitted_unvalidated" | "blocked";
  envelope: EventEnvelope | null;
  reasons: string[];
}

/**
 * Resolve one `required_envelope_fields` path against the caller's input.
 * Fields emit.ts always constructs (event_id, occurred_at, actor, source,
 * versions, result, privacy_class, event_name, event_version) are present by
 * construction; only the caller-supplied ones can actually be missing.
 */
function requiredFieldPresent(path: string, input: ValidateAndEmitInput): boolean {
  if (path.startsWith("context.")) {
    const key = path.slice("context.".length);
    const value = input.context?.[key];
    return typeof value === "string" && value.length > 0;
  }
  switch (path) {
    case "trace_id":
      return typeof input.trace_id === "string" && input.trace_id.length > 0;
    case "agent_run_id":
      return typeof input.agent_run_id === "string" && input.agent_run_id.length > 0;
    case "tenant_id":
      return input.tenant_id === undefined || input.tenant_id.length > 0;
    case "guest_session_id":
    case "action_request_id":
      // emit.ts hard-codes these null; a definition requiring one is asking
      // for a field the shared emit path cannot supply today.
      return false;
    case "context":
      return Object.keys(input.context ?? {}).length > 0;
    default:
      return true;
  }
}

let blockLogged = false;
function logBlock(message: string): void {
  // Loud, but once per process and never a throw: the fail-soft contract holds
  // even when the thing being reported is a rejection.
  if (blockLogged) return;
  blockLogged = true;
  console.warn(`[a08-steward] ${message}`);
}

/**
 * The one call every emitting agent makes. Validates against the dictionary,
 * then emits through the shipped emit path. NEVER throws.
 */
export async function validateAndEmit(
  input: ValidateAndEmitInput,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<ValidateAndEmitResult> {
  counters.events_validated += 1;
  const reasons: string[] = [];

  // 1. A name the compile-time union does not carry cannot produce a valid
  //    envelope. Counted, never silently dropped.
  if (!isCanonicalName(input.event_name)) {
    counters.emissions_blocked_unregistered += 1;
    logBlock(
      `blocked an emission of "${input.event_name}" — not in the canonical dictionary. ` +
        "Register it via proposeEventDefinition and regenerate names.ts."
    );
    return {
      status: "blocked",
      envelope: null,
      reasons: [`"${input.event_name}" is not a canonical event name`],
    };
  }
  const eventName: EventName = input.event_name;

  // 2. Paused A08 => fail OPEN on the customer path, marked and counted.
  const kill = checkKillSwitch(A08, clientProvider);
  if (kill.engaged) {
    counters.events_emitted_unvalidated += 1;
    const envelope = await emitPlatformEvent({
      ...input,
      event_name: eventName,
      context: { ...(input.context ?? {}), a08_unvalidated: "true" },
    });
    return {
      status: "emitted_unvalidated",
      envelope,
      reasons: [`A08 validation paused (${kill.scope}) — failed open, event recorded unvalidated`],
    };
  }

  const def = currentEventDefinition(eventName);

  // 3. No approved definition => fail OPEN, marked so the KPI has a numerator.
  if (!def || def.status !== "approved") {
    if (def?.status === "deprecated") {
      counters.events_emitted_undefined += 1;
      const envelope = await emitPlatformEvent({
        ...input,
        event_name: eventName,
        context: {
          ...(input.context ?? {}),
          deprecated_event: "true",
          ...(def.deprecated_by ? { deprecated_by: def.deprecated_by } : {}),
        },
      });
      return {
        status: "emitted_undefined",
        envelope,
        reasons: [
          `"${eventName}" is deprecated${def.deprecated_by ? ` — use ${def.deprecated_by}` : ""}`,
        ],
      };
    }
    counters.events_emitted_undefined += 1;
    const envelope = await emitPlatformEvent({
      ...input,
      event_name: eventName,
      context: { ...(input.context ?? {}), undefined_event: "true" },
    });
    return {
      status: "emitted_undefined",
      envelope,
      reasons: [`"${eventName}" has no approved EventDefinition`],
    };
  }

  // 4. Required-field check — a missing field is REJECTED, loudly, never a
  //    silently partial row (§9 step 2). This is a validation verdict, not a
  //    library failure, so fail-open does not apply.
  const missing = def.required_envelope_fields.filter((path) => !requiredFieldPresent(path, input));
  if (missing.length > 0) {
    counters.emissions_blocked_missing_field += 1;
    logBlock(`blocked "${eventName}" — missing required envelope fields: ${missing.join(", ")}`);
    reasons.push(`missing required envelope fields: ${missing.join(", ")}`);
    return { status: "blocked", envelope: null, reasons };
  }

  const envelope = await emitPlatformEvent({ ...input, event_name: eventName });
  counters.events_emitted += 1;
  return { status: "emitted", envelope, reasons };
}

/** A08's own six events go through the same one path — never beside it. */
async function emitSteward(
  eventName: EventName,
  context: Record<string, string>,
  clientProvider: PlatformClientProvider
): Promise<void> {
  await validateAndEmit({ event_name: eventName, agent_id: A08, context }, clientProvider);
}

// ---------------------------------------------------------------------------
// Stage C — collision and near-duplicate detection
// ---------------------------------------------------------------------------

export interface DuplicateFlag {
  candidate: string;
  existing: string;
  distance: number;
}

function nearDuplicates(candidate: string, existing: readonly string[]): DuplicateFlag[] {
  const threshold = dictionaryConfig().near_duplicate_max_distance;
  return existing
    .map((name) => ({ candidate, existing: name, distance: nameDistance(candidate, name) }))
    .filter((f) => f.distance > 0 && f.distance <= threshold)
    .sort((a, b) => a.distance - b.distance);
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export type ProposalOutcome =
  | "registered"
  | "rejected"
  | "queued_for_approval"
  | "refused_paused";

export interface ProposalResult {
  outcome: ProposalOutcome;
  reasons: string[];
  /** Set when the proposal auto-registered. */
  definition?: EventDefinition | MetricDefinition;
  /** Set when the proposal went to a human. */
  approval_id?: string;
  /** Set on a change proposal. */
  analysis?: CompatibilityAnalysis;
  flags?: DuplicateFlag[];
  /**
   * True when a newly registered EVENT name is not yet in names.ts. The
   * registry is the authority (pre-answer 10) but names.ts is the compile-time
   * union, so nothing can EMIT the new name until the seed artifact is
   * regenerated. Stated plainly rather than pretended away.
   */
  requires_names_regeneration?: boolean;
}

interface PendingChange {
  kind: "event" | "metric";
  approval_id: string;
  next: EventDefinition | MetricDefinition;
  analysis: CompatibilityAnalysis;
  /** A deprecation is a change too — it applies through the same gate. */
  is_deprecation: boolean;
}

const pendingChanges = new Map<string, PendingChange>();

interface ProposalContext {
  /** The run this proposal belongs to — the Approval Center requires one. */
  run_id: string;
  proposed_by?: string;
}

function paused(clientProvider: PlatformClientProvider): boolean {
  const kill = checkKillSwitch(A08, clientProvider);
  if (kill.engaged) {
    counters.registry_writes_refused_paused += 1;
    return true;
  }
  return false;
}

/**
 * Propose a BRAND-NEW EventDefinition.
 *
 * Clean and non-colliding => AUTO-VALIDATES and registers (pre-answer 1:
 * canon's "L1-L2 propose/validate" is the autonomous half of the line). It is
 * made visible three ways rather than through a blocking gate: the
 * schema.proposed + schema.approved pair is emitted, the enclosing run is
 * written to the Agent Run Ledger, and every auto-registered name is listed in
 * the scheduled audit digest. A blocking approval step is deliberately NOT
 * added — filling the queue with routine dictionary rows before a
 * homeowner-facing gate exists trains the owner to rubber-stamp it.
 *
 * EXACT NAME COLLISION => HARD BLOCK (canon: "new events cannot duplicate an
 * existing meaning under a new name"). Changing an existing definition is a
 * different call — proposeEventDefinitionChange — which always goes to a human.
 *
 * NEAR-DUPLICATE => held and routed to the Approval Center as an exception,
 * carrying the collision evidence. A near match is a question for a human, not
 * a verdict A08 gets to make.
 */
export async function proposeEventDefinition(
  input: Omit<EventDefinition, "definition_version">,
  ctx: ProposalContext,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<ProposalResult> {
  if (paused(clientProvider)) {
    return {
      outcome: "refused_paused",
      reasons: ["A08 is paused — registry writes fail CLOSED while the validator is degraded"],
    };
  }

  const candidate = EventDefinition.safeParse({ ...input, definition_version: 1 });
  if (!candidate.success) {
    return {
      outcome: "rejected",
      reasons: candidate.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const def = candidate.data;

  if (currentEventDefinition(def.event_name)) {
    return {
      outcome: "rejected",
      reasons: [
        `exact name collision: "${def.event_name}" is already registered — ` +
          "a change to an existing definition goes through proposeEventDefinitionChange, which always requires approval",
      ],
    };
  }

  const flags = nearDuplicates(
    def.event_name,
    listEventDefinitions().map((d) => d.event_name)
  );
  await emitSteward("schema.proposed", { definition_kind: "event", name: def.event_name }, clientProvider);

  if (flags.length > 0) {
    counters.near_duplicate_flags += 1;
    const item = await queueApproval(
      {
        agent_id: A08,
        run_id: ctx.run_id,
        approval_kind: "dictionary.definition_change" satisfies ApprovalKind,
        what_happened: `A new event name "${def.event_name}" is a near-duplicate of an existing one.`,
        evidence: { flags, existing_versions: flags.map((f) => f.existing) },
        recommendation:
          "Confirm these are different things, or register the new name as an alias of the existing one.",
        impact: "A duplicate name would split one meaning across two dictionary entries.",
        risk: "medium — metric drift is invisible once two names both carry data",
        reversibility: "reversible",
        proposed_change: def,
      },
      clientProvider
    );
    counters.changes_routed_to_approval += 1;
    pendingChanges.set(item.approval_id, {
      kind: "event",
      approval_id: item.approval_id,
      next: def,
      analysis: { change_class: "additive", differences: ["new definition, near-duplicate flagged"] },
      is_deprecation: false,
    });
    return {
      outcome: "queued_for_approval",
      reasons: [`near-duplicate of ${flags.map((f) => f.existing).join(", ")}`],
      approval_id: item.approval_id,
      flags,
    };
  }

  const registered = await appendEventDefinitionVersion(def, clientProvider);
  counters.definitions_auto_registered += 1;
  autoRegistered.push(`event:${def.event_name}`);
  await emitSteward("schema.approved", { definition_kind: "event", name: def.event_name }, clientProvider);
  return {
    outcome: "registered",
    reasons: [],
    definition: registered,
    requires_names_regeneration: !isCanonicalName(def.event_name),
  };
}

/** Propose a BRAND-NEW MetricDefinition. Same rules as events. */
export async function proposeMetricDefinition(
  input: Omit<MetricDefinition, "definition_version">,
  ctx: ProposalContext,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<ProposalResult> {
  if (paused(clientProvider)) {
    return {
      outcome: "refused_paused",
      reasons: ["A08 is paused — registry writes fail CLOSED while the validator is degraded"],
    };
  }

  const candidate = MetricDefinition.safeParse({ ...input, definition_version: 1 });
  if (!candidate.success) {
    return {
      outcome: "rejected",
      reasons: candidate.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const def = candidate.data;

  if (currentMetricDefinition(def.metric_key)) {
    return {
      outcome: "rejected",
      reasons: [
        `exact key collision: "${def.metric_key}" is already registered — ` +
          "a change goes through proposeMetricDefinitionChange, which always requires approval",
      ],
    };
  }

  // Every source event must itself be registered, or the metric is untraceable
  // the day it is created — the exact condition the Definition of Done forbids.
  const unknown = def.source_events
    .concat(def.denominator_event ? [def.denominator_event] : [])
    .filter((name) => !currentEventDefinition(name));
  if (unknown.length > 0) {
    return {
      outcome: "rejected",
      reasons: [`source events not registered: ${unknown.join(", ")}`],
    };
  }

  const flags = nearDuplicates(
    def.metric_key,
    listMetricDefinitions().map((d) => d.metric_key)
  );
  await emitSteward("schema.proposed", { definition_kind: "metric", name: def.metric_key }, clientProvider);

  if (flags.length > 0) {
    counters.near_duplicate_flags += 1;
    const item = await queueApproval(
      {
        agent_id: A08,
        run_id: ctx.run_id,
        approval_kind: "dictionary.definition_change" satisfies ApprovalKind,
        what_happened: `A new metric key "${def.metric_key}" is a near-duplicate of an existing one.`,
        evidence: { flags },
        recommendation: "Confirm these measure different things before registering both.",
        impact: "Two keys for one number is exactly the metric drift A08 exists to prevent.",
        risk: "medium",
        reversibility: "reversible",
        proposed_change: def,
      },
      clientProvider
    );
    counters.changes_routed_to_approval += 1;
    pendingChanges.set(item.approval_id, {
      kind: "metric",
      approval_id: item.approval_id,
      next: def,
      analysis: { change_class: "additive", differences: ["new definition, near-duplicate flagged"] },
      is_deprecation: false,
    });
    return {
      outcome: "queued_for_approval",
      reasons: [`near-duplicate of ${flags.map((f) => f.existing).join(", ")}`],
      approval_id: item.approval_id,
      flags,
    };
  }

  const registered = await appendMetricDefinitionVersion(def, clientProvider);
  counters.definitions_auto_registered += 1;
  autoRegistered.push(`metric:${def.metric_key}`);
  await emitSteward("metric.created", { metric_key: def.metric_key }, clientProvider);
  await emitSteward("schema.approved", { definition_kind: "metric", name: def.metric_key }, clientProvider);
  return { outcome: "registered", reasons: [], definition: registered };
}

// ---------------------------------------------------------------------------
// Changes — ALWAYS a human, no matter how clean
// ---------------------------------------------------------------------------

async function queueChange(
  kind: "event" | "metric",
  name: string,
  next: EventDefinition | MetricDefinition,
  analysis: CompatibilityAnalysis,
  ctx: ProposalContext,
  isDeprecation: boolean,
  clientProvider: PlatformClientProvider
): Promise<ApprovalItem> {
  if (analysis.change_class === "breaking") {
    counters.compatibility_failures += 1;
    await emitSteward(
      "compatibility.failed",
      { definition_kind: kind, name, differences: String(analysis.differences.length) },
      clientProvider
    );
  }
  const item = await queueApproval(
    {
      agent_id: A08,
      run_id: ctx.run_id,
      approval_kind: "dictionary.definition_change" satisfies ApprovalKind,
      what_happened: isDeprecation
        ? `A08 proposes deprecating the ${kind} "${name}".`
        : `A08 proposes a ${analysis.change_class} change to the already-registered ${kind} "${name}".`,
      evidence: { change_class: analysis.change_class, differences: analysis.differences },
      recommendation:
        analysis.change_class === "breaking"
          ? "Breaking. Review the differences before approving — existing producers and stored history are affected."
          : "Additive. No existing producer is affected.",
      impact:
        kind === "metric"
          ? "Changes what an already-published number means."
          : "Changes the contract every producer of this event is written against.",
      risk: analysis.change_class === "breaking" ? "high" : "low",
      reversibility: "reversible",
      proposed_change: next,
    },
    clientProvider
  );
  counters.changes_routed_to_approval += 1;
  pendingChanges.set(item.approval_id, {
    kind,
    approval_id: item.approval_id,
    next,
    analysis,
    is_deprecation: isDeprecation,
  });
  return item;
}

/**
 * ANY change to an already-registered EventDefinition — no matter how trivial,
 * no matter how clean the diff — routes to the Approval Center and is NOT
 * applied. This is canon's explicit line, not a design choice: "Initial
 * autonomy: L1-L2 propose/validate; schema changes require approval." A08 does
 * not exempt its own proposals.
 */
export async function proposeEventDefinitionChange(
  eventName: string,
  patch: Partial<Omit<EventDefinition, "event_name" | "definition_version">>,
  ctx: ProposalContext,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<ProposalResult> {
  if (paused(clientProvider)) {
    return {
      outcome: "refused_paused",
      reasons: ["A08 is paused — registry writes fail CLOSED"],
    };
  }
  const before = currentEventDefinition(eventName);
  if (!before) {
    return { outcome: "rejected", reasons: [`"${eventName}" is not registered`] };
  }
  const candidate = EventDefinition.safeParse({
    ...before,
    ...patch,
    event_name: eventName,
    definition_version: before.definition_version + 1,
  });
  if (!candidate.success) {
    return {
      outcome: "rejected",
      reasons: candidate.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const analysis = analyzeEventChange(before, candidate.data);
  await emitSteward("schema.proposed", { definition_kind: "event", name: eventName }, clientProvider);
  const item = await queueChange(
    "event",
    eventName,
    candidate.data,
    analysis,
    ctx,
    false,
    clientProvider
  );
  return {
    outcome: "queued_for_approval",
    reasons: [`a change to an already-registered definition always requires approval`],
    approval_id: item.approval_id,
    analysis,
  };
}

export async function proposeMetricDefinitionChange(
  metricKey: string,
  patch: Partial<Omit<MetricDefinition, "metric_key" | "definition_version">>,
  ctx: ProposalContext,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<ProposalResult> {
  if (paused(clientProvider)) {
    return { outcome: "refused_paused", reasons: ["A08 is paused — registry writes fail CLOSED"] };
  }
  const before = currentMetricDefinition(metricKey);
  if (!before) {
    return { outcome: "rejected", reasons: [`"${metricKey}" is not registered`] };
  }
  const candidate = MetricDefinition.safeParse({
    ...before,
    ...patch,
    metric_key: metricKey,
    definition_version: before.definition_version + 1,
  });
  if (!candidate.success) {
    return {
      outcome: "rejected",
      reasons: candidate.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const analysis = analyzeMetricChange(before, candidate.data);
  await emitSteward("schema.proposed", { definition_kind: "metric", name: metricKey }, clientProvider);
  const item = await queueChange(
    "metric",
    metricKey,
    candidate.data,
    analysis,
    ctx,
    false,
    clientProvider
  );
  return {
    outcome: "queued_for_approval",
    reasons: ["a change to an already-registered definition always requires approval"],
    approval_id: item.approval_id,
    analysis,
  };
}

/**
 * Deprecate an event name or metric key (spec §9 step 6). NEVER a delete: the
 * old name keeps its full version history and stays queryable forever, and a
 * lookup of the old name resolves FORWARD to its replacement.
 *
 * Deprecation is a change to an already-registered definition, so it queues
 * like any other and applies only after a human approves.
 */
export async function deprecate(
  kind: "event" | "metric",
  name: string,
  replacedBy: string,
  ctx: ProposalContext,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<ProposalResult> {
  if (paused(clientProvider)) {
    return { outcome: "refused_paused", reasons: ["A08 is paused — registry writes fail CLOSED"] };
  }
  if (kind === "event") {
    const before = currentEventDefinition(name);
    if (!before) return { outcome: "rejected", reasons: [`"${name}" is not registered`] };
    if (!currentEventDefinition(replacedBy)) {
      return { outcome: "rejected", reasons: [`replacement "${replacedBy}" is not registered`] };
    }
    // Blast radius: every live metric that reads this event.
    const impacted = getEventImpact(name).map((m) => m.metric_key);
    const next = EventDefinition.parse({
      ...before,
      definition_version: before.definition_version + 1,
      status: "deprecated",
      deprecated_by: replacedBy,
    });
    const analysis = analyzeEventChange(before, next);
    if (impacted.length > 0) {
      analysis.differences.unshift(`metrics reading this event: ${impacted.join(", ")}`);
    }
    const item = await queueChange("event", name, next, analysis, ctx, true, clientProvider);
    return {
      outcome: "queued_for_approval",
      reasons: ["deprecation is a change to a registered definition — always approval-gated"],
      approval_id: item.approval_id,
      analysis,
    };
  }

  const before = currentMetricDefinition(name);
  if (!before) return { outcome: "rejected", reasons: [`"${name}" is not registered`] };
  if (!currentMetricDefinition(replacedBy)) {
    return { outcome: "rejected", reasons: [`replacement "${replacedBy}" is not registered`] };
  }
  const next = MetricDefinition.parse({
    ...before,
    definition_version: before.definition_version + 1,
    status: "deprecated",
    superseded_by: replacedBy,
  });
  const analysis = analyzeMetricChange(before, next);
  const item = await queueChange("metric", name, next, analysis, ctx, true, clientProvider);
  return {
    outcome: "queued_for_approval",
    reasons: ["deprecation is a change to a registered definition — always approval-gated"],
    approval_id: item.approval_id,
    analysis,
  };
}

/**
 * Apply a change a human APPROVED. The caller resolves the ApprovalItem
 * through the Approval Center first; this refuses anything not approved, so a
 * pending or rejected item can never be applied by mistake.
 */
export async function applyApprovedChange(
  approvalId: string,
  item: ApprovalItem,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<ProposalResult> {
  const pending = pendingChanges.get(approvalId);
  if (!pending) return { outcome: "rejected", reasons: ["no pending change for that approval id"] };
  if (item.approval_id !== approvalId) {
    return { outcome: "rejected", reasons: ["approval item does not match the approval id"] };
  }
  if (item.status !== "APPROVED" && item.status !== "MODIFIED") {
    return {
      outcome: "rejected",
      reasons: [`approval is ${item.status} — only an APPROVED or MODIFIED item may be applied`],
    };
  }

  if (pending.kind === "event") {
    const next = pending.next as EventDefinition;
    const { definition_version: _drop, ...rest } = next;
    const applied = await appendEventDefinitionVersion(rest, clientProvider);
    pendingChanges.delete(approvalId);
    if (pending.is_deprecation) {
      await emitSteward(
        "event.deprecated",
        { name: applied.event_name, deprecated_by: applied.deprecated_by ?? "" },
        clientProvider
      );
    }
    await emitSteward(
      "schema.approved",
      { definition_kind: "event", name: applied.event_name },
      clientProvider
    );
    return { outcome: "registered", reasons: [], definition: applied, analysis: pending.analysis };
  }

  const next = pending.next as MetricDefinition;
  const { definition_version: _drop, ...rest } = next;
  const applied = await appendMetricDefinitionVersion(rest, clientProvider);
  pendingChanges.delete(approvalId);
  await emitSteward("metric.versioned", { metric_key: applied.metric_key }, clientProvider);
  await emitSteward(
    "schema.approved",
    { definition_kind: "metric", name: applied.metric_key },
    clientProvider
  );
  return { outcome: "registered", reasons: [], definition: applied, analysis: pending.analysis };
}

// ---------------------------------------------------------------------------
// Lookups and lineage
// ---------------------------------------------------------------------------

export interface LookupResult<T> {
  definition: T | null;
  /** Set when a deprecated name resolved forward to its replacement. */
  resolved_from?: string;
  reasons: string[];
}

/**
 * Look up an event definition. A DEPRECATED name still resolves — forward, to
 * its replacement — and its own history stays readable via
 * `eventDefinitionHistory`. Nothing silently vanishes.
 */
export function lookupEventDefinition(eventName: string): LookupResult<EventDefinition> {
  const def = currentEventDefinition(eventName);
  if (!def) return { definition: null, reasons: [`"${eventName}" is not registered`] };
  if (def.status === "deprecated" && def.deprecated_by) {
    const forward = currentEventDefinition(def.deprecated_by);
    if (forward) {
      return {
        definition: forward,
        resolved_from: eventName,
        reasons: [`"${eventName}" is deprecated — resolved forward to "${def.deprecated_by}"`],
      };
    }
  }
  return { definition: def, reasons: [] };
}

export function lookupMetricDefinition(
  metricKey: string,
  atVersion?: number
): LookupResult<MetricDefinition> {
  if (atVersion !== undefined) {
    const historical = metricDefinitionHistory(metricKey).find(
      (d) => d.definition_version === atVersion
    );
    return historical
      ? { definition: historical, reasons: [] }
      : { definition: null, reasons: [`version ${atVersion} of "${metricKey}" does not exist`] };
  }
  const def = currentMetricDefinition(metricKey);
  if (!def) return { definition: null, reasons: [`"${metricKey}" is not registered`] };
  if (def.status === "deprecated" && def.superseded_by) {
    const forward = currentMetricDefinition(def.superseded_by);
    if (forward) {
      return {
        definition: forward,
        resolved_from: metricKey,
        reasons: [`"${metricKey}" is deprecated — resolved forward to "${def.superseded_by}"`],
      };
    }
  }
  return { definition: def, reasons: [] };
}

/**
 * Metric lineage: the metric's own version history plus each source event and
 * the EventDefinition version it currently resolves to. Turns "every trial
 * metric can be traced to canonical versioned events and definitions" from an
 * aspiration into a function call.
 */
export function getMetricLineage(metricKey: string): MetricLineage {
  const versions = metricDefinitionHistory(metricKey);
  const current = versions[versions.length - 1];
  const chain: MetricLineage["source_event_chain"] = [];
  if (current) {
    const names = [...current.source_events];
    if (current.denominator_event && !names.includes(current.denominator_event)) {
      names.push(current.denominator_event);
    }
    for (const name of names) {
      const def = currentEventDefinition(name);
      chain.push({
        event_name: name,
        definition_version: def?.definition_version ?? null,
        status: def?.status ?? "unregistered",
        is_denominator: current.denominator_event === name,
      });
    }
  }
  return { metric_key: metricKey, definition_versions: versions, source_event_chain: chain };
}

/**
 * The reverse: every live metric that consumes this event — the blast radius to
 * read BEFORE proposing a deprecation. Denominator use counts: a metric whose
 * denominator disappears is broken just as thoroughly as one whose numerator
 * does.
 */
export function getEventImpact(eventName: string): MetricDefinition[] {
  return listMetricDefinitions().filter(
    (m) =>
      m.status !== "deprecated" &&
      (m.source_events.includes(eventName) || m.denominator_event === eventName)
  );
}

// ---------------------------------------------------------------------------
// Ledger discipline — ONE row per run, never one per event
// ---------------------------------------------------------------------------

export interface ValidationBatchResult<T> {
  result: T;
  run: AgentRunRecord;
  counters: StewardCounters;
}

/**
 * Wrap a batch of validation/registration work in ONE Agent Run Ledger row.
 * The counters accumulated during the batch become the row's outputs_summary —
 * IDs and counts only, never customer evidence.
 */
export async function runValidationBatch<T>(
  input: { trigger: "request" | "job" | "schedule" | "admin_action"; input_ids?: string[] },
  fn: () => Promise<T>,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<ValidationBatchResult<T>> {
  const before = { ...counters };
  const startedAt = Date.now();
  const result = await fn();
  const delta = Object.fromEntries(
    (Object.keys(counters) as (keyof StewardCounters)[]).map((k) => [k, counters[k] - before[k]])
  ) as unknown as StewardCounters;

  const run = await recordAgentRun(
    {
      agent_id: A08,
      trigger: input.trigger,
      input_ids: input.input_ids ?? [],
      capabilities_used: [...A08_CAPABILITIES],
      tool_provider: "deterministic-stand-in",
      outputs_summary: delta,
      // No model is ever called in this path (§3/§7), so the deterministic
      // cost is 0 — not an estimate, and not a dollar figure.
      cost_usd: 0,
      latency_ms: Date.now() - startedAt,
    },
    clientProvider
  );
  return { result, run, counters: delta };
}

// ---------------------------------------------------------------------------
// Stage F — the scheduled dictionary audit
// ---------------------------------------------------------------------------

export interface DictionaryHealth {
  /** §8: events that could not be matched to an approved definition. */
  undefined_event_count: number;
  undefined_event_rate: number;
  blocked_unregistered_count: number;
  duplicate_flag_count: number;
  schema_break_incidents: number;
  /** % of sampled envelopes carrying a non-null trace_id. */
  data_joinability: number;
  data_joinability_sample: number;
  /**
   * §8's fifth KPI. Structurally 0 in Wave 0 and that is the honest answer:
   * NO dashboard-definition object exists anywhere in the repo, so there is
   * nothing to compare the registry against yet. Reported as 0 with the
   * sample size so nobody reads it as "clean".
   */
  undocumented_kpi_count: number;
  undocumented_kpi_surfaces_checked: number;
  census: ReturnType<typeof dictionaryCensus>;
  auto_registered_since_last_audit: string[];
}

/**
 * Stage F. Walks the registry and the live event stream to compute the §8
 * health numbers for A07 and the owner. ONE ledger row per audit run.
 *
 * READS IDS AND COUNTS ONLY (condition 14). The event_envelope query selects
 * event_name, occurred_at and trace_id and nothing else; it never joins to
 * intake_answer, evidence, or any customer-evidence table, and no raw evidence
 * can reach the audit output. Fail-soft: with no database the audit reports
 * from the in-process counters and says the sample was zero rather than
 * reporting "clean".
 */
export async function runScheduledDictionaryAudit(
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<ValidationBatchResult<DictionaryHealth>> {
  return runValidationBatch(
    { trigger: "schedule" },
    async () => {
      const approvedNames = new Set(listEventDefinitions("approved").map((d) => d.event_name));
      let sample = 0;
      let joinable = 0;
      let undefinedInStream = 0;

      try {
        const client = clientProvider();
        if (client) {
          const { data, error } = await client
            .from("event_envelope")
            // IDs, names and timestamps only — never customer evidence.
            .select("event_name, occurred_at, trace_id")
            .limit(1000);
          if (!error && data) {
            for (const row of data as { event_name: string; trace_id: string | null }[]) {
              sample += 1;
              if (row.trace_id) joinable += 1;
              if (!approvedNames.has(row.event_name)) undefinedInStream += 1;
            }
          }
        }
      } catch {
        /* fail-soft: the audit reports a zero sample, never a false "clean" */
      }

      const undefinedTotal =
        undefinedInStream + counters.events_emitted_undefined + counters.emissions_blocked_unregistered;
      const observed = sample + counters.events_validated;

      const health: DictionaryHealth = {
        undefined_event_count: undefinedTotal,
        undefined_event_rate: observed > 0 ? undefinedTotal / observed : 0,
        blocked_unregistered_count: counters.emissions_blocked_unregistered,
        duplicate_flag_count: counters.near_duplicate_flags,
        schema_break_incidents: counters.compatibility_failures,
        data_joinability: sample > 0 ? joinable / sample : 0,
        data_joinability_sample: sample,
        undocumented_kpi_count: 0,
        undocumented_kpi_surfaces_checked: 0,
        census: dictionaryCensus(),
        auto_registered_since_last_audit: [...autoRegistered],
      };
      autoRegistered = [];
      return health;
    },
    clientProvider
  );
}
