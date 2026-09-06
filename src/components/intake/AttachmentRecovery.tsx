"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** A failed door upload can be retried without creating another request. */
export function AttachmentRecovery({ requestId, ownerKey }: { requestId: string; ownerKey?: string }) {
  const router = useRouter();
  const [kind, setKind] = useState("door_photo");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function retry(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true);
    let saved = 0;
    let error = "";
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.set("request_id", requestId);
      form.set("target", kind);
      form.set("file", file);
      if (ownerKey) form.set("k", ownerKey);
      const response = await fetch("/api/intake/media", { method: "POST", body: form }).catch(() => null);
      const receipt = await response?.json().catch(() => null);
      if (response?.ok && receipt?.ok) saved += 1;
      else error = receipt?.error || "An attachment could not be saved. Try again.";
    }
    setBusy(false);
    setMessage([saved ? `${saved} attachment${saved === 1 ? "" : "s"} saved to your packet.` : "", error].filter(Boolean).join(" "));
    if (saved) router.refresh();
  }
  return <div className="card-light" style={{ marginBottom: 20 }}>
    <p role="alert" style={{ marginBottom: 12 }}>Your description is saved. One or more attachments could not be saved. You can add them again here.</p>
    <label htmlFor="retry-kind" className="hint">Attachment type</label>{" "}
    <select id="retry-kind" className="inp" style={{ margin: "6px 0 12px" }} value={kind} disabled={busy} onChange={e => setKind(e.target.value)}>
      <option value="door_photo">Photos</option><option value="door_video">Video</option><option value="voice_note">Voice note</option>
    </select>
    <label htmlFor="retry-attachment" className="hint">Try the attachment again</label>
    <input id="retry-attachment" className="inp" style={{ marginTop: 6 }} type="file" disabled={busy} multiple={kind === "door_photo"}
      accept={kind === "voice_note" ? "audio/*" : kind === "door_video" ? "video/*" : "image/*"}
      onChange={e => { void retry(e.target.files); e.target.value = ""; }} />
    {busy && <p role="status">Saving the attachment…</p>}
    {message && <p role="status" style={{ marginTop: 10 }}>{message}</p>}
  </div>;
}
