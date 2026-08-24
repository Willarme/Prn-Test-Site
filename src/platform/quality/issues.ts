import { randomUUID } from "node:crypto";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { emitIssueDetected } from "@/platform/quality/events";
import type { InvariantRule, RuleViolation } from "@/platform/quality/invariants";
import { qualityStore } from "@/platform/quality/store";
import {
  QUARANTINING_SEVERITIES,
  QualityFinding,
  type EntityType,
  type FindingKind,
  type FindingSource,
  type FindingStatus,
  type QualityWriteResult,
  type RootHypothesis,
  type Severity,
} from "@/platform/quality/types";
import { recentAgentRuns } from "@/platform/runs/ledger";

/**
 * A09 build step 2 — ISSUE CREATION, and the one place A09 deliberately
 * refuses the platform's fail-soft contract.
 *
 * FAIL LOUD (Loop Spec Audit condition 7). db/client.ts makes every platform
 * write fail-soft "by contract" and that is right for telemetry. It is wrong
 * here and inverts the agent: a swallowed issue write leaves bad data feeding
 * KPIs while the run reports clean, which manufactures exactly the confidence
 * A09 exists to withhold. So a failed write:
 *
 *   - returns `{ ok: false }` from a discriminated union the caller cannot
 *     ignore without a type error;
 *   - logs at console.ERROR, not warn, and not once-per-process — every lost
 *     finding is its own incident;
 *   - increments a counter that lands on the Agent Run Ledger row for the run,
 *     so the run reports "could not verify" instead of "clean".
 *
 * It still never THROWS. The customer's journey is not A09's to break, and the
 * guard that calls this runs inside a live request.
 *
 * SUSPECTED OWNER IS NEVER FABRICATED (§9 step 2). The only evidence A09 has is
 * the Agent Run Ledger. Preference order, most-evidenced first:
 *   1. the most recent AgentRunRecord whose input_ids name this entity —
 *      basis "last_agent_run_ledger_write", with the run id attached;
 *   2. the rule's own declared owner, which is authored code stating which
 *      agent owns that entity type — basis "rule_declared_owner", clearly
 *      labelled as a declaration rather than an observation;
 *   3. null — basis "no_agent_run_found".
 * A plausible-looking guess would be worse than an honest blank: it sends a
 * human to the wrong agent carrying the confidence of a lookup.
 */

function now(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

// ---------------------------------------------------------------------------
// Fail-loud counters — read by the ledger row every A09 run writes
// ---------------------------------------------------------------------------

export interface QualityCounters {
  findings_recorded: number;
  findings_write_failed: number;
  quarantines_applied: number;
  quarantines_write_failed: number;
  quarantines_released: number;
  repairs_proposed: number;
  repairs_executed: number;
  repairs_reversed: number;
}

function zeroCounters(): QualityCounters {
  return {
    findings_recorded: 0,
    findings_write_failed: 0,
    quarantines_applied: 0,
    quarantines_write_failed: 0,
    quarantines_released: 0,
    repairs_proposed: 0,
    repairs_executed: 0,
    repairs_reversed: 0,
  };
}

let counters = zeroCounters();

export function qualityCounters(): Readonly<QualityCounters> {
  return counters;
}

export function bumpCounter(key: keyof QualityCounters, by = 1): void {
  counters[key] += by;
}

export function resetQualityCountersForTests(): void {
  counters = zeroCounters();
}

/** True when this run lost at least one of its own writes. */
export function writesLost(c: Readonly<QualityCounters> = counters): boolean {
  return c.findings_write_failed > 0 || c.quarantines_write_failed > 0;
}

/**
 * The loud half. Not once-per-process like the platform's `logMiss`: a
 * data-quality system that reports its first lost finding and then goes quiet
 * is the failure mode this whole condition exists to prevent.
 */
export function reportLostWrite(what: string, id: string, reason: string): void {
  console.error(
    `[a09-quality] LOST WRITE — ${what} ${id} could not be persisted (${reason}). ` +
      "This finding is NOT recorded. Data-quality runs must report 'could not verify', never 'clean', " +
      "until supabase/migrations/00010_data_quality.sql is applied or the store is reachable."
  );
}

// ---------------------------------------------------------------------------
// Root hypothesis
// ---------------------------------------------------------------------------

export function resolveRootHypothesis(
  entityId: string,
  declaredOwner: string | null
): RootHypothesis {
  // Newest first: the LAST run to write this record is the one being asked about.
  const runs = [...recentAgentRuns()].reverse();
  const hit = runs.find((r) => r.input_ids.includes(entityId));
  if (hit) {
    return {
      method: "deterministic",
      suspected_owner: hit.agent_id,
      basis: "last_agent_run_ledger_write",
      agent_run_id: hit.run_id,
    };
  }
  if (declaredOwner) {
    return {
      method: "deterministic",
      suspected_owner: declaredOwner,
      basis: "rule_declared_owner",
      agent_run_id: null,
    };
  }
  return {
    method: "deterministic",
    suspected_owner: null,
    basis: "no_agent_run_found",
    agent_run_id: null,
  };
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export interface RecordFindingInput {
  kind: FindingKind;
  source: FindingSource;
  rule: Pick<
    InvariantRule,
    "rule_id" | "rule_version" | "kind" | "severity_default" | "declared_owner"
  >;
  entity_type: EntityType;
  entity_id: string;
  violation: RuleViolation;
  tenant_id?: string;
  expected_count?: number | null;
  observed_count?: number | null;
  delta_pct?: number | null;
  tolerance_applied?: number | null;
  /** Set by the quarantine step; findings are recorded before the marker exists. */
  quarantined?: boolean;
}

export interface QualityDeps {
  clientProvider?: PlatformClientProvider;
}

export function severityFor(input: RecordFindingInput): Severity {
  return input.violation.severity ?? input.rule.severity_default;
}

export function shouldQuarantine(severity: Severity): boolean {
  return QUARANTINING_SEVERITIES.includes(severity);
}

/**
 * Build and persist ONE finding at version 1. Returns a result the caller must
 * handle; never throws.
 */
export async function recordFinding(
  input: RecordFindingInput,
  deps: QualityDeps = {}
): Promise<QualityWriteResult<QualityFinding>> {
  const clientProvider = deps.clientProvider ?? serviceClientProvider;
  const severity = severityFor(input);
  const finding = QualityFinding.parse({
    issue_id: `dq_${randomUUID()}`,
    finding_version: 1,
    tenant_id: input.tenant_id ?? "prn",
    kind: input.kind,
    source: input.source,
    check_kind: input.rule.kind,
    rule_id: input.rule.rule_id,
    rule_version: input.rule.rule_version,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    related_entity_ids: input.violation.related_entity_ids ?? [],
    severity,
    detail_code: input.violation.detail_code,
    expected_count: input.expected_count ?? null,
    observed_count: input.observed_count ?? null,
    delta_pct: input.delta_pct ?? null,
    tolerance_applied: input.tolerance_applied ?? null,
    root_hypothesis: resolveRootHypothesis(input.entity_id, input.rule.declared_owner),
    quarantined: input.quarantined ?? false,
    status: "open" satisfies FindingStatus,
    created_at: now(),
    resolved_at: null,
  });

  try {
    await qualityStore(clientProvider).appendFinding(finding);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    counters.findings_write_failed += 1;
    reportLostWrite("finding", finding.issue_id, reason);
    return { ok: false, error: reason, record: finding };
  }

  counters.findings_recorded += 1;
  // IDs, codes and counts only — the envelope carries no more than the record.
  await emitIssueDetected(
    {
      issue_id: finding.issue_id,
      kind: finding.kind,
      rule_id: finding.rule_id,
      entity_type: finding.entity_type,
      entity_id: finding.entity_id,
      severity: finding.severity,
      detail_code: finding.detail_code,
    },
    clientProvider
  );
  return { ok: true, record: finding };
}

/**
 * Move a finding's status by APPENDING a new version. Nothing is updated in
 * place — migration 00010 revokes update and delete on the findings table, so
 * the lifecycle is a version chain exactly like the event/metric dictionary's.
 */
export async function appendFindingStatus(
  current: QualityFinding,
  status: FindingStatus,
  deps: QualityDeps = {}
): Promise<QualityWriteResult<QualityFinding>> {
  const clientProvider = deps.clientProvider ?? serviceClientProvider;
  const terminal = status === "repair_verified" || status === "rejected" || status === "wont_fix";
  const next = QualityFinding.parse({
    ...current,
    finding_version: current.finding_version + 1,
    status,
    resolved_at: terminal ? now() : current.resolved_at,
  });
  try {
    await qualityStore(clientProvider).appendFinding(next);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    counters.findings_write_failed += 1;
    reportLostWrite("finding status", `${next.issue_id}@v${next.finding_version}`, reason);
    return { ok: false, error: reason, record: next };
  }
  return { ok: true, record: next };
}

// ---------------------------------------------------------------------------
// Reads — the exception queue's data source
// ---------------------------------------------------------------------------

/** Newest version of each finding. The version chain collapses to current state. */
export async function currentFindings(deps: QualityDeps = {}): Promise<QualityFinding[]> {
  const rows = await qualityStore(deps.clientProvider ?? serviceClientProvider).listFindings();
  const byId = new Map<string, QualityFinding>();
  for (const row of rows) {
    const existing = byId.get(row.issue_id);
    if (!existing || row.finding_version > existing.finding_version) byId.set(row.issue_id, row);
  }
  return [...byId.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function findingById(
  issueId: string,
  deps: QualityDeps = {}
): Promise<QualityFinding | null> {
  return (await currentFindings(deps)).find((f) => f.issue_id === issueId) ?? null;
}

const UNRESOLVED: readonly FindingStatus[] = [
  "open",
  "repair_proposed",
  "repair_executed",
];

export function isUnresolved(finding: QualityFinding): boolean {
  return UNRESOLVED.includes(finding.status);
}
