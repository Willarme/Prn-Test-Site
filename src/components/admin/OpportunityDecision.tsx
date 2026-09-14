"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminAction, adminActionMessage } from "./action";

/** ID/status only. Scoring, candidates and policies remain server-rendered. */
export function OpportunityDecision({ opportunityId, status }: { opportunityId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  async function decide(decision: "accept" | "reject" | "defer") {
    if (busy) return;
    setBusy(true); setMsg(null); setFailed(false);
    try {
      await adminAction("/api/admin/opportunities/decide", { body: { search_opportunity_id: opportunityId, decision } });
      setMsg(decision === "accept" ? "Accepted for page building. Nothing published." : decision === "defer" ? "Deferred for a later decision." : "Rejection recorded.");
      router.refresh();
    } catch (error) { setFailed(true); setMsg(adminActionMessage(error)); }
    finally { setBusy(false); }
  }
  return <span className="adm-action" aria-busy={busy}>
    {status !== "approved" && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => decide("accept")} title="Accept for page building; this does not publish a page.">Accept</button>}
    {status !== "rejected" && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => decide("reject")}>Reject</button>}
    {status !== "watch" && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => decide("defer")} title="Keep this opportunity for a later decision.">Defer</button>}
    {busy && <span className="adm-small" role="status">Recording…</span>}
    {msg && <span className={`adm-action-message${failed ? " adm-action-message--error" : ""}`} role={failed ? "alert" : "status"}>{msg}</span>}
  </span>;
}
