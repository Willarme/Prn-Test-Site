import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ApprovalItem,
  listApprovals,
  queueApproval,
  resolveApproval,
  resetApprovalCenterForTests,
} from "@/platform/approvals/center";

/**
 * A00 §9 step 7 — Approval Center: schema + queue ops proven with a
 * synthetic item. The queue is EXPECTED to stay empty in real Wave-0
 * operation (first consumer: A06, Wave 2); the existing /admin Pages
 * approve/publish flow is intentionally untouched.
 */
beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-approvals-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

beforeEach(() => {
  resetApprovalCenterForTests();
});

const SYNTHETIC = {
  agent_id: "A06",
  run_id: "ar_synthetic_test",
  what_happened: "QA passed for 1 staged page (synthetic test item)",
  evidence: { page_spec_id: "ps_test" },
  recommendation: "Publish",
  impact: "One new public page",
  risk: "Low — reversible unpublish exists",
  reversibility: "reversible" as const,
  proposed_change: { publish_page_id: "page_test" },
};

describe("A00 approval center", () => {
  it("inserts a PENDING item that parses against the contract", async () => {
    const item = await queueApproval(SYNTHETIC);
    expect(ApprovalItem.safeParse(item).success).toBe(true);
    expect(item.status).toBe("PENDING");
    expect(item.approval_id).toMatch(/^ap_/);
    expect(item.tenant_id).toBe("prn"); // reserved field, default only
    expect(item.resolved_by).toBeUndefined();
  });

  it("lists queued items newest first", async () => {
    await queueApproval(SYNTHETIC);
    await queueApproval({ ...SYNTHETIC, what_happened: "second item" });
    const items = await listApprovals();
    expect(items.length).toBe(2);
    expect(items[0].what_happened).toBe("second item");
  });

  it("resolves an item — status + resolved_* only — and refuses double resolution", async () => {
    const item = await queueApproval(SYNTHETIC);
    const resolved = await resolveApproval(item.approval_id, {
      status: "APPROVED",
      resolved_by: "owner:test",
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.status).toBe("APPROVED");
    expect(resolved!.resolved_by).toBe("owner:test");
    expect(resolved!.resolved_at).toBeDefined();
    // The ask itself is immutable — only the decision fields moved.
    expect(resolved!.what_happened).toBe(SYNTHETIC.what_happened);
    expect(resolved!.run_id).toBe(SYNTHETIC.run_id);

    const again = await resolveApproval(item.approval_id, {
      status: "REJECTED",
      resolved_by: "owner:test",
    });
    expect(again).toBeNull(); // a made decision is never silently overwritten
  });

  it("resolving an unknown id returns null, never throws", async () => {
    const res = await resolveApproval("ap_nope", { status: "REJECTED", resolved_by: "owner:test" });
    expect(res).toBeNull();
  });

  it("supports the do-not-ask-again-for-class decision", async () => {
    const item = await queueApproval(SYNTHETIC);
    const resolved = await resolveApproval(item.approval_id, {
      status: "DO_NOT_ASK_AGAIN_FOR_CLASS",
      resolved_by: "owner:test",
    });
    expect(resolved!.status).toBe("DO_NOT_ASK_AGAIN_FOR_CLASS");
  });
});
