"use client";

import { useState } from "react";
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

  async function act(action: "publish" | "unpublish") {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/pages/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_spec_id: pageSpecId, action }),
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
