import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminUnlocked } from "@/platform/admin/auth";
import { listApprovals, resolveApproval } from "@/platform/approvals/center";
import { appendFindingStatus, findingById } from "@/platform/quality/issues";
import { executeApprovedRepair } from "@/platform/quality/repairs";
import { qualityStore } from "@/platform/quality/store";

/**
 * THE APPROVAL RESOLVE CONTROL — coherence report issue 14, condition 12.
 *
 * WHY THIS EXISTS AND WHY A09 BUILT IT. A00 shipped the Approval Center with a
 * read-only admin list and `resolveApproval()` with no caller: it was scoped
 * expecting A06's publish gate (Wave 2) to be the first real producer. A09 got
 * there first — repair proposals and identity merges both file here — and A09's
 * Definition of Done requires an owner to be able to approve or reject a
 * proposed repair. The audit named this explicitly: "whoever builds first also
 * builds the resolve control that resolveApproval() still lacks."
 *
 * MINIMAL, AND NO NEW TOP-LEVEL PAGE. One owner-gated API route plus two
 * buttons on the Approval Center page A00 already shipped. It is the same shape
 * as the existing owner publish action (api/admin/pages/publish): session
 * check, validated body, one state change, audited.
 *
 * THE DECISION IS THE GATE, AND IT IS ENFORCED SERVER-SIDE. Rejecting is a
 * real outcome, not a dismissal: a rejected repair moves its finding to
 * `rejected` and the finding stays in the record forever. Approving a
 * data.repair does NOT merely flip a status — it runs the repair, and
 * `executeApprovedRepair` re-checks every boundary at execution time, so an
 * approval sitting in the queue can never become a licence to cross a line that
 * closed after it was filed.
 *
 * SCOPE. Kinds other than A09's resolve to APPROVED/REJECTED and nothing else
 * happens — there is no A04/A06 consumer yet, and inventing a side effect for
 * a producer that does not exist would be worse than leaving the hook honest.
 *
 * KNOWN LIMIT, stated rather than hidden: `resolveApproval` mutates A00's
 * in-process queue and fails soft to the database (migration 00007 is written,
 * not applied). In a single-process dev server that is correct end to end; in a
 * multi-instance deployment a decision would only be visible to the instance
 * that received it until 00007 is applied. That is A00's persistence gap, not a
 * behaviour A09 changed.
 */
const Body = z.object({
  approval_id: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
});

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isAdminUnlocked())) {
    return NextResponse.json({ error: "Owner sign-in required" }, { status: 403 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { approval_id, decision } = parsed.data;

  const existing = (await listApprovals()).find((i) => i.approval_id === approval_id);
  if (!existing) return NextResponse.json({ error: "unknown approval" }, { status: 404 });
  if (existing.status !== "PENDING") {
    return NextResponse.json(
      { error: `already ${existing.status.toLowerCase()}` },
      { status: 409 }
    );
  }

  const resolved = await resolveApproval(approval_id, {
    status: decision === "approve" ? "APPROVED" : "REJECTED",
    resolved_by: "owner",
  });
  if (!resolved) {
    return NextResponse.json({ error: "could not resolve" }, { status: 409 });
  }

  // A09's two kinds are the only ones with a consumer today.
  if (resolved.approval_kind === "data.repair") {
    const proposal = (await qualityStore().listRepairProposals()).find(
      (p) => p.approval_id === approval_id
    );
    if (!proposal) {
      return NextResponse.json(
        { ok: true, status: resolved.status, note: "no repair proposal found for this item" },
        { status: 200 }
      );
    }
    if (decision === "approve") {
      const executed = await executeApprovedRepair(proposal.proposal_id, resolved);
      return NextResponse.json({
        ok: true,
        status: resolved.status,
        repair: {
          outcome: executed.outcome,
          verified: executed.verified ?? false,
          reasons: executed.reasons,
          execution_id: executed.execution?.execution_id ?? null,
        },
      });
    }
    // A rejection is recorded on the finding, not thrown away.
    const finding = await findingById(proposal.issue_id);
    if (finding) await appendFindingStatus(finding, "rejected");
    return NextResponse.json({ ok: true, status: resolved.status, repair: { outcome: "rejected" } });
  }

  return NextResponse.json({ ok: true, status: resolved.status });
}
