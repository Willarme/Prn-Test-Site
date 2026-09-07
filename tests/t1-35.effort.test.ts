import { fork, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { QUESTION_COSTS } from "@/domain/intake/readiness";
import { MemoryAiPolicyStore, setAiPolicyStoreForTests } from "@/platform/ai/policy-store";
import { MemorySpendLedger, setSpendLedgerForTests } from "@/platform/ai/spend";
import { startIntake } from "@/platform/intake/start";
import { appendIntakeEffort, EFFORT_POLICY_VERSION, finishIntakeEffort, readIntakeEffort, recordIntakeSelection,
  type AppendIntakeEffortInput, type EffortIdentity, type EffortOperation, type EffortResult } from "@/platform/intake/effort";
import { resetRuntimeStore, runtimeStore } from "@/platform/stores/runtime";
import * as runtimeModule from "@/platform/stores/runtime";
import * as clientModule from "@/platform/db/client";

const selection = [{ question_id: "equipment", fills_fields: ["unit_model_serial"], already_populated_fields: ["brand"], policy_version: EFFORT_POLICY_VERSION }];
function action(identity: EffortIdentity, id: string, patch: Partial<AppendIntakeEffortInput> = {}): AppendIntakeEffortInput {
  return { ...identity, operation_id: id, kind: "answer", question_id: "equipment", question_type: "closed_choice", ...patch };
}

describe("T1-35 durable local effort admission", () => {
  let dir: string;
  const network = vi.fn(() => { throw new Error("No external services in effort tests"); });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prn-effort-"));
    vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "dev-db.json")); vi.stubEnv("PRN_RUNTIME_STORE", "file");
    vi.stubEnv("VITEST", "1"); vi.stubEnv("PRN_AI_LIVE_TESTS", "0");
    vi.stubGlobal("fetch", network);
    resetRuntimeStore(); setAiPolicyStoreForTests(new MemoryAiPolicyStore()); setSpendLedgerForTests(new MemorySpendLedger());
  });
  afterEach(() => {
    expect(network).not.toHaveBeenCalled();
    resetRuntimeStore(); setAiPolicyStoreForTests(null); setSpendLedgerForTests(null);
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });
  async function journey(): Promise<EffortIdentity> {
    const result = await startIntake({ description: "My cooling is weak", source: "json",
      disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: { landing_path: "/start", problem_family_hint: "hvac-cooling", page_id: null,
        intent_cluster_id: null, search_opportunity_id: null, experiment_id: null, variant: null, referrer: null } });
    expect(result.kind).toBe("started");
    if (result.kind !== "started") throw new Error("Expected real accepted intake");
    return { request_id: result.request_id, tenant_id: "prn" };
  }
  async function workers(identity: EffortIdentity, count: number, mode = "append"): Promise<unknown[]> {
    const file = join(dir, "effort-worker.mts");
    writeFileSync(file, `import { appendIntakeEffort, readIntakeEffort } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "src/platform/intake/effort.ts")).href)};
const identity=JSON.parse(process.argv[2]); const n=process.argv[3]; const mode=process.argv[4];
process.send?.({ready:true});
process.once('message',async()=>{try {const result=mode==='read'?await readIntakeEffort(identity):await Promise.all(Array.from({length:5},(_,i)=>appendIntakeEffort({...identity,operation_id:'worker:'+n+':'+i,kind:i%2?'skip':'retry',question_id:'equipment',question_type:'closed_choice'})));process.send?.({result});process.disconnect();}catch(e){process.send?.({error:String(e)});process.disconnect();process.exitCode=1;}});`);
    const peers: ChildProcess[] = [];
    const ready: Promise<void>[] = []; const results: Promise<unknown>[] = [];
    for (let i = 0; i < count; i++) {
      const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
        NODE_ENV: "test", VITEST: "1", PRN_AI_LIVE_TESTS: "0", PRN_RUNTIME_STORE: "file", PRN_DEV_DB_PATH: process.env.PRN_DEV_DB_PATH };
      const child = fork(file, [JSON.stringify(identity), String(i), mode], { execArgv: ["--import", "tsx"], env, silent: true });
      peers.push(child);
      ready.push(new Promise((resolve, reject) => {
        child.on("message", msg => { if ((msg as { ready?: boolean }).ready) resolve(); }); child.once("error", reject);
        child.once("exit", code => { if (code) reject(new Error(`Worker failed before ready: ${code}`)); });
      }));
      results.push(new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(new Error("Effort worker timed out")); }, 25_000);
        child.on("message", msg => {
          const data = msg as { error?: string; result?: unknown };
          if (data.error) { clearTimeout(timer); reject(new Error(data.error)); }
          else if (Object.hasOwn(data, "result")) { clearTimeout(timer); resolve(data.result); }
        });
        child.once("exit", code => { if (code) { clearTimeout(timer); reject(new Error(`Worker failed: ${code}`)); } });
      }));
    }
    try { await Promise.all(ready); peers.forEach(child => child.send("go")); return await Promise.all(results); }
    finally { peers.forEach(child => child.kill()); }
  }

  it("charges canonical costs, records selection provenance and persists a fresh read", async () => {
    const id = await journey(); const initial = await readIntakeEffort(id);
    expect(QUESTION_COSTS).toEqual({ closed_choice: 1, confirm: 1, media: 3, short_text: 4, free_text: 5 });
    for (const [type, cost] of Object.entries(QUESTION_COSTS)) {
      const result = await appendIntakeEffort(action(id, `cost:${type}`, { question_type: type as keyof typeof QUESTION_COSTS,
        selection_decisions: selection, requirement_ids: ["unit_model_serial"] }));
      expect(result.accepted).toBe(true);
      expect(result.ledger.attempts.at(-1)).toMatchObject({ charged_units: cost, operation: { selection_decisions: selection } });
    }
    resetRuntimeStore();
    const persisted = await readIntakeEffort(id);
    expect(persisted.effort_spent).toBe(initial.effort_spent + 14);
    expect(persisted.policy_version).toBe(EFFORT_POLICY_VERSION);
  });
  it("charges grouped screens atomically and leaves the packet and free finish available", async () => {
    const id = await journey();
    const starting = (await readIntakeEffort(id)).effort_spent;
    if (starting < 5) await appendIntakeEffort(action(id, "opening:fixture", { kind: "opening", question_type: "free_text", units: 5 - starting }));
    const first = await appendIntakeEffort(action(id, "group:one", { units: 9, question_id: "screen:context", selection_decisions: selection }));
    expect(first.accepted).toBe(true);
    const next = await appendIntakeEffort(action(id, "group:two", { units: 9, question_id: "screen:context" }));
    expect(next).toMatchObject({ accepted: false, reason: "effort_limit", ledger: { effort_spent: first.ledger.effort_spent } });
    const before = (await readIntakeEffort(id)).effort_spent;
    const refused = await appendIntakeEffort(action(id, "too-much", { units: 20 }));
    expect(refused).toMatchObject({ accepted: false, reason: "effort_limit", ledger: { effort_spent: before } });
    expect(refused.ledger.attempts.at(-1)?.charged_units).toBe(0);
    expect(await runtimeStore().getJourney(id.request_id)).not.toBeNull();
    const finished = await finishIntakeEffort({ ...id, operation_id: "finish", reason: "effort_limit" });
    expect(finished).toMatchObject({ accepted: true, ledger: { effort_spent: before, finish_reason: "effort_limit" } });
    expect(finished.ledger.finished_at).not.toBeNull();
    expect(await appendIntakeEffort(action(id, "after-finish"))).toMatchObject({ accepted: false, reason: "finished" });
  });
  it("deduplicates identical operations but distinct skips and retries consume effort", async () => {
    const id = await journey(); const input = action(id, "same", { kind: "retry", question_type: "media" });
    const first = await appendIntakeEffort(input);
    expect(await appendIntakeEffort(input)).toMatchObject({ duplicate: true, ledger: { effort_spent: first.ledger.effort_spent } });
    await expect(appendIntakeEffort({ ...input, units: 1 })).rejects.toThrow(/different input/);
    const skip = await appendIntakeEffort(action(id, "skip", { kind: "skip" }));
    expect(skip.ledger.effort_spent).toBe(first.ledger.effort_spent + 1);
    const retry = await appendIntakeEffort(action(id, "retry", { kind: "retry", question_type: "media" }));
    expect(retry.ledger.effort_spent).toBe(skip.ledger.effort_spent + 3);
  });
  it("records an emitted selection without charging reloads, including after finishing", async () => {
    const id = await journey(); const baseline = (await readIntakeEffort(id)).effort_spent;
    const input = { ...id, operation_id: "selection:one", question_id: "screen:equipment", selection_decisions: selection };
    expect(await recordIntakeSelection(input)).toMatchObject({ accepted: true, duplicate: false, ledger: { effort_spent: baseline } });
    expect(await recordIntakeSelection(input)).toMatchObject({ duplicate: true, ledger: { effort_spent: baseline } });
    await finishIntakeEffort({ ...id, operation_id: "finish" });
    const after = await recordIntakeSelection({ ...input, operation_id: "selection:finished", selection_decisions: [] });
    expect(after).toMatchObject({ accepted: true, ledger: { effort_spent: baseline } });
  });
  it("refuses wrong tenant, nonexistent request, zero/negative/fractional/oversized action costs", async () => {
    const id = await journey();
    await expect(appendIntakeEffort(action({ ...id, tenant_id: "other" }, "wrong"))).rejects.toThrow(/ownership/);
    await expect(readIntakeEffort({ request_id: "missing", tenant_id: "prn" })).rejects.toThrow(/ownership/);
    for (const units of [0, -1, 0.5, 21, Number.NaN]) await expect(appendIntakeEffort(action(id, `bad:${String(units).replace("-", "n")}`, { units }))).rejects.toThrow();
  });
  it("eight real processes cannot exceed the cap; a new process reads the same durable result", async () => {
    const id = await journey(); const initial = await readIntakeEffort(id);
    const results = (await workers(id, 8)).flat() as EffortResult[];
    expect(results.filter(r => r.accepted)).toHaveLength(20 - initial.effort_spent);
    const ledger = await readIntakeEffort(id);
    expect(ledger.effort_spent).toBe(20);
    expect(ledger.attempts).toHaveLength(initial.attempts.length + 40);
    expect(new Set(ledger.attempts.map(a => a.operation.operation_id)).size).toBe(ledger.attempts.length);
    const [restarted] = await workers(id, 1, "read");
    expect(restarted).toEqual(ledger);
  }, 40_000);
  it("preserves damaged ledger bytes and refuses further admission", async () => {
    const id = await journey(); await appendIntakeEffort(action(id, "before-corrupt"));
    const hash = createHash("sha256").update(JSON.stringify([id.tenant_id, id.request_id])).digest("hex");
    const file = join(dir, "intake-effort", `${hash}.json`); const broken = '{"attempts":[';
    writeFileSync(file, broken);
    await expect(readIntakeEffort(id)).rejects.toThrow();
    await expect(appendIntakeEffort(action(id, "after-corrupt"))).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe(broken);
  });
  it.each(["spent-reset", "cleared-finish", "changed-finish-time", "changed-finish-reason", "accepted-after-finish", "forged-refusal"] as const)("rejects %s history before any local write or replay", async mutation => {
    const id = await journey();
    const finished = await finishIntakeEffort({ ...id, operation_id: "finish", reason: "homeowner_finish" });
    const corrupt = structuredClone(finished.ledger);
    if (mutation === "spent-reset") corrupt.effort_spent = 0;
    else if (mutation === "cleared-finish") { corrupt.finished_at = null; corrupt.finish_reason = null; }
    else if (mutation === "changed-finish-time") corrupt.finished_at = "2020-01-01T00:00:00.000Z";
    else if (mutation === "changed-finish-reason") corrupt.finish_reason = "ready";
    else if (mutation === "forged-refusal") {
      const source = corrupt.attempts.find(a => a.operation.kind === "opening")!;
      corrupt.attempts.splice(1, 0, { ...structuredClone(source), operation: { ...source.operation, operation_id: "forged-refusal", units: 1 },
        charged_units: 0, accepted: false, rejection_reason: "effort_limit" });
    }
    else {
      const source = corrupt.attempts.find(a => a.operation.kind === "opening")!;
      corrupt.attempts.push({ ...structuredClone(source), operation: { ...source.operation, operation_id: "forged-after-finish", units: 1 }, charged_units: 1 });
      corrupt.effort_spent += 1;
    }
    const hash = createHash("sha256").update(JSON.stringify([id.tenant_id, id.request_id])).digest("hex");
    const file = join(dir, "intake-effort", `${hash}.json`); const before = JSON.stringify(corrupt); writeFileSync(file, before);
    await expect(readIntakeEffort(id)).rejects.toThrow(/Invalid intake effort ledger/);
    await expect(appendIntakeEffort(action(id, "must-not-admit"))).rejects.toThrow(/Invalid intake effort ledger/);
    await expect(finishIntakeEffort({ ...id, operation_id: "finish" })).rejects.toThrow(/Invalid intake effort ledger/);
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});

describe("T1-35 actual PostgreSQL effort migration", () => {
  let db: PGlite;
  const identity = { request_id: "rq_effort_sql", tenant_id: "prn" };
  const migration = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
  const operation = (id: string, units = 1, patch: Partial<EffortOperation> = {}): EffortOperation => ({
    operation_id: id, kind: "answer", question_id: "screen:context", question_type: "closed_choice", units,
    requirement_ids: [], selection_decisions: selection, decision_reason: null, finish_reason: null,
    policy_version: EFFORT_POLICY_VERSION, ...patch,
  });
  async function rpc(op: EffortOperation, who = identity): Promise<EffortResult> {
    const result = await db.query<{ result: EffortResult }>("select public.record_intake_effort($1,$2,$3::jsonb) as result",
      [who.request_id, who.tenant_id, JSON.stringify(op)]);
    return result.rows[0].result;
  }
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;`);
    for (const name of ["00002_journey_runtime.sql", "00005_intake_details.sql", "00015_core_record_tenancy.sql", "00019_request_scoped_read_seam.sql", "00022_intake_effort.sql"]) await db.exec(migration(name));
    for (const [request, tenant] of [[identity.request_id, "prn"], ["rq_other_sql", "other"]]) {
      await db.query(`insert into public.intake_session(intake_session_id,schema_version,request_id,attribution,entered_at)
        values($1,'1.0.0',$2,'{}',now())`, [`is_${request}`, request]);
      await db.query(`insert into public.problem_record(problem_id,schema_version,status,source_channel,intake_session_id,safety_state,created_at,request_id,tenant_id)
        values($1,'1.0.0','draft','web',$2,'normal',now(),$3,$4)`, [`problem_${request}`, `is_${request}`, request, tenant]);
    }
  }, 25_000);
  beforeEach(async () => { await db.exec("reset role; truncate public.intake_effort_ledger; set role service_role"); });
  afterAll(async () => { await db.close(); });

  it("serializes competing RPC transactions at twenty and retains every refusal", async () => {
    // PGlite has one SQL connection: this proves real SQL transaction execution,
    // not production PostgREST authentication or a multi-connection load test.
    const outcomes = await Promise.all(Array.from({ length: 30 }, (_, i) => rpc(operation(`sql:${i}`))));
    expect(outcomes.filter(r => r.accepted)).toHaveLength(20);
    const last = outcomes.at(-1)!;
    expect(last.ledger.effort_spent).toBe(20); expect(last.ledger.attempts).toHaveLength(30);
    expect(last.ledger.attempts.filter(a => !a.accepted).every(a => a.charged_units === 0)).toBe(true);
  });
  it("admits grouped costs atomically, retains selection, and accepts free finish at the cap", async () => {
    await rpc(operation("first", 9)); await rpc(operation("second", 9));
    expect(await rpc(operation("third", 9))).toMatchObject({ accepted: false, ledger: { effort_spent: 18 } });
    await rpc(operation("fill", 2));
    const finished = await rpc(operation("finish", 0, { kind: "finish", question_id: null, question_type: null, finish_reason: "effort_limit", selection_decisions: [] }));
    expect(finished).toMatchObject({ accepted: true, ledger: { effort_spent: 20, finish_reason: "effort_limit" } });
    expect(finished.ledger.attempts[0].operation.selection_decisions).toEqual(selection);
    expect(await rpc(operation("after"))).toMatchObject({ accepted: false, reason: "finished" });
    expect(await rpc(operation("selection", 0, { kind: "selection", question_type: null }))).toMatchObject({ accepted: true, ledger: { effort_spent: 20 } });
  });
  it("replays an identical operation only once and rejects payload substitution", async () => {
    const op = operation("same", 3, { kind: "retry", question_type: "media" });
    await rpc(op);
    expect(await rpc(op)).toMatchObject({ accepted: true, duplicate: true, ledger: { effort_spent: 3 } });
    await expect(rpc({ ...op, units: 1 })).rejects.toThrow(/different input/);
    expect(await rpc(operation("another-skip", 1, { kind: "skip" }))).toMatchObject({ ledger: { effort_spent: 4 } });
  });
  it("requires an existing request/problem with exactly matching tenant", async () => {
    await expect(rpc(operation("wrong"), { ...identity, tenant_id: "other" })).rejects.toThrow(/ownership/);
    await expect(rpc(operation("missing"), { request_id: "rq_missing", tenant_id: "prn" })).rejects.toThrow(/ownership/);
    const rows = await db.query("select * from public.intake_effort_ledger"); expect(rows.rows).toHaveLength(0);
  });
  it("enforces role grants and RLS: own reads only, no anonymous or authenticated mutation", async () => {
    await rpc(operation("own")); await rpc(operation("other"), { request_id: "rq_other_sql", tenant_id: "other" });
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`reset role; set role ${role}`);
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role, request_id: identity.request_id })]);
      await expect(rpc(operation(`deny:${role}`))).rejects.toThrow(/permission denied/);
      await expect(db.exec("update public.intake_effort_ledger set ledger=ledger")).rejects.toThrow(/permission denied/);
      await expect(db.exec("delete from public.intake_effort_ledger")).rejects.toThrow(/permission denied/);
      await expect(db.exec("truncate public.intake_effort_ledger")).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.intake_effort_valid_ledger('{}','r','t','p')")).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.intake_effort_validate_operation('{}')")).rejects.toThrow(/permission denied/);
      if (role === "anon") await expect(db.exec("select * from public.intake_effort_ledger")).rejects.toThrow(/permission denied/);
    }
    const own = await db.query<{ request_id: string }>("select request_id from public.intake_effort_ledger");
    expect(own.rows).toEqual([{ request_id: identity.request_id }]);
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: "authenticated", request_id: "unrelated" })]);
    expect((await db.query("select * from public.intake_effort_ledger")).rows).toHaveLength(0);
    await db.exec("reset role; set role service_role");
    await expect(db.exec("update public.intake_effort_ledger set ledger=ledger")).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.intake_effort_valid_ledger('{}','r','t','p')")).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.intake_effort_validate_operation('{}')")).rejects.toThrow(/permission denied/);
  });
  it("rejects forged costs, malformed selections and unsupported policy versions without writes", async () => {
    for (const units of [0, -1, 0.5, 21]) await expect(rpc(operation(`invalid:${String(units)}`, units))).rejects.toThrow();
    await expect(rpc(operation("wrong-policy", 1, { policy_version: "wrong" as typeof EFFORT_POLICY_VERSION }))).rejects.toThrow();
    await expect(rpc(operation("bad-selection", 1, { selection_decisions: [{ ...selection[0], fills_fields: ["customer prose is not an id"] }] }))).rejects.toThrow();
    expect((await db.query("select * from public.intake_effort_ledger")).rows).toHaveLength(0);
  });
  it("round-trips the actual platform Supabase adapter through SQL and fails closed on RPC failure", async () => {
    const sqlRpc = vi.fn(async (_name: string, args: { p_request_id: string; p_tenant_id: string; p_operation: EffortOperation }) => {
      const data = await rpc(args.p_operation, { request_id: args.p_request_id, tenant_id: args.p_tenant_id });
      return { data, error: null as { message: string } | null };
    });
    const service = { rpc: sqlRpc } as unknown as SupabaseClient;
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: vi.fn(async () => {
      const result = await db.query<{ ledger: unknown }>("select ledger from public.intake_effort_ledger where request_id=$1 and tenant_id=$2", [identity.request_id, identity.tenant_id]);
      return { data: result.rows[0] ?? null, error: null };
    }) };
    const scoped = { from: vi.fn(() => query) } as unknown as SupabaseClient;
    const storeSpy = vi.spyOn(runtimeModule, "runtimeStore").mockReturnValue({ kind: "supabase", getJourney: async () => ({
      session: { request_id: identity.request_id }, problem: { problem_id: `problem_${identity.request_id}`, tenant_id: identity.tenant_id },
    }) } as unknown as runtimeModule.RuntimeStore);
    const serviceSpy = vi.spyOn(clientModule, "requireServiceClient").mockReturnValue(service);
    const scopedSpy = vi.spyOn(clientModule, "requestScopedClient").mockReturnValue(scoped);
    try {
      const result = await appendIntakeEffort(action(identity, "adapter:group", { units: 9, selection_decisions: selection }));
      expect(result).toMatchObject({ accepted: true, ledger: { effort_spent: 9 } });
      expect(sqlRpc.mock.calls[0][0]).toBe("record_intake_effort");
      expect(await readIntakeEffort(identity)).toEqual(result.ledger);
      expect(scopedSpy).toHaveBeenCalledWith(identity.request_id);
      sqlRpc.mockResolvedValueOnce({ data: null as unknown as EffortResult, error: { message: "database unavailable" } });
      await expect(appendIntakeEffort(action(identity, "failed"))).rejects.toThrow(/write unavailable/);
      expect((await readIntakeEffort(identity)).effort_spent).toBe(9);
    } finally { storeSpy.mockRestore(); serviceSpy.mockRestore(); scopedSpy.mockRestore(); }
  });
  it("rejects an empty ledger at the table constraint instead of accepting SQL NULL", async () => {
    await db.exec("reset role");
    await expect(db.query(`insert into public.intake_effort_ledger(request_id,tenant_id,problem_id,ledger)
      values($1,'prn',$2,'{}')`, [identity.request_id, `problem_${identity.request_id}`])).rejects.toThrow(/check constraint/);
    expect((await db.query("select * from public.intake_effort_ledger")).rows).toHaveLength(0);
  });
  it("rejects rewritten totals and finish facts at the table constraint, preserving the original ledger", async () => {
    await rpc(operation("nineteen", 19));
    const finished = await rpc(operation("finish", 0, { kind: "finish", question_id: null, question_type: null, finish_reason: "homeowner_finish" }));
    await db.exec("reset role");
    for (const patch of [{ effort_spent: 0 }, { finished_at: null, finish_reason: null },
      { finished_at: "2020-01-01T00:00:00.000Z" }, { finish_reason: "ready" }]) {
      await expect(db.query("update public.intake_effort_ledger set ledger=$1::jsonb where request_id=$2",
        [JSON.stringify({ ...finished.ledger, ...patch }), identity.request_id])).rejects.toThrow(/check constraint/);
      const rows = await db.query<{ ledger: unknown }>("select ledger from public.intake_effort_ledger where request_id=$1", [identity.request_id]);
      expect(rows.rows[0].ledger).toEqual(finished.ledger);
    }
  });
  it.each(["spent-reset", "cleared-finish", "changed-finish-time", "changed-finish-reason", "accepted-after-finish", "forged-refusal"] as const)("rejects legacy %s corruption inside RPC before committing anything", async mutation => {
    // Git materializes this shipped SQL with CRLF on some checkouts. Normalize
    // fixture parsing only, and verify restoration is possible before any DROP.
    const ddl = migration("00022_intake_effort.sql").replace(/\r\n/g, "\n");
    const marker = "constraint intake_effort_identity check (";
    const markerStart = ddl.indexOf(marker);
    const end = ddl.indexOf("\n  )\n);", markerStart + marker.length);
    expect(markerStart).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(markerStart + marker.length);
    const constraintExpression = ddl.slice(markerStart + marker.length, end);
    const base = await rpc(operation("valid:nineteen", 19));
    let corrupt = structuredClone(base.ledger);
    if (mutation !== "spent-reset") {
      const finished = await rpc(operation("valid:finish", 0, { kind: "finish", question_id: null, question_type: null, finish_reason: "homeowner_finish" }));
      corrupt = structuredClone(finished.ledger);
    }
    if (mutation === "spent-reset") corrupt.effort_spent = 0;
    else if (mutation === "cleared-finish") { corrupt.finished_at = null; corrupt.finish_reason = null; }
    else if (mutation === "changed-finish-time") corrupt.finished_at = "2020-01-01T00:00:00.000Z";
    else if (mutation === "changed-finish-reason") corrupt.finish_reason = "ready";
    else if (mutation === "forged-refusal") {
      corrupt.attempts.splice(1, 0, { operation: operation("forged-refusal", 1), occurred_at: new Date().toISOString(),
        charged_units: 0, accepted: false, rejection_reason: "effort_limit" });
    }
    else {
      corrupt.attempts.push({ operation: operation("forged-after-finish", 1), occurred_at: new Date().toISOString(), charged_units: 1, accepted: true, rejection_reason: null });
      corrupt.effort_spent = 20;
    }
    // A privileged fixture removes only the constraint, representing a corrupt
    // row written before hardening. The service-role RPC must protect itself.
    await db.exec("reset role; alter table public.intake_effort_ledger drop constraint intake_effort_identity");
    try {
      await db.query("update public.intake_effort_ledger set ledger=$1::jsonb where request_id=$2", [JSON.stringify(corrupt), identity.request_id]);
      await db.exec("set role service_role");
      await expect(rpc(operation("must-not-commit", 2))).rejects.toThrow(/Invalid intake effort ledger/);
      await expect(rpc(operation("valid:nineteen", 19))).rejects.toThrow(/Invalid intake effort ledger/);
      const rows = await db.query<{ ledger: unknown }>("select ledger from public.intake_effort_ledger where request_id=$1", [identity.request_id]);
      expect(rows.rows[0].ledger).toEqual(corrupt);
    } finally {
      await db.exec("reset role; truncate public.intake_effort_ledger");
      // Reapply the shipped constraint expression, without assuming its shape.
      await db.exec(`alter table public.intake_effort_ledger add constraint intake_effort_identity check (${constraintExpression})`);
    }
  });
});
