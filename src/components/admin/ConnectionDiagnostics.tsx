"use client";
import { useState } from "react";
import { adminAction } from "@/components/admin/action";
import { AdminStatus } from "@/components/admin/AdminUI";

type Report = { checked_at: string; mode: "local" | "database"; checks: Array<{ name: string; status: "pass" | "unavailable" | "skipped"; detail: string }> };

/** A successful HTTP status is not enough to render a connection receipt. */
export function connectionReport(value: unknown): Report | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.checked_at !== "string" || row.checked_at.length > 64 || !Number.isFinite(Date.parse(row.checked_at)) ||
      (row.mode !== "local" && row.mode !== "database") || !Array.isArray(row.checks) || row.checks.length > 20) return null;
  const checks: Report["checks"] = [];
  for (const item of row.checks) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const check = item as Record<string, unknown>;
    if (typeof check.name !== "string" || !check.name || check.name.length > 100 ||
        typeof check.detail !== "string" || !check.detail || check.detail.length > 600 ||
        !["pass", "unavailable", "skipped"].includes(String(check.status))) return null;
    checks.push({ name: check.name, detail: check.detail, status: check.status as Report["checks"][number]["status"] });
  }
  return { checked_at: row.checked_at, mode: row.mode, checks };
}

export function ConnectionDiagnostics() {
  const [pending, setPending] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  async function check() {
    setPending(true); setError("");
    try {
      const result = connectionReport(await adminAction<unknown>("/api/admin/connections/check", { body: {} }));
      if (!result) throw new Error("The server did not return a valid connection check. No new result was accepted.");
      setReport(result);
    }
    catch (err) { setError(err instanceof Error ? err.message : "The checks could not complete."); }
    finally { setPending(false); }
  }
  return <section className="console-sheet" aria-labelledby="check-heading">
    <div className="console-section-head"><div><p className="adm-kicker">Connection evidence</p><h2 id="check-heading">Run a fresh read check</h2></div><button className="btn btn-pink" type="button" disabled={pending} onClick={check}>{pending ? "Checking connections…" : "Check connections"}</button></div>
    <p className="adm-description">A bounded read of the active storage connection. This does not activate a service, change customer records or send anything to a customer.</p>
    {error && <p className="console-notice" role="alert">{error}{report ? " The previous completed result remains below." : ""}</p>}
    <div aria-live="polite" aria-busy={pending}>{report ? <>
      <p className="console-footnote">Last completed: {new Date(report.checked_at).toLocaleString()} · {report.mode === "local" ? "file runtime" : "database connection"} · {pending ? "refresh in progress" : error ? "previous result" : "read check"}</p>
      <div className="console-table-scroll" tabIndex={0} role="region" aria-label="Connection check results"><table className="adm-table"><caption className="sr-only">Connection check results</caption><thead><tr><th scope="col">Source</th><th scope="col">Result</th><th scope="col">What was verified</th></tr></thead><tbody>{report.checks.map(check => <tr key={check.name}><th scope="row">{check.name}</th><td><AdminStatus tone={check.status === "pass" ? "good" : check.status === "unavailable" ? "warning" : "neutral"}>{check.status === "pass" ? "Readable" : check.status === "skipped" ? "Not checked" : "Unavailable"}</AdminStatus></td><td>{check.detail}</td></tr>)}</tbody></table></div>
    </> : <p className="console-footnote">No check has been run in this view. Configuration alone is not connection evidence.</p>}</div>
  </section>;
}
