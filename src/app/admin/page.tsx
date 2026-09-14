import Link from "next/link";
import { adminGate } from "@/components/admin/AdminGate";
import { AdminPageHeader, AdminStatus } from "@/components/admin/AdminUI";
import { ReconciliationRun } from "@/components/admin/ReconciliationRun";
import { readConsoleSnapshot, consoleAttention, formatObservationTime } from "@/platform/admin/console-data";
import "./console.css";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const gate = await adminGate();
  if (gate) return gate;
  const data = await readConsoleSnapshot();
  const attention = consoleAttention(data);
  const critical = attention.some(a => a.severity === "danger");
  const warning = attention.some(a => a.severity === "warning");
  const quality = data.quality.value;
  const ready = data.releases.value?.filter(row => row.decision.release_eligible).length;
  const held = data.releases.value?.filter(row => !row.decision.release_eligible).length;
  const policy = data.policy.value;
  const spend = data.spend.value;
  const progress = policy && spend && policy.global_daily_budget_usd > 0 ? Math.min(100, (spend.total_usd / policy.global_daily_budget_usd) * 100) : null;
  const activeRuns = data.runs.value?.rows ?? [];
  const legacyVersions = data.releases.value?.filter(row => !row.spec.door_template).length ?? 0;

  return <div className="console-overview">
    <AdminPageHeader eyebrow="Company / Operating brief" title="A clear view. A deliberate next move."
      description="The work, the exceptions and the evidence behind them."
      meta={"Observed " + formatObservationTime(data.observed_at) + " · " + (data.storage === "file" ? "Local demonstration" : data.storage === "supabase" ? "Configured database" : "Storage unavailable")}
      actions={<Link className="btn btn-teal" href="/demo">Open demo <span aria-hidden>↗</span></Link>} />

    <section className="console-brief" aria-labelledby="brief-title">
      <div className="console-brief-copy">
        <div className="console-kicker"><span className={"console-signal " + (critical ? "is-danger" : warning ? "is-warning" : "")} aria-hidden /> CURRENT OPERATING PICTURE</div>
        <h2 id="brief-title">{critical ? "An exception needs attention." : warning ? "A closer look is needed." : "The trial is taking shape."}</h2>
        <p>{attention[0].detail}</p>
        <Link href={attention[0].href}>{attention[0].title} <span aria-hidden>→</span></Link>
      </div>
      <div className="console-brief-aside">
        <span className="console-kicker">OPERATING BOUNDARY</span>
        <strong>{data.storage === "file" ? "Local working demo" : data.storage === "supabase" ? "Database-backed runtime" : "Storage not verified"}</strong>
        <p>{data.storage === "file" ? "Example journeys and saved run receipts. These counts are not production customers." : "Storage configuration is shown separately from observed connectivity and schema readiness."}</p>
        <span className="console-tag">Trial · indexing held</span>
      </div>
    </section>

    <section className="console-metrics" aria-label="Measured operating summaries">
      <Link className="console-metric" href="/admin/requests"><span>Requests in view</span><strong>{data.requests.value?.included ?? "—"}</strong>
        <small>{data.requests.value ? data.requests.value.scope + " · " + data.requests.value.withheld + " withheld by A09 · latest 100 maximum" : "Records or quarantine could not be read"}</small></Link>
      <Link className="console-metric" href="/admin/pages"><span>Queue eligible</span><strong>{ready ?? "—"}<em> / {data.releases.value?.length ?? "—"}</em></strong><small>{held === undefined ? "Release evidence unavailable" : legacyVersions ? `${legacyVersions} legacy versions · inspect AI and launch evidence` : held + (held === 1 ? " version held" : " versions held") + " · current A06 check"}</small></Link>
      <Link className="console-metric" href="/admin/system#ai-policy"><span>Recorded AI spend</span><strong>{spend ? "$" + spend.total_usd.toFixed(6) : "—"}</strong><small>{spend ? spend.calls + " recorded calls · today UTC · TEST accounting" : "Spend ledger could not be read"}</small></Link>
      <a className="console-metric" href="#data-quality"><span>Open data findings</span><strong>{quality && !quality.read_failed ? quality.unresolved_total : "—"}</strong><small>{quality?.could_not_verify ? "Incomplete verification · inspect below" : "A09 observed findings · not a health score"}</small></a>
    </section>

    <div className="console-columns">
      <section className="console-sheet" aria-labelledby="attention-title">
        <div className="console-section-head"><div><span className="console-kicker">01 / NEXT MOVES</span><h2 id="attention-title">What needs attention</h2></div><span className="console-count">{attention.length}</span></div>
        <ol className="console-attention">{attention.map((item, i) => <li key={item.id}>
          <span className={"console-order " + item.severity}>{String(i + 1).padStart(2, "0")}</span>
          <Link href={item.href}><strong>{item.title}</strong><span>{item.detail}</span></Link><span aria-hidden>↗</span>
        </li>)}</ol>
        <p className="console-footnote">Routine work belongs to the system. A review item preserves its actual action boundary; it does not imply a new owner decision.</p>
      </section>
      <section className="console-sheet" aria-labelledby="flow-title">
        <div className="console-section-head"><div><span className="console-kicker">02 / THE WORKING LOOP</span><h2 id="flow-title">From signal to service</h2></div></div>
        <div className="console-flow">
          <Link href="/admin/requests"><span>01</span><div><strong>Understand the problem</strong><small>Intake, evidence and safety records</small></div><b>{data.requests.value?.included ?? "—"}</b></Link>
          <Link href="/admin/requests"><span>02</span><div><strong>Keep the useful context</strong><small>Current packets in the same request sample</small></div><b>{data.requests.value?.packets ?? "—"}</b></Link>
          <Link href="/admin/opportunities"><span>03</span><div><strong>Learn what people ask</strong><small>Research workbook · {formatObservationTime(data.research.generated_at)}</small></div><b>{data.research.count}</b></Link>
          <Link href="/admin/pages"><span>04</span><div><strong>Build with evidence</strong><small>Staged versions, independently checked</small></div><b>{data.releases.value?.length ?? "—"}</b></Link>
        </div>
        <p className="console-footnote">Distinct record sets, not a conversion funnel. Provider outcomes and resolution rates are not measured here yet.</p>
      </section>
    </div>

    <section className="console-sheet" id="data-quality" aria-labelledby="quality-title">
      <div className="console-section-head"><div><span className="console-kicker">03 / EVIDENCE INTEGRITY</span><h2 id="quality-title">Data quality, kept in view</h2></div><ReconciliationRun /></div>
      {quality?.could_not_verify || !quality ? <div className="console-notice" role="status">Some quality evidence could not be verified. Missing reads or lost writes are not a clean bill of health.</div> : null}
      <div className="console-quality-line">
        <div><strong>{quality && !quality.read_failed ? quality.critical_open : "—"}</strong><span>critical open</span></div>
        <div><strong>{quality && !quality.read_failed ? quality.quarantined_active : "—"}</strong><span>active quarantine markers</span></div>
        <div><strong>{quality?.data_completeness_sample ? Math.round(quality.data_completeness_pass_rate * 100) + "%" : "—"}</strong><span>{quality?.data_completeness_sample ? quality.data_completeness_sample + " ingest checks · this process" : "no ingest sample in this process"}</span></div>
      </div>
      {data.findings.value?.length ? <div className="console-table-scroll" tabIndex={0} role="region" aria-label="Data quality findings, scroll horizontally"><table className="adm-table"><thead><tr><th scope="col">Severity</th><th scope="col">Rule / finding</th><th scope="col">Record</th><th scope="col">Status</th></tr></thead><tbody>{data.findings.value.map(f => <tr key={f.issue_id}><td><AdminStatus tone={f.severity === "critical" ? "danger" : "warning"}>{f.severity}</AdminStatus></td><td><strong>{f.rule_id}</strong><br /><span className="mono">{f.detail_code}</span></td><td className="mono">{f.entity_type}<br />{f.entity_id}</td><td>{f.status}</td></tr>)}</tbody></table></div> : <p className="console-footnote">{data.findings.state === "unavailable" || !quality || quality.could_not_verify ? "No complete findings reading is available." : "No unresolved data findings in the available A09 records."}</p>}
    </section>

    <div className="console-columns">
      <section className="console-sheet" aria-labelledby="changes-title"><div className="console-section-head"><div><span className="console-kicker">04 / THE RECORD</span><h2 id="changes-title">Material changes</h2></div><Link href="/admin/audit">Full audit <span aria-hidden>↗</span></Link></div>
        {data.audit.value?.length ? <ol className="console-timeline">{data.audit.value.slice(0, 6).map((entry, i) => <li key={entry.at + i}><time dateTime={entry.at}>{formatObservationTime(entry.at)}</time><div><strong>{entry.action.replaceAll(".", " / ")}</strong><span className="mono">{entry.target}</span></div></li>)}</ol> : <p className="console-footnote">{data.audit.state === "unavailable" ? "The action audit could not be read." : "No owner actions have been recorded yet. Completed actions will appear here."}</p>}
      </section>
      <section className="console-sheet" aria-labelledby="machine-title"><div className="console-section-head"><div><span className="console-kicker">05 / MACHINE ACTIVITY</span><h2 id="machine-title">Runs with receipts</h2></div><Link href="/admin/agents">Inspect <span aria-hidden>↗</span></Link></div>
        <div className="console-budget"><div><span>AI master policy</span><AdminStatus tone={policy?.enabled ? "good" : "neutral"}>{policy ? policy.enabled ? "Enabled" : "Off" : "Unknown"}</AdminStatus></div><p>{policy ? "$" + policy.global_daily_budget_usd.toFixed(2) + " daily TEST ceiling · shared across model capabilities" : "Policy could not be read"}</p>{progress !== null ? <progress aria-label="Recorded AI budget usage" value={progress} max={100} /> : null}</div>
        {activeRuns.length ? <ul className="console-run-list">{activeRuns.slice(0, 4).map(run => <li key={run.run_id}><span className="console-agent-id">{run.agent_id}</span><div><strong>{run.trigger.replaceAll("_", " ")}</strong><small>{formatObservationTime(run.created_at)}</small></div><AdminStatus tone={run.error_count ? "warning" : "neutral"}>{run.error_count ? run.error_count + " errors" : "Recorded"}</AdminStatus></li>)}</ul> : <p className="console-footnote">{data.runs.value?.state === "unavailable" || !data.runs.value ? "Run history could not be read." : "No run receipts in this environment yet."}</p>}
        <p className="console-footnote">{data.runs.value?.source ?? "Unknown source"} · latest {data.runs.value?.limit ?? 80} · {data.runs.value?.state ?? "unavailable"}. A receipt proves a run, not a deployed service.</p>
      </section>
    </div>
    <section className="console-next"><div><span className="console-kicker">THE LARGER SYSTEM</span><h2>Build depth as the evidence grows.</h2><p>Trust, Home Memory, provider operations and company-health synthesis remain at their actual implementation stage.</p></div><Link href="/admin/map">Explore the system map <span aria-hidden>→</span></Link></section>
  </div>;
}
