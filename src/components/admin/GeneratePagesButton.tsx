"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * THE PAGE MAKER BUTTON — the admin's trigger for A05, the Page Factory.
 *
 * The backend route (/api/admin/pages/generate) has existed since the loop
 * build, but nothing in the admin UI called it: the owner could approve
 * opportunities and watch the Pages queue, yet the step between the two —
 * "build the pages I approved" — lived only in the CLI. This button closes
 * that gap, deliberately boring: POST, show the server's own counts, refresh
 * the server-rendered queue. It invents nothing client-side.
 *
 * OMIT opportunityId to run every owner-approved opportunity (the route is
 * idempotent per opportunity — an opportunity that already has a page comes
 * back as a skip, so "build all" and "build one" are safe to press twice).
 *
 * WHAT IT CANNOT DO, BY THE ROUTE'S OWN CONTRACT: publish. Generation stages
 * pages at qa PENDING; A06 QA and the owner's separate Approve & publish
 * still stand between a draft and the public site.
 */
export function GeneratePagesButton({ opportunityId }: { opportunityId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function build() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    const res = await fetch("/api/admin/pages/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        opportunityId ? { search_opportunity_id: opportunityId } : {}
      ),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      staged?: number;
      skipped?: number;
      message?: string;
      error?: string;
      skipped_detail?: Array<{ search_opportunity_id: string; reason: string }>;
    };
    setBusy(false);
    if (!res.ok) {
      setErr(data.error ?? "Refused");
      return;
    }
    const staged = data.staged ?? 0;
    const skipped = data.skipped ?? 0;
    if (staged === 0 && skipped === 0 && data.message) {
      setMsg(data.message);
      return;
    }
    const parts: string[] = [`${staged} page${staged === 1 ? "" : "s"} staged`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    setMsg(parts.join(" · ") + " — now QA-pending in the queue below.");
    router.refresh();
  }

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn btn-pink btn-sm" disabled={busy} onClick={build}>
        {busy
          ? "Building…"
          : opportunityId
            ? "Build page"
            : "Build pages from approved opportunities"}
      </button>
      {msg && (
        <span className="hint" style={{ color: "var(--green)", maxWidth: 480 }}>
          {msg}
        </span>
      )}
      {err && (
        <span className="hint" style={{ color: "var(--amber)", maxWidth: 480 }}>
          {err}
        </span>
      )}
    </span>
  );
}
