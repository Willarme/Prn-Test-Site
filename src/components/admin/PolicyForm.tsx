"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Page-creator controls (Owner Decisions D-3/D-10 + #23 §1.3). Every change is
 * validated by the same SeoFactoryPolicy contract on the server — invalid or
 * canon-violating settings are refused with the reason.
 */
type Local = { local_target_id: string; state: string; county: string | null; target_pages_per_period: number };

export interface PolicyFormValues {
  version: number;
  national_enabled: boolean;
  national_target: number;
  locals: Local[];
  target_qualified_pages_per_period: number;
  max_new_pages_per_period: number;
  min_opportunity_score: number;
  min_search_volume: number | null;
  max_keyword_difficulty: number | null;
  discovery_scan_cadence: string;
  max_external_seo_spend_usd_month: number;
  max_page_ai_spend_usd_month: number;
  daily_publish_cap: number;
  allowed_categories: string[];
}

const US_STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const CATEGORIES = ["plumbing", "hvac", "electrical", "roofing", "appliance", "water_damage", "general_home_problem"];

export function PolicyForm({ initial, canEdit, disabledReason }: { initial: PolicyFormValues; canEdit: boolean; disabledReason: string | null }) {
  const router = useRouter();
  const [v, setV] = useState<PolicyFormValues>(initial);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const plannedTotal = (v.national_enabled ? v.national_target : 0) + v.locals.reduce((s, l) => s + l.target_pages_per_period, 0);

  function addLocal() {
    setV({ ...v, locals: [...v.locals, { local_target_id: `lt_${Date.now().toString(36)}`, state: "IN", county: null, target_pages_per_period: 5 }] });
  }
  function updateLocal(i: number, patch: Partial<Local>) {
    setV({ ...v, locals: v.locals.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  }
  function removeLocal(i: number) {
    setV({ ...v, locals: v.locals.filter((_, j) => j !== i) });
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    const res = await fetch("/api/admin/policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setStatus({ kind: "err", text: data.error ?? "Refused" });
      return;
    }
    setStatus({ kind: "ok", text: `Saved as policy version ${data.version}. The next scheduled research run uses it — no deploy needed.` });
    setV({ ...v, version: data.version });
    router.refresh();
  }

  const ro = !canEdit;
  const num = (x: number | null) => (x === null ? "" : String(x));

  return (
    <div style={{ display: "grid", gap: 26 }}>
      {ro && (
        <div className="cell">
          <span className="tag">Read-only</span>
          <p style={{ color: "var(--on-dark-mute)" }}>{disabledReason}</p>
        </div>
      )}

      <section className="card-light">
        <div className="eyebrow">Where to build pages · Owner Decision D-10</div>
        <label style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <input type="checkbox" checked={v.national_enabled} disabled={ro} onChange={(e) => setV({ ...v, national_enabled: e.target.checked })} />
          <strong>Nationwide pages</strong>
        </label>
        <div className="field" style={{ maxWidth: 260 }}>
          <label className="field-label">Nationwide pages per period</label>
          <input className="inp" type="number" min={0} disabled={ro || !v.national_enabled} value={v.national_target} onChange={(e) => setV({ ...v, national_target: Number(e.target.value) })} />
        </div>

        <h3 className="d3" style={{ margin: "18px 0 6px" }}>Local targets</h3>
        <p className="hint" style={{ marginBottom: 12 }}>
          Add as many as you like. Pick a state; optionally narrow to a county. <strong>Choosing a county automatically covers every city in that county</strong> — all cities share that entry&apos;s quota, and every city page still passes scoring, QA and your approval (no doorway spam).
        </p>
        {v.locals.map((l, i) => (
          <div key={l.local_target_id} style={{ display: "grid", gridTemplateColumns: "120px 1fr 160px auto", gap: 10, alignItems: "end", marginBottom: 10 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">State</label>
              <select className="inp" disabled={ro} value={l.state} onChange={(e) => updateLocal(i, { state: e.target.value })}>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">County (blank = whole state)</label>
              <input className="inp" disabled={ro} placeholder="e.g. Allen" value={l.county ?? ""} onChange={(e) => updateLocal(i, { county: e.target.value.trim() === "" ? null : e.target.value })} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">Pages per period</label>
              <input className="inp" type="number" min={0} disabled={ro} value={l.target_pages_per_period} onChange={(e) => updateLocal(i, { target_pages_per_period: Number(e.target.value) })} />
            </div>
            <button className="btn btn-ghost btn-sm" disabled={ro} onClick={() => removeLocal(i)}>Remove</button>
          </div>
        ))}
        <button className="btn btn-ghost btn-sm" disabled={ro} onClick={addLocal}>+ Add local target</button>
        <p className="hint" style={{ marginTop: 14 }}>
          Planned pages per period: <strong>{plannedTotal}</strong> (hard maximum below: {v.max_new_pages_per_period}). Local targets are executed once vendor geo mapping lands; until then they are counted and reported.
        </p>
      </section>

      <section className="card-light">
        <div className="eyebrow">Volume and quality</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          <div className="field"><label className="field-label">Target qualified pages / period</label><input className="inp" type="number" min={0} disabled={ro} value={v.target_qualified_pages_per_period} onChange={(e) => setV({ ...v, target_qualified_pages_per_period: Number(e.target.value) })} /><p className="hint">A goal, never a command to make weak pages.</p></div>
          <div className="field"><label className="field-label">Hard maximum / period</label><input className="inp" type="number" min={0} disabled={ro} value={v.max_new_pages_per_period} onChange={(e) => setV({ ...v, max_new_pages_per_period: Number(e.target.value) })} /><p className="hint">The brake.</p></div>
          <div className="field"><label className="field-label">Minimum opportunity score (0-100)</label><input className="inp" type="number" min={0} max={100} disabled={ro} value={v.min_opportunity_score} onChange={(e) => setV({ ...v, min_opportunity_score: Number(e.target.value) })} /></div>
          <div className="field"><label className="field-label">Minimum monthly volume (blank = none)</label><input className="inp" type="number" min={0} disabled={ro} value={num(v.min_search_volume)} onChange={(e) => setV({ ...v, min_search_volume: e.target.value === "" ? null : Number(e.target.value) })} /></div>
          <div className="field"><label className="field-label">Maximum keyword difficulty (blank = none)</label><input className="inp" type="number" min={0} max={100} disabled={ro} value={num(v.max_keyword_difficulty)} onChange={(e) => setV({ ...v, max_keyword_difficulty: e.target.value === "" ? null : Number(e.target.value) })} /></div>
          <div className="field"><label className="field-label">Research cadence</label><select className="inp" disabled={ro} value={v.discovery_scan_cadence} onChange={(e) => setV({ ...v, discovery_scan_cadence: e.target.value })}>{["daily", "weekly", "monthly", "quarterly"].map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        </div>
        <div className="field">
          <label className="field-label">Allowed problem categories</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CATEGORIES.map((c) => {
              const on = v.allowed_categories.includes(c);
              return (
                <button key={c} type="button" className="chip" aria-pressed={on} disabled={ro} onClick={() => setV({ ...v, allowed_categories: on ? v.allowed_categories.filter((x) => x !== c) : [...v.allowed_categories, c] })}>
                  {c}
                </button>
              );
            })}
          </div>
          <p className="hint">Keep &ldquo;general_home_problem&rdquo; on to allow keywords whose category isn&apos;t recognized yet.</p>
        </div>
      </section>

      <section className="card-light">
        <div className="eyebrow">Money</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          <div className="field"><label className="field-label">Max search-data spend / month ($)</label><input className="inp" type="number" min={0} disabled={ro} value={v.max_external_seo_spend_usd_month} onChange={(e) => setV({ ...v, max_external_seo_spend_usd_month: Number(e.target.value) })} /><p className="hint">Research stops cleanly at this cap.</p></div>
          <div className="field"><label className="field-label">Max page-AI spend / month ($)</label><input className="inp" type="number" min={0} disabled={ro} value={v.max_page_ai_spend_usd_month} onChange={(e) => setV({ ...v, max_page_ai_spend_usd_month: Number(e.target.value) })} /></div>
          <div className="field"><label className="field-label">Daily publish cap</label><input className="inp" type="number" min={0} disabled={ro} value={v.daily_publish_cap} onChange={(e) => setV({ ...v, daily_publish_cap: Number(e.target.value) })} /></div>
        </div>
        <p className="hint">Human publish approval stays ON for the whole trial — it cannot be switched off from here (canon).</p>
      </section>

      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <button className="btn btn-pink" disabled={ro || busy} onClick={save}>{busy ? "Saving…" : `Save as version ${v.version + 1}`}</button>
        {status && <span style={{ color: status.kind === "ok" ? "var(--green-bright)" : "var(--amber)" }}>{status.text}</span>}
      </div>
    </div>
  );
}
