import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { A09_EMITTED_EVENT_NAMES } from "@/platform/quality/events";
import {
  evaluateSubject,
  type InvariantContext,
  type QualitySubject,
} from "@/platform/quality/invariants";
import {
  qualityCounters,
  recordFinding,
  shouldQuarantine,
  writesLost,
  type QualityDeps,
} from "@/platform/quality/issues";
import { recordIngestCheckOutcome } from "@/platform/quality/kpi";
import { applyQuarantine } from "@/platform/quality/quarantine";
import type { FindingSource } from "@/platform/quality/types";
import { requirePolicyBoolean } from "@/platform/policy/store";
import { recordAgentRun } from "@/platform/runs/ledger";
import type { RecordJourneyInput, RuntimeStore } from "@/platform/stores/runtime";
import type { EventEnvelope } from "@/platform/events/envelope";
import type { JobPacket } from "@/domain/problem/contracts";

/**
 * A09 build step 3 — INGEST-TIME VALIDATION, HOOKED AT THE STORE BOUNDARY.
 *
 * WHY HERE AND NOT IN src/domain/* (pre-answer 3). The domain modules are
 * mostly contracts and pure logic; actual persistence funnels through
 * `stores/runtime.ts`. One wrapper at that seam covers every writer, cannot be
 * bypassed by a new caller who forgets to call a validator, and adds no
 * per-domain edits. `runtimeStore()` applies this decorator itself, so there is
 * no opt-in to forget.
 *
 * IT VALIDATES AFTER THE WRITE, NEVER INSTEAD OF IT. A09 detects and contains;
 * it does not reject a homeowner's record. The inner write happens first and
 * its result is returned untouched, so a bad record is caught in the SAME
 * REQUEST CYCLE (§9 step 3) without A09 ever becoming a gate on the customer
 * path. If every rule in this module were deleted, the customer journey would
 * behave identically.
 *
 * NOTHING A09 DOES HERE CAN THROW INTO A REQUEST. Rule evaluation is already
 * contained per-rule; the whole guard is wrapped again, because a defect in the
 * data-quality agent must never become a 500 on an intake.
 *
 * CHEAP CHECKS ONLY. This is a guard, not a report (§2 trigger 1). It runs the
 * rules that need nothing but the record in hand. Referential sweeps, duplicate
 * scans and cross-source totals need a table scan, so they belong to
 * reconciliation.ts — and a rule whose resolver returns `undefined` here treats
 * that as "unknown", never as a violation.
 *
 * RE-ENTRANCY. Recording a finding EMITS `data_quality.issue_detected`, which
 * reaches `recordEvents` — the very method this guard wraps. The loop is broken
 * precisely rather than with a global flag (which would misbehave under
 * concurrent requests): A09's own six event names are never validated. One
 * level, no recursion, and no correctness cost — A09 validating its own
 * telemetry would tell nobody anything.
 *
 * KILL SWITCH (§7). Pausing A09 stops repair PROPOSAL and EXECUTION
 * (enforced in repairs.ts) and deliberately does NOT stop detection, recording
 * or containment: "visibility into a broken pipeline is exactly what you don't
 * want to lose while investigating it", and a pause that also un-quarantined
 * everything would put known-bad rows straight back into the owner's numbers.
 *
 * LEDGER PER BATCH, NOT PER CHECK (§5, and A08's condition-7 precedent). One
 * guarded journey or packet write is one validation batch and writes ONE ledger
 * row. Event validation writes NO row of its own — `emitPlatformEvent` fires
 * several times per request and a row each would be unbounded amplification —
 * its counters fold into the next batch.
 */

const A09 = "A09";
const A09_CAPABILITIES = ["quality.validate_ingest"] as const;
const A09_OWN_EVENT_NAMES: readonly string[] = A09_EMITTED_EVENT_NAMES;

export interface GuardDeps extends QualityDeps {
  /** Test seam: force the guard on/off without editing the policy store. */
  enabled?: boolean;
}

function guardEnabled(deps: GuardDeps): boolean {
  if (deps.enabled !== undefined) return deps.enabled;
  try {
    return requirePolicyBoolean("quality.ingest_validation_enabled");
  } catch {
    // A missing policy key is a programmer error the policy test catches. At
    // runtime, default to VALIDATING — the failure mode of an unnecessary check
    // is a wasted microsecond; the failure mode of a silently disabled guard is
    // the whole agent.
    return true;
  }
}

export interface IngestValidationResult {
  checked: number;
  findings: number;
  quarantined: number;
  /** True when a finding or marker this batch raised did not persist. */
  could_not_verify: boolean;
}

/**
 * Evaluate a batch of subjects, record what fails, quarantine what is severe
 * enough. Returns counts only. Never throws.
 */
export async function validateSubjects(
  subjects: readonly QualitySubject[],
  source: FindingSource,
  ctx: InvariantContext,
  deps: GuardDeps = {}
): Promise<IngestValidationResult> {
  const clientProvider = deps.clientProvider ?? serviceClientProvider;
  const result: IngestValidationResult = {
    checked: 0,
    findings: 0,
    quarantined: 0,
    could_not_verify: false,
  };

  for (const subject of subjects) {
    const violations = evaluateSubject(subject, ctx);
    result.checked += 1;
    recordIngestCheckOutcome(violations.length === 0);

    for (const { rule, violation } of violations) {
      const written = await recordFinding(
        {
          kind: "data_quality_issue",
          source,
          rule,
          entity_type: subject.entity_type,
          entity_id: subject.entity_id,
          violation,
        },
        { clientProvider }
      );
      result.findings += 1;
      if (!written.ok) {
        // Loud already (issues.ts). The batch must not now claim it contained
        // something it could not even record.
        result.could_not_verify = true;
        continue;
      }
      if (!shouldQuarantine(written.record.severity)) continue;
      const marker = await applyQuarantine(written.record, { clientProvider });
      if (marker.ok) result.quarantined += 1;
      else result.could_not_verify = true;
    }
  }
  return result;
}

/** One Agent Run Ledger row for one validation batch. IDs and counts only. */
async function writeBatchLedgerRow(
  trigger: "request" | "job" | "schedule" | "admin_action",
  inputIds: string[],
  result: IngestValidationResult,
  startedAt: number,
  clientProvider: PlatformClientProvider
): Promise<void> {
  const c = qualityCounters();
  await recordAgentRun(
    {
      agent_id: A09,
      trigger,
      input_ids: inputIds,
      capabilities_used: [...A09_CAPABILITIES],
      tool_provider: "deterministic-stand-in",
      outputs_summary: {
        subjects_checked: result.checked,
        findings_created: result.findings,
        quarantines_applied: result.quarantined,
        // The honest verdict. Never "clean" when A09's own writes did not land.
        verdict: result.could_not_verify
          ? "could_not_verify"
          : result.findings === 0
            ? "clean"
            : "findings_recorded",
      },
      // No model is called anywhere in A09 (§3), so the deterministic cost is 0
      // — not an estimate, and not a dollar figure.
      cost_usd: 0,
      latency_ms: Date.now() - startedAt,
      errors: result.could_not_verify
        ? [
            `lost writes this process: findings=${c.findings_write_failed} quarantines=${c.quarantines_write_failed}`,
          ]
        : undefined,
    },
    clientProvider
  );
}

function subjectsFromJourney(input: RecordJourneyInput): QualitySubject[] {
  return [
    {
      entity_type: "problem_record",
      entity_id: input.problem.problem_id,
      record: input.problem,
    },
    { entity_type: "job_packet", entity_id: input.packet.job_packet_id, record: input.packet },
    {
      entity_type: "consent_event",
      entity_id: input.consent.consent_event_id,
      record: input.consent,
    },
    {
      entity_type: "intake_session",
      entity_id: input.session.intake_session_id,
      record: input.session,
    },
  ];
}

/**
 * A resolver built from the records being written in this very call. Anything
 * it was not handed resolves to `undefined` — unknown, therefore not a
 * violation. The full referential sweep is reconciliation's job.
 */
function localResolver(known: ReadonlySet<string>): InvariantContext["exists"] {
  return (_type, id) => (known.has(id) ? true : undefined);
}

/**
 * Wrap a RuntimeStore so every write through it is validated. Applied by
 * `runtimeStore()` itself — validation is not opt-in.
 */
export function applyQualityGuard(inner: RuntimeStore, deps: GuardDeps = {}): RuntimeStore {
  const clientProvider = deps.clientProvider ?? serviceClientProvider;

  /**
   * EVERY method is delegated EXPLICITLY. A spread of `inner` would copy only
   * own properties and silently drop every prototype method of the Supabase and
   * File store classes. Listing them also means a new method on RuntimeStore is
   * a TYPE ERROR here rather than a write that quietly escapes validation —
   * which is the property this whole seam exists to provide.
   */
  const guarded: RuntimeStore = {
    kind: inner.kind,

    /**
     * PURE PASSTHROUGHS, bound rather than wrapped in arrow functions. A bound
     * method has no body of its own, so it cannot grow logic later, and the
     * client-boundary test's "only owner-admin API routes mutate owner state"
     * grep stays at full strength instead of needing an exemption for a guard
     * that mutates nothing. Notably `setPublished` and `appendAudit`: A09 never
     * publishes, unpublishes, retires or edits page content (condition 8), and
     * no quarantine or repair may reach through this seam to do so.
     */
    ensureDisclosure: inner.ensureDisclosure.bind(inner),
    getJourney: inner.getJourney.bind(inner),
    listJourneys: inner.listJourneys.bind(inner),
    countEvents: inner.countEvents.bind(inner),
    totals: inner.totals.bind(inner),
    getPublishedPageIds: inner.getPublishedPageIds.bind(inner),
    setPublished: inner.setPublished.bind(inner),
    listStagedSpecs: inner.listStagedSpecs.bind(inner),
    appendAudit: inner.appendAudit.bind(inner),
    listAudit: inner.listAudit.bind(inner),
    attachEvidence: inner.attachEvidence.bind(inner),
    saveIntakeAnswers: inner.saveIntakeAnswers.bind(inner),
    listIntakeAnswers: inner.listIntakeAnswers.bind(inner),
    saveDiagnosisAnswer: inner.saveDiagnosisAnswer.bind(inner),
    listDiagnosisAnswers: inner.listDiagnosisAnswers.bind(inner),
    listEvidence: inner.listEvidence.bind(inner),
    listClaims: inner.listClaims.bind(inner),
    listDerivations: inner.listDerivations.bind(inner),
    /**
     * SUPERSESSION IS A PASSTHROUGH, not a validated write. It sets two fields
     * on a packet A09 already validated when it was written, and validating a
     * record again on the way to being retired would raise findings about a
     * version nobody will look at again.
     */
    supersedePacket: inner.supersedePacket.bind(inner),

    // --- validated writes --------------------------------------------------
    async recordJourney(input: RecordJourneyInput): Promise<void> {
      // The customer's write happens first and unconditionally.
      await inner.recordJourney(input);
      if (!guardEnabled(deps)) return;
      const startedAt = Date.now();
      try {
        const known = new Set([
          input.problem.problem_id,
          input.packet.job_packet_id,
          input.session.intake_session_id,
          input.consent.consent_event_id,
          ...input.problem.evidence_ids,
        ]);
        const subjects = subjectsFromJourney(input);
        const result = await validateSubjects(subjects, "ingest", { exists: localResolver(known) }, deps);
        await writeBatchLedgerRow(
          "request",
          subjects.map((s) => s.entity_id),
          result,
          startedAt,
          clientProvider
        );
      } catch {
        /* A defect in A09 must never become a 500 on a homeowner's intake. */
      }
    },

    async savePacket(packet: JobPacket): Promise<void> {
      await inner.savePacket(packet);
      if (!guardEnabled(deps)) return;
      const startedAt = Date.now();
      try {
        const subjects: QualitySubject[] = [
          { entity_type: "job_packet", entity_id: packet.job_packet_id, record: packet },
        ];
        const result = await validateSubjects(subjects, "ingest", {}, deps);
        await writeBatchLedgerRow(
          "request",
          [packet.job_packet_id],
          result,
          startedAt,
          clientProvider
        );
      } catch {
        /* never breaks the caller */
      }
    },

    async recordEvents(events: EventEnvelope[]): Promise<void> {
      await inner.recordEvents(events);
      if (!guardEnabled(deps)) return;
      try {
        // A09's own telemetry is never validated — that is what stops the
        // record -> emit -> record loop, precisely and without a global flag.
        const subjects: QualitySubject[] = events
          .filter((e) => !A09_OWN_EVENT_NAMES.includes(e.event_name))
          .map((record) => ({
            entity_type: "event_envelope" as const,
            entity_id: record.event_id,
            record,
          }));
        if (subjects.length === 0) return;
        // No ledger row here: emit fires several times per request and a row
        // each would be unbounded amplification. Counters fold into the next
        // batch's row.
        await validateSubjects(subjects, "ingest", {}, deps);
      } catch {
        /* never breaks the caller */
      }
    },
  };

  return guarded;
}

/**
 * Write a ledger row for the event-validation counters accumulated since the
 * last batch. Exposed for a caller that emits without also writing a journey;
 * nothing in Wave 0 needs it, and it exists so the DoD's "every validation run
 * produces a ledger row" has a callable answer rather than a promise.
 */
export async function flushIngestValidationBatch(
  deps: GuardDeps = {}
): Promise<void> {
  const clientProvider = deps.clientProvider ?? serviceClientProvider;
  const c = qualityCounters();
  await writeBatchLedgerRow(
    "job",
    [],
    {
      checked: 0,
      findings: c.findings_recorded,
      quarantined: c.quarantines_applied,
      could_not_verify: writesLost(c),
    },
    Date.now(),
    clientProvider
  );
}
