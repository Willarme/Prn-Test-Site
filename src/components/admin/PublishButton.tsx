"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { adminAction, adminActionMessage } from "./action";

export function PublishButton({ pageSpecId, published, canPublish, disabledReason }: {
  pageSpecId: string; published: boolean; canPublish: boolean; disabledReason: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // This bounded server input measures time on this control, not total owner work.
  const shownAt = useRef(Date.now());
  async function act(action: "publish" | "unpublish") {
    if (busy) return;
    setBusy(true); setMsg(null); setFailed(false);
    try {
      await adminAction("/api/admin/pages/publish", { body: {
        page_spec_id: pageSpecId, action, owner_ms: Math.min(4 * 60 * 60 * 1000, Math.max(1, Date.now() - shownAt.current)),
      } });
      setMsg(action === "publish" ? "Published state recorded." : "Removed from the published set.");
      router.refresh();
    } catch (error) { setFailed(true); setMsg(adminActionMessage(error)); }
    finally { setBusy(false); }
  }
  if (!canPublish) return <span className="adm-small">{disabledReason}</span>;
  return <span className="adm-action" aria-busy={busy}><button type="button" className={published ? "btn btn-ghost btn-sm" : "btn btn-sm"} disabled={busy} onClick={() => act(published ? "unpublish" : "publish")}>{busy ? "Recording…" : published ? "Unpublish" : "Approve & publish"}</button>{msg && <span className={`adm-action-message${failed ? " adm-action-message--error" : ""}`} role={failed ? "alert" : "status"}>{msg}</span>}</span>;
}
