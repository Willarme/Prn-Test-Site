"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminAction, adminActionMessage } from "./action";

export function KillSwitchControl({ scope, scopeRef, engaged, disabled = false, disabledReason }: {
  scope: "GLOBAL" | "AGENT"; scopeRef?: string; engaged: boolean; disabled?: boolean; disabledReason?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    if (busy || disabled) return;
    setBusy(true); setError(null);
    try {
      await adminAction("/api/admin/killswitch", { body: {
        action: engaged ? "release" : "engage", scope, scope_ref: scopeRef,
        reason: engaged ? "released from owner admin" : "engaged from owner admin",
      } });
      router.refresh();
    } catch (error) { setError(adminActionMessage(error)); }
    finally { setBusy(false); }
  }
  return <span className="adm-action" aria-busy={busy}>
    <button type="button" className={engaged ? "btn btn-sm" : "btn btn-sm btn-danger"} disabled={busy || disabled} onClick={toggle} aria-label={`${engaged ? "Release" : "Engage"} ${scope === "GLOBAL" ? "global" : scopeRef ?? "agent"} stop`}>{busy ? "Updating…" : disabled ? "Control unavailable" : engaged ? "Release stop" : "Engage stop"}</button>
    {disabled && disabledReason && <span className="adm-action-message">{disabledReason}</span>}
    {error && <span className="adm-action-message adm-action-message--error" role="alert">{error}</span>}
  </span>;
}
