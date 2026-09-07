import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { issueLink, readLinkLedger, recordIssuedLink, recordKeepRequested, readKeepState, consumeKeepLink, ledgerHasLink } from "@/platform/links/ledger";
import { decodeLink, signLink } from "@/platform/links/tokens";
import { resetServiceClient } from "@/platform/db/client";
import { resetRuntimeStore, runtimeStore } from "@/platform/stores/runtime";
import ClaimPage from "@/app/claim/[magic]/page";

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`FIXTURE_REDIRECT:${url}`); } }));
const own = { request_id: "rq_link_own", tenant_id: "prn" };
const other = { request_id: "rq_link_other", tenant_id: "other" };
const at = "2026-09-07T03:00:00.000Z";
const privateCanary = "SYNTHETIC_PRIVATE_BACKEND_DETAIL";

describe("durable hosted link ledger SQL and actual Supabase client", () => {
  let db: PGlite; let server: Server; let origin: string; let dir: string;
  let unavailable = false; let corruptRead = false;
  const requests: Array<{ method: string; table: string; role: string; request_id?: string }> = [];
  const tables = new Set(["intake_session", "problem_record", "evidence_object", "job_packet", "issued_request_links", "request_keep_state", "keep_claims", "link_revocations"]);
  const columns = new Set(["request_id", "tenant_id", "problem_id", "intake_session_id", "packet_version", "packet", "evidence_ids", "captured_at", "created_at", "link_id", "id", "contact", "contact_kind", "claimed_at", "magic_link_id"]);
  async function sql<T = Record<string, unknown>>(statement: string, values: unknown[] = [], role = "service_role", requestId?: string) {
    return db.transaction(async tx => {
      await tx.exec(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role, request_id: requestId })]);
      return tx.query<T>(statement, values);
    });
  }
  async function rpc(name: string, input: Record<string, unknown>, role = "service_role") {
    let query: string; let args: unknown[];
    if (name === "register_request_link") {
      query = "select public.register_request_link($1,$2,$3::jsonb) as value";
      args = [input.p_request_id, input.p_tenant_id, JSON.stringify(input.p_link)];
    } else if (name === "register_request_keep") {
      query = "select public.register_request_keep($1,$2,$3,$4) as value";
      args = [input.p_request_id, input.p_tenant_id, input.p_email_id, input.p_magic_id];
    } else if (name === "confirm_request_keep") {
      query = "select public.confirm_request_keep($1,$2,$3,$4,$5::jsonb) as value";
      args = [input.p_request_id, input.p_tenant_id, input.p_magic_id, input.p_at, input.p_owner_link ? JSON.stringify(input.p_owner_link) : null];
    } else throw new Error("Unexpected fixture RPC");
    return (await sql<{ value: unknown }>(query, args, role)).rows[0].value;
  }
  async function seedKeep(magic = "mg_own", identity = own, claimedAt = at, email = "em_own") {
    await db.query("insert into magic_links(magic_id,tenant_id,request_id,contact,created_at) values($1,$2,$3,'synthetic@example.invalid',$4)", [magic, identity.tenant_id, identity.request_id, claimedAt]);
    await db.query("insert into keep_claims(tenant_id,request_id,contact,contact_kind,claimed_at,magic_link_id) values($1,$2,'synthetic@example.invalid','email',$3,$4)", [identity.tenant_id, identity.request_id, claimedAt, magic]);
    await db.query(`insert into email_outbox(email_id,tenant_id,request_id,"to",subject,text,html,mode,created_at)
      values($1,$2,$3,'synthetic@example.invalid','Fixture','Fixture','','preview',$4)`, [email, identity.tenant_id, identity.request_id, claimedAt]);
    return { email_id: email, magic_id: magic };
  }
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      alter default privileges in schema public grant all on tables to service_role;
      alter default privileges in schema public grant all on sequences to service_role;`);
    for (const name of ["00002_journey_runtime.sql", "00005_intake_details.sql", "00015_core_record_tenancy.sql", "00019_request_scoped_read_seam.sql", "00020_loop_surfaces.sql", "00021_loop_grant_hardening.sql", "00024_request_link_ledger.sql"]) {
      await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8"));
    }
    for (const identity of [own, other]) {
      await db.query("insert into intake_session(intake_session_id,schema_version,request_id,attribution,entered_at) values($1,'1.0.0',$2,'{}',$3)", [`is_${identity.request_id}`, identity.request_id, at]);
      await db.query(`insert into problem_record(problem_id,schema_version,status,source_channel,intake_session_id,safety_state,created_at,request_id,tenant_id,evidence_ids)
        values($1,'1.0.0','draft','web',$2,'normal',$3,$4,$5,'{}')`, [`problem_${identity.request_id}`, `is_${identity.request_id}`, at, identity.request_id, identity.tenant_id]);
      await db.query(`insert into job_packet(job_packet_id,packet_version,schema_version,problem_id,packet,generated_at,engine,request_id)
        values($1,1,'1.0.0',$2,'{}',$3,'fixture',$4)`, [`packet_${identity.request_id}`, `problem_${identity.request_id}`, at, identity.request_id]);
    }
    // Loopback adapter runs the real Supabase client's HTTP contract against
    // actual SQL/RLS. It is not a deployed PostgREST or multi-connection test.
    server = createServer((req, res) => { void (async () => {
      try {
        const url = new URL(req.url!, "http://localhost");
        const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
        let role = "service_role"; let requestId: string | undefined;
        if (token !== "synthetic-service-key") {
          const [header, payload, signature] = token.split(".");
          if (signature !== createHmac("sha256", "synthetic-jwt-secret").update(`${header}.${payload}`).digest("base64url")) throw new Error("Invalid fixture JWT");
          const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
          if (claims.role !== "authenticated") throw new Error("Invalid fixture role");
          role = claims.role; requestId = claims.request_id;
        }
        const table = url.pathname.replace(/^\/rest\/v1\//, "");
        requests.push({ method: req.method!, table, role, request_id: requestId });
        if (unavailable && (table.includes("request_link") || table.includes("request_keep"))) throw new Error(privateCanary);
        let result: unknown;
        if (req.method === "POST") {
          let raw = ""; for await (const chunk of req) raw += String(chunk);
          result = await rpc(table.replace(/^rpc\//, ""), JSON.parse(raw), role);
        } else {
          if (!tables.has(table)) throw new Error("Unexpected fixture table");
          const selected = url.searchParams.get("select") ?? "*";
          if (selected !== "*" && selected.split(",").some(column => !columns.has(column.trim()))) throw new Error(`Unexpected fixture selection: ${selected}`);
          const filters: string[] = []; const values: unknown[] = [];
          for (const [key, value] of url.searchParams) {
            if (["select", "order", "limit", "offset"].includes(key)) continue;
            if (!columns.has(key) || !value.startsWith("eq.")) throw new Error("Unexpected fixture filter");
            values.push(value.slice(3)); filters.push(`${key}=$${values.length}`);
          }
          let order = "";
          const ordered = url.searchParams.get("order");
          if (ordered) order = " order by " + ordered.split(",").map(part => { const [key, direction] = part.split("."); if (!columns.has(key)) throw new Error("Unexpected fixture order"); return `${key} ${direction === "desc" ? "desc" : "asc"}`; }).join(",");
          const limitValue = url.searchParams.get("limit"); const offsetValue = url.searchParams.get("offset");
          if (limitValue && !/^\d+$/.test(limitValue) || offsetValue && !/^\d+$/.test(offsetValue)) throw new Error("Unexpected fixture pagination");
          const limit = limitValue ? ` limit ${limitValue}` : ""; const offset = offsetValue ? ` offset ${offsetValue}` : "";
          const rows = (await sql(`select ${selected} from public.${table}${filters.length ? ` where ${filters.join(" and ")}` : ""}${order}${limit}${offset}`, values, role, requestId)).rows;
          if (corruptRead && table === "issued_request_links" && rows.length) rows[0].request_id = other.request_id;
          result = req.headers.accept?.includes("vnd.pgrst.object") ? rows[0] ?? null : rows;
        }
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(result));
      } catch (error) { res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ message: String(error), code: "SYNTHETIC" })); }
    })(); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }, 30_000);
  beforeEach(async () => {
    await db.exec("truncate public.issued_request_links,public.request_keep_state,public.keep_claims,public.magic_links,public.email_outbox");
    unavailable = false; corruptRead = false; requests.length = 0;
    dir = mkdtempSync(join(tmpdir(), "prn-shared-links-"));
    vi.stubEnv("SUPABASE_URL", origin); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
    vi.stubEnv("SUPABASE_ANON_KEY", "synthetic-anon-key"); vi.stubEnv("SUPABASE_JWT_SECRET", "synthetic-jwt-secret");
    vi.stubEnv("LINK_SIGNING_SECRET", "synthetic-link-signing-secret"); vi.stubEnv("PRN_RUNTIME_STORE", "supabase");
    vi.stubEnv("VERCEL", "1"); vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "db.json"));
    resetRuntimeStore(); resetServiceClient();
  });
  afterEach(() => { resetRuntimeStore(); resetServiceClient(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await db.close(); });

  it("actual client persists issued links across fresh clients without a filesystem sidecar", async () => {
    const link = await issueLink({ scope: "packet", request_id: own.request_id });
    expect((await sql("select link_id from issued_request_links")).rows).toEqual([{ link_id: link.link_id }]);
    resetRuntimeStore(); resetServiceClient();
    expect(await ledgerHasLink(own.request_id, link.link_id)).toBe(true);
    expect((await readLinkLedger(other.request_id)).links).toHaveLength(0);
    expect(requests.some(row => row.table === "issued_request_links" && row.role === "authenticated" && row.request_id === own.request_id)).toBe(true);
    expect(existsSync(join(dir, "links"))).toBe(false);
  });
  it("a fresh Node process reads the same shared issuance and Keep receipt", async () => {
    const link = await issueLink({ scope: "packet", request_id: own.request_id });
    const pending = await seedKeep(); await recordKeepRequested(own.request_id, pending);
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "-e", `
      const { readLinkLedger } = require('./src/platform/links/ledger.ts');
      readLinkLedger(process.argv[1]).then(value => process.stdout.write(JSON.stringify({
        ids: value.links.map(row => row.link_id), keep: value.keep
      }))).catch(() => { process.exitCode = 1; });
    `, own.request_id], { cwd: process.cwd(), timeout: 15_000, windowsHide: true,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: dir, TMP: dir, NODE_ENV: "test",
        VERCEL: "1", PRN_RUNTIME_STORE: "supabase", PRN_DEV_DB_PATH: join(dir, "fresh.json"),
        SUPABASE_URL: origin, SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key", SUPABASE_ANON_KEY: "synthetic-anon-key",
        SUPABASE_JWT_SECRET: "synthetic-jwt-secret", LINK_SIGNING_SECRET: "synthetic-link-signing-secret" } });
    expect(JSON.parse(stdout)).toEqual({ ids: [link.link_id], keep: { ...pending, confirmed_at: null } });
    expect(existsSync(join(dir, "links"))).toBe(false);
  }, 20_000);
  it("retains every acknowledged concurrent issuance and makes the same token idempotent", async () => {
    const links = await Promise.all(Array.from({ length: 10 }, () => issueLink({ scope: "ask", request_id: own.request_id })));
    const first = (await readLinkLedger(own.request_id)).links[0];
    expect(await recordIssuedLink(first.token)).toEqual(first);
    expect((await readLinkLedger(own.request_id)).links).toHaveLength(10);
    expect(new Set(links.map(row => row.link_id)).size).toBe(10);
  });
  it("keeps expired issued links visible for history without making them usable", async () => {
    const link = await issueLink({ scope: "packet", request_id: own.request_id, ttl_days: 1 / 86400 });
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(decodeLink(link.token)).toEqual({ ok: false, reason: "expired" });
    expect((await readLinkLedger(own.request_id)).links[0].link_id).toBe(link.link_id);
  });
  it("preserves the configured service fallback with explicit request and tenant scope", async () => {
    const link = await issueLink({ scope: "packet", request_id: own.request_id });
    vi.stubEnv("SUPABASE_JWT_SECRET", ""); resetRuntimeStore(); resetServiceClient(); requests.length = 0;
    expect((await readLinkLedger(own.request_id)).links[0].link_id).toBe(link.link_id);
    expect((await readLinkLedger(other.request_id)).links).toHaveLength(0);
    expect(requests.filter(row => row.table === "issued_request_links").every(row => row.role === "service_role")).toBe(true);
  });
  it("pages the complete link history instead of silently truncating older revocation targets", async () => {
    for (let i = 0; i < 205; i++) {
      const token = signLink({ scope: "packet", request_id: own.request_id }); const decoded = decodeLink(token);
      if (!decoded.ok) throw new Error("Fixture signing failed");
      await rpc("register_request_link", { p_request_id: own.request_id, p_tenant_id: own.tenant_id,
        p_link: { link_id: decoded.link_id, scope: "packet", token, created_at: at, exp: decoded.exp } });
    }
    requests.length = 0;
    expect((await readLinkLedger(own.request_id)).links).toHaveLength(205);
    expect(requests.filter(row => row.table === "issued_request_links")).toHaveLength(2);
  });
  it("enforces request/tenant ownership and immutable IDs in SQL", async () => {
    const saved = await issueLink({ scope: "packet", request_id: own.request_id });
    const link = (await readLinkLedger(own.request_id)).links[0];
    for (const identity of [{ ...own, tenant_id: "other" }, { request_id: "rq_missing", tenant_id: "prn" }, other]) {
      await expect(rpc("register_request_link", { p_request_id: identity.request_id, p_tenant_id: identity.tenant_id, p_link: link })).rejects.toThrow();
    }
    await expect(rpc("register_request_link", { p_request_id: own.request_id, p_tenant_id: own.tenant_id, p_link: { ...link, token: "replacement" } })).rejects.toThrow(/conflict/);
    expect((await readLinkLedger(own.request_id)).links[0].token).toBe(saved.token);
  });
  it("denies anonymous reads, all direct mutations, and non-service RPC execution", async () => {
    await issueLink({ scope: "packet", request_id: own.request_id });
    await issueLink({ scope: "packet", request_id: other.request_id });
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const table of ["issued_request_links", "request_keep_state"]) {
        for (const mutation of [`update ${table} set tenant_id='other'`, `delete from ${table}`, `truncate ${table}`]) {
          await expect(sql(mutation, [], role, own.request_id)).rejects.toThrow(/permission denied/);
        }
        await expect(sql(`insert into ${table}(request_id) values('rq_forged')`, [], role, own.request_id)).rejects.toThrow(/permission denied/);
      }
      if (role !== "service_role") for (const name of ["register_request_link", "register_request_keep", "confirm_request_keep"]) {
        await expect(rpc(name, { p_request_id: own.request_id, p_tenant_id: own.tenant_id, p_link: {} }, role)).rejects.toThrow(/permission denied/);
      }
    }
    await expect(sql("select * from issued_request_links", [], "anon")).rejects.toThrow(/permission denied/);
    expect((await sql("select request_id from issued_request_links", [], "authenticated", own.request_id)).rows).toEqual([{ request_id: own.request_id }]);
    expect((await sql("select * from issued_request_links", [], "authenticated", "missing")).rows).toHaveLength(0);
  });
  it("records Keep state across clients and refuses stale or foreign receipt registration", async () => {
    const original = await seedKeep(); await recordKeepRequested(own.request_id, original);
    resetRuntimeStore(); resetServiceClient();
    expect(await readKeepState(own.request_id)).toEqual({ ...original, confirmed_at: null });
    const newer = await seedKeep("mg_new", own, "2026-09-07T03:01:00.000Z", "em_new");
    await recordKeepRequested(own.request_id, newer);
    await expect(recordKeepRequested(own.request_id, original)).rejects.toThrow(/unavailable/);
    const foreign = await seedKeep("mg_other", other, at, "em_other");
    await expect(recordKeepRequested(own.request_id, { ...newer, email_id: foreign.email_id })).rejects.toThrow(/unavailable/);
    expect(await readKeepState(own.request_id)).toEqual({ ...newer, confirmed_at: null });
  });
  it("uses the same newest claim for equal timestamps in runtime reads and SQL registration", async () => {
    const older = await seedKeep();
    const newer = await seedKeep("mg_tie", own, at, "em_tie");
    expect((await runtimeStore().getKeepClaim(own.request_id))?.magic_link_id).toBe(newer.magic_id);
    await recordKeepRequested(own.request_id, newer);
    await expect(recordKeepRequested(own.request_id, older)).rejects.toThrow(/unavailable/);
    expect((await readKeepState(own.request_id))?.magic_id).toBe(newer.magic_id);
  });
  it("atomically consumes once, confirms, and issues exactly one owner link", async () => {
    const pending = await seedKeep(); await recordKeepRequested(own.request_id, pending);
    const attempts = await Promise.all(Array.from({ length: 6 }, () => consumeKeepLink(own.request_id, pending.magic_id, at)));
    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect((await readKeepState(own.request_id))?.confirmed_at).toBe(at);
    expect((await readLinkLedger(own.request_id)).links).toHaveLength(1);
    expect((await sql("select consumed_at from magic_links where magic_id='mg_own'")).rows[0].consumed_at).not.toBeNull();
  });
  it("does not call a missing current receipt already used or burn its unconsumed magic link", async () => {
    const pending = await seedKeep();
    const magic = signLink({ scope: "magic", request_id: own.request_id, extra: { magic_id: pending.magic_id } });
    expect(await ClaimPage({ params: Promise.resolve({ magic }) })).toMatchObject({ props: { reason: "unavailable" } });
    expect((await sql("select consumed_at from magic_links where magic_id='mg_own'")).rows[0].consumed_at).toBeNull();
  }, 20_000);
  it("never confirms a superseded or foreign claim, and registration cannot clear a current confirmation", async () => {
    const original = await seedKeep(); await recordKeepRequested(own.request_id, original);
    const current = await seedKeep("mg_new", own, "2026-09-07T03:01:00.000Z", "em_new");
    await recordKeepRequested(own.request_id, current);
    expect(await consumeKeepLink(own.request_id, original.magic_id, at)).toBeNull();
    expect(await consumeKeepLink(other.request_id, current.magic_id, at)).toBeNull();
    expect(await consumeKeepLink(own.request_id, current.magic_id, at)).not.toBeNull();
    await recordKeepRequested(own.request_id, current);
    expect((await readKeepState(own.request_id))?.confirmed_at).toBe(at);
    expect((await sql("select consumed_at from magic_links where magic_id='mg_own'")).rows[0].consumed_at).toBeNull();
  });
  it("rolls back consumption and confirmation if owner issuance fails, then permits a retry", async () => {
    const pending = await seedKeep(); await recordKeepRequested(own.request_id, pending);
    await db.exec(`create function reject_synthetic_issuance() returns trigger language plpgsql as $$ begin raise exception 'synthetic disk/database write failure'; end $$;
      create trigger reject_synthetic_issuance before insert on issued_request_links for each row execute function reject_synthetic_issuance();`);
    try {
      await expect(consumeKeepLink(own.request_id, pending.magic_id, at)).rejects.toThrow(/unavailable/);
      expect((await sql("select consumed_at from magic_links where magic_id='mg_own'")).rows[0].consumed_at).toBeNull();
      expect((await readKeepState(own.request_id))?.confirmed_at).toBeNull();
      expect((await readLinkLedger(own.request_id)).links).toHaveLength(0);
    } finally { await db.exec("drop trigger reject_synthetic_issuance on issued_request_links; drop function reject_synthetic_issuance()"); }
    expect(await consumeKeepLink(own.request_id, pending.magic_id, at)).not.toBeNull();
  }, 20_000);
  it("actual claim route returns unavailable on storage failure without consuming, and redirects on retry", async () => {
    const pending = await seedKeep(); await recordKeepRequested(own.request_id, pending);
    const magic = signLink({ scope: "magic", request_id: own.request_id, extra: { magic_id: pending.magic_id } });
    unavailable = true;
    expect(await ClaimPage({ params: Promise.resolve({ magic }) })).toMatchObject({ props: { reason: "unavailable" } });
    expect((await sql("select consumed_at from magic_links where magic_id='mg_own'")).rows[0].consumed_at).toBeNull();
    unavailable = false;
    await expect(ClaimPage({ params: Promise.resolve({ magic }) })).rejects.toThrow(/^FIXTURE_REDIRECT:\/results\/rq_link_own\?kept=1&k=/);
    expect(await ClaimPage({ params: Promise.resolve({ magic }) })).toMatchObject({ props: { reason: "used" } });
  }, 20_000);
  it("fails closed on missing shared storage and rejects foreign rows without raw backend details", async () => {
    await issueLink({ scope: "packet", request_id: own.request_id });
    corruptRead = true; await expect(readLinkLedger(own.request_id)).rejects.toThrow(/^Shared link history is unavailable\.$/); corruptRead = false;
    unavailable = true;
    await expect(issueLink({ scope: "packet", request_id: own.request_id })).rejects.toThrow(/^Shared link history is unavailable\.$/);
    await expect(readLinkLedger(own.request_id)).rejects.toThrow(/^Shared link history is unavailable\.$/);
    vi.stubEnv("PRN_RUNTIME_STORE", "file"); resetRuntimeStore();
    await expect(readLinkLedger(own.request_id)).rejects.toThrow(/unavailable/);
    expect(existsSync(join(dir, "links"))).toBe(false); expect(existsSync(join(dir, "db.json"))).toBe(false);
  }, 25_000);
});
