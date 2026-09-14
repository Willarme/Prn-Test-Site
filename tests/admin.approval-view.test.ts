import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ApprovalsPage from "@/app/admin/approvals/page";
import { approvalEffect, approvalEvidenceText } from "@/platform/admin/approval-view";
import type { ApprovalSnapshot } from "@/platform/approvals/center";

const state = vi.hoisted(() => ({ unlocked: true, snapshot: { items: [], source: "this process", verified: true } as ApprovalSnapshot, reads: 0 }));
vi.mock("@/components/admin/AdminGate", () => ({ adminGate: async () => state.unlocked ? null : createElement("p", null, "Locked") }));
vi.mock("@/platform/approvals/center", () => ({ readApprovalSnapshot: async () => { state.reads++; return state.snapshot; } }));
vi.mock("@/components/admin/ApprovalDecision", () => ({ ApprovalDecision: () => createElement("button", null, "APPROVAL_ACTION") }));

beforeEach(() => {
  state.unlocked = true; state.reads = 0;
  state.snapshot = { source: "database", verified: true, items: [{
    approval_id: "ap_fixture", agent_id: "A09", run_id: "ar_fixture", approval_kind: "data.repair",
    what_happened: "Synthetic data discrepancy", recommendation: "Keep the original and repair the blank reference",
    evidence: { issue_id: "qi_fixture", api_key: "SYNTHETIC_SECRET_DO_NOT_RENDER" },
    proposed_change: { before: ["ev_a", ""], after: ["ev_a"], note: "<script>example</script>" },
    impact: "One synthetic record", risk: "Bounded", reversibility: "reversible", status: "PENDING", created_at: "2026-09-06T00:00:00Z",
  }] };
});

describe("approval evidence and consequence presentation", () => {
  it("renders the actual recommendation, proposal and basis without executable markup or credential values", async () => {
    const html = renderToStaticMarkup(await ApprovalsPage());
    expect(html).toContain("Keep the original and repair the blank reference");
    expect(html).toContain("qi_fixture"); expect(html).toContain("ev_a");
    expect(html).toContain("&lt;script&gt;example&lt;/script&gt;");
    expect(html).not.toContain("<script>example");
    expect(html).not.toContain("SYNTHETIC_SECRET_DO_NOT_RENDER");
    expect(html).toContain("Decision class is not recorded");
    expect(html).toContain("APPROVAL_ACTION");
  });
  it("gates before reading and never offers a decision from an unverified cached queue", async () => {
    state.unlocked = false;
    expect(renderToStaticMarkup(await ApprovalsPage())).toContain("Locked"); expect(state.reads).toBe(0);
    state.unlocked = true; state.snapshot.verified = false; state.snapshot.source = "this process";
    const html = renderToStaticMarkup(await ApprovalsPage());
    expect(html).toContain("Database queue unverified"); expect(html).not.toContain("APPROVAL_ACTION");
  });
  it("does not imply a queue-only publication or identity decision performs that external action", () => {
    expect(approvalEffect("seo.page_publish")).toContain("Actual publication remains on Pages");
    expect(approvalEffect("data.identity_merge")).toContain("does not execute an identity merge");
  });
  it("bounds malformed large payloads and preserves the saved data", () => {
    const original = { long: "x".repeat(9000), nested: { access_token: "SYNTHETIC_TOKEN" } };
    const result = approvalEvidenceText(original);
    expect(result.truncated).toBe(true); expect(result.text.length).toBeLessThan(8150);
    expect(result.text).toContain("Display limited");
    expect(original.nested.access_token).toBe("SYNTHETIC_TOKEN");
  });
});
