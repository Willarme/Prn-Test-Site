"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminAction, adminActionMessage } from "./action";

type ReconciliationResult = { verdict?: string; scan_complete?: boolean; findings?: number; checks_run?: number; quarantined?: number };
export function ReconciliationRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  async function run() {
    if (busy) return;
    setBusy(true); setMsg(null); setFailed(false);
    try {
      const data = await adminAction<ReconciliationResult>("/api/admin/quality/reconcile");
      if (data.verdict === "could_not_verify") {
        setFailed(true);
        setMsg(data.scan_complete ? "Could not verify. The pass ran but could not record all of its findings." : "Could not verify. The backend could not enumerate every row needed for the checks.");
      } else {
        setMsg(`${data.checks_run ?? "Unknown number of"} checks · ${data.findings ?? "unknown"} findings · ${data.quarantined ?? "unknown"} quarantined.`);
      }
      router.refresh();
    } catch (error) { setFailed(true); setMsg(adminActionMessage(error)); }
    finally { setBusy(false); }
  }
  return <span className="adm-action" aria-busy={busy}><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={run} title="Check stored records and events. This may add reversible quarantine markers; it does not delete or repair records.">{busy ? "Checking records…" : "Run reconciliation"}</button>{msg && <span className={`adm-action-message${failed ? " adm-action-message--error" : ""}`} role={failed ? "alert" : "status"}>{msg}</span>}</span>;
}
