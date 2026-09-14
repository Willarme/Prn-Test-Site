"use client";
import { useEffect, useState } from "react";
import { adminAction, adminActionMessage } from "./action";
import { AdminStatus } from "./AdminUI";
import type { FeatureAdminView } from "@/platform/features/admin";
import type { FeatureState } from "@/domain/features/types";
import type { FeaturePreset } from "@/platform/features/state";
import styles from "./features.module.css";

export function FeatureControls({ initial }: { initial: FeatureAdminView }) {
  const [view, setView] = useState(initial);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function refresh() {
    const response = await fetch("/api/admin/features", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error("Feature state could not be refreshed. Check your sign-in and try again.");
    setView(await response.json() as FeatureAdminView);
  }
  useEffect(() => {
    const timer = setInterval(() => { if (!busy) void refresh().catch(() => setError("Live refresh is unavailable. Refresh before making another change.")); }, 30_000);
    return () => clearInterval(timer);
  }, [busy]);
  async function save(featureId?: string, state?: FeatureState, preset?: FeaturePreset) {
    if (reason.trim().length < 3) { setError("Add a short reason for this change."); return; }
    setBusy(true); setError(""); setMessage("");
    const feature = view.features.find(item => item.id === featureId);
    const body = preset ? { mode: "preset", preset, expected_versions: Object.fromEntries(view.features.map(item => [item.id, item.version])), reason } :
      { mode: "changes", changes: [{ feature_id: featureId, state, expected_version: feature?.version }], reason };
    try {
      const result = await adminAction<FeatureAdminView & { ok: boolean }>("/api/admin/features", { method: "PUT", body });
      setView(result); setMessage("Saved. Customer pages will reflect this state within 30 seconds.");
    } catch (failure) { setError(adminActionMessage(failure)); }
    finally { setBusy(false); }
  }
  return <div className={styles.features}>
    <section className={styles.scope} aria-labelledby="feature-scope-title">
      <div><p className="adm-kicker">The launch vocabulary</p><h2 id="feature-scope-title">Hidden means absent</h2><p><strong>HIDDEN FOR NOW</strong> always means <strong>HIDDEN</strong>: no functional links, routes or controls. The four separate product explanation pages can be <strong>PREVIEW</strong>, with optional interest capture.</p><p className="adm-small">TO BUILD and YOURS stay unset until their implementation or supplied design is ready. COMING OUT stays hidden and retired. LIVE makes a built feature available; it does not activate AI, change budgets or lift noindex.</p></div>
      <AdminStatus tone={view.verified ? "good" : "danger"}>{view.verified ? "Stored state verified" : "Storage unavailable"}</AdminStatus>
    </section>
    <section className={styles.controls} aria-label="Feature changes">
      <label htmlFor="feature-reason">Reason for the next change<textarea id="feature-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={2} placeholder="Describe why this state is changing. Do not include personal information." /></label>
      <div className={styles.buttons}>
        <button disabled={busy || !view.verified} onClick={() => void save(undefined, undefined, "launch")}>Apply launch scope</button>
        <button disabled={busy || !view.verified} onClick={() => void save(undefined, undefined, "show_all")}>Show all built features (live)</button>
        <button disabled={busy || !view.verified} onClick={() => void save(undefined, undefined, "preview_only")}>Hide all but product explanations</button>
        <button disabled={busy} onClick={() => void refresh().then(() => setError("")).catch(failure => setError(adminActionMessage(failure)))}>Refresh state</button>
      </div>
      {message && <p role="status">{message}</p>}{error && <p role="alert" className={styles.error}>{error}</p>}
    </section>
    {["Launch", "Product previews", "Hidden for now", "Retired"].map(group => <section key={group} className={styles.group}>
      <div className={styles.groupTitle}><h2>{group}</h2><span>{view.features.filter(item => item.group === group).length} features</span></div>
      <div className="adm-table-scroll" tabIndex={0} role="region" aria-label={`${group} feature states`}><table><thead><tr><th>Feature</th><th>Launch word</th><th>Stored state</th><th>Interest</th><th>Last change</th></tr></thead><tbody>
        {view.features.filter(item => item.group === group).map(feature => {
          const unavailable = feature.launch_word === "TO BUILD" || feature.launch_word === "YOURS" || feature.group === "Retired" || feature.live_eligible === false;
          return <tr key={feature.id}><td><strong>{feature.label}</strong>{feature.marketing_path && <div><a href={feature.marketing_path}>Open explanation ↗</a></div>}</td><td><span className="adm-small">{feature.launch_word}</span></td><td>
            <select aria-label={`State for ${feature.label}`} value={feature.state} disabled={busy || !view.verified || unavailable} onChange={event => void save(feature.id, event.target.value as FeatureState)}><option value="HIDDEN">HIDDEN</option>{feature.marketing_path && <option value="PREVIEW">PREVIEW</option>}<option value="LIVE">LIVE</option></select>
            <div className="adm-small">{feature.recorded ? `Version ${feature.version}` : "Unset · hidden"}</div>
            {feature.live_eligible === false && <div className="adm-small">After launch · implementation remains open</div>}
          </td><td>{feature.interest ? <><strong>{feature.interest.total}</strong><div className="adm-small">Yes {feature.interest.yes} · Maybe {feature.interest.maybe} · No {feature.interest.no}</div></> : "Unavailable"}</td><td><div>{feature.reason ?? "No saved change"}</div><div className="adm-small">{feature.actor ?? "—"}{feature.updated_at ? ` · ${feature.updated_at.replace("T", " ").replace(/\.\d+Z$/, " UTC").replace(/Z$/, " UTC")}` : ""}</div>{feature.decision_ref && <div className="adm-small">{feature.decision_ref}</div>}</td></tr>;
        })}
      </tbody></table></div>
    </section>)}
  </div>;
}
