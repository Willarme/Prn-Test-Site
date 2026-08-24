"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The owner's accept / reject / defer control for one search opportunity.
 *
 * THE CLIENT BOUNDARY IS THE POINT. This component receives an opportunity
 * ID and a status STRING — nothing else. No score, no score components, no
 * recommendation reasoning, no policy thresholds, no row object. The scoring
 * formula and the candidate queue's internals stay on the server, where the
 * client-boundary tests keep them (Loop Spec Audit condition 10: this is the
 * one place A04 could regress into the DiagnoseWalkthrough View-Source leak
 * class, where a 19-step playbook graph shipped in the page payload).
 *
 * It imports nothing from platform/* or domain/* and talks to exactly one
 * owner-gated API route.
 */
export function OpportunityDecision({
  opportunityId,
  status,
}: {
  opportunityId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function decide(decision: "accept" | "reject" | "defer") {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/opportunities/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search_opportunity_id: opportunityId, decision }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(data.error ?? "Refused");
      return;
    }
    router.refresh();
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {status !== "approved" && (
        <button
          className="btn btn-pink btn-sm"
          disabled={busy}
          onClick={() => decide("accept")}
          title="Accept: this becomes eligible for page building. It does not create or publish a page."
        >
          Accept
        </button>
      )}
      {status !== "rejected" && (
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => decide("reject")}>
          Reject
        </button>
      )}
      {status !== "watch" && (
        <button
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => decide("defer")}
          title="Defer: decide later. It stays in the Approval Center as a to-do."
        >
          Defer
        </button>
      )}
      {msg && (
        <span className="hint" style={{ color: "var(--amber)" }}>
          {msg}
        </span>
      )}
    </span>
  );
}
