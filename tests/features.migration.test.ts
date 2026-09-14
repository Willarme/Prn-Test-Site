import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FEATURES, FEATURE_DECISION_REF } from "@/platform/features/registry";
let db: PGlite;
const at = "2026-09-13T12:00:00Z";
const set = (tenant: string, changes: unknown[]) => db.query<{ rows: unknown[] }>(
  "select public.set_feature_states($1,$2::jsonb,'system','fixture','test-only',$3::timestamptz) as rows", [tenant, JSON.stringify(changes), at]);
const row = (feature_id: string, expected_version = 0, state = "PREVIEW") => ({ feature_id, expected_version, state });
const vote = (tenant_id = "trial") => ({ tenant_id, feature_id: "marketing", feature_version: 1,
  page: "/pages/marketing", answer: "yes", visitor_hash: "a".repeat(64), dedupe_key: "b".repeat(64), created_at: at });
const record = (input: unknown) => db.query<{ created: boolean }>("select public.record_feature_interest($1::jsonb) as created", [JSON.stringify(input)]);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;`);
  // Replay the actual runtime/audit schema and inherited production grant rules.
  for (const name of ["00002_journey_runtime.sql", "00003_service_role_grants.sql", "00013_admin_audit_duration.sql"]) {
    await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8"));
  }
  await db.exec(`alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    create sequence existing_sequence; grant select on existing_sequence to authenticated;`);
  await db.exec(readFileSync(join(process.cwd(), "supabase/migrations/00027_feature_states.sql"), "utf8"));
}, 20_000);
afterAll(async () => { await db.close(); });
describe("feature SQL transactions and grants", () => {
  it("seeds only recorded registry states and does not overwrite later decisions on replay", async () => {
    const expected = FEATURES.filter(f => f.launch_word !== "TO BUILD" && f.launch_word !== "YOURS")
      .map(f => ({ feature_id: f.id, state: f.launch_state, version: 1, actor: "system:c6ff9a", decision_ref: FEATURE_DECISION_REF }))
      .sort((a, b) => a.feature_id.localeCompare(b.feature_id));
    expect((await db.query("select feature_id,state,version,actor,decision_ref from feature_state where tenant_id='prn' order by feature_id")).rows).toEqual(expected);
    await set("prn", [row("door_pages", 1, "HIDDEN")]);
    const before = (await db.query("select count(*) from admin_audit")).rows;
    const source = readFileSync(join(process.cwd(), "supabase/migrations/00027_feature_states.sql"), "utf8");
    await db.exec("-- BEGIN RECORDED LAUNCH SEED." + source.split("-- BEGIN RECORDED LAUNCH SEED.")[1].split("-- END RECORDED LAUNCH SEED.")[0]);
    expect((await db.query("select state,version from feature_state where tenant_id='prn' and feature_id='door_pages'")).rows[0]).toEqual({ state: "HIDDEN", version: 2 });
    expect((await db.query("select count(*) from admin_audit")).rows).toEqual(before);
  });
  it("allows only service RPC mutations and protects raw interest rows", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const access = await db.query(`select has_table_privilege($1,'feature_state','INSERT') as state_write,
        has_table_privilege($1,'feature_interest','SELECT') as interest_read,
        has_function_privilege($1,'set_feature_states(text,jsonb,text,text,text,timestamptz)','EXECUTE') as rpc`, [role]);
      expect(access.rows[0]).toEqual({ state_write: false, interest_read: false, rpc: role === "service_role" });
    }
    expect((await db.query("select relrowsecurity from pg_class where relname in ('feature_state','feature_interest')")).rows).toEqual([{ relrowsecurity: true }, { relrowsecurity: true }]);
    expect((await db.query("select has_sequence_privilege('authenticated','existing_sequence','SELECT') as unchanged")).rows[0]).toEqual({ unchanged: true });
    await db.exec("set role authenticated");
    await expect(set("denied", [row("marketing")])).rejects.toThrow(/permission denied/);
    await db.exec("reset role; set role service_role");
    await set("trial", [row("marketing")]);
    await db.exec("reset role");
  });
  it("rejects one stale bulk row without committing earlier rows or their audits", async () => {
    const count = (await db.query("select count(*) from admin_audit")).rows;
    await expect(set("trial", [row("new"), row("marketing")])).rejects.toMatchObject({ code: "P0002" });
    expect((await db.query("select * from feature_state where feature_id='new'")).rows).toEqual([]);
    expect((await db.query("select count(*) from admin_audit")).rows).toEqual(count);
    await set("other", [row("marketing")]);
    await set("trial", [row("marketing", 1, "HIDDEN")]);
    expect((await db.query("select state,version from feature_state where tenant_id='trial'")).rows).toEqual([{ state: "HIDDEN", version: 2 }]);
  });
  it("executes competing CAS requests through real SQL with exactly one winner", async () => {
    // PGlite is a single connection and queues SQL; this verifies transaction/CAS
    // semantics under competing calls, not multi-connection PostgreSQL scheduling.
    const results = await Promise.allSettled([set("race", [row("marketing")]), set("race", [row("marketing")])]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect((await db.query("select count(*) from admin_audit where detail::jsonb->>'tenant_id'='race'")).rows[0]).toEqual({ count: 1 });
  });
  it("deduplicates both keys atomically, scopes counts by tenant, and audits only inserts", async () => {
    await set("votes", [row("marketing")]);
    const results = await Promise.all([record(vote("votes")), record(vote("votes"))]);
    expect(results.flatMap(r => r.rows).filter(r => r.created)).toHaveLength(1);
    expect((await record({ ...vote("votes"), dedupe_key: "c".repeat(64) })).rows[0].created).toBe(false);
    await record({ ...vote("other"), answer: "no" });
    expect((await db.query("select * from feature_interest_counts('votes')")).rows).toEqual([{ feature_id: "marketing", yes: 1, no: 0, maybe: 0, total: 1 }]);
    expect((await db.query("select count(*) from admin_audit where action='feature_interest_recorded'")).rows[0]).toEqual({ count: 2 });
    await expect(record({ ...vote("votes"), visitor_hash: "d".repeat(64), dedupe_key: "e".repeat(64), page: "/pages/marketing?email=private" })).rejects.toThrow(/check constraint/);
  });
  it("rolls back state and interest insertion when their audit cannot be written", async () => {
    await set("audit-interest", [row("marketing")]);
    await db.exec(`create function reject_feature_audit() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable'; end $$;
      create trigger fail_audit before insert on admin_audit for each row execute function reject_feature_audit();`);
    try {
      await expect(set("audit-fault", [row("marketing")])).rejects.toThrow(/audit unavailable/);
      await expect(record(vote("audit-interest"))).rejects.toThrow(/audit unavailable/);
      expect((await db.query("select * from feature_state where tenant_id='audit-fault'")).rows).toEqual([]);
      expect((await db.query("select * from feature_interest where tenant_id='audit-interest'")).rows).toEqual([]);
    } finally { await db.exec("drop trigger fail_audit on admin_audit"); }
  });
  it("rejects absent, hidden and stale preview versions and enforces shared burst limits", async () => {
    await expect(record(vote("missing"))).rejects.toMatchObject({ code: "P0004" });
    await expect(record(vote("trial"))).rejects.toMatchObject({ code: "P0004" });
    await set("burst", Array.from({ length: 21 }, (_, n) => row(`feature_${n}`)));
    const input = (n: number) => ({ ...vote("burst"), feature_id: `feature_${n}`, dedupe_key: n.toString(16).padStart(64, "0") });
    await expect(record({ ...input(0), feature_version: 0 })).rejects.toMatchObject({ code: "P0004" });
    const results = await Promise.allSettled(Array.from({ length: 21 }, (_, n) => record(input(n))));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(20);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "P0003" } });
    expect((await record(input(0))).rows[0].created).toBe(false);
    expect((await db.query("select count(*) from feature_interest where tenant_id='burst'")).rows[0]).toEqual({ count: 20 });
    expect((await db.query("select count(*) from admin_audit where action='feature_interest_recorded' and detail::jsonb->>'tenant_id'='burst'")).rows[0]).toEqual({ count: 20 });
    expect((await record({ ...input(20), created_at: "2026-09-13T12:01:01Z" })).rows[0].created).toBe(true);
  });
});
