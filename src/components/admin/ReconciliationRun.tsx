"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The owner's "run the reconciliation pass now" control, for the A09 section of
 * the cockpit.
 *
 * Takes no props and talks to one owner-gated API route. It imports nothing
 * from platform/* — the quality store, the run ledger and the check set are all
 * server-only, and the client-boundary tests enforce that. What the browser
 * gets is a button and whatever the route says back.
 *
 * IT REPORTS THE VERDICT, NEVER A GREEN TICK BY DEFAULT. A09's whole point is
 * that "we looked and found nothing" and "we could not look" must never render
 * alike, so `could_not_verify` gets the amber COULD NOT VERIFY treatment the
 * rest of this section already uses, and an incomplete scan says so in words.
 */
export function ReconciliationRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tone, setTone] = useState<"ok" | "warn">("ok");

  async function run() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/quality/reconcile", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setTone("warn");
      setMsg(data.error ?? "Refused");
      return;
    }

    if (data.verdict === "could_not_verify") {
      setTone("warn");
      setMsg(
        data.scan_complete
          ? "COULD NOT VERIFY — the pass ran but lost one or more of its own writes. Read the numbers above as unknown, not clean."
          : "COULD NOT VERIFY — the backend could not enumerate every row a sweep needs, so this is not a clean bill of health."
      );
      router.refresh();
      return;
    }

    setTone("ok");
    setMsg(
      data.findings > 0
        ? `${data.checks_run} checks · ${data.findings} finding(s) raised · ${data.quarantined} quarantined`
        : `${data.checks_run} checks · nothing to report`
    );
    router.refresh();
  }

  return (
    <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <button
        className="btn btn-ghost btn-sm"
        disabled={busy}
        onClick={run}
        title="Run the four cross-checks over stored records and the event stream. It only ever flags and quarantines — nothing is deleted and nothing is repaired without your approval."
      >
        {busy ? "Running…" : "Run reconciliation now"}
      </button>
      {msg && (
        <span
          className="hint"
          style={{ color: tone === "warn" ? "var(--amber)" : "var(--on-dark-mute)" }}
        >
          {msg}
        </span>
      )}
    </span>
  );
}
