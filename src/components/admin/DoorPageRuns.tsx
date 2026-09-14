"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { DoorRunCreateRequest, DoorRunFixtureCatalog, DoorRunView } from "@/platform/admin/door-page-run-types";
import { adminActionMessage } from "./action";
import { advanceDoorRun, doorRunCreation, doorRunTransport, resumeDoorRun, validDoorRunId } from "./door-page-run-transport";

function rememberRun(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("run", id); else url.searchParams.delete("run");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function DoorRunResults({ run }: { run: DoorRunView }) {
  return <section aria-labelledby="door-run-results" className="adm-door-run-results">
    <h3 id="door-run-results">{run.dry_run ? "Unsaved fixture dry run" : "Saved fixture run"}</h3>
    <p role="status">{run.status === "COMPLETE" ? "Complete: every item has a recorded outcome." : `${run.status}: ${run.terminal_count} of ${run.items.length} items have a recorded outcome.`} Built, blocked and failed outcomes all count toward completion.</p>
    <p className="adm-small">Recorded model calls: {run.model_calls} · Recorded cost: USD {run.cost_usd}. This run does not approve QA or publish pages.</p>
    {run.retry_after && <p>Another request may hold this run. Read its state after <time dateTime={run.retry_after}>{run.retry_after}</time> before resuming.</p>}
    {run.status !== "COMPLETE" && !run.resumable && !run.retry_after && <p>This unfinished run cannot currently resume. Read its state again; if it remains unavailable, it needs operator support. No items were marked complete by this screen.</p>}
    <ol className="adm-door-run-items">{run.items.map(item => <li key={item.item_id}>
      <div className="adm-door-row"><h4>{item.fixture_id}</h4><strong>{item.status}</strong></div>
      <p className="adm-small">Attempts: {item.attempts} · Recorded model calls: {item.model_calls} · Recorded cost: USD {item.cost_usd}</p>
      {item.diagnostics.length > 0 && <ul aria-label={`${item.fixture_id} diagnostics`}>{item.diagnostics.map((diagnostic, i) => <li key={i}><strong>{diagnostic.code}</strong>{diagnostic.pointer && <span className="mono"> · {diagnostic.pointer}</span>}</li>)}</ul>}
      {item.preview_href && <><a href={item.preview_href} target="_blank" rel="noopener noreferrer">Private draft preview</a><p className="adm-small">Content review only; styling and interactive walkthrough acceptance are still pending.</p></>}
      {item.version_href && <p><a href={item.version_href}>Review registered version</a></p>}
      <details className="adm-door-details"><summary>Item record</summary><dl className="adm-door-facts"><div><dt>Item</dt><dd className="mono">{item.item_id}</dd></div><div><dt>Page identity</dt><dd className="mono">{item.page_id}</dd></div><div><dt>Input hash</dt><dd className="mono">{item.input_sha256 ?? "Not recorded"}</dd></div><div><dt>Artifact hash</dt><dd className="mono">{item.artifact_hash ?? "Not recorded"}</dd></div></dl></details>
    </li>)}</ol>
    <details className="adm-door-details"><summary>Run receipt</summary><dl className="adm-door-facts">
      <div><dt>Run</dt><dd className="mono">{run.run_id}</dd></div><div><dt>Revision</dt><dd>{run.revision}</dd></div><div><dt>Fixture package</dt><dd className="mono">{run.package_sha256}</dd></div><div><dt>Executor</dt><dd>{run.executor_version}</dd></div><div><dt>Last recorded update</dt><dd><time dateTime={run.updated_at}>{run.updated_at}</time></dd></div>
    </dl></details>
  </section>;
}

export function DoorPageRuns({ initialRunId = null }: { initialRunId?: string | null }) {
  const [catalog, setCatalog] = useState<DoorRunFixtureCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [dryRun, setDryRun] = useState(true);
  const [reason, setReason] = useState("");
  const [run, setRun] = useState<DoorRunView | null>(null);
  const [address, setAddress] = useState<string | null>(initialRunId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const mounted = useRef(false);
  const busyRef = useRef(false);
  const continuing = useRef(false);
  const currentAddress = useRef<string | null>(initialRunId);
  const creation = useRef<ReturnType<typeof doorRunCreation> | null>(null);
  const operation = useRef(0);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void doorRunTransport.catalog().then(data => {
      if (active) { setCatalog(data); setSelected(data.fixtures.map(item => item.fixture_id)); }
    }).catch(cause => { if (active) setCatalogError(adminActionMessage(cause)); });
    return () => { active = false; mounted.current = false; continuing.current = false; };
  }, []);

  useEffect(() => {
    if (!initialRunId || (creation.current && `run-${creation.current.key}` === initialRunId)) return;
    let active = true;
    ++operation.current;
    continuing.current = false;
    currentAddress.current = initialRunId;
    setAddress(initialRunId);
    setRun(null);
    setError(null);
    setProcessing(false);
    setPausing(false);
    busyRef.current = true;
    setBusy(true);
    void doorRunTransport.read(initialRunId).then(data => { if (active) setRun(data); })
      .catch(cause => { if (active) setError(adminActionMessage(cause)); })
      .finally(() => { if (active) { busyRef.current = false; setBusy(false); } });
    return () => { active = false; };
  }, [initialRunId]);

  function receipt(value: DoorRunView) { if (mounted.current && value.run_id === currentAddress.current) setRun(value); }
  async function work(start: DoorRunView) {
    if (!continuing.current || !mounted.current || start.run_id !== currentAddress.current) return;
    setProcessing(true);
    await advanceDoorRun(start, doorRunTransport, () => continuing.current && mounted.current && start.run_id === currentAddress.current, receipt);
  }
  function finish(sequence: number) {
    if (sequence !== operation.current) return;
    busyRef.current = false;
    continuing.current = false;
    if (mounted.current) { setBusy(false); setProcessing(false); setPausing(false); }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !catalog || !selected.length || reason.trim().length < 3 || reason.trim().length > 240) return;
    const input: DoorRunCreateRequest = { mode: "fixture", dry_run: dryRun, opportunity_ids: selected, count: selected.length, reason: reason.trim() };
    const sequence = ++operation.current;
    const attempt = doorRunCreation(input, creation.current);
    creation.current = attempt;
    const id = `run-${attempt.key}`;
    currentAddress.current = id;
    setAddress(id);
    rememberRun(id);
    busyRef.current = true;
    continuing.current = true;
    setBusy(true); setError(null); setUncertain(false); setRun(null);
    try {
      const created = await doorRunTransport.create(input, attempt.key);
      receipt(created);
      try { await work(created); }
      catch (cause) { if (mounted.current && sequence === operation.current) setError(adminActionMessage(cause)); }
    } catch (cause) { if (mounted.current && sequence === operation.current) { setError(adminActionMessage(cause)); setUncertain(true); } }
    finally { finish(sequence); }
  }
  async function read(resume: boolean) {
    if (busyRef.current || !address) return;
    const sequence = ++operation.current;
    busyRef.current = true;
    continuing.current = resume;
    setBusy(true); setError(null);
    try {
      if (resume) {
        setProcessing(true);
        await resumeDoorRun(address, doorRunTransport, () => continuing.current && mounted.current && sequence === operation.current, receipt);
      } else receipt(await doorRunTransport.read(address));
      if (mounted.current && sequence === operation.current) setUncertain(false);
    } catch (cause) { if (mounted.current && sequence === operation.current) setError(adminActionMessage(cause)); }
    finally { finish(sequence); }
  }
  function pause() { continuing.current = false; setPausing(true); }
  function prepare() {
    if (busyRef.current) return;
    creation.current = null; currentAddress.current = null;
    rememberRun(null); setAddress(null); setRun(null); setError(null); setUncertain(false);
  }

  return <section className="cell adm-door-section adm-door-run" aria-labelledby="door-run-title">
    <h2 id="door-run-title">Run the fixture checks</h2>
    <p>Compile selected fixture inputs and inspect each recorded result. These are synthetic, unreviewed candidates. F01 retains its source-control blockers; fixture themes are not approved themes.</p>
    <p className="adm-small">No paid model calls. A dry run saves its private run receipts and preview artifacts, without registering page versions. Turning dry run off can register fixture candidates; neither mode publishes pages or supplies complete QA acceptance.</p>
    {catalogError ? <p role="alert">{catalogError} Reload to read the catalogue again.</p> : !catalog ? <p role="status">Loading the fixture catalogue…</p> : null}
    <form onSubmit={create}>
      <fieldset disabled={busy || !catalog || (!!address && !uncertain)}>
        <legend>Fixtures ({selected.length} selected)</legend>
        <label className="adm-door-run-choice"><input type="checkbox" checked={!!catalog && selected.length === catalog.fixtures.length} onChange={event => setSelected(event.target.checked ? catalog!.fixtures.map(item => item.fixture_id) : [])} /> Select all fixtures</label>
        <div className="adm-door-run-fixtures">{catalog?.fixtures.map(item => <label key={item.fixture_id} className="adm-door-run-choice"><input type="checkbox" checked={selected.includes(item.fixture_id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, item.fixture_id].sort() : previous.filter(id => id !== item.fixture_id))} /> <span><strong>{item.fixture_id}</strong> {item.label}</span></label>)}</div>
        <label className="adm-door-run-choice"><input type="checkbox" checked={dryRun} onChange={event => setDryRun(event.target.checked)} /> Dry run — do not register page versions</label>
        <label className="adm-door-run-reason" htmlFor="door-run-reason">Reason for this run<textarea id="door-run-reason" required minLength={3} maxLength={240} aria-describedby="door-run-reason-hint" rows={2} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <p id="door-run-reason-hint" className="adm-small">Use 3–240 characters, excluding surrounding spaces.</p>
        <p className="adm-small">Create also starts processing, one item per request, while this page remains open. Pause stops after the current request. Reopening this address only reads the run; use Resume to continue unfinished items.</p>
        <button type="submit" className="btn" disabled={!selected.length || reason.trim().length < 3 || reason.trim().length > 240}>{uncertain && creation.current ? "Retry creation with this request" : "Create fixture run"}</button>
      </fieldset>
    </form>
    {address && <div className="adm-door-run-controls">
      <p className="mono">Run: {address}</p>
      {busy && <p role="status">{pausing ? "Pausing after the current request…" : processing ? "Processing one item at a time…" : "Reading or creating the run…"}</p>}
      <div className="adm-door-run-buttons">
        <button className="btn btn-ghost" type="button" disabled={busy || !validDoorRunId(address)} onClick={() => void read(false)}>Read current state</button>
        <button className="btn" type="button" disabled={busy || !run || run.status === "COMPLETE"} onClick={() => void read(true)}>Resume unfinished items</button>
        {busy && <button className="btn btn-ghost" type="button" disabled={pausing} onClick={pause}>Pause after this request</button>}
        {!busy && <button className="btn btn-ghost" type="button" onClick={prepare}>Prepare a separate run</button>}
      </div>
      {uncertain && <p>Creation may already be recorded at this run address. Read its state first. An unchanged creation request keeps the same key; changing the request creates a separate run.</p>}
      {!busy && <p className="adm-small">Preparing a separate run does not cancel this run. Keep this address to inspect or resume it later.</p>}
    </div>}
    {error && <p role="alert">{error}{run && " The last verified receipt remains below; it may be out of date."}</p>}
    {run && <DoorRunResults run={run} />}
  </section>;
}
