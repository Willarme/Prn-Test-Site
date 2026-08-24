import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listApprovals, resetApprovalCenterForTests } from "@/platform/approvals/center";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import { cleanProblemRecord } from "@/platform/quality/fixtures";
import { findRule } from "@/platform/quality/invariants";
import {
  currentFindings,
  recordFinding,
  resetQualityCountersForTests,
} from "@/platform/quality/issues";
import { resetQualityKpiForTests } from "@/platform/quality/kpi";
import { proposeRepair } from "@/platform/quality/repairs";
import { qualityStore } from "@/platform/quality/store";
import type { QualityFinding } from "@/platform/quality/types";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { readDevDb, updateDevDb } from "@/platform/stores/dev-db";
import { resetRuntimeStore } from "@/platform/stores/runtime";

/**
 * THE RESOLVE CONTROL (coherence report issue 14, condition 12).
 *
 * A00 shipped the Approval Center read-only with `resolveApproval()` unwired.
 * A09 is the first real producer, so A09 builds the missing half: one
 * owner-gated API route plus two buttons on the page that already existed. The
 * DoD's "an owner can approve or reject a proposed repair" is a claim about
 * something the owner can actually click, so it is tested through the route.
 */

const noDb = () => null;
const RULE = findRule("problem_record.required_ids")!;

/** The admin gate is a cookie check; these tests drive the route both ways. */
let unlocked = true;
vi.mock("@/platform/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform/admin/auth")>();
  return { ...actual, isAdminUnlocked: async () => unlocked };
});

let POST: (request: Request) => Promise<Response>;

function resolveRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/approvals/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedProposedRepair(): Promise<{ finding: QualityFinding; approvalId: string }> {
  updateDevDb((db) => {
    db.problems.push(
      cleanProblemRecord({ problem_id: "pr_resolve", evidence_ids: ["ev_1", "", "ev_2"] })
    );
  });
  const written = await recordFinding(
    {
      kind: "data_quality_issue",
      source: "ingest",
      rule: RULE,
      entity_type: "problem_record",
      entity_id: "pr_resolve",
      violation: { detail_code: "blank_evidence_id" },
    },
    { clientProvider: noDb }
  );
  if (!written.ok) throw new Error("fixture finding did not persist");
  const proposed = await proposeRepair(
    written.record,
    { run_id: "ar_test" },
    { clientProvider: noDb }
  );
  return { finding: written.record, approvalId: proposed.approval_id! };
}

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a09-resolve-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  ({ POST } = await import("@/app/api/admin/approvals/resolve/route"));
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
  resetRuntimeStore();
});

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a09-resolve-case-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  unlocked = true;
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

describe("the control is owner-gated like everything else", () => {
  it("refuses without an owner session", async () => {
    const { approvalId } = await seedProposedRepair();
    unlocked = false;
    const res = await POST(resolveRequest({ approval_id: approvalId, decision: "approve" }));
    expect(res.status).toBe(403);
    // ...and nothing happened.
    expect(readDevDb().problems[0].evidence_ids).toEqual(["ev_1", "", "ev_2"]);
    expect((await listApprovals(noDb))[0].status).toBe("PENDING");
  });

  it("rejects a malformed body", async () => {
    const res = await POST(resolveRequest({ approval_id: "", decision: "maybe" }));
    expect(res.status).toBe(400);
  });

  it("404s an unknown approval", async () => {
    const res = await POST(resolveRequest({ approval_id: "ap_nope", decision: "approve" }));
    expect(res.status).toBe(404);
  });
});

describe("APPROVE runs the repair", () => {
  it("resolves the item, executes, verifies and reports back", async () => {
    const { approvalId } = await seedProposedRepair();
    const res = await POST(resolveRequest({ approval_id: approvalId, decision: "approve" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("APPROVED");
    expect(body.repair.outcome).toBe("executed");
    expect(body.repair.verified).toBe(true);

    expect(readDevDb().problems[0].evidence_ids).toEqual(["ev_1", "ev_2"]);
    const current = await currentFindings({ clientProvider: noDb });
    expect(current[0].status).toBe("repair_verified");
    expect((await qualityStore(noDb).listRepairExecutions())).toHaveLength(1);
  });

  it("refuses a second decision on the same item", async () => {
    const { approvalId } = await seedProposedRepair();
    await POST(resolveRequest({ approval_id: approvalId, decision: "approve" }));
    const res = await POST(resolveRequest({ approval_id: approvalId, decision: "reject" }));
    expect(res.status).toBe(409);
  });
});

describe("REJECT is a real outcome, not a dismissal", () => {
  it("records the rejection on the finding and changes no data", async () => {
    const { approvalId } = await seedProposedRepair();
    const res = await POST(resolveRequest({ approval_id: approvalId, decision: "reject" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("REJECTED");
    expect(body.repair.outcome).toBe("rejected");

    // The bad data is untouched — a rejected repair repairs nothing.
    expect(readDevDb().problems[0].evidence_ids).toEqual(["ev_1", "", "ev_2"]);
    const current = await currentFindings({ clientProvider: noDb });
    expect(current[0].status).toBe("rejected");
    expect(current[0].resolved_at).not.toBeNull();
    // The finding itself is never deleted.
    expect((await qualityStore(noDb).listFindings()).length).toBeGreaterThan(1);
    expect(await qualityStore(noDb).listRepairExecutions()).toEqual([]);
  });
});

describe("the control does not overreach", () => {
  it("resolves a non-A09 kind without inventing a side effect for it", async () => {
    const { queueApproval } = await import("@/platform/approvals/center");
    const item = await queueApproval(
      {
        agent_id: "A06",
        run_id: "ar_x",
        approval_kind: "seo.page_publish",
        what_happened: "fixture",
        evidence: {},
        impact: "fixture",
        risk: "low",
        reversibility: "reversible",
        proposed_change: {},
      },
      noDb
    );
    const res = await POST(resolveRequest({ approval_id: item.approval_id, decision: "approve" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("APPROVED");
    expect(body.repair).toBeUndefined();
  });

  it("never touches publish state — the route cannot reach it", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "app", "api", "admin", "approvals", "resolve", "route.ts"),
      "utf-8"
    );
    expect(source).not.toMatch(/setPublished|published_page|publish\(/);
  });

  it("ships a client control that imports nothing from the platform", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "components", "admin", "ApprovalDecision.tsx"),
      "utf-8"
    );
    expect(source).toMatch(/^"use client"/);
    expect(source).not.toMatch(/@\/platform\//);
  });

  it("adds NO new top-level admin page — the control lives on the existing one", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "app", "admin", "approvals", "page.tsx"),
      "utf-8"
    );
    expect(page).toMatch(/ApprovalDecision/);
  });
});
