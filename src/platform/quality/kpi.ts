import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { currentFindings, isUnresolved, qualityCounters, writesLost } from "@/platform/quality/issues";
import { activeQuarantineKeys, quarantineKey } from "@/platform/quality/quarantine";
import type { QualityDeps } from "@/platform/quality/issues";
import type { EntityType, QualityFinding, Severity } from "@/platform/quality/types";
import { runtimeStore } from "@/platform/stores/runtime";

/**
 * A09 build step 6 — THE KPI READS THAT HONOUR QUARANTINE, and A09's own
 * numbers for the owner cockpit.
 *
 * This module is the CONCRETE half of "quarantined records disappear from every
 * read path that feeds KPIs" (§9 step 4). The audit's condition 12 flagged that
 * sentence as a cross-cutting refactor masquerading as a sub-step, so rather
 * than editing every consumer, the KPI reads are gathered HERE, enumerated in
 * quarantine.ts, and pinned by a test. A future consumer that needs
 * quarantine-honest numbers calls one of these instead of inventing its own
 * filter, and the enumeration tells it that is the rule.
 *
 * CUSTOMER-FACING READS ARE NOT TOUCHED, deliberately — see the
 * TODO-ASK-OWNER in quarantine.ts. A quarantine can change a number on the
 * owner's screen; in Wave 0 it can never change what a homeowner sees.
 *
 * COUNTS AND IDS ONLY. Nothing here reads or returns problem summaries,
 * evidence, consent text or any customer material — the cockpit renders
 * numbers, rule ids and entity ids.
 *
 * "COULD NOT VERIFY", NEVER A FALSE "CLEAN" (condition 7). Every snapshot
 * carries `could_not_verify`, set when this process lost one of its own
 * finding/quarantine writes. Zero findings with `could_not_verify: true` means
 * "we do not know", and the cockpit must say so rather than showing a reassuring
 * zero.
 */

export interface QualityKpiSnapshot {
  critical_open: number;
  critical_open_7d: number;
  critical_open_30d: number;
  unresolved_total: number;
  unresolved_mismatches: number;
  mismatches_total: number;
  /** Open mismatches over all mismatches raised. 0 when none were raised. */
  unresolved_mismatch_rate: number;
  quarantined_active: number;
  by_severity: Record<Severity, number>;
  /** Ingest checks that passed, over all ingest checks run this process. */
  data_completeness_pass_rate: number;
  data_completeness_sample: number;
  /** TRUE when this process lost a finding or quarantine write. */
  could_not_verify: boolean;
  findings_write_failed: number;
  quarantines_write_failed: number;
}

/** Ingest pass/fail tally — the data-completeness denominator. */
let ingestChecksRun = 0;
let ingestChecksPassed = 0;

export function recordIngestCheckOutcome(passed: boolean): void {
  ingestChecksRun += 1;
  if (passed) ingestChecksPassed += 1;
}

export function resetQualityKpiForTests(): void {
  ingestChecksRun = 0;
  ingestChecksPassed = 0;
}

function withinDays(iso: string, days: number, at: number): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && at - t <= days * 24 * 60 * 60 * 1000;
}

export async function qualityKpiSnapshot(
  deps: QualityDeps = {}
): Promise<QualityKpiSnapshot> {
  const findings = await currentFindings(deps);
  const quarantined = await activeQuarantineKeys(deps);
  const at = Date.now();
  const c = qualityCounters();

  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  let criticalOpen = 0;
  let critical7 = 0;
  let critical30 = 0;
  let unresolved = 0;
  let mismatches = 0;
  let unresolvedMismatches = 0;

  for (const f of findings) {
    bySeverity[f.severity] += 1;
    const open = isUnresolved(f);
    if (open) unresolved += 1;
    if (f.kind === "reconciliation_mismatch") {
      mismatches += 1;
      if (open) unresolvedMismatches += 1;
    }
    if (f.severity === "critical" && open) {
      criticalOpen += 1;
      if (withinDays(f.created_at, 7, at)) critical7 += 1;
      if (withinDays(f.created_at, 30, at)) critical30 += 1;
    }
  }

  return {
    critical_open: criticalOpen,
    critical_open_7d: critical7,
    critical_open_30d: critical30,
    unresolved_total: unresolved,
    unresolved_mismatches: unresolvedMismatches,
    mismatches_total: mismatches,
    unresolved_mismatch_rate: mismatches > 0 ? unresolvedMismatches / mismatches : 0,
    quarantined_active: quarantined.size,
    by_severity: bySeverity,
    data_completeness_pass_rate: ingestChecksRun > 0 ? ingestChecksPassed / ingestChecksRun : 1,
    data_completeness_sample: ingestChecksRun,
    could_not_verify: writesLost(c),
    findings_write_failed: c.findings_write_failed,
    quarantines_write_failed: c.quarantines_write_failed,
  };
}

export interface QuarantineFilteredTotals {
  journeys: number;
  packets: number;
  consents: number;
  /** How many journeys were withheld from the counts above. */
  excluded_by_quarantine: number;
  could_not_verify: boolean;
}

/**
 * Journey/packet/consent totals with quarantined records removed — the numbers
 * the owner cockpit shows. A quarantined ProblemRecord (or its journey's
 * session/packet) stops contributing to the KPI the moment the marker exists,
 * which is the difference between quarantine and a cosmetic flag.
 */
export async function qualityFilteredJourneyTotals(
  deps: QualityDeps = {}
): Promise<QuarantineFilteredTotals> {
  const store = runtimeStore();
  const [raw, journeys, keys] = await Promise.all([
    store.totals(),
    store.listJourneys(1000),
    activeQuarantineKeys(deps),
  ]);

  let excluded = 0;
  for (const j of journeys) {
    const hit =
      keys.has(quarantineKey("problem_record", j.problem.problem_id)) ||
      keys.has(quarantineKey("job_packet", j.packet.job_packet_id)) ||
      keys.has(quarantineKey("intake_session", j.session.intake_session_id));
    if (hit) excluded += 1;
  }

  return {
    journeys: Math.max(0, raw.journeys - excluded),
    packets: Math.max(0, raw.packets - excluded),
    consents: raw.consents,
    excluded_by_quarantine: excluded,
    could_not_verify: writesLost(),
  };
}

/**
 * Whether an arbitrary list of entity refs should be shown in an AGGREGATE.
 * Exposed so a future KPI consumer filters through A09 rather than reimplementing
 * the join — the seam the audit warned "is the one most likely to rot".
 */
export async function excludeQuarantined<T>(
  rows: readonly T[],
  ref: (row: T) => { entity_type: EntityType; entity_id: string },
  deps: QualityDeps = {}
): Promise<T[]> {
  const keys = await activeQuarantineKeys(deps);
  return rows.filter((row) => {
    const { entity_type, entity_id } = ref(row);
    return !keys.has(quarantineKey(entity_type, entity_id));
  });
}

/** Findings for the exception queue: unresolved first, worst first. IDs and counts only. */
export async function exceptionQueue(
  limit = 25,
  deps: QualityDeps = {}
): Promise<QualityFinding[]> {
  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return (await currentFindings(deps))
    .filter(isUnresolved)
    .sort((a, b) => order[a.severity] - order[b.severity] || (a.created_at < b.created_at ? 1 : -1))
    .slice(0, limit);
}

/** Explicit re-export so admin surfaces need only one import. */
export type { PlatformClientProvider };
export { serviceClientProvider };
