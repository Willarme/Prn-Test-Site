"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminAction, adminActionMessage } from "./action";

type ApprovalResponse = { note?: string; repair?: { outcome: string; verified?: boolean; reasons?: string[] } };

export function ApprovalDecision({ approvalId, kind, status }: {
  approvalId: string; kind: string | null; status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  async function decide(decision: "approve" | "reject") {
    if (busy) return;
    setBusy(true); setMsg(null); setFailed(false);
    try {
      const data = await adminAction<ApprovalResponse>("/api/admin/approvals/resolve", { body: { approval_id: approvalId, decision } });
      if (data.repair && data.repair.outcome !== "rejected") {
        setMsg(`Decision recorded. Repair ${data.repair.outcome}${data.repair.verified ? " · verified" : " · verification not confirmed"}${data.repair.reasons?.length ? ": " + data.repair.reasons.join("; ") : "."}`);
      } else { setMsg(data.note ?? `${decision === "approve" ? "Approval" : "Rejection"} recorded.`); }
      router.refresh();
    } catch (error) { setFailed(true); setMsg(adminActionMessage(error)); }
    finally { setBusy(false); }
  }
  return <span className="adm-action" aria-busy={busy}>
    {status === "PENDING" ? <>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => decide("approve")} title={kind === "data.repair" ? "Approve and run the proposed repair through its current safety checks." : "Record approval for this proposal."}>{busy ? "Recording…" : kind === "data.repair" ? "Approve repair" : "Approve"}</button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => decide("reject")}>Reject</button>
    </> : <span className="adm-small">{status.toLowerCase().replaceAll("_", " ")}</span>}
    {msg && <span className={`adm-action-message${failed ? " adm-action-message--error" : ""}`} role={failed ? "alert" : "status"}>{msg}</span>}
  </span>;
}
