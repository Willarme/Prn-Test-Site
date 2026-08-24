import type { SupabaseClient } from "@supabase/supabase-js";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { readDevDb, updateDevDb } from "@/platform/stores/dev-db";
import {
  QualityFinding,
  QuarantineMarker,
  RepairExecution,
  RepairProposal,
  RepairReversalSnapshot,
  type QuarantineStatus,
} from "@/platform/quality/types";

/**
 * A09's persistence seam — TWO INTERCHANGEABLE BACKENDS, the same pattern
 * stores/runtime.ts uses, for the same reason: the file backend is what makes
 * a database-less dev environment a real environment rather than a silent one.
 *
 * WHY THIS IS NOT THE A00 PLATFORM PATTERN. approvals/center.ts, runs/ledger.ts
 * and events/dictionary.ts all keep an in-process buffer and log a miss when no
 * database is configured. That is correct for them and WRONG here: an
 * in-process-only finding disappears at the end of the request that raised it,
 * so the nightly run and the exception queue would read clean while the bad
 * data kept feeding KPIs. A09 therefore writes to a store that actually
 * persists in both configurations, and a write that does not land THROWS out of
 * this module so the caller in issues.ts can surface it loudly (condition 7).
 * The throw stops here — nothing above issues.ts ever sees it.
 *
 * CLIENT INJECTABLE (condition 6). The factory ACCEPTS a PlatformClientProvider
 * rather than importing the service client, exactly as approvals/center.ts and
 * runs/ledger.ts do; elevated credentials remain for narrowly scoped internal
 * operations only, and a request-scoped client can be threaded through later
 * without restructuring.
 *
 * APPEND-ONLY. Findings and repair records are only ever appended — a status
 * change writes a NEW `finding_version`, mirroring the event/metric dictionary
 * and enforced at the database level by migration 00010 (update/delete
 * revoked). Quarantine markers are the one mutable row, and only on
 * status/released_*: a marker exists precisely so it can be released, and every
 * release emits data_quality.quarantine_released so the HISTORY stays
 * append-only even though the flag does not.
 */

export interface QualityStore {
  readonly kind: "supabase" | "file";
  appendFinding(finding: QualityFinding): Promise<void>;
  listFindings(): Promise<QualityFinding[]>;
  appendQuarantine(marker: QuarantineMarker): Promise<void>;
  listQuarantine(): Promise<QuarantineMarker[]>;
  setQuarantineStatus(
    markerId: string,
    status: QuarantineStatus,
    releasedAt: string | null,
    releasedBy: string | null
  ): Promise<void>;
  appendRepairProposal(proposal: RepairProposal): Promise<void>;
  listRepairProposals(): Promise<RepairProposal[]>;
  appendRepairExecution(execution: RepairExecution): Promise<void>;
  listRepairExecutions(): Promise<RepairExecution[]>;
  appendReversalSnapshot(snapshot: RepairReversalSnapshot): Promise<void>;
  listReversalSnapshots(): Promise<RepairReversalSnapshot[]>;
}

function fail(what: string, message: string): never {
  throw new Error(`${what}: ${message}`);
}

// ---------------------------------------------------------------------------
// Supabase backend (migration 00010 — written, NOT applied)
// ---------------------------------------------------------------------------

class SupabaseQualityStore implements QualityStore {
  readonly kind = "supabase" as const;
  constructor(private readonly db: SupabaseClient) {}

  async appendFinding(finding: QualityFinding): Promise<void> {
    const { error } = await this.db.from("data_quality_issue").insert({
      issue_id: finding.issue_id,
      finding_version: finding.finding_version,
      tenant_id: finding.tenant_id,
      kind: finding.kind,
      source: finding.source,
      check_kind: finding.check_kind,
      rule_id: finding.rule_id,
      rule_version: finding.rule_version,
      entity_type: finding.entity_type,
      entity_id: finding.entity_id,
      related_entity_ids: finding.related_entity_ids,
      severity: finding.severity,
      detail_code: finding.detail_code,
      expected_count: finding.expected_count,
      observed_count: finding.observed_count,
      delta_pct: finding.delta_pct,
      tolerance_applied: finding.tolerance_applied,
      root_hypothesis: finding.root_hypothesis,
      quarantined: finding.quarantined,
      status: finding.status,
      created_at: finding.created_at,
      resolved_at: finding.resolved_at,
    });
    if (error) fail("append quality finding", error.message);
  }

  async listFindings(): Promise<QualityFinding[]> {
    const { data, error } = await this.db
      .from("data_quality_issue")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(2000);
    if (error) fail("list quality findings", error.message);
    return (data ?? []).map((row) => QualityFinding.parse(row));
  }

  async appendQuarantine(marker: QuarantineMarker): Promise<void> {
    const { error } = await this.db.from("quarantine_marker").insert(marker);
    if (error) fail("append quarantine marker", error.message);
  }

  async listQuarantine(): Promise<QuarantineMarker[]> {
    const { data, error } = await this.db.from("quarantine_marker").select("*").limit(2000);
    if (error) fail("list quarantine markers", error.message);
    return (data ?? []).map((row) => QuarantineMarker.parse(row));
  }

  async setQuarantineStatus(
    markerId: string,
    status: QuarantineStatus,
    releasedAt: string | null,
    releasedBy: string | null
  ): Promise<void> {
    const { error } = await this.db
      .from("quarantine_marker")
      .update({ status, released_at: releasedAt, released_by: releasedBy })
      .eq("marker_id", markerId);
    if (error) fail("release quarantine marker", error.message);
  }

  async appendRepairProposal(proposal: RepairProposal): Promise<void> {
    const { error } = await this.db.from("repair_proposal").insert(proposal);
    if (error) fail("append repair proposal", error.message);
  }

  async listRepairProposals(): Promise<RepairProposal[]> {
    const { data, error } = await this.db.from("repair_proposal").select("*").limit(2000);
    if (error) fail("list repair proposals", error.message);
    return (data ?? []).map((row) => RepairProposal.parse(row));
  }

  async appendRepairExecution(execution: RepairExecution): Promise<void> {
    const { error } = await this.db.from("repair_execution").insert(execution);
    if (error) fail("append repair execution", error.message);
  }

  async listRepairExecutions(): Promise<RepairExecution[]> {
    const { data, error } = await this.db.from("repair_execution").select("*").limit(2000);
    if (error) fail("list repair executions", error.message);
    return (data ?? []).map((row) => RepairExecution.parse(row));
  }

  async appendReversalSnapshot(snapshot: RepairReversalSnapshot): Promise<void> {
    const { error } = await this.db.from("repair_reversal_snapshot").insert(snapshot);
    if (error) fail("append reversal snapshot", error.message);
  }

  async listReversalSnapshots(): Promise<RepairReversalSnapshot[]> {
    const { data, error } = await this.db.from("repair_reversal_snapshot").select("*").limit(2000);
    if (error) fail("list reversal snapshots", error.message);
    return (data ?? []).map((row) => RepairReversalSnapshot.parse(row));
  }
}

// ---------------------------------------------------------------------------
// File backend — the durable store when no database is configured
// ---------------------------------------------------------------------------

class FileQualityStore implements QualityStore {
  readonly kind = "file" as const;

  async appendFinding(finding: QualityFinding): Promise<void> {
    updateDevDb((db) => {
      db.quality_findings.push(finding);
    });
  }

  async listFindings(): Promise<QualityFinding[]> {
    return readDevDb().quality_findings.map((row) => QualityFinding.parse(row));
  }

  async appendQuarantine(marker: QuarantineMarker): Promise<void> {
    updateDevDb((db) => {
      db.quarantine_markers.push(marker);
    });
  }

  async listQuarantine(): Promise<QuarantineMarker[]> {
    return readDevDb().quarantine_markers.map((row) => QuarantineMarker.parse(row));
  }

  async setQuarantineStatus(
    markerId: string,
    status: QuarantineStatus,
    releasedAt: string | null,
    releasedBy: string | null
  ): Promise<void> {
    let found = false;
    updateDevDb((db) => {
      db.quarantine_markers = db.quarantine_markers.map((row) => {
        const marker = QuarantineMarker.parse(row);
        if (marker.marker_id !== markerId) return marker;
        found = true;
        return { ...marker, status, released_at: releasedAt, released_by: releasedBy };
      });
    });
    // A release that matched nothing is a lost write, not a no-op: the caller
    // believes a record is back in the KPI numbers when it is not.
    if (!found) fail("release quarantine marker", `no marker ${markerId}`);
  }

  async appendRepairProposal(proposal: RepairProposal): Promise<void> {
    updateDevDb((db) => {
      db.repair_proposals.push(proposal);
    });
  }

  async listRepairProposals(): Promise<RepairProposal[]> {
    return readDevDb().repair_proposals.map((row) => RepairProposal.parse(row));
  }

  async appendRepairExecution(execution: RepairExecution): Promise<void> {
    updateDevDb((db) => {
      db.repair_executions.push(execution);
    });
  }

  async listRepairExecutions(): Promise<RepairExecution[]> {
    return readDevDb().repair_executions.map((row) => RepairExecution.parse(row));
  }

  async appendReversalSnapshot(snapshot: RepairReversalSnapshot): Promise<void> {
    updateDevDb((db) => {
      db.repair_reversal_snapshots.push(snapshot);
    });
  }

  async listReversalSnapshots(): Promise<RepairReversalSnapshot[]> {
    return readDevDb().repair_reversal_snapshots.map((row) => RepairReversalSnapshot.parse(row));
  }
}

/**
 * Pick a backend. ACCEPTS a client provider (condition 6) — the caller may pass
 * a request-scoped one, and tests pass a stub that fails on purpose.
 */
export function qualityStore(
  clientProvider: PlatformClientProvider = serviceClientProvider
): QualityStore {
  const client = clientProvider();
  return client ? new SupabaseQualityStore(client) : new FileQualityStore();
}
