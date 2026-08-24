import { randomUUID } from "node:crypto";
import type { ProblemRecord } from "@/domain/problem/contracts";
import { queueApproval, type ApprovalItem } from "@/platform/approvals/center";
import type { ApprovalKind } from "@/platform/approvals/kinds";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { checkKillSwitch } from "@/platform/killswitch";
import { requirePolicyBoolean } from "@/platform/policy/store";
import {
  emitRepairExecuted,
  emitRepairProposed,
  emitRepairVerified,
} from "@/platform/quality/events";
import { evaluateSubject, findRule } from "@/platform/quality/invariants";
import {
  appendFindingStatus,
  bumpCounter,
  findingById,
  reportLostWrite,
  type QualityDeps,
} from "@/platform/quality/issues";
import { qualityStore } from "@/platform/quality/store";
import {
  NEVER_REPAIRABLE_ENTITY_TYPES,
  RepairExecution,
  RepairProposal,
  RepairReversalSnapshot,
  type EntityType,
  type QualityFinding,
} from "@/platform/quality/types";
import { readDevDb, updateDevDb } from "@/platform/stores/dev-db";
import { runtimeStore } from "@/platform/stores/runtime";

/**
 * A09 build step 5 — SAFE-REPAIR MACHINERY, SHIPPED WITH THE ALLOW-LIST EMPTY.
 *
 * THE ALLOW-LIST IS EMPTY AND THE MASTER SWITCH IS OFF (condition 11 /
 * pre-answer 5). Both must be changed for anything to auto-execute, and neither
 * is. This is not only the spec's own conservatism: the repo's OD-10 already
 * records that autonomy graduation is a PROCESS gate, not a machine gate.
 * Turning on a first class is Joshua's call at review, one named class at a
 * time, with that class's reversal test green. Until then every repair —
 * "safe" class or not — goes propose -> Approval Center -> human -> execute ->
 * verify.
 *
 * FOUR THINGS NO REPAIR MAY EVER DO, enforced here and pinned by never-do
 * tests:
 *   1. TOUCH THE CONSENT LEDGER. It is append-only at the database level and
 *      belongs to the customer. A09 may DETECT an anomaly in it; A09 may never
 *      repair, merge or alter it — automatically OR with approval, permanently.
 *      Refused before the kill switch, before the allow-list, before anything.
 *   2. CHANGE PAGE PUBLISH STATE (condition 8). Quarantining an already
 *      published page is an unpublish by another name, and an agent that can
 *      unpublish is the effective publisher. No declared repair kind may target
 *      a publish/lifecycle/content field, and the guard refuses one at runtime
 *      even if a future kind declared it.
 *   3. MERGE IDENTITIES. `proposeIdentityMerge` files an Approval Center item
 *      under `data.identity_merge` and has NO execute path at all — not a
 *      disabled one, an absent one. Detector confidence is irrelevant.
 *   4. RUN WHILE PAUSED. The kill switch stops proposal generation and
 *      execution (§7) while leaving detection, recording and containment
 *      alive — the opposite pause would blind the owner exactly when they are
 *      investigating.
 *
 * REVERSIBILITY IS PROVEN, NOT PROMISED. Every declared kind touches an ID LIST
 * and nothing else, so its prior value can be snapshotted as bounded ID data
 * inside the no-raw-evidence contract and restored byte-for-byte. A repair that
 * needed to snapshot free text could not be declared at all — that is the
 * intended ceiling on what A09 is ever allowed to repair, not an accident of
 * this wave's scope.
 */

const A09 = "A09";

/**
 * THE AUTO-REPAIR ALLOW-LIST. EMPTY, DELIBERATELY.
 *
 * Adding a `repair_kind` string here does NOT by itself enable anything — the
 * `quality.auto_repair_enabled` policy flag must also be true. Two gates, both
 * off, because the cost of holding them is nothing and the cost of discovering
 * an agent silently rewrote records is not recoverable.
 */
export const AUTO_REPAIR_ALLOW_LIST: readonly string[] = [];

/**
 * Fields no repair may write, whatever it declares. `status` and `indexed` are
 * a PageSpec's publish state; the rest are page content and its provenance.
 * A09 routes anything wrong here to the human exception queue and stops.
 */
export const FORBIDDEN_TARGET_FIELDS: readonly string[] = [
  "status",
  "indexed",
  "noindex_reason",
  "published",
  "qa",
  "canonical_path",
  "content_blocks",
  "hero",
  "title",
  "meta_description",
  "h1",
  "disclosure_version_id",
  "action",
  "scope",
];

export interface RepairKind {
  repair_kind: string;
  applies_to: EntityType;
  /** The one field this kind writes. Checked against FORBIDDEN_TARGET_FIELDS. */
  target_field: string;
  description: string;
  /** Rule ids whose findings this kind can address. */
  addresses_rule_ids: readonly string[];
  /** The repaired value, computed from the current one. Pure. */
  repaired: (previous: string[]) => string[];
  detail_code: string;
}

/**
 * DECLARED repair kinds. Declared is not enabled: none is on the allow-list.
 * Both touch an id array on a ProblemRecord, both are pure functions of the
 * prior value, and both are exactly reversible.
 */
export const REPAIR_KINDS: readonly RepairKind[] = [
  {
    repair_kind: "problem_record.prune_blank_evidence_ids",
    applies_to: "problem_record",
    target_field: "evidence_ids",
    description:
      "Remove blank entries from a ProblemRecord's evidence_ids. Removes nothing that points at anything: a blank id references no evidence object, so no customer material can be detached by this repair.",
    addresses_rule_ids: ["problem_record.required_ids"],
    repaired: (previous) => previous.filter((id) => id.trim().length > 0),
    detail_code: "prune_blank_ids",
  },
  {
    repair_kind: "problem_record.prune_blank_claim_ids",
    applies_to: "problem_record",
    target_field: "claim_ids",
    description:
      "Remove blank entries from a ProblemRecord's claim_ids. Same reasoning: a blank id references no claim.",
    addresses_rule_ids: ["problem_record.required_ids"],
    repaired: (previous) => previous.filter((id) => id.trim().length > 0),
    detail_code: "prune_blank_ids",
  },
];

export function findRepairKind(kind: string): RepairKind | null {
  return REPAIR_KINDS.find((k) => k.repair_kind === kind) ?? null;
}

/** Kinds that could address this finding. May be empty — most findings need a human. */
export function repairKindsFor(finding: QualityFinding): RepairKind[] {
  return REPAIR_KINDS.filter(
    (k) =>
      k.applies_to === finding.entity_type && k.addresses_rule_ids.includes(finding.rule_id)
  );
}

export function autoRepairEnabled(): boolean {
  try {
    return requirePolicyBoolean("quality.auto_repair_enabled");
  } catch {
    return false;
  }
}

/** True only when BOTH gates are open for this specific kind. */
export function mayAutoExecute(kind: string): boolean {
  return autoRepairEnabled() && AUTO_REPAIR_ALLOW_LIST.includes(kind);
}

function now(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

// ---------------------------------------------------------------------------
// Refusals — checked before anything else happens
// ---------------------------------------------------------------------------

export function repairRefusalReason(
  finding: QualityFinding,
  kind: RepairKind | null
): string | null {
  if (NEVER_REPAIRABLE_ENTITY_TYPES.includes(finding.entity_type)) {
    return `${finding.entity_type} is never a repair target — the consent ledger is append-only and belongs to the customer (detect and queue only, permanently)`;
  }
  const rule = findRule(finding.rule_id);
  if (rule?.detect_only) {
    return `rule ${finding.rule_id} is detect-only — its findings route to the human exception queue and never to a repair`;
  }
  if (!kind) return `no declared repair kind addresses ${finding.rule_id}`;
  if (kind.applies_to !== finding.entity_type) {
    return `repair kind ${kind.repair_kind} does not apply to ${finding.entity_type}`;
  }
  if (FORBIDDEN_TARGET_FIELDS.includes(kind.target_field)) {
    return `repair kind ${kind.repair_kind} targets ${kind.target_field}, which no repair may write — publish state and page content are the owner's, never an agent's`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading and writing the one field a repair touches
// ---------------------------------------------------------------------------

const ID_FIELDS = ["evidence_ids", "claim_ids"] as const;
type IdField = (typeof ID_FIELDS)[number];

function isIdField(field: string): field is IdField {
  return (ID_FIELDS as readonly string[]).includes(field);
}

/** Current value of the field, or null when the record or backend is unavailable. */
function readIdField(entityId: string, field: string): string[] | null {
  if (!isIdField(field)) return null;
  if (runtimeStore().kind !== "file") return null;
  const record = readDevDb().problems.find(
    (p) => (p as ProblemRecord).problem_id === entityId
  ) as ProblemRecord | undefined;
  return record ? [...record[field]] : null;
}

/** Write the field back. Returns rows affected. */
function writeIdField(entityId: string, field: string, ids: string[]): number {
  if (!isIdField(field)) return 0;
  if (runtimeStore().kind !== "file") return 0;
  let affected = 0;
  updateDevDb((db) => {
    for (const record of db.problems) {
      if (record.problem_id !== entityId) continue;
      record[field] = ids;
      affected += 1;
    }
  });
  return affected;
}

const UNSUPPORTED_BACKEND =
  "repair execution is only implemented for the file backend in Wave 0 — the Supabase path needs migration 00010 applied and an owner-approved write route, which is deliberately not built while the allow-list is empty";

// ---------------------------------------------------------------------------
// Simulate
// ---------------------------------------------------------------------------

export interface RepairSimulation {
  rows_affected: number;
  rule_passes_after: boolean;
  detail_code: string;
  reasons: string[];
}

/**
 * Compute what the repair WOULD do, without doing it. Deterministic, and it
 * re-runs the rule that raised the finding against the projected record so
 * "would this actually fix it" is answered rather than assumed.
 */
export function simulateRepair(
  finding: QualityFinding,
  kind: RepairKind
): RepairSimulation {
  const previous = readIdField(finding.entity_id, kind.target_field);
  if (previous === null) {
    return {
      rows_affected: 0,
      rule_passes_after: false,
      detail_code: "simulation_unavailable",
      reasons: [UNSUPPORTED_BACKEND],
    };
  }
  const next = kind.repaired(previous);
  const rowsAffected = next.length === previous.length ? 0 : 1;

  let passesAfter = false;
  const record = readDevDb().problems.find(
    (p) => (p as ProblemRecord).problem_id === finding.entity_id
  ) as ProblemRecord | undefined;
  if (record && isIdField(kind.target_field)) {
    const projected: ProblemRecord = { ...record, [kind.target_field]: next };
    passesAfter = !evaluateSubject(
      { entity_type: "problem_record", entity_id: finding.entity_id, record: projected },
      {}
    ).some((e) => e.rule.rule_id === finding.rule_id);
  }

  return {
    rows_affected: rowsAffected,
    rule_passes_after: passesAfter,
    detail_code: kind.detail_code,
    reasons: [],
  };
}

// ---------------------------------------------------------------------------
// Propose
// ---------------------------------------------------------------------------

export interface ProposeRepairResult {
  outcome: "queued_for_approval" | "refused";
  reasons: string[];
  proposal?: RepairProposal;
  approval_id?: string;
  simulation?: RepairSimulation;
}

/**
 * Propose a repair. ALWAYS routes to the Approval Center while the allow-list
 * is empty — which is always, in Wave 0. Never executes.
 */
export async function proposeRepair(
  finding: QualityFinding,
  ctx: { run_id: string },
  deps: QualityDeps = {}
): Promise<ProposeRepairResult> {
  const clientProvider: PlatformClientProvider = deps.clientProvider ?? serviceClientProvider;

  // The consent-ledger and publish-state refusals come FIRST: before the kill
  // switch, before the allow-list, before the simulation. They are not
  // conditions, they are boundaries.
  const kind = repairKindsFor(finding)[0] ?? null;
  const refusal = repairRefusalReason(finding, kind);
  if (refusal) return { outcome: "refused", reasons: [refusal] };

  const kill = checkKillSwitch(A09, clientProvider);
  if (kill.engaged) {
    return {
      outcome: "refused",
      reasons: [
        `A09 is paused (${kill.scope}) — proposal generation and execution stop while paused; detection, recording and quarantine keep running`,
      ],
    };
  }

  const simulation = simulateRepair(finding, kind!);
  if (!simulation.rule_passes_after) {
    return {
      outcome: "refused",
      reasons: [
        ...simulation.reasons,
        "simulation says the rule would still fail after this repair — a repair that does not fix the finding is not proposed",
      ],
      simulation,
    };
  }

  const item = await queueApproval(
    {
      agent_id: A09,
      run_id: ctx.run_id,
      approval_kind: "data.repair" satisfies ApprovalKind,
      what_happened: `A09 found ${finding.detail_code} on ${finding.entity_type} ${finding.entity_id} (rule ${finding.rule_id}) and proposes ${kind!.repair_kind}.`,
      // IDs, codes and counts. Never the record's contents.
      evidence: {
        issue_id: finding.issue_id,
        rule_id: finding.rule_id,
        rule_version: finding.rule_version,
        entity_type: finding.entity_type,
        entity_id: finding.entity_id,
        severity: finding.severity,
        detail_code: finding.detail_code,
        simulated_rows_affected: simulation.rows_affected,
        simulated_rule_passes_after: simulation.rule_passes_after,
      },
      recommendation: kind!.description,
      impact: `Rewrites ${kind!.target_field} on ${simulation.rows_affected} row(s). Nothing is deleted and no page publish state changes.`,
      risk: "low — the repair is deterministic, touches an id list only, and is exactly reversible",
      reversibility: "reversible",
      proposed_change: {
        repair_kind: kind!.repair_kind,
        target_field: kind!.target_field,
        entity_id: finding.entity_id,
      },
    },
    clientProvider
  );

  const proposal = RepairProposal.parse({
    proposal_id: `rp_${randomUUID()}`,
    tenant_id: finding.tenant_id,
    issue_id: finding.issue_id,
    repair_kind: kind!.repair_kind,
    entity_type: finding.entity_type,
    entity_id: finding.entity_id,
    target_field: kind!.target_field,
    simulated_rows_affected: simulation.rows_affected,
    simulated_rule_passes_after: simulation.rule_passes_after,
    simulation_detail_code: simulation.detail_code,
    reversible: true,
    // TRUE while the allow-list is empty and the master switch is off — which
    // is both of them, in Wave 0.
    requires_approval: !mayAutoExecute(kind!.repair_kind),
    approval_id: item.approval_id,
    proposed_at: now(),
  });

  try {
    await qualityStore(clientProvider).appendRepairProposal(proposal);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    reportLostWrite("repair proposal", proposal.proposal_id, reason);
    return { outcome: "refused", reasons: [reason], simulation };
  }

  bumpCounter("repairs_proposed");
  await emitRepairProposed(
    {
      issue_id: finding.issue_id,
      repair_kind: kind!.repair_kind,
      approval_id: item.approval_id,
      entity_type: finding.entity_type,
      entity_id: finding.entity_id,
    },
    clientProvider
  );
  await appendFindingStatus(finding, "repair_proposed", { clientProvider });

  return {
    outcome: "queued_for_approval",
    reasons: ["every repair is owner-approved: the auto-repair allow-list ships empty"],
    proposal,
    approval_id: item.approval_id,
    simulation,
  };
}

/**
 * IDENTITY MERGE — proposal only. There is deliberately NO execute path in this
 * module: not a disabled one, an absent one. Duplicate detection concluding
 * "these are the same entity" always goes to a human with explicit evidence,
 * regardless of detector confidence, and what counts as a duplicate homeowner
 * problem is itself an unmade owner decision (pre-answer 11).
 */
export async function proposeIdentityMerge(
  finding: QualityFinding,
  ctx: { run_id: string },
  deps: QualityDeps = {}
): Promise<{ outcome: "queued_for_approval" | "refused"; reasons: string[]; approval_id?: string }> {
  const clientProvider = deps.clientProvider ?? serviceClientProvider;
  if (NEVER_REPAIRABLE_ENTITY_TYPES.includes(finding.entity_type)) {
    return { outcome: "refused", reasons: ["the consent ledger is never a merge target"] };
  }
  const kill = checkKillSwitch(A09, clientProvider);
  if (kill.engaged) {
    return { outcome: "refused", reasons: [`A09 is paused (${kill.scope})`] };
  }
  const item = await queueApproval(
    {
      agent_id: A09,
      run_id: ctx.run_id,
      approval_kind: "data.identity_merge" satisfies ApprovalKind,
      what_happened: `A09 flagged ${finding.entity_type} ${finding.entity_id} as a possible duplicate of ${finding.related_entity_ids.join(", ")}.`,
      evidence: {
        issue_id: finding.issue_id,
        rule_id: finding.rule_id,
        entity_ids: [finding.entity_id, ...finding.related_entity_ids],
        detail_code: finding.detail_code,
      },
      recommendation:
        "A09 has NO merge capability and proposes no merge action. What counts as a duplicate homeowner problem, and what happens to the homeowner when two of their records are merged, is an unmade owner decision (Master Todo / melissa-park).",
      impact: "None until a human decides. A09 cannot merge these records.",
      risk: "high if merged — a homeowner's history, packet and record are affected",
      reversibility: "hard-to-reverse",
      proposed_change: { action: "none — flagged for owner review only" },
    },
    clientProvider
  );
  return {
    outcome: "queued_for_approval",
    reasons: ["identity merges are unconditionally an owner decision"],
    approval_id: item.approval_id,
  };
}

// ---------------------------------------------------------------------------
// Execute + verify
// ---------------------------------------------------------------------------

export interface ExecuteRepairResult {
  outcome: "executed" | "refused";
  reasons: string[];
  execution?: RepairExecution;
  verified?: boolean;
}

/**
 * Execute a repair a human APPROVED. Refuses anything not approved, so a
 * pending or rejected item can never be applied by mistake — the same discipline
 * A08's `applyApprovedChange` uses, for the same reason.
 */
export async function executeApprovedRepair(
  proposalId: string,
  item: ApprovalItem,
  deps: QualityDeps = {}
): Promise<ExecuteRepairResult> {
  const clientProvider = deps.clientProvider ?? serviceClientProvider;
  const store = qualityStore(clientProvider);
  const proposal = (await store.listRepairProposals()).find((p) => p.proposal_id === proposalId);
  if (!proposal) return { outcome: "refused", reasons: ["no such repair proposal"] };
  if (item.approval_id !== proposal.approval_id) {
    return { outcome: "refused", reasons: ["approval item does not match this proposal"] };
  }
  if (item.approval_kind !== "data.repair") {
    return { outcome: "refused", reasons: ["approval item is not a data.repair decision"] };
  }
  if (item.status !== "APPROVED" && item.status !== "MODIFIED") {
    return {
      outcome: "refused",
      reasons: [`approval is ${item.status} — only an APPROVED or MODIFIED item may be executed`],
    };
  }

  const finding = await findingById(proposal.issue_id, { clientProvider });
  if (!finding) return { outcome: "refused", reasons: ["the finding this repair addresses is gone"] };
  const kind = findRepairKind(proposal.repair_kind);
  const refusal = repairRefusalReason(finding, kind);
  // Re-checked at EXECUTION, not only at proposal: an approval sitting in the
  // queue must not become a licence to cross a boundary that was closed after
  // it was filed.
  if (refusal) return { outcome: "refused", reasons: [refusal] };

  const kill = checkKillSwitch(A09, clientProvider);
  if (kill.engaged) {
    return { outcome: "refused", reasons: [`A09 is paused (${kill.scope}) — no repair executes`] };
  }

  const previous = readIdField(proposal.entity_id, proposal.target_field);
  if (previous === null) return { outcome: "refused", reasons: [UNSUPPORTED_BACKEND] };

  const token = `rv_${randomUUID()}`;
  const snapshot = RepairReversalSnapshot.parse({
    reversal_token: token,
    tenant_id: proposal.tenant_id,
    entity_type: proposal.entity_type,
    entity_id: proposal.entity_id,
    target_field: proposal.target_field,
    previous_ids: previous,
    captured_at: now(),
  });
  try {
    // The snapshot is written BEFORE the mutation. A repair whose undo was not
    // durably recorded is not reversible, whatever the type says.
    await store.appendReversalSnapshot(snapshot);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    reportLostWrite("reversal snapshot", token, reason);
    return { outcome: "refused", reasons: [`refusing to repair without a durable undo: ${reason}`] };
  }

  const next = kind!.repaired(previous);
  const rowsAffected = writeIdField(proposal.entity_id, proposal.target_field, next);

  // VERIFY: re-run the rule that raised the finding against the record as it
  // now stands. Not the simulation again — the real thing.
  const after = readIdField(proposal.entity_id, proposal.target_field);
  const record = readDevDb().problems.find(
    (p) => (p as ProblemRecord).problem_id === proposal.entity_id
  ) as ProblemRecord | undefined;
  const verified =
    after !== null &&
    record !== undefined &&
    !evaluateSubject(
      { entity_type: "problem_record", entity_id: proposal.entity_id, record },
      {}
    ).some((e) => e.rule.rule_id === finding.rule_id);

  const execution = RepairExecution.parse({
    execution_id: `rx_${randomUUID()}`,
    tenant_id: proposal.tenant_id,
    proposal_id: proposal.proposal_id,
    issue_id: proposal.issue_id,
    repair_kind: proposal.repair_kind,
    executed_by: `owner:${item.resolved_by ?? "unknown"}`,
    executed_at: now(),
    rows_affected: rowsAffected,
    verified,
    verified_at: verified ? now() : null,
    rollback_of: null,
    executed_at_reversal_token: token,
  });

  try {
    await store.appendRepairExecution(execution);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    reportLostWrite("repair execution", execution.execution_id, reason);
    return { outcome: "refused", reasons: [reason] };
  }

  bumpCounter("repairs_executed");
  await emitRepairExecuted(
    {
      issue_id: proposal.issue_id,
      repair_kind: proposal.repair_kind,
      execution_id: execution.execution_id,
      rows_affected: String(rowsAffected),
    },
    clientProvider
  );
  const executedFinding = await appendFindingStatus(finding, "repair_executed", { clientProvider });

  if (verified) {
    await emitRepairVerified(
      {
        issue_id: proposal.issue_id,
        repair_kind: proposal.repair_kind,
        execution_id: execution.execution_id,
      },
      clientProvider
    );
    if (executedFinding.ok) {
      await appendFindingStatus(executedFinding.record, "repair_verified", { clientProvider });
    }
  }

  return { outcome: "executed", reasons: [], execution, verified };
}

export interface ReverseRepairResult {
  outcome: "reversed" | "refused";
  reasons: string[];
  execution?: RepairExecution;
  restored_ids?: string[];
}

/**
 * Undo an execution, restoring the field to its snapshotted prior value
 * EXACTLY — same members, same order, blanks included. The reversal is itself
 * an execution record carrying `rollback_of`, so the audit trail never loses a
 * step: what was done and what undid it are both permanent.
 */
export async function reverseRepair(
  executionId: string,
  reversedBy: string,
  deps: QualityDeps = {}
): Promise<ReverseRepairResult> {
  const clientProvider = deps.clientProvider ?? serviceClientProvider;
  const store = qualityStore(clientProvider);
  const original = (await store.listRepairExecutions()).find(
    (e) => e.execution_id === executionId
  );
  if (!original) return { outcome: "refused", reasons: ["no such repair execution"] };
  if (original.rollback_of) {
    return { outcome: "refused", reasons: ["that record is itself a rollback"] };
  }
  const snapshot = (await store.listReversalSnapshots()).find(
    (s) => s.reversal_token === original.executed_at_reversal_token
  );
  if (!snapshot) return { outcome: "refused", reasons: ["the reversal snapshot is missing"] };

  const rowsAffected = writeIdField(
    snapshot.entity_id,
    snapshot.target_field,
    [...snapshot.previous_ids]
  );

  const rollback = RepairExecution.parse({
    execution_id: `rx_${randomUUID()}`,
    tenant_id: original.tenant_id,
    proposal_id: original.proposal_id,
    issue_id: original.issue_id,
    repair_kind: original.repair_kind,
    executed_by: `owner:${reversedBy}`,
    executed_at: now(),
    rows_affected: rowsAffected,
    verified: true,
    verified_at: now(),
    rollback_of: original.execution_id,
    executed_at_reversal_token: original.executed_at_reversal_token,
  });
  try {
    await store.appendRepairExecution(rollback);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    reportLostWrite("repair rollback", rollback.execution_id, reason);
    return { outcome: "refused", reasons: [reason] };
  }

  bumpCounter("repairs_reversed");
  await emitRepairExecuted(
    {
      issue_id: original.issue_id,
      repair_kind: original.repair_kind,
      execution_id: rollback.execution_id,
      rollback_of: original.execution_id,
    },
    clientProvider
  );
  return {
    outcome: "reversed",
    reasons: [],
    execution: rollback,
    restored_ids: [...snapshot.previous_ids],
  };
}
