import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";

/** Actual production SQL in embedded PostgreSQL. No HTTP listener, hosted
 * project, artifact publication or independent QA is exercised by this suite.
 * PGlite serializes one connection: competing calls prove transaction/CAS
 * outcomes, not PostgreSQL multi-connection lock scheduling. */
let db: PGlite;
const at = "2026-09-13T20:00:00Z";
const migration = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
const tables = ["door_page_identity", "door_page_version_reservation", "door_page_version"];
interface Reservation {
  reservation_id: string; tenant_id: string; page_id: string; page_version: number;
  operation_id: string; expected_latest_version: number; canonical_intent_id: string; canonical_url: string;
}
function command(tenant: string, override: Record<string, unknown> = {}) {
  return { tenant_id: tenant, page_id: "page_synthetic", canonical_intent_id: "intent_synthetic",
    canonical_url: "https://example.test/problems/synthetic-door",
    operation_id: "op_synthetic", expected_latest_version: 0, actor: "synthetic-test",
    reason: "Offline SQL contract fixture only", at, ...override };
}
async function reserve(input: ReturnType<typeof command>): Promise<Reservation> {
  return (await db.query<{ result: Reservation }>("select public.reserve_door_page_version($1::jsonb) as result", [JSON.stringify(input)])).rows[0].result;
}
async function auditCount(): Promise<number> {
  return (await db.query<{ count: number }>("select count(*)::integer as count from admin_audit")).rows[0].count;
}
function metadata(reservation: Reservation) {
  // SQL metadata fixture only. No corresponding artifact or QA approval exists.
  const hash = "a".repeat(64);
  const receipt = { receipt_id: "synthetic_sql_fixture", compiler_version: "door-v44-compiler/1.0.0", content_baseline_id: "ac-v43",
    tenant_id: reservation.tenant_id, page_id: reservation.page_id, page_version: reservation.page_version,
    canonical_intent_id: reservation.canonical_intent_id, canonical_url: reservation.canonical_url,
    input_hashes: { synthetic_fixture: hash }, html_hash: hash, semantic_hash: hash, artifact_hash: hash,
    robots: "noindex,nofollow", date_modified: null, visible_components: [], source_ids: [], claim_ids: [], section_order: [],
    derived_counts: {}, rendered_capability_ids: [], constants: [], mode: "fixture", release_ready: false,
    pending_checks: ["synthetic_sql_fixture_no_artifact_or_qa"], wording_findings: [] };
  return { receipt, receipt_sha256: doorV44Hash(receipt), provenance_status: "unattested", build_provenance_sha256: null };
}
function registration(reservation: Reservation, saved = metadata(reservation)) {
  return { tenant_id: reservation.tenant_id, page_id: reservation.page_id, reservation_id: reservation.reservation_id,
    metadata: saved, actor: "synthetic-test", reason: "Offline metadata fixture only", at };
}
async function register(input: unknown) {
  return (await db.query<{ result: { tenant_id: string; page_id: string; page_version: number; reservation_id: string; metadata: ReturnType<typeof metadata> } }>(
    "select public.register_door_page_version($1::jsonb) as result", [JSON.stringify(input)])).rows[0].result;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;`);
  for (const name of ["00002_journey_runtime.sql", "00003_service_role_grants.sql", "00012_page_registry.sql", "00013_admin_audit_duration.sql"]) {
    await db.exec(migration(name));
  }
  // Deliberately permissive inherited defaults: the migration must explicitly
  // protect its tables/functions without changing unrelated existing ACLs.
  await db.exec(`create table unrelated_catalogue_fixture(id integer primary key);
    create sequence unrelated_catalogue_sequence;
    grant select on unrelated_catalogue_fixture to authenticated;
    grant select on unrelated_catalogue_sequence to authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
  await db.exec(migration("00028_door_page_versions.sql"));
}, 20_000);
afterEach(async () => { await db.exec("reset role"); });
afterAll(async () => { await db?.close(); });

describe("immutable door PageVersion SQL catalogue", () => {
  it("allows service RPCs while denying raw writes and anonymous/authenticated access", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const table of tables) {
        const access = (await db.query(`select has_table_privilege($1,$2,'SELECT') as can_read,
          has_table_privilege($1,$2,'INSERT') as can_insert, has_table_privilege($1,$2,'UPDATE') as can_update,
          has_table_privilege($1,$2,'DELETE') as can_delete`, [role, table])).rows[0];
        expect(access).toEqual({ can_read: role === "service_role", can_insert: false, can_update: false, can_delete: false });
      }
      for (const rpc of ["reserve_door_page_version(jsonb)", "register_door_page_version(jsonb)"]) {
        expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, rpc])).rows[0])
          .toEqual({ allowed: role === "service_role" });
      }
    }
    expect((await db.query("select relrowsecurity from pg_class where relname=any($1::text[])", [tables])).rows)
      .toEqual(tables.map(() => ({ relrowsecurity: true })));
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(reserve(command("denied"))).rejects.toThrow(/permission denied/);
      for (const table of tables) await expect(db.query(`select * from ${table}`)).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    expect((await reserve(command("service"))).page_version).toBe(1);
    for (const table of tables) await expect(db.exec(`delete from ${table}`)).rejects.toThrow(/permission denied/);
  });

  it("preserves unrelated table and sequence privileges", async () => {
    expect((await db.query(`select has_table_privilege('authenticated','unrelated_catalogue_fixture','SELECT') as table_read,
      has_sequence_privilege('authenticated','unrelated_catalogue_sequence','SELECT') as sequence_read`)).rows[0])
      .toEqual({ table_read: true, sequence_read: true });
  });

  it("rejects malformed reservation inputs before allocating any identity or audit", async () => {
    const before = await auditCount();
    for (const override of [{ expected_latest_version: -1 }, { expected_latest_version: 0.5 },
      { canonical_url: "https://example.test/problems/synthetic-door?private=value" },
      { canonical_url: "https://user:pass@example.test/problems/synthetic-door" },
      { canonical_url: "https://example.test:99999/problems/synthetic-door" },
      { canonical_url: "https://example.test:443/problems/synthetic-door" },
      { canonical_url: "https://example.test/start" }, { tenant_id: "invalid tenant" },
      { operation_id: "" }, { actor: "" }, { at: "not-a-date" }]) {
      await expect(reserve(command("invalid_input", override))).rejects.toThrow(/DOOR_VERSION_INVALID/);
    }
    expect((await db.query("select * from door_page_identity where tenant_id='invalid_input'")).rows).toEqual([]);
    expect(await auditCount()).toBe(before);
  });

  it("returns a stable invalid-input refusal for syntactically ISO but impossible dates", async () => {
    await expect(reserve(command("invalid_date", { at: "2026-02-31T20:00:00Z" }))).rejects.toThrow(/DOOR_VERSION_INVALID/);
    expect((await db.query("select * from door_page_identity where tenant_id='invalid_date'")).rows).toEqual([]);
  });

  it("retries one reservation idempotently without advancing its version or duplicating audit", async () => {
    const input = command("retry");
    const before = await auditCount();
    const first = await reserve(input);
    const retry = await reserve(input);
    expect(first).toMatchObject({ tenant_id: "retry", page_id: "page_synthetic", page_version: 1, operation_id: "op_synthetic", expected_latest_version: 0 });
    expect(retry).toEqual(first);
    expect(await auditCount()).toBe(before + 1);
    expect((await db.query("select latest_version from door_page_identity where tenant_id='retry'")).rows).toEqual([{ latest_version: 1 }]);
  });

  it("gives competing CAS operations exactly one version and retains unused reserved gaps", async () => {
    const before = await auditCount();
    const results = await Promise.allSettled([reserve(command("cas", { operation_id: "first" })), reserve(command("cas", { operation_id: "second" }))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await auditCount()).toBe(before + 1);
    const next = await reserve(command("cas", { operation_id: "third", expected_latest_version: 1 }));
    expect(next.page_version).toBe(2);
    await expect(reserve(command("cas", { operation_id: "stale", expected_latest_version: 0 }))).rejects.toThrow(/DOOR_VERSION_CONFLICT/);
    expect((await db.query("select page_version from door_page_version_reservation where tenant_id='cas' order by page_version")).rows)
      .toEqual([{ page_version: 1 }, { page_version: 2 }]);
    expect((await db.query("select * from door_page_version where tenant_id='cas'")).rows).toEqual([]);
  });

  it("refuses operation identity changes without mutating the original reservation", async () => {
    const original = await reserve(command("identity"));
    const before = await auditCount();
    for (const override of [{ expected_latest_version: 1 }, { canonical_intent_id: "changed_intent" },
      { canonical_url: "https://example.test/problems/changed" }]) {
      await expect(reserve(command("identity", override))).rejects.toThrow(/DOOR_VERSION_CONFLICT/);
    }
    expect(await reserve(command("identity"))).toEqual(original);
    expect(await auditCount()).toBe(before);
  });

  it("refuses a second page claiming a canonical URL/path or intent within one tenant", async () => {
    await reserve(command("unique"));
    await expect(reserve(command("unique", { page_id: "another_page", operation_id: "another_op", canonical_intent_id: "another_intent" })))
      .rejects.toThrow(/DOOR_VERSION_CONFLICT/);
    await expect(reserve(command("unique", { page_id: "another_page", operation_id: "another_op",
      canonical_url: "https://example.test/problems/another" })))
      .rejects.toThrow(/DOOR_VERSION_CONFLICT/);
    expect((await db.query("select count(*)::integer as count from door_page_identity where tenant_id='unique'")).rows[0]).toEqual({ count: 1 });
  });

  it("isolates identical page and operation IDs across tenants and advances versions independently", async () => {
    const a = await reserve(command("tenant_a"));
    const b = await reserve(command("tenant_b"));
    expect(a.reservation_id).not.toBe(b.reservation_id);
    expect(a.page_version).toBe(1); expect(b.page_version).toBe(1);
    await reserve(command("tenant_a", { operation_id: "next", expected_latest_version: 1 }));
    expect((await db.query("select tenant_id,latest_version from door_page_identity where tenant_id in ('tenant_a','tenant_b') order by tenant_id")).rows)
      .toEqual([{ tenant_id: "tenant_a", latest_version: 2 }, { tenant_id: "tenant_b", latest_version: 1 }]);
  });

  it("registers the exact reserved metadata once and refuses replacement under the same version", async () => {
    const reservation = await reserve(command("register_once"));
    const input = registration(reservation);
    const before = await auditCount();
    const saved = await register(input);
    expect(saved).toMatchObject({ tenant_id: reservation.tenant_id, page_id: reservation.page_id,
      page_version: 1, reservation_id: reservation.reservation_id, metadata: input.metadata });
    expect(await register(input)).toEqual(saved);
    expect(await auditCount()).toBe(before + 1);
    const changed = structuredClone(input);
    changed.metadata.receipt.html_hash = "b".repeat(64);
    changed.metadata.receipt_sha256 = doorV44Hash(changed.metadata.receipt);
    await expect(register(changed)).rejects.toThrow(/DOOR_VERSION_CONFLICT/);
    expect((await db.query("select metadata from door_page_version where tenant_id='register_once'")).rows)
      .toEqual([{ metadata: input.metadata }]);
    await db.exec("set role service_role");
    await expect(db.exec("update door_page_version set metadata='{}'::jsonb where tenant_id='register_once'")).rejects.toThrow(/permission denied/);
  });

  it("rejects a reservation from another tenant/page and a receipt for another version", async () => {
    const reservation = await reserve(command("register_scope"));
    const input = registration(reservation);
    const before = await auditCount();
    await expect(register({ ...input, tenant_id: "foreign_scope" })).rejects.toThrow(/DOOR_VERSION_(CONFLICT|INVALID)/);
    await expect(register({ ...input, page_id: "foreign_page" })).rejects.toThrow(/DOOR_VERSION_(CONFLICT|INVALID)/);
    for (const field of ["tenant_id", "page_id", "canonical_intent_id", "canonical_url", "page_version"] as const) {
      const changed = structuredClone(input);
      if (field === "page_version") changed.metadata.receipt.page_version = 2;
      else changed.metadata.receipt[field] = field === "canonical_url" ? "https://example.test/problems/foreign" : "foreign";
      changed.metadata.receipt_sha256 = doorV44Hash(changed.metadata.receipt);
      await expect(register(changed)).rejects.toThrow(/DOOR_VERSION_(CONFLICT|INVALID)/);
    }
    expect(await auditCount()).toBe(before);
    expect((await db.query("select * from door_page_version where tenant_id='register_scope'")).rows).toEqual([]);
  });

  it("retains older immutable versions and identical version numbers in another tenant", async () => {
    const first = await reserve(command("history"));
    const firstInput = registration(first);
    await register(firstInput);
    const second = await reserve(command("history", { expected_latest_version: 1, operation_id: "second" }));
    await register(registration(second));
    const other = await reserve(command("history_other"));
    await register(registration(other));
    expect((await db.query("select tenant_id,page_version from door_page_version where tenant_id in ('history','history_other') order by tenant_id,page_version")).rows)
      .toEqual([{ tenant_id: "history", page_version: 1 }, { tenant_id: "history", page_version: 2 }, { tenant_id: "history_other", page_version: 1 }]);
    expect((await db.query("select metadata from door_page_version where tenant_id='history' and page_version=1")).rows)
      .toEqual([{ metadata: firstInput.metadata }]);
  });

  it("refuses forged metadata hashes and release flags without writing a version", async () => {
    const reservation = await reserve(command("metadata_invalid"));
    const good = registration(reservation);
    const wrongHash = structuredClone(good);
    wrongHash.metadata.receipt_sha256 = "f".repeat(64);
    await expect(register(wrongHash)).rejects.toThrow(/DOOR_VERSION_INVALID/);
    const released = structuredClone(good);
    released.metadata.receipt.release_ready = true;
    released.metadata.receipt_sha256 = doorV44Hash(released.metadata.receipt);
    await expect(register(released)).rejects.toThrow(/DOOR_VERSION_INVALID/);
    expect((await db.query("select * from door_page_version where tenant_id='metadata_invalid'")).rows).toEqual([]);
  });

  it("rejects null required receipt fields and nested severity instead of accepting SQL unknown", async () => {
    const reservation = await reserve(command("metadata_null"));
    const good = registration(reservation);
    for (const field of Object.keys(good.metadata.receipt).filter(key => key !== "date_modified")) {
      const changed = structuredClone(good);
      Object.assign(changed.metadata.receipt, { [field]: null });
      changed.metadata.receipt_sha256 = doorV44Hash(changed.metadata.receipt);
      await expect(register(changed), `required receipt field ${field}`).rejects.toThrow(/DOOR_VERSION_INVALID/);
    }
    const nested = structuredClone(good);
    Object.assign(nested.metadata.receipt, { wording_findings: [{ code: "SYNTHETIC", pointer: "/fixture", severity: null }] });
    nested.metadata.receipt_sha256 = doorV44Hash(nested.metadata.receipt);
    await expect(register(nested)).rejects.toThrow(/DOOR_VERSION_INVALID/);
    expect((await db.query("select * from door_page_version where tenant_id='metadata_null'")).rows).toEqual([]);
  });

  it("blocks elevated direct UPDATE and DELETE of registered and reserved history", async () => {
    const reservation = await reserve(command("elevated_immutable"));
    await register(registration(reservation));
    // Default PGlite owner role has privileges; triggers must enforce immutability.
    await expect(db.query("update door_page_identity set canonical_intent_id='changed_intent' where tenant_id='elevated_immutable'"))
      .rejects.toThrow(/DOOR_VERSION_CONFLICT/);
    await expect(db.query("delete from door_page_identity where tenant_id='elevated_immutable'"))
      .rejects.toThrow(/DOOR_VERSION_CONFLICT/);
    for (const table of ["door_page_version_reservation", "door_page_version"]) {
      await expect(db.query(`update ${table} set actor='changed' where tenant_id='elevated_immutable'`)).rejects.toThrow(/DOOR_VERSION_CONFLICT/);
      await expect(db.query(`delete from ${table} where tenant_id='elevated_immutable'`)).rejects.toThrow(/DOOR_VERSION_CONFLICT/);
    }
  });

  it("rolls back registration when audit fails while retaining its already allocated reservation", async () => {
    const reservation = await reserve(command("register_audit"));
    const before = await auditCount();
    await db.exec(`create function reject_door_registration_audit() returns trigger language plpgsql as $$ begin raise exception 'synthetic registration audit unavailable'; end $$;
      create trigger fail_door_registration_audit before insert on admin_audit for each row execute function reject_door_registration_audit();`);
    try {
      await expect(register(registration(reservation))).rejects.toThrow(/synthetic registration audit unavailable/);
      expect((await db.query("select * from door_page_version where tenant_id='register_audit'")).rows).toEqual([]);
      expect((await db.query("select page_version from door_page_version_reservation where tenant_id='register_audit'")).rows).toEqual([{ page_version: 1 }]);
      expect(await auditCount()).toBe(before);
    } finally { await db.exec("drop trigger fail_door_registration_audit on admin_audit"); }
    expect((await register(registration(reservation))).page_version).toBe(1);
  });

  it("rolls back identity, reservation, version allocation and audit together when audit fails", async () => {
    const before = await auditCount();
    await db.exec(`create function reject_door_version_audit() returns trigger language plpgsql as $$ begin raise exception 'synthetic audit unavailable'; end $$;
      create trigger fail_door_version_audit before insert on admin_audit for each row execute function reject_door_version_audit();`);
    try {
      await expect(reserve(command("audit_failure"))).rejects.toThrow(/synthetic audit unavailable/);
      expect((await db.query("select * from door_page_identity where tenant_id='audit_failure'")).rows).toEqual([]);
      expect((await db.query("select * from door_page_version_reservation where tenant_id='audit_failure'")).rows).toEqual([]);
      expect(await auditCount()).toBe(before);
    } finally { await db.exec("drop trigger fail_door_version_audit on admin_audit"); }
    expect((await reserve(command("audit_failure"))).page_version).toBe(1);
  });
});
