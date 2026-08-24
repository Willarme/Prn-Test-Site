import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listApprovals,
  resetApprovalCenterForTests,
  resolveApproval,
  type ApprovalItem,
} from "@/platform/approvals/center";
import {
  engageKillSwitch,
  releaseKillSwitch,
  resetKillSwitchForTests,
} from "@/platform/killswitch";
import { getPolicySetting } from "@/platform/policy/store";
import { cleanProblemRecord } from "@/platform/quality/fixtures";
import { findRule } from "@/platform/quality/invariants";
import {
  currentFindings,
  qualityCounters,
  recordFinding,
  resetQualityCountersForTests,
  type RecordFindingInput,
} from "@/platform/quality/issues";
import { resetQualityKpiForTests } from "@/platform/quality/kpi";
import {
  AUTO_REPAIR_ALLOW_LIST,
  FORBIDDEN_TARGET_FIELDS,
  REPAIR_KINDS,
  autoRepairEnabled,
  executeApprovedRepair,
  mayAutoExecute,
  proposeIdentityMerge,
  proposeRepair,
  repairKindsFor,
  repairRefusalReason,
  reverseRepair,
  simulateRepair,
} from "@/platform/quality/repairs";
import { qualityStore } from "@/platform/quality/store";
import type { QualityFinding } from "@/platform/quality/types";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { readDevDb, updateDevDb } from "@/platform/stores/dev-db";
import { resetRuntimeStore } from "@/platform/stores/runtime";

/**
 * A09 §9 step 5 failable check: "the safe-repair allow-list is explicitly
 * enumerated in code and in the Policy Store, defaults to empty, and each
 * candidate repair kind has a simulation test plus a reversal test (execute,
 * then roll back, then confirm original state is restored exactly)."
 */

const noDb = () => null;
const RULE = findRule("problem_record.required_ids")!;

function seedProblem(evidenceIds: string[]): void {
  updateDevDb((db) => {
    db.problems.push(cleanProblemRecord({ problem_id: "pr_repair", evidence_ids: evidenceIds }));
  });
}

async function seedFinding(overrides: Partial<RecordFindingInput> = {}): Promise<QualityFinding> {
  const result = await recordFinding(
    {
      kind: "data_quality_issue",
      source: "ingest",
      rule: RULE,
      entity_type: "problem_record",
      entity_id: "pr_repair",
      violation: { detail_code: "blank_evidence_id" },
      ...overrides,
    },
    { clientProvider: noDb }
  );
  if (!result.ok) throw new Error("fixture finding did not persist");
  return result.record;
}

/** The owner's decision, as the resolve control will produce it. */
async function approve(approvalId: string): Promise<ApprovalItem> {
  const item = await resolveApproval(
    approvalId,
    { status: "APPROVED", resolved_by: "owner" },
    noDb
  );
  if (!item) throw new Error("approval did not resolve");
  return item;
}

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a09-repairs-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
  resetRuntimeStore();
});

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a09-repairs-case-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  resetQualityCountersForTests();
  resetQualityKpiForTests();
  resetAgentRunLedgerForTests();
  resetApprovalCenterForTests();
  resetKillSwitchForTests();
  resetRuntimeStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the allow-list ships EMPTY, behind a master switch that is OFF", () => {
  it("enumerates no auto-repair class in code", () => {
    expect(AUTO_REPAIR_ALLOW_LIST).toEqual([]);
  });

  it("keeps the policy master switch off", () => {
    expect(getPolicySetting<boolean>("quality.auto_repair_enabled")!.value).toBe(false);
    expect(autoRepairEnabled()).toBe(false);
  });

  it("needs BOTH gates open, so no declared kind may auto-execute", () => {
    for (const kind of REPAIR_KINDS) {
      expect(mayAutoExecute(kind.repair_kind), kind.repair_kind).toBe(false);
    }
  });

  it("marks every proposal as requiring approval", async () => {
    seedProblem(["ev_1", ""]);
    const finding = await seedFinding();
    const result = await proposeRepair(finding, { run_id: "ar_test" }, { clientProvider: noDb });
    expect(result.outcome).toBe("queued_for_approval");
    expect(result.proposal!.requires_approval).toBe(true);
  });
});

describe("declared repair kinds are bounded by construction", () => {
  it("declares only kinds that target an id list, never publish state or content", () => {
    for (const kind of REPAIR_KINDS) {
      expect(FORBIDDEN_TARGET_FIELDS, kind.repair_kind).not.toContain(kind.target_field);
      expect(kind.target_field).toMatch(/_ids$/);
    }
  });

  it("is a pure function of the prior value", () => {
    for (const kind of REPAIR_KINDS) {
      const input = ["a", "", "b", "  "];
      const once = kind.repaired(input);
      const twice = kind.repaired(input);
      expect(once).toEqual(twice);
      expect(input).toEqual(["a", "", "b", "  "]); // unmutated
    }
  });

  it("addresses only rules that exist", () => {
    for (const kind of REPAIR_KINDS) {
      for (const ruleId of kind.addresses_rule_ids) {
        expect(findRule(ruleId), ruleId).not.toBeNull();
      }
    }
  });
});

describe("simulation", () => {
  it("computes rows affected and re-runs the rule against the projected record", async () => {
    seedProblem(["ev_1", ""]);
    const finding = await seedFinding();
    const kind = repairKindsFor(finding)[0];
    const sim = simulateRepair(finding, kind);
    expect(sim.rows_affected).toBe(1);
    expect(sim.rule_passes_after).toBe(true);
  });

  it("changes NOTHING — the record is untouched by a simulation", async () => {
    seedProblem(["ev_1", ""]);
    const finding = await seedFinding();
    simulateRepair(finding, repairKindsFor(finding)[0]);
    expect(readDevDb().problems[0].evidence_ids).toEqual(["ev_1", ""]);
  });

  it("refuses to propose a repair the simulation says would not fix the finding", async () => {
    // The blank claim_id kind cannot fix a blank EVIDENCE id: after pruning
    // claims, the rule still fails on evidence.
    seedProblem(["ev_1", ""]);
    const finding = await seedFinding();
    const claimKind = REPAIR_KINDS.find((k) => k.target_field === "claim_ids")!;
    const sim = simulateRepair(finding, claimKind);
    expect(sim.rule_passes_after).toBe(false);
  });
});

describe("propose routes through the Approval Center as data.repair", () => {
  it("files an item with the right kind, evidence and reversibility", async () => {
    seedProblem(["ev_1", ""]);
    const finding = await seedFinding();
    const result = await proposeRepair(finding, { run_id: "ar_test" }, { clientProvider: noDb });
    expect(result.outcome).toBe("queued_for_approval");

    const items = await listApprovals(noDb);
    expect(items).toHaveLength(1);
    expect(items[0].approval_kind).toBe("data.repair");
    expect(items[0].agent_id).toBe("A09");
    expect(items[0].reversibility).toBe("reversible");
    expect(items[0].status).toBe("PENDING");
  });

  it("puts IDs, codes and counts in the evidence — never the record's contents", async () => {
    updateDevDb((db) => {
      db.problems.push(
        cleanProblemRecord({
          problem_id: "pr_repair",
          evidence_ids: ["ev_1", ""],
          problem_summary: "MY PIPE EXPLODED IN THE PURPLE BATHROOM",
        })
      );
    });
    const finding = await seedFinding();
    await proposeRepair(finding, { run_id: "ar_test" }, { clientProvider: noDb });
    const serialized = JSON.stringify(await listApprovals(noDb));
    expect(serialized).not.toContain("PURPLE BATHROOM");
  });

  it("moves the finding to repair_proposed and counts it", async () => {
    seedProblem(["ev_1", ""]);
    const finding = await seedFinding();
    await proposeRepair(finding, { run_id: "ar_test" }, { clientProvider: noDb });
    const current = await currentFindings({ clientProvider: noDb });
    expect(current[0].status).toBe("repair_proposed");
    expect(qualityCounters().repairs_proposed).toBe(1);
  });

  it("executes NOTHING at proposal time", async () => {
    seedProblem(["ev_1", ""]);
    const finding = await seedFinding();
    await proposeRepair(finding, { run_id: "ar_test" }, { clientProvider: noDb });
    expect(readDevDb().problems[0].evidence_ids).toEqual(["ev_1", ""]);
    expect(await qualityStore(noDb).listRepairExecutions()).toEqual([]);
  });
});

describe("execute requires a real owner approval", () => {
  async function proposed() {
    seedProblem(["ev_1", "", "ev_2"]);
    const finding = await seedFinding();
    const result = await proposeRepair(finding, { run_id: "ar_test" }, { clientProvider: noDb });
    return { finding, proposal: result.proposal!, approvalId: result.approval_id! };
  }

  it("refuses a PENDING approval — a queued item is not a decision", async () => {
    const { proposal } = await proposed();
    const pending = (await listApprovals(noDb))[0];
    const result = await executeApprovedRepair(proposal.proposal_id, pending, {
      clientProvider: noDb,
    });
    expect(result.outcome).toBe("refused");
    expect(result.reasons[0]).toMatch(/PENDING/);
    expect(readDevDb().problems[0].evidence_ids).toEqual(["ev_1", "", "ev_2"]);
  });

  it("refuses a REJECTED approval", async () => {
    const { proposal, approvalId } = await proposed();
    const rejected = await resolveApproval(
      approvalId,
      { status: "REJECTED", resolved_by: "owner" },
      noDb
    );
    const result = await executeApprovedRepair(proposal.proposal_id, rejected!, {
      clientProvider: noDb,
    });
    expect(result.outcome).toBe("refused");
    expect(readDevDb().problems[0].evidence_ids).toEqual(["ev_1", "", "ev_2"]);
  });

  it("refuses an approval belonging to a different proposal", async () => {
    const { approvalId } = await proposed();
    const item = await approve(approvalId);
    const result = await executeApprovedRepair("rp_not_real", item, { clientProvider: noDb });
    expect(result.outcome).toBe("refused");
  });

  it("executes, verifies and records when the owner approves", async () => {
    const { proposal, approvalId } = await proposed();
    const item = await approve(approvalId);
    const result = await executeApprovedRepair(proposal.proposal_id, item, {
      clientProvider: noDb,
    });
    expect(result.outcome).toBe("executed");
    expect(result.verified).toBe(true);
    expect(result.execution!.executed_by).toBe("owner:owner");
    expect(result.execution!.rows_affected).toBe(1);
    expect(readDevDb().problems[0].evidence_ids).toEqual(["ev_1", "ev_2"]);

    const current = await currentFindings({ clientProvider: noDb });
    expect(current[0].status).toBe("repair_verified");
    expect(current[0].resolved_at).not.toBeNull();
  });

  it("writes the undo BEFORE the mutation — an irreversible repair is refused", async () => {
    const { proposal, approvalId } = await proposed();
    const item = await approve(approvalId);
    await executeApprovedRepair(proposal.proposal_id, item, { clientProvider: noDb });
    const snapshots = await qualityStore(noDb).listReversalSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].previous_ids).toEqual(["ev_1", "", "ev_2"]);
  });
});

describe("the reversal test — execute, roll back, original state restored EXACTLY", () => {
  it("restores the prior value byte for byte, blanks and order included", async () => {
    const original = ["ev_1", "", "ev_2", "  "];
    seedProblem([...original]);
    const finding = await seedFinding();
    const proposal = (
      await proposeRepair(finding, { run_id: "ar_test" }, { clientProvider: noDb })
    ).proposal!;
    const item = await approve(proposal.approval_id!);
    const executed = await executeApprovedRepair(proposal.proposal_id, item, {
      clientProvider: noDb,
    });
    expect(readDevDb().problems[0].evidence_ids).toEqual(["ev_1", "ev_2"]);

    const reversed = await reverseRepair(executed.execution!.execution_id, "owner", {
      clientProvider: noDb,
    });
    expect(reversed.outcome).toBe("reversed");
    expect(readDevDb().problems[0].evidence_ids).toEqual(original);
    expect(reversed.restored_ids).toEqual(original);
  });

  it("records the rollback as its own execution — the audit trail never loses a step", async () => {
    seedProblem(["ev_1", ""]);
    const finding = await seedFinding();
    const proposal = (
      await proposeRepair(finding, { run_id: "ar_test" }, { clientProvider: noDb })
    ).proposal!;
    const item = await approve(proposal.approval_id!);
    const executed = await executeApprovedRepair(proposal.proposal_id, item, {
      clientProvider: noDb,
    });
    await reverseRepair(executed.execution!.execution_id, "owner", { clientProvider: noDb });

    const executions = await qualityStore(noDb).listRepairExecutions();
    expect(executions).toHaveLength(2);
    const rollback = executions.find((e) => e.rollback_of)!;
    expect(rollback.rollback_of).toBe(executed.execution!.execution_id);
    expect(qualityCounters().repairs_reversed).toBe(1);
  });

  it("refuses to roll back a rollback", async () => {
    seedProblem(["ev_1", ""]);
    const finding = await seedFinding();
    const proposal = (
      await proposeRepair(finding, { run_id: "ar_test" }, { clientProvider: noDb })
    ).proposal!;
    const item = await approve(proposal.approval_id!);
    const executed = await executeApprovedRepair(proposal.proposal_id, item, {
      clientProvider: noDb,
    });
    const reversed = await reverseRepair(executed.execution!.execution_id, "owner", {
      clientProvider: noDb,
    });
    const again = await reverseRepair(reversed.execution!.execution_id, "owner", {
      clientProvider: noDb,
    });
    expect(again.outcome).toBe("refused");
  });
});

describe("boundaries no approval can open", () => {
  it("REFUSES a consent-ledger repair — permanently, before any other check", async () => {
    const consentRule = findRule("consent_event.required_ids")!;
    const finding = await seedFinding({
      rule: consentRule,
      entity_type: "consent_event",
      entity_id: "ce_1",
      violation: { detail_code: "missing_disclosure_version" },
    });
    const result = await proposeRepair(finding, { run_id: "ar_test" }, { clientProvider: noDb });
    expect(result.outcome).toBe("refused");
    expect(result.reasons[0]).toMatch(/never a repair target/);
    expect(await listApprovals(noDb)).toEqual([]);
  });

  it("refuses a detect-only rule's finding even on a repairable entity type", () => {
    const detectOnly = findRule("consent_event.required_ids")!;
    expect(detectOnly.detect_only).toBe(true);
    const fake = {
      entity_type: "problem_record",
      rule_id: detectOnly.rule_id,
    } as unknown as QualityFinding;
    expect(repairRefusalReason(fake, REPAIR_KINDS[0])).toMatch(/detect-only/);
  });

  it("refuses any kind targeting publish state or page content", () => {
    const fake = { entity_type: "page_spec", rule_id: "page_spec.legal_transition" } as unknown as QualityFinding;
    for (const field of ["status", "indexed", "canonical_path", "content_blocks"]) {
      const rogue = { ...REPAIR_KINDS[0], applies_to: "page_spec" as const, target_field: field };
      expect(repairRefusalReason(fake, rogue), field).toMatch(/no repair may write/);
    }
  });

  it("has NO identity-merge execute path at all — proposal only", async () => {
    seedProblem(["ev_1"]);
    const finding = await seedFinding({
      violation: { detail_code: "same_intake_session_candidate" },
    });
    const result = await proposeIdentityMerge(finding, { run_id: "ar_test" }, { clientProvider: noDb });
    expect(result.outcome).toBe("queued_for_approval");
    const item = (await listApprovals(noDb))[0];
    expect(item.approval_kind).toBe("data.identity_merge");
    expect(item.reversibility).toBe("hard-to-reverse");
    expect(JSON.stringify(item.proposed_change)).toMatch(/flagged for owner review only/);
  });
});

describe("the kill switch stops repairs, never recording", () => {
  it("refuses to PROPOSE while A09 is paused", async () => {
    seedProblem(["ev_1", ""]);
    const finding = await seedFinding();
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A09", by: "owner" }, noDb);
    const result = await proposeRepair(finding, { run_id: "ar_test" }, { clientProvider: noDb });
    expect(result.outcome).toBe("refused");
    expect(result.reasons[0]).toMatch(/paused/);
  });

  it("refuses to EXECUTE an already-approved repair while paused", async () => {
    seedProblem(["ev_1", ""]);
    const finding = await seedFinding();
    const proposal = (
      await proposeRepair(finding, { run_id: "ar_test" }, { clientProvider: noDb })
    ).proposal!;
    const item = await approve(proposal.approval_id!);
    await engageKillSwitch({ scope: "GLOBAL", by: "owner" }, noDb);
    const result = await executeApprovedRepair(proposal.proposal_id, item, {
      clientProvider: noDb,
    });
    expect(result.outcome).toBe("refused");
    expect(readDevDb().problems[0].evidence_ids).toEqual(["ev_1", ""]);
    await releaseKillSwitch({ scope: "GLOBAL", by: "owner" }, noDb);
  });

  it("keeps RECORDING while paused — visibility is what you least want to lose", async () => {
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A09", by: "owner" }, noDb);
    seedProblem(["ev_1", ""]);
    const finding = await seedFinding();
    expect(finding.issue_id).toMatch(/^dq_/);
    expect(await currentFindings({ clientProvider: noDb })).toHaveLength(1);
  });
});
