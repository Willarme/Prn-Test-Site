"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** A permanent, zero-effort exit. Missing facts stay explicit in the packet. */
export function FinishIntake({ requestId, ownerKey }: { requestId: string; ownerKey?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function finish() {
    setBusy(true); setError(null);
    const response = await fetch("/api/intake/finish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, k: ownerKey }),
    }).catch(() => null);
    if (!response?.ok) { setError("Could not finish just now. Your saved packet is still available."); setBusy(false); return; }
    router.push(`/results/${requestId}${ownerKey ? `?k=${encodeURIComponent(ownerKey)}` : ""}`);
  }
  return <div>
    <button type="button" className="btn btn-ghost" disabled={busy} onClick={finish} data-finish-intake>
      {busy ? "Saving…" : "Finish with what I have"}
    </button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
