import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { doorPageRunStore } from "@/platform/search/door-page-run-store";
import { doorPageRunItems, verifyDoorPageRun, type DoorPageRun, type DoorPageRunCreate, type DoorPageRunOutcome, type DoorPageRunClaim, type DoorPageRunComplete, type DoorPageRunStore } from "@/domain/search/door-v44/page-run";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { readDevDb, updateDevDb } from "@/platform/stores/dev-db";

// Synthetic transition mechanics only: these hashes do not attest real artifacts,
// approvals or QA. PGlite's single connection tests SQL transactions/CAS results;
// it does not prove scheduling across independent PostgreSQL connections.
let sql: PGlite, dir: string, path: string; let sequence = 0;
const H = "a".repeat(64), at = "2026-09-13T20:00:00Z";
const time = (minute: number) => `2026-09-13T20:${String(minute).padStart(2, "0")}:00Z`;
function command(ids: Parameters<typeof doorPageRunItems>[2] = undefined): DoorPageRunCreate {
  const run_id = `run_synthetic_${++sequence}`;
  return { tenant_id: "prn", run_id, idempotency_key: run_id, request_sha256: doorV44Hash({ fixture_count: ids?.length ?? 11 }), actor: "owner-session", reason: "Synthetic fixture run only", created_at: at,
    mode: "fixture", dry_run: false, package_sha256: H, executor_sha256: H, executor_version: "fixture-executor-1", environment: { kind: "local", commit_sha: null }, items: doorPageRunItems("prn", run_id, ids) };
}
function claim(run: DoorPageRun, minute = 1, attempt_id = "attempt_first"): DoorPageRunClaim { return { tenant_id: "prn", run_id: run.run_id, expected_revision: run.revision, attempt_id, at: time(minute), lease_expires_at: time(minute + 5) }; }
function outcome(run: DoorPageRun, index = 0, status: DoorPageRunOutcome["status"] = "BLOCKED"): DoorPageRunOutcome {
  return { status, fixture_id: run.items[index].fixture_id, diagnostics: [{ code: "SYNTHETIC_FIXTURE_ONLY", pointer: "" }], input_sha256: status === "BUILT" ? H : null,
    spec_sha256: status === "BUILT" ? H : null, html_hash: status === "BUILT" ? H : null, semantic_hash: status === "BUILT" ? H : null, compile_receipt_sha256: status === "BUILT" ? H : null,
    reservation_id: status === "BUILT" && !run.dry_run ? H : null,
    artifact: status === "BUILT" ? { namespace: run.dry_run ? "dry-run" : "saved", artifact_hash: H, tenant_id: "prn", page_id: run.items[index].page_id, page_version: 1, run_id: run.run_id } : null,
    control_report: null, model_calls: 0, cost_usd: "0", release_ready: false };
}
function completion(run: DoorPageRun, minute = 2, index = 0, status: DoorPageRunOutcome["status"] = "BLOCKED"): DoorPageRunComplete {
  return { tenant_id: "prn", run_id: run.run_id, item_id: run.items[index].item_id, attempt_id: run.items[index].attempts.at(-1)!.attempt_id, expected_revision: run.revision, at: time(minute), outcome: outcome(run, index, status) };
}
async function rpc(name: string, input: unknown): Promise<DoorPageRun> { return verifyDoorPageRun((await sql.query<{ result: unknown }>(`select public.${name}($1::jsonb) result`, [JSON.stringify(input)])).rows[0].result); }
const sqlStore: DoorPageRunStore = { create: p => rpc("create_door_page_run", p), claimNext: p => rpc("claim_door_page_run", p), complete: p => rpc("complete_door_page_run", p),
  async read(tenant, run) { const rows = await sql.query<{ record: unknown }>("select record from door_page_run where tenant_id=$1 and run_id=$2", [tenant, run]); return rows.rows.length ? verifyDoorPageRun(rows.rows[0].record) : null; } };
beforeAll(async () => {
  sql = new PGlite(); await sql.exec("create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;");
  for (const name of ["00002_journey_runtime.sql", "00003_service_role_grants.sql", "00012_page_registry.sql", "00013_admin_audit_duration.sql", "00028_door_page_versions.sql"]) await sql.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  await sql.exec("create table unrelated_run_fixture(id integer);grant select on unrelated_run_fixture to authenticated;alter default privileges in schema public grant all on tables to anon,authenticated,service_role;");
  await sql.exec(readFileSync("supabase/migrations/00032_door_page_runs.sql", "utf8"));
}, 20000);
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "door-run-test-")); path = join(dir, "db.json"); vi.stubEnv("PRN_DEV_DB_PATH", path); });
afterEach(async () => { await sql.exec("reset role"); vi.unstubAllEnvs(); const checked = resolve(dir); if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.includes("door-run-test-")) throw new Error("Unsafe cleanup"); rmSync(checked, { recursive: true, force: true }); });
afterAll(async () => { await sql?.close(); });

describe.each(["file", "sql"] as const)("durable ordered fixture runs: %s", mode => {
  const store = () => mode === "file" ? doorPageRunStore(() => null) : sqlStore;
  async function auditCount(run: string) { return mode === "file" ? readDevDb().admin_audit.filter(a => a.target === run).length : (await sql.query<{ count: number }>("select count(*)::int count from admin_audit where target=$1", [run])).rows[0].count; }
  it("atomically inserts all eleven ordered immutable fixture assignments", async () => {
    const c = command(), r = await store().create(c); expect(r.items.map(i => i.fixture_id)).toEqual(c.items.map(i => i.fixture_id)); expect(r.items.every(i => i.status === "PENDING")).toBe(true);
    expect(r.revision).toBe(1); expect(await store().read("prn", c.run_id)).toEqual(r); expect(await auditCount(c.run_id)).toBe(1);
    expect(r.creation_sha256).toBe(doorV44Hash(c));
  });
  it("replays a normalized request without changing original deployment/time pins", async () => {
    const c = command(), r = await store().create(c); const retry = { ...c, created_at: time(1), package_sha256: "b".repeat(64), executor_sha256: "c".repeat(64) };
    expect(await store().create(retry)).toEqual(r); expect(await auditCount(c.run_id)).toBe(1);
    await expect(store().create({ ...c, request_sha256: "b".repeat(64) })).rejects.toThrow("DOOR_RUN_CONFLICT");
  });
  it("rejects conflicting run/key identities and preserves the existing run", async () => {
    const c = command(), r = await store().create(c); const other = command();
    await expect(store().create({ ...other, idempotency_key: c.idempotency_key, request_sha256: c.request_sha256 })).rejects.toThrow("DOOR_RUN_CONFLICT");
    await expect(store().create({ ...c, idempotency_key: other.idempotency_key })).rejects.toThrow("DOOR_RUN_CONFLICT"); expect(await store().read("prn", c.run_id)).toEqual(r);
  });
  it("serializes competing claims and never starts the following item during a lease", async () => {
    const r = await store().create(command()); const results = await Promise.allSettled([store().claimNext(claim(r, 1, "a")), store().claimNext(claim(r, 1, "b"))]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); const live = (await store().read("prn", r.run_id))!;
    expect(live.items.filter(i => i.status === "RUNNING")).toHaveLength(1); expect(live.items[1].attempts).toEqual([]);
    await expect(store().claimNext(claim(live, 2, "c"))).rejects.toThrow("DOOR_RUN_CONFLICT");
  });
  it("recovers an expired lease while fencing old attempts and retaining execution_at", async () => {
    const initial = await store().create(command()), first = await store().claimNext(claim(initial));
    expect(await store().claimNext(claim(initial))).toEqual(first);
    const recovered = await store().claimNext(claim(first, 6, "recovery")); expect(recovered.items[0].execution_at).toBe(time(1)); expect(recovered.items[0].attempts).toHaveLength(2);
    await expect(store().complete({ ...completion(first, 7), expected_revision: recovered.revision })).rejects.toThrow("DOOR_RUN_CONFLICT");
    await expect(store().claimNext({ ...claim(recovered, 7), attempt_id: "attempt_first" })).rejects.toThrow("DOOR_RUN_CONFLICT");
    expect((await store().complete(completion(recovered, 7))).items[0].status).toBe("BLOCKED");
  });
  it("refuses completion after expiry even before another worker recovers", async () => {
    const r = await store().claimNext(claim(await store().create(command())));
    await expect(store().complete(completion(r, 6))).rejects.toThrow("DOOR_RUN_CONFLICT");
  });
  it.each(["BUILT", "BLOCKED", "FAILED"] as const)("never reruns terminal %s and harmlessly replays exact completion", async status => {
    const r = await store().claimNext(claim(await store().create(command(["F04"])))); const c = completion(r, 2, 0, status), done = await store().complete(c);
    expect(done.status).toBe("COMPLETED"); expect(await store().complete({ ...c, at: time(9) })).toEqual(done); expect(await auditCount(r.run_id)).toBe(3);
    expect(await store().claimNext(claim(done, 10, "new_attempt"))).toEqual(done);
    await expect(store().complete({ ...c, outcome: { ...c.outcome, diagnostics: [] } })).rejects.toThrow("DOOR_RUN_CONFLICT");
  });
  it("moves to the next ordered fixture only after terminal completion", async () => {
    const r = await store().claimNext(claim(await store().create(command(["F01", "F04"]))));
    const completed = await store().complete(completion(r)); const next = await store().claimNext(claim(completed, 3, "second"));
    expect(next.items.map(i => i.status)).toEqual(["BLOCKED", "RUNNING"]); expect(next.items[1].execution_at).toBe(time(3));
    expect((await store().complete(completion(next, 4, 1, "BUILT"))).status).toBe("COMPLETED");
  });
  it("audits transaction-derived prior/new state, shared role and normalized request identity", async () => {
    const initial = await store().create(command(["F04"])), active = await store().claimNext(claim(initial)), done = await store().complete(completion(active));
    const rows = mode === "file" ? readDevDb().admin_audit.filter(a => a.target === initial.run_id)
      : (await sql.query<{ detail: string }>("select detail from admin_audit where target=$1 order by (detail::jsonb->>'revision')::integer", [initial.run_id])).rows;
    const details = rows.map(a => JSON.parse(a.detail!));
    expect(details.map(d => [d.previous_revision, d.revision, d.previous_status, d.status])).toEqual([[0, 1, null, "PENDING"], [1, 2, "PENDING", "RUNNING"], [2, 3, "RUNNING", "COMPLETED"]]);
    expect(details.map(d => [d.previous_state_sha256, d.state_sha256])).toEqual([[null, initial.state_sha256], [initial.state_sha256, active.state_sha256], [active.state_sha256, done.state_sha256]]);
    expect(details.every(d => d.role === "owner-session" && d.request_id === initial.idempotency_key && d.request_sha256 === initial.request_sha256)).toBe(true);
  });
  it("keeps dry-run artifacts separate and rejects saved bindings in dry mode", async () => {
    const c = command(["F04"]); c.dry_run = true; const r = await store().claimNext(claim(await store().create(c)));
    const good = completion(r, 2, 0, "BUILT"), bad = structuredClone(good); bad.outcome.artifact!.namespace = "saved";
    await expect(store().complete(bad)).rejects.toThrow("DOOR_RUN_INVALID"); expect((await store().complete(good)).items[0].outcome?.reservation_id).toBeNull();
  });
  it.each(["bad-order", "foreign-page", "duplicate", "empty", "foreign-tenant", "extra", "floating", "invalid-date", "impossible-date"])("rejects malformed creation %s atomically", async mutation => {
    const c = command(); if (mutation === "bad-order") c.items.reverse(); if (mutation === "foreign-page") c.items[0].page_id = "live_page";
    if (mutation === "duplicate") c.items[1] = c.items[0]; if (mutation === "empty") c.items = [];
    if (mutation === "foreign-tenant") Object.assign(c, { tenant_id: "foreign" }); if (mutation === "extra") Object.assign(c, { private_context: "synthetic" });
    if (mutation === "floating") Object.assign(c.environment, { commit_sha: 0.1 }); if (mutation === "invalid-date") c.created_at = "2026-99-99T20:00:00Z";
    if (mutation === "impossible-date") c.created_at = "2026-02-31T20:00:00Z";
    await expect(store().create(c)).rejects.toThrow("DOOR_RUN_INVALID"); expect(await store().read("prn", c.run_id)).toBeNull();
  });
  it.each(["paid", "approval", "foreign-artifact", "bad-diagnostics", "null-status"])("rejects terminal %s claims", async mutation => {
    const r = await store().claimNext(claim(await store().create(command(["F04"])))); const c = completion(r, 2, 0, "BUILT");
    if (mutation === "paid") Object.assign(c.outcome, { model_calls: 1, cost_usd: "1" }); if (mutation === "approval") Object.assign(c.outcome, { release_ready: true });
    if (mutation === "foreign-artifact") c.outcome.artifact!.page_id = "other"; if (mutation === "bad-diagnostics") c.outcome.diagnostics[0].pointer = "private\ntext";
    if (mutation === "null-status") Object.assign(c.outcome, { status: null });
    await expect(store().complete(c)).rejects.toThrow("DOOR_RUN_INVALID"); expect((await store().read("prn", r.run_id))?.revision).toBe(2);
  });
  it("returns missing distinctly and rejects a stale revision without modifying state", async () => {
    const c = command(); expect(await store().read("prn", c.run_id)).toBeNull(); await expect(store().claimNext({ ...claim({ run_id: c.run_id, revision: 1 } as DoorPageRun) })).rejects.toThrow("DOOR_RUN_NOT_FOUND");
    const r = await store().create(c); await expect(store().claimNext({ ...claim(r), expected_revision: 2 })).rejects.toThrow("DOOR_RUN_CONFLICT"); expect(await store().read("prn", c.run_id)).toEqual(r);
  });
  it("bounds leases and leaves an exhausted expired attempt for operator investigation", async () => {
    let r = await store().create(command(["F04"]));
    await expect(store().claimNext({ ...claim(r), lease_expires_at: time(1) })).rejects.toThrow("DOOR_RUN_INVALID");
    await expect(store().claimNext({ ...claim(r), lease_expires_at: time(32) })).rejects.toThrow("DOOR_RUN_INVALID");
    for (let n = 0; n < 20; n++) r = await store().claimNext({ ...claim(r, n + 1, `bounded_${n}`), lease_expires_at: time(n + 2) });
    await expect(store().claimNext({ ...claim(r, 21, "exhausted"), lease_expires_at: time(22) })).rejects.toThrow("DOOR_RUN_CONFLICT");
    const saved = (await store().read("prn", r.run_id))!; expect(saved.items[0].attempts).toHaveLength(20); expect(saved.items[0].outcome).toBeNull(); expect(saved.items[0].execution_at).toBe(time(1));
  });
});

describe("run adapter and storage boundaries", () => {
  it("deep-copies inputs before awaiting the configured provider", async () => {
    const c = command(); let release!: () => void; const barrier = new Promise<void>(r => { release = r; }); let observed: unknown;
    const client = { rpc: async (_name: string, args: { p_input: DoorPageRunCreate }) => { await barrier; observed = structuredClone(args.p_input); const record = await doorPageRunStore(() => null).create(args.p_input); return { data: record, error: null }; } } as unknown as SupabaseClient;
    const pending = doorPageRunStore(() => client).create(c); c.items[0].page_id = "modified"; release(); await pending;
    expect((observed as DoorPageRunCreate).items[0].page_id).not.toBe("modified");
  });
  it("refuses accessors without invoking them", async () => {
    const c = command(); const getter = vi.fn(() => []); Object.defineProperty(c, "items", { get: getter, enumerable: true });
    await expect(doorPageRunStore(() => null).create(c)).rejects.toThrow("DOOR_RUN_INVALID"); expect(getter).not.toHaveBeenCalled();
  });
  it("detects missing run subsets and audit substitution without overwriting unrelated collections", async () => {
    const store = doorPageRunStore(() => null), a = await store.create(command()), b = await store.create(command());
    updateDevDb(db => { db.signups.push({ synthetic: "preserved" } as never); }); const original = readFileSync(path, "utf8");
    const damaged = JSON.parse(original); damaged.door_page_runs = [b]; writeFileSync(path, JSON.stringify(damaged));
    await expect(store.read("prn", b.run_id)).rejects.toThrow("DOOR_RUN_CORRUPT"); const before = readFileSync(path, "utf8"); await expect(store.create(command())).rejects.toThrow(); expect(readFileSync(path, "utf8")).toBe(before);
    writeFileSync(path, original); const forged = JSON.parse(original); forged.admin_audit[0].detail = JSON.stringify({ ...JSON.parse(forged.admin_audit[0].detail), actor: "forged" }); writeFileSync(path, JSON.stringify(forged));
    await expect(store.read("prn", a.run_id)).rejects.toThrow("DOOR_RUN_CORRUPT");
  });
  it("validates remote exact scope and count; configured read failure never falls back", async () => {
    const run = await doorPageRunStore(() => null).create(command());
    for (const result of [{ data: [], count: null, error: null }, { data: [], count: 1, error: null }, { data: [{ record: run }, { record: run }], count: 2, error: null }, { data: [{ record: run }], count: 1, error: null }, { data: null, count: null, error: { message: "missing schema" } }]) {
      const filters: unknown[] = []; const q = { select: () => q, eq: (key: string, v: string) => { filters.push([key, v]); return q; }, range: async (a: number, b: number) => { expect([a, b]).toEqual([0, 1]); return result; } };
      const client = { from: () => q } as unknown as SupabaseClient;
      await expect(doorPageRunStore(() => client).read("prn", "other_run")).rejects.toThrow(result.error ? "DOOR_RUN_UNAVAILABLE" : "DOOR_RUN_CORRUPT"); expect(filters).toEqual([["tenant_id", "prn"], ["run_id", "other_run"]]);
    }
  });
  it.each(["prior-hash", "prior-revision", "prior-status", "request", "role"])("refuses a broken %s file audit chain without rewriting it", async mutation => {
    const store = doorPageRunStore(() => null), initial = await store.create(command()); await store.claimNext(claim(initial));
    const damaged = JSON.parse(readFileSync(path, "utf8")), detail = JSON.parse(damaged.admin_audit[1].detail);
    if (mutation === "prior-hash") detail.previous_state_sha256 = H; if (mutation === "prior-revision") detail.previous_revision = 0;
    if (mutation === "prior-status") detail.previous_status = "COMPLETED"; if (mutation === "request") detail.request_id = "foreign"; if (mutation === "role") detail.role = "foreign";
    damaged.admin_audit[1].detail = JSON.stringify(detail); writeFileSync(path, JSON.stringify(damaged)); const before = readFileSync(path, "utf8");
    await expect(store.read("prn", initial.run_id)).rejects.toThrow("DOOR_RUN_CORRUPT"); expect(readFileSync(path, "utf8")).toBe(before);
  });
  it("rolls back SQL aggregate changes when audit insertion fails", async () => {
    const c = command(), before = await sqlStore.create(command()), active = await sqlStore.claimNext(claim(await sqlStore.create(command())));
    await sql.exec("create function synthetic_run_audit_fail() returns trigger language plpgsql as $$begin if new.action='door_page_run_transition' then raise exception 'synthetic audit failure';end if;return new;end$$;create trigger synthetic_run_audit_fail before insert on admin_audit for each row execute function synthetic_run_audit_fail();");
    try { await expect(sqlStore.create(c)).rejects.toThrow("synthetic audit failure"); expect(await sqlStore.read("prn", c.run_id)).toBeNull();
      await expect(sqlStore.claimNext(claim(before))).rejects.toThrow("synthetic audit failure"); expect(await sqlStore.read("prn", before.run_id)).toEqual(before);
      await expect(sqlStore.complete(completion(active))).rejects.toThrow("synthetic audit failure"); expect(await sqlStore.read("prn", active.run_id)).toEqual(active); }
    finally { await sql.exec("drop trigger synthetic_run_audit_fail on admin_audit;drop function synthetic_run_audit_fail();"); }
  });
  it("allows service RPCs only and preserves unrelated ACLs", async () => {
    const acl = (await sql.query<{ role: string; sel: boolean; ins: boolean; upd: boolean; del: boolean; rpc: boolean; helper: boolean }>("select r role,has_table_privilege(r,'door_page_run','select') sel,has_table_privilege(r,'door_page_run','insert') ins,has_table_privilege(r,'door_page_run','update') upd,has_table_privilege(r,'door_page_run','delete') del,has_function_privilege(r,'create_door_page_run(jsonb)','execute') rpc,has_function_privilege(r,'door_run_audit(jsonb,jsonb)','execute') helper from unnest(array['anon','authenticated','service_role']) r")).rows;
    expect(acl).toEqual([{ role: "anon", sel: false, ins: false, upd: false, del: false, rpc: false, helper: false }, { role: "authenticated", sel: false, ins: false, upd: false, del: false, rpc: false, helper: false }, { role: "service_role", sel: true, ins: false, upd: false, del: false, rpc: true, helper: false }]);
    expect((await sql.query<{ allowed: boolean }>("select has_table_privilege('authenticated','unrelated_run_fixture','select') allowed")).rows[0].allowed).toBe(true);
    await sql.exec("set role anon"); await expect(sqlStore.create(command())).rejects.toThrow(/permission denied/); await sql.exec("reset role;set role service_role"); const c = command(); expect((await sqlStore.create(c)).run_id).toBe(c.run_id);
    await expect(sql.query("delete from door_page_run where run_id=$1", [c.run_id])).rejects.toThrow(/permission denied/);
  });
});
