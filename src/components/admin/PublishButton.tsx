"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function PublishButton({
  pageSpecId,
  published,
  canPublish,
  disabledReason,
}: {
  pageSpecId: string;
  published: boolean;
  canPublish: boolean;
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  /**
   * OWNER HOURS, MEASURED WHERE IT ACTUALLY HAPPENS (Trial Spec Audit §4 item
   * 5). A10's Owner Hours is the number the one-person-company constraint
   * answers to, and it was permanently uncomputable because nothing anywhere
   * recorded a duration. The server cannot know how long a person looked at a
   * decision; this control can. Elapsed time from render to click, sent with
   * the action and stored on the audit row — the server bounds it, because a
   * browser-supplied number is untrusted input.
   */
  const shownAt = useRef(Date.now());

  async function act(action: "publish" | "unpublish") {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/pages/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page_spec_id: pageSpecId,
        action,
        owner_ms: Math.max(1, Date.now() - shownAt.current),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(data.error ?? "Refused");
      return;
    }
    router.refresh();
  }

  if (!canPublish) {
    return <span className="hint" style={{ color: "var(--on-dark-mute)" }}>{disabledReason}</span>;
  }
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      {published ? (
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act("unpublish")}>
          Unpublish
        </button>
      ) : (
        <button className="btn btn-pink btn-sm" disabled={busy} onClick={() => act("publish")}>
          Approve &amp; publish
        </button>
      )}
      {msg && <span className="hint" style={{ color: "var(--amber)" }}>{msg}</span>}
    </span>
  );
}
