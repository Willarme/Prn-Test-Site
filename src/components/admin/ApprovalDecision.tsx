"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The owner's approve / reject control for one Approval Center item.
 *
 * Takes only strings as props and talks to one owner-gated API route. It
 * imports nothing from platform/* — the approval queue, the run ledger and the
 * event dictionary are all server-only, and the client-boundary tests enforce
 * that. What the browser gets is an id and a label.
 */
export function ApprovalDecision({
  approvalId,
  kind,
  status,
}: {
  approvalId: string;
  kind: string | null;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/approvals/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval_id: approvalId, decision }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(data.error ?? "Refused");
      return;
    }
    if (data.repair && data.repair.outcome !== "executed" && data.repair.outcome !== "rejected") {
      // The decision landed but the repair did not run. Say so rather than
      // letting a green refresh imply it did.
      setMsg(`Decision recorded — repair ${data.repair.outcome}: ${(data.repair.reasons ?? []).join("; ")}`);
    }
    router.refresh();
  }

  if (status !== "PENDING") {
    return (
      <span className="hint" style={{ color: "var(--on-dark-mute)" }}>
        {status.toLowerCase()}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button
        className="btn btn-pink btn-sm"
        disabled={busy}
        onClick={() => decide("approve")}
        title={
          kind === "data.repair"
            ? "Approve and run the repair. It is reversible and every step is recorded."
            : "Approve this item."
        }
      >
        Approve
      </button>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => decide("reject")}>
        Reject
      </button>
      {msg && (
        <span className="hint" style={{ color: "var(--amber)" }}>
          {msg}
        </span>
      )}
    </span>
  );
}
