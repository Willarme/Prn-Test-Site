"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The engage/release control for one kill switch. Posts to the admin-gated
 * API route and refreshes so the server-rendered state re-reads from the
 * same store the gateway checks — the button can never disagree with what
 * actually kills calls.
 */
export function KillSwitchControl({
  scope,
  scopeRef,
  engaged,
}: {
  scope: "GLOBAL" | "AGENT";
  scopeRef?: string;
  engaged: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/killswitch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: engaged ? "release" : "engage",
        scope,
        scope_ref: scopeRef,
        reason: engaged ? "released from owner admin" : "engaged from owner admin",
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "The switch did not move");
      return;
    }
    router.refresh();
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <button className={engaged ? "btn btn-sm" : "btn btn-sm btn-pink"} disabled={busy} onClick={toggle}>
        {busy ? "Moving…" : engaged ? "Release" : "Engage"}
      </button>
      {error && (
        <span role="alert" style={{ color: "#ff8f8f", fontSize: ".8rem" }}>
          {error}
        </span>
      )}
    </span>
  );
}
