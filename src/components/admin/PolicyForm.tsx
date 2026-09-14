"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { adminAction, adminActionMessage } from "./action";

type Local = { local_target_id: string; state: string; county: string | null; target_pages_per_period: number };
export interface PolicyFormValues {
  version: number; national_enabled: boolean; national_target: number; locals: Local[];
  target_qualified_pages_per_period: number; max_new_pages_per_period: number;
  min_opportunity_score: number; min_search_volume: number | null; max_keyword_difficulty: number | null;
  discovery_scan_cadence: string; max_external_seo_spend_usd_month: number;
  max_page_ai_spend_usd_month: number; daily_publish_cap: number; allowed_categories: string[];
}
const US_STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const CATEGORIES = ["plumbing", "hvac", "electrical", "roofing", "appliance", "water_damage", "general_home_problem"];

function NumberField({ id, label, value, onChange, disabled, max, hint, step = 1 }: {
  id: string; label: string; value: number | null; onChange: (value: string) => void;
  disabled: boolean; max?: number; hint?: string; step?: number | "any";
}) {
  return <div className="field"><label className="field-label" htmlFor={id}>{label}</label><input id={id} className="inp" type="number" min={0} max={max} step={step} disabled={disabled} value={value ?? ""} onChange={event => onChange(event.target.value)} aria-describedby={hint ? id + "-hint" : undefined} />{hint && <p className="hint" id={id + "-hint"}>{hint}</p>}</div>;
}

export function PolicyForm({ initial, canEdit, disabledReason }: { initial: PolicyFormValues; canEdit: boolean; disabledReason: string | null }) {
  const router = useRouter();
  const prefix = useId();
  const [v, setV] = useState<PolicyFormValues>(initial);
  const [saved, setSaved] = useState<PolicyFormValues>(initial);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const readOnly = !canEdit || busy;
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);
  const plannedTotal = (v.national_enabled ? v.national_target : 0) + v.locals.reduce((sum, local) => sum + local.target_pages_per_period, 0);
  function patch(update: Partial<PolicyFormValues>) { setV(current => ({ ...current, ...update })); }
  function updateLocal(index: number, update: Partial<Local>) { patch({ locals: v.locals.map((local, i) => i === index ? { ...local, ...update } : local) }); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || busy || !dirty) return;
    setBusy(true); setStatus(null);
    try {
      const data = await adminAction<{ version: number }>("/api/admin/policy", { method: "PUT", body: v });
      if (!Number.isInteger(data.version)) throw new Error("The save result did not include a policy version. Reload to verify before saving again.");
      const next = { ...v, version: data.version };
      setV(next); setSaved(next);
      setStatus({ kind: "ok", text: `Policy version ${data.version} saved. Subsequent runs use this policy.` });
      router.refresh();
    } catch (error) { setStatus({ kind: "err", text: adminActionMessage(error) }); }
    finally { setBusy(false); }
  }

  return <form method="post" action="/api/admin/policy" onSubmit={save} className="adm-policy-form" style={{ display: "grid", gap: 24 }} aria-busy={busy}>
    {!canEdit && <div className="cell"><span className="tag">Read-only</span><p>{disabledReason}</p></div>}
    <section className="card-light" aria-labelledby={prefix + "-geography"}>
      <h2 className="eyebrow" id={prefix + "-geography"}>01 / Geography</h2>
      <label style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}><input type="checkbox" checked={v.national_enabled} disabled={readOnly} onChange={event => patch({ national_enabled: event.target.checked })} /><strong>Nationwide pages</strong></label>
      <div style={{ maxWidth: 280 }}><NumberField id={prefix + "-national"} label="Nationwide pages per period" value={v.national_target} onChange={value => patch({ national_target: Number(value) })} disabled={readOnly || !v.national_enabled} /></div>
      <h3 className="d3" style={{ margin: "24px 0 8px" }}>Local targets</h3>
      <p className="hint" style={{ marginBottom: 18 }}>Choose a state and, optionally, a county. A county entry shares its quota across its cities. Local targets are counted and reported; execution depends on vendor geography mapping.</p>
      {v.locals.length === 0 && <p className="adm-small">No local targets in this policy.</p>}
      {v.locals.map((local, i) => <div key={local.local_target_id} className="adm-policy-local">
        <div className="field" style={{ marginBottom: 0 }}><label className="field-label" htmlFor={prefix + "-state-" + i}>State</label><select id={prefix + "-state-" + i} className="inp" disabled={readOnly} value={local.state} onChange={event => updateLocal(i, { state: event.target.value })}>{US_STATES.map(state => <option key={state} value={state}>{state}</option>)}</select></div>
        <div className="field" style={{ marginBottom: 0 }}><label className="field-label" htmlFor={prefix + "-county-" + i}>County (optional)</label><input id={prefix + "-county-" + i} className="inp" disabled={readOnly} placeholder="Whole state" value={local.county ?? ""} onChange={event => updateLocal(i, { county: event.target.value.trim() ? event.target.value : null })} /></div>
        <NumberField id={prefix + "-quota-" + i} label="Pages per period" value={local.target_pages_per_period} onChange={value => updateLocal(i, { target_pages_per_period: Number(value) })} disabled={readOnly} />
        <button type="button" className="btn btn-ghost btn-sm" disabled={readOnly} onClick={() => patch({ locals: v.locals.filter((_, index) => index !== i) })} aria-label={`Remove ${local.county ? local.county + ", " : ""}${local.state} target`}>Remove</button>
      </div>)}
      <button type="button" className="btn btn-ghost btn-sm" disabled={readOnly} onClick={() => patch({ locals: [...v.locals, { local_target_id: `lt_${Date.now().toString(36)}`, state: "IN", county: null, target_pages_per_period: 5 }] })}>Add local target</button>
      <p className="hint" style={{ marginTop: 18 }}>Planned pages per period: <strong>{plannedTotal}</strong> / hard maximum <strong>{v.max_new_pages_per_period}</strong>.</p>
    </section>
    <section className="card-light" aria-labelledby={prefix + "-quality"}>
      <h2 className="eyebrow" id={prefix + "-quality"}>02 / Volume and quality</h2>
      <div className="adm-policy-fields">
        <NumberField id={prefix + "-target"} label="Target qualified pages per period" value={v.target_qualified_pages_per_period} onChange={value => patch({ target_qualified_pages_per_period: Number(value) })} disabled={readOnly} hint="A goal. Every page still has to pass its quality gates." />
        <NumberField id={prefix + "-maximum"} label="Hard maximum per period" value={v.max_new_pages_per_period} onChange={value => patch({ max_new_pages_per_period: Number(value) })} disabled={readOnly} />
        <NumberField id={prefix + "-score"} label="Minimum opportunity score" value={v.min_opportunity_score} onChange={value => patch({ min_opportunity_score: Number(value) })} disabled={readOnly} max={100} step="any" />
        <NumberField id={prefix + "-volume"} label="Minimum monthly volume (optional)" value={v.min_search_volume} onChange={value => patch({ min_search_volume: value === "" ? null : Number(value) })} disabled={readOnly} />
        <NumberField id={prefix + "-difficulty"} label="Maximum keyword difficulty (optional)" value={v.max_keyword_difficulty} onChange={value => patch({ max_keyword_difficulty: value === "" ? null : Number(value) })} disabled={readOnly} max={100} step="any" />
        <div className="field"><label className="field-label" htmlFor={prefix + "-cadence"}>Requested research cadence</label><select id={prefix + "-cadence"} className="inp" disabled={readOnly} value={v.discovery_scan_cadence} onChange={event => patch({ discovery_scan_cadence: event.target.value })}>{["daily", "weekly", "monthly", "quarterly"].map(cadence => <option key={cadence} value={cadence}>{cadence}</option>)}</select><p className="hint">This setting does not create a scheduler.</p></div>
      </div>
      <fieldset className="adm-policy-categories"><legend className="field-label">Allowed problem categories</legend><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{CATEGORIES.map(category => {
        const selected = v.allowed_categories.includes(category);
        return <button key={category} type="button" className="chip" aria-pressed={selected} disabled={readOnly} onClick={() => patch({ allowed_categories: selected ? v.allowed_categories.filter(item => item !== category) : [...v.allowed_categories, category] })}>{category.replaceAll("_", " ")}</button>;
      })}</div><p className="hint">General home problem allows keywords whose category is not recognized yet.</p></fieldset>
    </section>
    <section className="card-light" aria-labelledby={prefix + "-limits"}>
      <h2 className="eyebrow" id={prefix + "-limits"}>03 / Spending and release limits</h2>
      <div className="adm-policy-fields">
        <NumberField id={prefix + "-search-spend"} label="Search-data limit per month ($)" value={v.max_external_seo_spend_usd_month} onChange={value => patch({ max_external_seo_spend_usd_month: Number(value) })} disabled={readOnly} step="any" />
        <NumberField id={prefix + "-ai-spend"} label="Page AI limit per month ($)" value={v.max_page_ai_spend_usd_month} onChange={value => patch({ max_page_ai_spend_usd_month: Number(value) })} disabled={readOnly} step="any" />
        <NumberField id={prefix + "-publish-cap"} label="Daily publish cap" value={v.daily_publish_cap} onChange={value => patch({ daily_publish_cap: Number(value) })} disabled={readOnly} />
      </div>
      <p className="hint">Existing release and spending gates remain enforced by the server. Changing a limit does not publish a page.</p>
    </section>
    <div className="adm-policy-actions"><button type="submit" className="btn" disabled={!canEdit || busy || !dirty}>{busy ? "Saving policy…" : `Save version ${v.version + 1}`}</button><span className="adm-small">{dirty ? "Unsaved changes · current version " + saved.version : "No unsaved changes · version " + v.version}</span>{status && <span className={`adm-action-message${status.kind === "err" ? " adm-action-message--error" : ""}`} role={status.kind === "err" ? "alert" : "status"}>{status.text}</span>}</div>
  </form>;
}
