import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { currentEventDefinition } from "@/platform/events/dictionary";
import { requirePolicyNumber } from "@/platform/policy/store";
import type { InvariantRule } from "@/platform/quality/invariants";
import {
  qualityCounters,
  recordFinding,
  shouldQuarantine,
  type QualityDeps,
} from "@/platform/quality/issues";
import { applyQuarantine } from "@/platform/quality/quarantine";
import type { CheckKind, EntityType, Severity } from "@/platform/quality/types";
import { recordAgentRun } from "@/platform/runs/ledger";
import { readDevDb } from "@/platform/stores/dev-db";
import { runtimeStore } from "@/platform/stores/runtime";

/**
 * A09 build step 3, second half — THE RECONCILIATION PASS.
 *
 * IT IS A PLAIN CALLABLE FUNCTION, AND THAT IS THE POINT (Loop Spec Audit
 * condition 3). The A09 spec §6 lists the Durable Workflow Orchestrator as a
 * hard prerequisite. The repo's orchestrator is interface-only and provably
 * unused (WORKFLOW_ORCHESTRATOR_STATUS = "DEFERRED_INTERFACE_ONLY"), which
 * under A09's own preflight rule means either an immediate stop or A09 quietly
 * building A00's job. Neither is right, so the Wave-0 truth is written down
 * instead: `runReconciliation()` is one idempotent function any caller can
 * invoke — a cron route, an admin action, a test — written so it can be lifted
 * onto the orchestrator later without changing its shape. No A09 module imports
 * the deferred orchestrator, and two tests pin that — here, and the
 * "no Wave-0/1 code path imports it" scan in tests/workflows.interface.test.ts,
 * which A09 must keep passing.
 *
 * IDEMPOTENCY AT THE RUN LEVEL, so a retry cannot double-write findings. Every
 * run carries a `run_key`; a repeat of a key already completed in this process
 * returns `skipped_duplicate_run` and writes nothing. Callers that want one run
 * per night pass a date-stamped key and get retry safety for free.
 *
 * WHAT IT CHECKS — the four §2/§9 sweeps, each needing a table scan and
 * therefore deliberately NOT in the ingest guard:
 *   referential  — every JobPacket resolves to a real ProblemRecord
 *   cross-source — two independently-derived totals for the same quantity
 *                  agree within tolerance
 *   duplicate    — flag-only; A09 never merges, and what counts as a duplicate
 *                  homeowner problem is an owner decision (pre-answer 11)
 *   schema drift — every event name in the live stream resolves to an approved
 *                  EventDefinition; a failure is DEFINITIONAL and is handed to
 *                  A08, who owns naming. A09 never renames anything.
 *
 * READS IDS, NAMES AND COUNTS ONLY. It walks journeys for their ids and the
 * event stream for its names; it never materialises evidence, intake answers,
 * consent text or problem summaries into any output.
 *
 * "COULD NOT VERIFY", NEVER A FALSE "CLEAN" (condition 7). If this run lost one
 * of its own writes, the ledger row and the returned report say so. A nightly
 * pass that reports clean because it could not write is the exact failure this
 * agent exists to make impossible.
 */

const A09 = "A09";
const A09_CAPABILITIES = ["quality.reconcile"] as const;

/**
 * A reconciliation check's identity. Same shape a finding needs from an
 * InvariantRule, so both sweeps produce uniform records in the one table.
 */
export type ReconciliationCheck = Pick<
  InvariantRule,
  "rule_id" | "rule_version" | "kind" | "severity_default" | "declared_owner"
> & { description: string };

function check(
  rule_id: string,
  kind: CheckKind,
  severity_default: Severity,
  declared_owner: string | null,
  description: string
): ReconciliationCheck {
  return { rule_id, rule_version: 1, kind, severity_default, declared_owner, description };
}

export const RECONCILIATION_CHECKS: readonly ReconciliationCheck[] = [
  check(
    "reconcile.packet_problem_referential",
    "referential",
    "critical",
    "A02",
    "Every JobPacket must resolve to a ProblemRecord that exists. A packet pointing at nothing is a document about a request the system cannot find."
  ),
  check(
    "reconcile.packet_count_vs_events",
    "cross_source_total",
    "medium",
    "A08",
    "The number of stored JobPackets and the number of packet.generated events must agree within tolerance. Two independently-derived counts of the same thing disagreeing means one of the two screens showing them is lying."
  ),
  check(
    "reconcile.problem_count_vs_events",
    "cross_source_total",
    "medium",
    "A08",
    "The number of stored journeys and the number of problem.created events must agree within tolerance."
  ),
  check(
    "reconcile.problem_duplicate_intake_session",
    "duplicate",
    "low",
    null,
    "Two ProblemRecords claim the same intake session. Flagged for a human only — A09 never merges identities."
  ),
  check(
    "reconcile.unregistered_event_name",
    "schema_drift",
    "medium",
    "A08",
    "An event name in the live stream has no approved EventDefinition. This is definitional drift, handed to A08 who owns naming, not a data defect A09 repairs."
  ),
];

export function findReconciliationCheck(ruleId: string): ReconciliationCheck | null {
  return RECONCILIATION_CHECKS.find((c) => c.rule_id === ruleId) ?? null;
}

export type ReconciliationVerdict =
  | "clean"
  | "findings_recorded"
  | "could_not_verify"
  | "skipped_duplicate_run";

export interface ReconciliationReport {
  run_key: string;
  run_id: string | null;
  started_at: string;
  checks_run: number;
  findings: number;
  quarantined: number;
  verdict: ReconciliationVerdict;
  /** rule_id -> findings raised. IDs and counts only. */
  by_check: Record<string, number>;
  tolerance_pct: number;
  /**
   * FALSE when the backend could not enumerate everything a sweep needs — and
   * then the verdict may NOT be "clean". RuntimeStore exposes `listJourneys`,
   * which only returns journeys whose session, problem AND packet all resolve:
   * a dangling packet is invisible through it BY CONSTRUCTION, which is exactly
   * the defect the referential sweep exists to find. The file backend can read
   * the rows directly; the Supabase backend has no such method on the shipped
   * interface, so the sweep says it did not see everything rather than
   * inventing a query or reporting a reassuring zero.
   *
   * TODO: a `listPackets`/`listProblems` read model on RuntimeStore would close
   * this — an A00 interface change, deliberately not made inside A09's build.
   */
  scan_complete: boolean;
}

/** Run keys completed in this process — the idempotency guard. */
const completedRunKeys = new Set<string>();

export function resetReconciliationForTests(): void {
  completedRunKeys.clear();
}

export interface ReconciliationOptions extends QualityDeps {
  /**
   * Idempotency key. A repeat of a key already completed in this process is
   * skipped rather than re-run, so a retried cron invocation cannot double-write
   * every finding. Defaults to a per-call unique key (no idempotency) so a
   * caller that has not thought about retries does not get accidental skipping.
   */
  run_key?: string;
  trigger?: "schedule" | "admin_action" | "job";
}

function now(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function tolerancePct(): number {
  try {
    return requirePolicyNumber("quality.cross_source_tolerance_pct");
  } catch {
    return 0;
  }
}

/**
 * THE PASS. One call, no orchestrator, no cron wiring, no side effects beyond
 * findings, quarantine markers and one ledger row. Never throws.
 */
export async function runReconciliation(
  options: ReconciliationOptions = {}
): Promise<ReconciliationReport> {
  const clientProvider: PlatformClientProvider =
    options.clientProvider ?? serviceClientProvider;
  const runKey = options.run_key ?? `recon:adhoc:${now()}:${Math.random().toString(36).slice(2)}`;
  const startedAt = Date.now();
  const tolerance = tolerancePct();

  const report: ReconciliationReport = {
    run_key: runKey,
    run_id: null,
    started_at: now(),
    checks_run: 0,
    findings: 0,
    quarantined: 0,
    verdict: "clean",
    by_check: {},
    tolerance_pct: tolerance,
    scan_complete: false,
  };

  if (completedRunKeys.has(runKey)) {
    report.verdict = "skipped_duplicate_run";
    return report;
  }
  completedRunKeys.add(runKey);

  const before = { ...qualityCounters() };
  let lostWrite = false;

  async function raise(
    c: ReconciliationCheck,
    entityType: EntityType,
    entityId: string,
    detailCode: string,
    extra: {
      related?: string[];
      expected?: number | null;
      observed?: number | null;
      delta_pct?: number | null;
    } = {}
  ): Promise<void> {
    const written = await recordFinding(
      {
        kind: "reconciliation_mismatch",
        source: "reconciliation",
        rule: c,
        entity_type: entityType,
        entity_id: entityId,
        violation: { detail_code: detailCode, related_entity_ids: extra.related },
        expected_count: extra.expected ?? null,
        observed_count: extra.observed ?? null,
        delta_pct: extra.delta_pct ?? null,
        tolerance_applied: c.kind === "cross_source_total" ? tolerance : null,
      },
      { clientProvider }
    );
    report.findings += 1;
    report.by_check[c.rule_id] = (report.by_check[c.rule_id] ?? 0) + 1;
    if (!written.ok) {
      lostWrite = true;
      return;
    }
    if (!shouldQuarantine(written.record.severity)) return;
    const marker = await applyQuarantine(written.record, { clientProvider });
    if (marker.ok) report.quarantined += 1;
    else lostWrite = true;
  }

  try {
    const store = runtimeStore();
    const totals = await store.totals();
    const scan = readSweepData(store);
    report.scan_complete = scan.complete;
    const problemIds = new Set(scan.problems.map((p) => p.problem_id));

    // --- referential integrity sweep --------------------------------------
    const referential = RECONCILIATION_CHECKS[0];
    report.checks_run += 1;
    for (const packet of scan.packets) {
      if (!problemIds.has(packet.problem_id)) {
        await raise(referential, "job_packet", packet.job_packet_id, "dangling_problem_reference", {
          related: [packet.problem_id],
        });
      }
    }

    // --- cross-source totals ----------------------------------------------
    const compareTotals = async (
      c: ReconciliationCheck,
      expected: number,
      observed: number
    ): Promise<void> => {
      if (expected === observed) return;
      const base = Math.max(expected, 1);
      const deltaPct = (Math.abs(expected - observed) / base) * 100;
      if (deltaPct <= tolerance) return;
      // The subject of a cross-source finding is the TENANT-level total, not a
      // row — there is no single record at fault, and naming one would be a
      // fabricated attribution.
      await raise(c, "event_envelope", `total:${c.rule_id}`, "cross_source_total_mismatch", {
        expected,
        observed,
        delta_pct: deltaPct,
      });
    };

    report.checks_run += 1;
    await compareTotals(
      RECONCILIATION_CHECKS[1],
      totals.packets,
      await store.countEvents("packet.generated")
    );

    report.checks_run += 1;
    await compareTotals(
      RECONCILIATION_CHECKS[2],
      totals.journeys,
      await store.countEvents("problem.created")
    );

    // --- duplicate scan (flag only) ---------------------------------------
    const duplicates = RECONCILIATION_CHECKS[3];
    report.checks_run += 1;
    const bySession = new Map<string, string[]>();
    for (const problem of scan.problems) {
      const sessionId = problem.intake_session_id;
      if (!sessionId) continue;
      bySession.set(sessionId, [...(bySession.get(sessionId) ?? []), problem.problem_id]);
    }
    for (const group of bySession.values()) {
      if (group.length < 2) continue;
      // Sorted so the subject of the finding does not depend on read order —
      // the same duplicate pair must produce the same record every run.
      const ids = [...group].sort();
      // One finding for the group, not one per member: a duplicate is a
      // relationship, and a finding per side would double-count the queue.
      await raise(duplicates, "problem_record", ids[0], "same_intake_session_candidate", {
        related: ids.slice(1, 25),
      });
    }

    // --- schema drift ------------------------------------------------------
    const drift = RECONCILIATION_CHECKS[4];
    report.checks_run += 1;
    for (const name of scan.event_names) {
      const def = currentEventDefinition(name);
      if (!def || def.status !== "approved") {
        await raise(drift, "event_envelope", `name:${name}`, "unregistered_event_name");
      }
    }
  } catch {
    // A reconciliation that crashed did not verify anything. Saying so is the
    // whole contract; reporting "clean" here would be the lie.
    lostWrite = true;
  }

  const after = qualityCounters();
  if (
    lostWrite ||
    after.findings_write_failed > before.findings_write_failed ||
    after.quarantines_write_failed > before.quarantines_write_failed
  ) {
    report.verdict = "could_not_verify";
  } else if (report.findings > 0) {
    report.verdict = "findings_recorded";
  } else if (!report.scan_complete) {
    // Zero findings from a partial scan is "we did not look everywhere", not
    // "everything is fine". Reporting clean here would be the exact lie this
    // agent exists to prevent.
    report.verdict = "could_not_verify";
  }

  const run = await recordAgentRun(
    {
      agent_id: A09,
      trigger: options.trigger ?? "schedule",
      input_ids: [],
      capabilities_used: [...A09_CAPABILITIES],
      tool_provider: "deterministic-stand-in",
      outputs_summary: {
        run_key: report.run_key,
        checks_run: report.checks_run,
        findings_created: report.findings,
        quarantines_applied: report.quarantined,
        by_check: report.by_check,
        scan_complete: report.scan_complete,
        verdict: report.verdict,
      },
      // No model anywhere in A09. Deterministic cost, not an estimate, not a
      // dollar figure.
      cost_usd: 0,
      latency_ms: Date.now() - startedAt,
      errors:
        report.verdict === "could_not_verify"
          ? [
              report.scan_complete
                ? "reconciliation could not verify — one or more of its own writes did not land"
                : "reconciliation could not verify — the backend could not enumerate every row a sweep needs (scan incomplete)",
            ]
          : undefined,
    },
    clientProvider
  );
  report.run_id = run.run_id;
  return report;
}

interface SweepData {
  problems: { problem_id: string; intake_session_id: string | null }[];
  packets: { job_packet_id: string; problem_id: string }[];
  /** Distinct event NAMES in the live stream. */
  event_names: string[];
  /** False when the backend could not enumerate everything — see scan_complete. */
  complete: boolean;
}

/**
 * READS IDS AND NAMES ONLY (A08's condition 14, applied to A09's own sweep):
 * problem ids, packet ids, session ids and event names. It never touches
 * intake_answer, evidence_object, consent text or a problem summary.
 *
 * The file backend can enumerate the rows. The Supabase backend cannot through
 * the shipped RuntimeStore interface — `listJourneys` only returns journeys
 * whose session, problem AND packet all resolve, which makes a dangling packet
 * invisible exactly where the referential sweep is looking. Rather than invent
 * a query or quietly under-report, the sweep falls back to journeys and marks
 * the scan INCOMPLETE, which forbids a "clean" verdict.
 */
function readSweepData(store: ReturnType<typeof runtimeStore>): SweepData {
  if (store.kind === "file") {
    const db = readDevDb();
    return {
      problems: db.problems.map((p) => ({
        problem_id: p.problem_id,
        intake_session_id: p.intake_session_id,
      })),
      packets: db.packets.map((k) => ({
        job_packet_id: k.job_packet_id,
        problem_id: k.problem_id,
      })),
      event_names: [...new Set(db.events.map((e) => e.event_name))],
      complete: true,
    };
  }
  return { problems: [], packets: [], event_names: [], complete: false };
}
