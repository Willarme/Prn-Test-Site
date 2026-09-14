"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminAction, adminActionMessage } from "./action";

type GenerationResult = { staged?: number; skipped?: number; message?: string; skipped_detail?: Array<{ search_opportunity_id: string; reason: string }> };
export function GeneratePagesButton({ opportunityId }: { opportunityId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function build() {
    if (busy) return;
    setBusy(true); setMsg(null); setErr(null);
    try {
      const data = await adminAction<GenerationResult>("/api/admin/pages/generate", { body: opportunityId ? { search_opportunity_id: opportunityId } : {} });
      const staged = data.staged ?? 0;
      const skipped = data.skipped ?? 0;
      setMsg(staged === 0 && skipped === 0 && data.message ? data.message : `${staged} page${staged === 1 ? "" : "s"} staged${skipped ? ` · ${skipped} skipped` : ""}. Review the current QA verdicts in Pages.`);
      router.refresh();
    } catch (error) { setErr(adminActionMessage(error)); }
    finally { setBusy(false); }
  }
  return <span className="adm-action" aria-busy={busy}>
    <button type="button" className="btn btn-sm" disabled={busy} onClick={build}>{busy ? "Building drafts…" : opportunityId ? "Build page" : "Build approved opportunities"}</button>
    {msg && <span className="adm-action-message" role="status">{msg}</span>}
    {err && <span className="adm-action-message adm-action-message--error" role="alert">{err}</span>}
  </span>;
}
