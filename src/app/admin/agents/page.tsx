import Link from "next/link";
import { adminGate } from "@/components/admin/AdminGate";
import { AdminEmptyState, AdminPageHeader, AdminStatus } from "@/components/admin/AdminUI";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";
import type { AgentDefinition } from "@/platform/agents/contracts";
import { readRunHistory, type RunHistory, type RunObservation } from "@/platform/admin/run-history";
import styles from "./agents.module.css";

export const dynamic = "force-dynamic";

const PHASE_BANDS = ["FOUNDATION", "TRIAL", "PHASE2", "LATER", "TBD"] as const;
const BAND_LABELS: Record<string, string> = {
  FOUNDATION: "Foundation", TRIAL: "Trial", PHASE2: "Phase 2", LATER: "Later", TBD: "Phase not declared",
};
const BAND_BLURBS: Record<string, string> = {
  FOUNDATION: "Shared platform responsibilities in the declared foundation scope.",
  TRIAL: "Responsibilities assigned to the Black Car trial. This band does not establish implementation or activation.",
  PHASE2: "Responsibilities assigned to a later product phase; build and activation need their own evidence.",
  LATER: "Later scope declarations, retained here for continuity.",
  TBD: "No phase is assigned in the current registry.",
};

type Search = Record<string, string | string[] | undefined>;
function parameter(value: Search[string]): string { return typeof value === "string" ? value.slice(0, 160) : ""; }
function declared(value: string | undefined): string { return !value || value === "TBD" ? "Not declared (TBD)" : value; }
function money(value: number | null): string { return value !== null && Number.isFinite(value) && value >= 0 ? `$${value.toFixed(6)}` : "Not recorded"; }
function date(value: string): string { return value.replace("T", " ").replace(/\.\d+Z$/, " UTC").replace(/Z$/, " UTC"); }
function readable(value: string): string { return value.replaceAll("_", " "); }

function BudgetTerms({ agent }: { agent: AgentDefinition }) {
  const budget = agent.budgets;
  const entries: Array<[string, string]> = [];
  if (budget.ai_api_dollars_per_day !== undefined) entries.push(["AI / API ceiling", `$${budget.ai_api_dollars_per_day} per day · internal TEST setting`]);
  if (budget.contacts_per_day !== undefined) entries.push(["Contacts", `${budget.contacts_per_day} per day`]);
  if (budget.page_publishes_per_day !== undefined) entries.push(["Page publications", `${budget.page_publishes_per_day} per day`]);
  if (budget.db_writes_per_run !== undefined) entries.push(["Database writes", `${budget.db_writes_per_run} per run`]);
  if (budget.max_retries !== undefined) entries.push(["Retry limit", `${budget.max_retries}`]);
  if (budget.max_blast_radius !== undefined) entries.push(["Maximum scope", budget.max_blast_radius]);
  return entries.length ? <dl className={styles.definition}>{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p className={styles.note}>No per-agent budgets are declared here. Active gateway and model spend controls are separate; an empty registry budget does not mean unlimited authority.</p>;
}

function KeyList({ values, empty }: { values: string[]; empty: string }) {
  return values.length ? <ul className={styles.keys}>{values.map(value => <li key={value}>{value}</li>)}</ul> : <p className={styles.note}>{empty}</p>;
}

function AgentRow({ agent, observations, history }: { agent: AgentDefinition; observations: RunObservation[]; history: RunHistory }) {
  const newest = observations[0];
  const errors = observations.reduce((sum, run) => sum + run.error_count, 0);
  return <details className={styles.agent} id={agent.agent_id}>
    <summary className={styles.agentSummary}>
      <span className={styles.agentIdentity}><span className={styles.agentId}>{agent.agent_id}</span><span><strong>{agent.name}</strong><span className={styles.summaryPurpose}>{agent.purpose}</span></span></span>
      <span className={styles.declaration}><AdminStatus>Declared {agent.status}</AdminStatus><span>{BAND_LABELS[agent.phase_band]} · autonomy {agent.autonomy_level}</span></span>
      <span className={styles.observation}><strong>{history.state === "unavailable" ? "Run history unavailable" : observations.length ? `${observations.length} ${observations.length === 1 ? "receipt" : "receipts"} in this read` : "No observed runs in this read"}</strong><span>{newest ? `${date(newest.created_at)}${errors ? ` · ${errors} recorded errors` : ""}` : "Registry status is not runtime proof"}</span></span>
      <span className={styles.expand} aria-hidden>+</span>
    </summary>
    <div className={styles.agentBody}>
      <section className={styles.mandate}><p className={styles.kicker}>Declared responsibility</p><h3>Mandate</h3><p>{agent.mandate}</p><p className={styles.note}>This is the registry’s intended scope. It does not verify each advertised input, output, integration or production deployment.</p></section>
      <div className={styles.detailGrid}>
        <section><h3>Boundaries & configuration</h3><dl className={styles.definition}>
          <div><dt>Owner layer</dt><dd>{declared(agent.owner_layer)}</dd></div>
          <div><dt>Autonomy</dt><dd>{declared(agent.autonomy_level)}</dd></div>
          <div><dt>Declared schedule</dt><dd>{agent.schedule ?? "Not declared"}</dd></div>
          <div><dt>Policy version</dt><dd>{declared(agent.policy_version)}</dd></div>
          <div><dt>Prompt version</dt><dd>{agent.prompt_version ?? "Not declared"}</dd></div>
          <div><dt>Kill-switch reference</dt><dd className="mono">{agent.kill_switch_ref}</dd></div>
          <div><dt>Evaluation reference</dt><dd>{agent.eval_suite_ref ?? "Not declared"}</dd></div>
          <div><dt>Legacy health declaration</dt><dd>{agent.health ? `${agent.health} · metadata only, not a current health check` : "Not declared; no runtime health claim"}</dd></div>
        </dl><p className={styles.note}>A schedule label does not prove a scheduler is connected. Evaluation references do not establish passing results. Pause controls and active runtime policy are on <Link href="/admin/system">System & safety</Link>.</p></section>
        <section><h3>Declared budgets</h3><BudgetTerms agent={agent} /><h3>Observed activity</h3>{history.state === "unavailable" ? <p className={styles.note}>The run history could not be read, so activity is unknown.</p> : newest ? <dl className={styles.definition}>
          <div><dt>Newest receipt</dt><dd className="mono">{newest.run_id}</dd></div><div><dt>Trigger</dt><dd>{readable(newest.trigger)}</dd></div>
          <div><dt>Provider / model</dt><dd>{newest.provider ?? "Provider not recorded"} / {newest.model ?? "model not recorded"}</dd></div>
          <div><dt>Reported cost</dt><dd>{money(newest.cost_usd)}{newest.cost_usd !== null ? " · internal TEST telemetry" : ""}</dd></div>
          <div><dt>Recorded errors</dt><dd>{newest.error_count} on this receipt; this is not an independently verified outcome</dd></div>
        </dl> : <p className={styles.note}>No receipt for this agent appears in the bounded {history.source} read. This does not establish that the agent has never run.</p>}</section>
        <section><h3>Allowed capability keys</h3><KeyList values={agent.allowed_capabilities} empty="No bindings are enumerated here. Do not interpret a mandate as executable capability." /></section>
        <section><h3>Data access</h3><KeyList values={agent.data_access} empty="Read access is not enumerated. An empty declaration does not prove no access." /><h3>Write access</h3><KeyList values={agent.write_access} empty="Write access is not enumerated. An empty declaration does not grant or deny writes." /></section>
      </div>
    </div>
  </details>;
}

function RunTable({ rows }: { rows: RunObservation[] }) {
  return <div className={styles.runScroll} tabIndex={0} role="region" aria-label="Recent agent receipt table"><table className="adm-table"><thead><tr><th scope="col">Agent / time</th><th scope="col">Trigger / receipt</th><th scope="col">Provider / model</th><th scope="col">Reported cost</th><th scope="col">Recorded errors</th></tr></thead><tbody>{rows.map(run => <tr key={run.run_id}>
    <td>{TRIAL_AGENT_REGISTRY.some(agent => agent.agent_id === run.agent_id) ? <Link href={`#${run.agent_id}`} className="mono">{run.agent_id}</Link> : <span className="mono">{run.agent_id}</span>}<span className={styles.tableNote}>{date(run.created_at)}</span></td>
    <td>{readable(run.trigger)}<span className={styles.tableNote}>{run.run_id}</span></td>
    <td>{run.provider ?? "Not recorded"}<span className={styles.tableNote}>{run.model ?? "Model not recorded"}{run.latency_ms !== null ? ` · ${run.latency_ms.toLocaleString("en-US")} ms` : ""}</span></td>
    <td>{money(run.cost_usd)}{run.cost_usd !== null && <span className={styles.tableNote}>Internal TEST telemetry</span>}</td>
    <td><AdminStatus tone={run.error_count > 0 ? "warning" : "neutral"}>{run.error_count > 0 ? `${run.error_count} recorded` : "None recorded"}</AdminStatus><span className={styles.tableNote}>{run.capability_count} capability {run.capability_count === 1 ? "reference" : "references"}</span></td>
  </tr>)}</tbody></table></div>;
}

export default async function AdminAgents({ searchParams }: { searchParams?: Promise<Search> }) {
  const gate = await adminGate();
  if (gate) return gate;
  const history = await readRunHistory(80);
  const search = await searchParams ?? {};
  const query = parameter(search.q).trim();
  const phaseInput = parameter(search.phase);
  const phase = PHASE_BANDS.some(band => band === phaseInput) ? phaseInput : "";
  const activityInput = parameter(search.activity);
  const activity = history.state !== "unavailable" && ["observed", "no-observed"].includes(activityInput) ? activityInput : "";
  const observations = new Map<string, RunObservation[]>();
  for (const row of [...history.rows].sort((a, b) => b.created_at.localeCompare(a.created_at))) observations.set(row.agent_id, [...observations.get(row.agent_id) ?? [], row]);
  const matching = TRIAL_AGENT_REGISTRY.filter(agent =>
    (!query || [agent.agent_id, agent.name, agent.mandate, ...agent.allowed_capabilities].some(value => value.toLocaleLowerCase().includes(query.toLocaleLowerCase()))) &&
    (!phase || agent.phase_band === phase) &&
    (!activity || (activity === "observed" ? observations.has(agent.agent_id) : !observations.has(agent.agent_id)))
  );
  return <div className={styles.page}>
    <AdminPageHeader eyebrow="Machine / Agents" title="Responsibilities, backed by receipts."
      description="One roster of declared responsibilities, paired with the activity this environment can actually show. Open a row to inspect its mandate, access, budgets and evidence."
      actions={<Link href="/admin/system" className="btn btn-ghost">System & safety →</Link>}
      meta={<><AdminStatus>{TRIAL_AGENT_REGISTRY.length} registry entries</AdminStatus><AdminStatus tone={history.state === "available" ? "neutral" : "warning"}>History {history.state}</AdminStatus><span className="adm-small">Read {date(history.observed_at)}</span></>} />

    <section className={styles.observedSection} aria-labelledby="observed-activity">
      <div className={styles.sectionHeader}><div><p className={styles.kicker}>01 / Observed activity</p><h2 id="observed-activity">What the record shows</h2></div><AdminStatus>{history.source}</AdminStatus></div>
      <p className={styles.note}>{history.state === "unavailable" ? "The activity source could not be read. No zero-activity or healthy-state conclusion is available." : `${history.rows.length} receipts returned, limited to ${history.limit}. ${history.scanned} records scanned${history.skipped ? `; ${history.skipped} unreadable or excluded entries` : ""}.`}{history.state === "partial" ? " This is a partial reading, not complete history." : ""}</p>
      {history.source === "process buffer" && <p className={styles.notice}>The process buffer can lose its history on restart and does not represent other server instances.</p>}
      {history.rows.length ? <><RunTable rows={history.rows.slice(0, 12)} />{history.rows.length > 12 && <details className={styles.moreRuns}><summary>Show the other {history.rows.length - 12} receipts in this read</summary><RunTable rows={history.rows.slice(12)} /></details>}</> : <AdminEmptyState title={history.state === "unavailable" ? "Activity is unavailable" : "No run receipts returned"}>{history.state === "unavailable" ? "Retry after the activity source is available. The registry below remains a configuration view." : "No receipt appears in this source and window. Registry declarations are available below; they are not substitute execution evidence."}</AdminEmptyState>}
      <p className={styles.note}>A receipt records an invocation and its reported telemetry. No recorded errors does not prove a useful outcome. No model ID does not prove a model ran. Local receipts are not production verification.</p>
    </section>

    <section className={styles.registrySection} aria-labelledby="declared-roster">
      <div className={styles.sectionHeader}><div><p className={styles.kicker}>02 / Registry declarations</p><h2 id="declared-roster">The responsibilities behind the system</h2></div><span className={styles.count}>{matching.length} of {TRIAL_AGENT_REGISTRY.length}</span></div>
      <p className={styles.notice}>LIVE, TRIAL and TBD below are registry values. They do not establish a running agent, deployed connection or verified production capability. Unspecified fields stay visible.</p>
      <form method="get" className={styles.filters}>
        <label>Find an agent<input type="search" name="q" defaultValue={query} maxLength={160} placeholder="ID, name, mandate or capability" /></label>
        <label>Declared phase<select name="phase" defaultValue={phase}><option value="">All phases</option>{PHASE_BANDS.map(band => <option key={band} value={band}>{BAND_LABELS[band]}</option>)}</select></label>
        <label>Observed activity<select name="activity" defaultValue={activity} disabled={history.state === "unavailable"}><option value="">All registry entries</option><option value="observed">Has receipts in this read</option><option value="no-observed">No receipts in this read</option></select></label>
        <button type="submit" className="btn btn-pink btn-sm">Apply filters</button>{(query || phase || activity) && <Link href="/admin/agents" className="btn btn-ghost btn-sm">Clear</Link>}
      </form>
      {matching.length ? PHASE_BANDS.map(band => {
        const agents = matching.filter(agent => agent.phase_band === band).sort((a, b) => a.agent_id.localeCompare(b.agent_id));
        return agents.length ? <section key={band} className={styles.band}><div className={styles.bandHeading}><h3>{BAND_LABELS[band]} <span>{agents.length}</span></h3><p>{BAND_BLURBS[band]}</p></div><div className={styles.roster}>{agents.map(agent => <AgentRow key={agent.agent_id} agent={agent} observations={observations.get(agent.agent_id) ?? []} history={history} />)}</div></section> : null;
      }) : <AdminEmptyState title="No registry entries match">Clear the filters to return to the complete roster.</AdminEmptyState>}
    </section>
  </div>;
}
