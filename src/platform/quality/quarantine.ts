import { randomUUID } from "node:crypto";
import { serviceClientProvider } from "@/platform/db/client";
import { emitQuarantineReleased, emitQuarantined } from "@/platform/quality/events";
import { bumpCounter, reportLostWrite, type QualityDeps } from "@/platform/quality/issues";
import { qualityStore } from "@/platform/quality/store";
import {
  QuarantineMarker,
  type EntityType,
  type QualityFinding,
  type QualityWriteResult,
} from "@/platform/quality/types";

/**
 * A09 build step 4 — QUARANTINE, NOT DROP.
 *
 * THE MARKER LIVES IN ITS OWN STORE (Loop Spec Audit condition 10). Never a
 * `quarantined_at` column bolted onto a watched table: a separate marker avoids
 * schema changes and RLS-policy edits on live customer tables, avoids touching
 * the append-only consent ledger's SHAPE at all, and is the cleaner per-client
 * story. The original row is never modified, never moved and never deleted —
 * "the original is always still there for a human to inspect" is the whole
 * point of quarantining rather than dropping.
 *
 * WHAT QUARANTINE ACTUALLY DOES IN WAVE 0 — and the line this build will not
 * cross. Quarantine is enforced at the READ layer, and Wave 0 scopes it to
 * KPI/aggregate and admin reads ONLY. The customer-facing read path serves the
 * record UNCHANGED.
 *
 * TODO-ASK-OWNER (Melissa) — pre-answer 10, parked, NOT decided here. "What
 * does a homeowner see when their own record is quarantined mid-journey?" is a
 * homeowner-experience, copy and psychology question: whether their packet or
 * their /results page vanishes, whether their intake can still complete, and
 * the wording of anything they are shown. Nothing in this build answers it. The
 * behaviour is a policy knob (`quality.quarantine_customer_reads`, default
 * FALSE) so the answer, when it exists, is a setting rather than a rewrite —
 * and until it exists, a live homeowner journey CANNOT be broken by a
 * quarantine, which is the only safe default when the question is open.
 *
 * A RELEASE IS AN OWNER ACT AND IS EVENTED. The marker's status is the one
 * mutable field in A09's data (findings and repair records are append-only), so
 * both edges emit — data_quality.quarantined on apply,
 * data_quality.quarantine_released on release — keeping the HISTORY
 * append-only even though the flag is not. A release changes which rows every
 * KPI includes; a release that left no record would be a silent restatement of
 * every number on the cockpit.
 */

function now(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

/** Composite key for the read-path filter. */
export function quarantineKey(entityType: EntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}

/**
 * Apply a marker for a finding. Fail-LOUD like the finding write: a swallowed
 * quarantine leaves bad data in the KPI numbers while the run claims it was
 * contained, which is strictly worse than never having quarantined at all.
 */
export async function applyQuarantine(
  finding: QualityFinding,
  deps: QualityDeps = {}
): Promise<QualityWriteResult<QuarantineMarker>> {
  const clientProvider = deps.clientProvider ?? serviceClientProvider;
  const marker = QuarantineMarker.parse({
    marker_id: `qm_${randomUUID()}`,
    tenant_id: finding.tenant_id,
    entity_type: finding.entity_type,
    entity_id: finding.entity_id,
    issue_id: finding.issue_id,
    reason_code: finding.detail_code,
    severity: finding.severity,
    status: "active",
    applied_at: now(),
    released_at: null,
    released_by: null,
  });

  try {
    await qualityStore(clientProvider).appendQuarantine(marker);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    bumpCounter("quarantines_write_failed");
    reportLostWrite("quarantine marker", marker.marker_id, reason);
    return { ok: false, error: reason, record: marker };
  }

  bumpCounter("quarantines_applied");
  await emitQuarantined(
    {
      issue_id: marker.issue_id,
      entity_type: marker.entity_type,
      entity_id: marker.entity_id,
      severity: marker.severity,
      reason_code: marker.reason_code,
    },
    clientProvider
  );
  return { ok: true, record: marker };
}

/**
 * Release a marker — an OWNER act, never an agent's. Returns the released
 * marker or a loud failure; nothing is deleted either way.
 */
export async function releaseQuarantine(
  markerId: string,
  releasedBy: string,
  deps: QualityDeps = {}
): Promise<QualityWriteResult<QuarantineMarker> | null> {
  const clientProvider = deps.clientProvider ?? serviceClientProvider;
  const store = qualityStore(clientProvider);
  const markers = await store.listQuarantine();
  const marker = markers.find((m) => m.marker_id === markerId && m.status === "active");
  if (!marker) return null;

  const releasedAt = now();
  const released = QuarantineMarker.parse({
    ...marker,
    status: "released",
    released_at: releasedAt,
    released_by: releasedBy,
  });
  try {
    await store.setQuarantineStatus(markerId, "released", releasedAt, releasedBy);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    bumpCounter("quarantines_write_failed");
    reportLostWrite("quarantine release", markerId, reason);
    return { ok: false, error: reason, record: released };
  }

  bumpCounter("quarantines_released");
  await emitQuarantineReleased(
    {
      issue_id: released.issue_id,
      entity_type: released.entity_type,
      entity_id: released.entity_id,
      released_by: releasedBy,
    },
    clientProvider
  );
  return { ok: true, record: released };
}

/** Every marker still in force. */
export async function activeQuarantine(
  deps: QualityDeps = {}
): Promise<QuarantineMarker[]> {
  const store = qualityStore(deps.clientProvider ?? serviceClientProvider);
  return (await store.listQuarantine()).filter((m) => m.status === "active");
}

/** The keys a read path filters against. */
export async function activeQuarantineKeys(deps: QualityDeps = {}): Promise<Set<string>> {
  const markers = await activeQuarantine(deps);
  return new Set(markers.map((m) => quarantineKey(m.entity_type, m.entity_id)));
}

export async function isQuarantined(
  entityType: EntityType,
  entityId: string,
  deps: QualityDeps = {}
): Promise<boolean> {
  return (await activeQuarantineKeys(deps)).has(quarantineKey(entityType, entityId));
}

/** Owner-retrievable: every marker, released ones included. Nothing is deleted. */
export async function allQuarantineMarkers(
  deps: QualityDeps = {}
): Promise<QuarantineMarker[]> {
  return qualityStore(deps.clientProvider ?? serviceClientProvider).listQuarantine();
}

/**
 * THE READ-PATH CONTRACT, enumerated (condition 12, hidden commitment 2).
 *
 * "Quarantined records disappear from every read path that feeds KPIs or
 * customer-facing surfaces" is a cross-cutting change to every consumer, not a
 * sub-step — so the read paths are LISTED here rather than assumed, a test pins
 * the list, and every future consumer has one place to check itself against.
 *
 * EXCLUDED (KPI / aggregate / admin counts):
 *   - platform/quality/kpi.ts  qualityFilteredJourneyTotals()  — the journey,
 *     packet and consent counts the /admin cockpit renders
 *   - platform/quality/kpi.ts  qualityKpiSnapshot()            — A09's own
 *     critical/unresolved/quarantined counters for the cockpit line
 *
 * NOT EXCLUDED, DELIBERATELY (customer-facing):
 *   - RuntimeStore.getJourney()   /results/{request_id}, /complete/{id}
 *   - RuntimeStore.listEvidence() the homeowner's own material
 *   - RuntimeStore.savePacket()   regeneration during a live journey
 *   Serving these unchanged is what keeps a quarantine from breaking a live
 *   homeowner journey while pre-answer 10 is parked with Melissa.
 */
export const KPI_READ_PATHS_HONOURING_QUARANTINE = [
  "quality/kpi.ts:qualityFilteredJourneyTotals",
  "quality/kpi.ts:qualityKpiSnapshot",
] as const;

export const CUSTOMER_READ_PATHS_DELIBERATELY_UNFILTERED = [
  "stores/runtime.ts:getJourney",
  "stores/runtime.ts:listEvidence",
  "stores/runtime.ts:savePacket",
] as const;
