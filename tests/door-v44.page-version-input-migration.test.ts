import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";
import { compileDoorV44Page } from "@/domain/search/door-v44/compiler";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { prepareDoorPageVersionInput, decodeDoorPageVersionInput, verifyDoorPageVersionInputReceipt,
  type DoorPageVersionInputWire } from "@/domain/search/door-v44/page-version-input";
import type { DoorPageVersionReservation } from "@/domain/search/door-v44/page-version";

/** Actual migration SQL, embedded PostgreSQL, synthetic compiler inputs.
 * No listeners, paid calls, hosted/shared-artifact proof or independent QA.
 * Competing operations share PGlite's one serialized connection; these tests
 * establish SQL ordering/transaction behavior, not multi-connection scheduling. */
let db: PGlite;
let baseline: Awaited<ReturnType<typeof compilerFixture>>;
let operation = 0;
const at = "2026-09-13T20:00:00Z";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const sql = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");

async function prepared(numeric = false, inheritedHash = false) {
  const fixture = structuredClone(baseline);
  if (inheritedHash) fixture.context.validation.input_hashes.sql_fixture_governed_sha256 = "a".repeat(64);
  if (numeric) {
    // An unused valid schema definition carries real JSON numbers without
    // changing any homeowner content or the constraints on fixture fields.
    const schema = fixture.context.validation.schema_bundle[0] as Record<string, unknown>;
    schema.definitions = { ...(schema.definitions as object ?? {}), sql_numeric_fixture: {
      type: "number", enum: [0.1, 1e-7, 1e21, 1e308, -0.5],
    } };
  }
  const identity = fixture.spec.identity;
  const latest = (await db.query<{ latest_version: number }>(
    "select latest_version from door_page_identity where tenant_id=$1 and page_id=$2", [identity.tenant_id, identity.page_id])).rows[0]?.latest_version ?? 0;
  const input = { tenant_id: identity.tenant_id, page_id: identity.page_id, canonical_intent_id: identity.canonical_intent_id,
    canonical_url: new URL(identity.canonical_path, fixture.context.validation.origin).href,
    operation_id: `sql_input_${++operation}`, expected_latest_version: latest, actor: "synthetic-test", reason: "Offline input fixture", at };
  const reservation = (await db.query<{ result: DoorPageVersionReservation }>(
    "select reserve_door_page_version($1::jsonb) as result", [JSON.stringify(input)])).rows[0].result;
  fixture.spec.identity.page_version = reservation.page_version;
  const planned = prepareDoorPageVersionInput({ tenant_id: identity.tenant_id, page_id: identity.page_id, reservation_id: reservation.reservation_id,
    spec: fixture.spec, context: fixture.context, model_provenance: { status: "fixture_no_model_calls", fixture_id: "sql_input_fixture" },
    actor: "synthetic-test", reason: "Offline immutable input fixture", at }, reservation);
  return { ...planned, reservation };
}
async function capture(input: unknown) {
  return (await db.query<{ result: DoorPageVersionInputWire }>("select capture_door_page_version_input($1::jsonb) as result", [JSON.stringify(input)])).rows[0].result;
}
async function stored(reservation: DoorPageVersionReservation) {
  return (await db.query<DoorPageVersionInputWire>("select * from door_page_version_input where reservation_id=$1", [reservation.reservation_id])).rows;
}
async function registration(item: Awaited<ReturnType<typeof prepared>>) {
  const compiled = await compileDoorV44Page(item.record.spec, item.record.context);
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) throw new Error("Synthetic compiler baseline failed");
  expect(verifyDoorPageVersionInputReceipt(item.record, compiled.receipt)).toEqual({ ok: true, errors: [] });
  return { tenant_id: item.reservation.tenant_id, page_id: item.reservation.page_id, reservation_id: item.reservation.reservation_id,
    metadata: { receipt: compiled.receipt, receipt_sha256: doorV44Hash(compiled.receipt), provenance_status: "unattested", build_provenance_sha256: null },
    actor: "synthetic-test", reason: "Offline compile association only", at };
}
async function register(input: unknown) {
  return (await db.query<{ result: unknown }>("select register_door_page_version($1::jsonb) as result", [JSON.stringify(input)])).rows[0].result;
}
async function audits() {
  return (await db.query<{ count: number }>("select count(*)::integer as count from admin_audit")).rows[0].count;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;");
  for (const name of ["00002_journey_runtime.sql", "00003_service_role_grants.sql", "00012_page_registry.sql", "00013_admin_audit_duration.sql", "00028_door_page_versions.sql"]) await db.exec(sql(name));
  await db.exec(`create table input_acl_sentinel(id integer); create sequence input_acl_sequence;
    grant select on input_acl_sentinel,input_acl_sequence to authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
  await db.exec(sql("00029_door_page_version_inputs.sql"));
  baseline = await compilerFixture();
}, 20_000);
afterEach(async () => { await db.exec("reset role"); });
afterAll(async () => { await db?.close(); });

describe("governed PageVersion input SQL", () => {
  it("roundtrips decimal/exponent JSON bytes and compiles the exact retrieved snapshot", async () => {
    const item = await prepared(true);
    const row = await capture(item.wire);
    expect(row).toEqual(item.wire);
    expect(await stored(item.reservation)).toEqual([item.wire]);
    expect(row.payload_json).toContain("1e-7");
    expect(row.payload_json).toContain("1e+21");
    expect(row.payload_json).toContain("1e+308");
    expect(sha(row.payload_json)).toBe(item.record.input_sha256);
    const recovered = decodeDoorPageVersionInput(row, item.reservation);
    expect(recovered).toEqual(item.record);
    expect(doorV44Hash(recovered.context)).toBe(item.record.context_sha256);
    expect(await register(await registration({ ...item, record: recovered }))).toBeTruthy();
  });

  it("captures once, retries identically and refuses changed same-reservation inputs", async () => {
    const item = await prepared(); const before = await audits();
    expect(await capture(item.wire)).toEqual(item.wire);
    expect(await capture(item.wire)).toEqual(item.wire);
    expect(await audits()).toBe(before + 1);
    await expect(capture({ ...item.wire, reason: "Changed input identity" })).rejects.toThrow(/DOOR_INPUT_CONFLICT/);
    expect(await stored(item.reservation)).toEqual([item.wire]);
  });

  it("refuses corrupt payload bytes or component hashes before persistence", async () => {
    const item = await prepared(); const before = await audits();
    await expect(capture({ ...item.wire, payload_json: item.wire.payload_json + " " })).rejects.toThrow(/DOOR_INPUT_INVALID/);
    for (const field of ["input_sha256", "spec_sha256", "context_sha256", "schema_sha256", "source_records_sha256", "fact_records_sha256", "asset_records_sha256"]) {
      await expect(capture({ ...item.wire, [field]: "f".repeat(64) })).rejects.toThrow(/DOOR_INPUT_INVALID/);
    }
    expect(await stored(item.reservation)).toEqual([]); expect(await audits()).toBe(before);
  });

  it("refuses changed tenant, page, reservation or version scope", async () => {
    const item = await prepared(); const before = await audits();
    for (const override of [{ tenant_id: "foreign_tenant" }, { page_id: "foreign_page" },
      { reservation_id: "f".repeat(64) }, { page_version: item.reservation.page_version + 1 }]) {
      await expect(capture({ ...item.wire, ...override })).rejects.toThrow(/DOOR_INPUT_(INVALID|CONFLICT)/);
    }
    expect(await stored(item.reservation)).toEqual([]); expect(await audits()).toBe(before);
  });

  it("denies public access and raw service writes while allowing the service capture RPC", async () => {
    const item = await prepared();
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await db.query(`select has_table_privilege($1,'door_page_version_input','SELECT') as read,
        has_table_privilege($1,'door_page_version_input','INSERT') as insert,
        has_table_privilege($1,'door_page_version_input','UPDATE') as update,
        has_table_privilege($1,'door_page_version_input','DELETE') as delete,
        has_function_privilege($1,'capture_door_page_version_input(jsonb)','EXECUTE') as rpc`, [role])).rows[0])
        .toEqual({ read: role === "service_role", insert: false, update: false, delete: false, rpc: role === "service_role" });
    }
    expect((await db.query("select relrowsecurity from pg_class where relname='door_page_version_input'")).rows[0]).toEqual({ relrowsecurity: true });
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(capture(item.wire)).rejects.toThrow(/permission denied/);
      await expect(db.exec("select * from door_page_version_input")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    expect(await capture(item.wire)).toEqual(item.wire);
    await expect(db.exec("update door_page_version_input set reason='changed'")).rejects.toThrow(/permission denied/);
    await expect(db.exec("delete from door_page_version_input")).rejects.toThrow(/permission denied/);
  });

  it("preserves unrelated privileges and protects rows from elevated mutation", async () => {
    expect((await db.query(`select has_table_privilege('authenticated','input_acl_sentinel','SELECT') as table_read,
      has_sequence_privilege('authenticated','input_acl_sequence','SELECT') as sequence_read`)).rows[0]).toEqual({ table_read: true, sequence_read: true });
    const item = await prepared(); await capture(item.wire);
    await expect(db.query("update door_page_version_input set reason='changed' where reservation_id=$1", [item.reservation.reservation_id])).rejects.toThrow(/DOOR_VERSION_CONFLICT immutable row/);
    await expect(db.query("delete from door_page_version_input where reservation_id=$1", [item.reservation.reservation_id])).rejects.toThrow(/DOOR_VERSION_CONFLICT immutable row/);
    expect(await stored(item.reservation)).toEqual([item.wire]);
  });

  it("rolls back capture if its audit cannot be written, preserving the reservation", async () => {
    const item = await prepared(); const before = await audits();
    await db.exec(`create function refuse_input_audit() returns trigger language plpgsql as $$ begin raise exception 'synthetic input audit failure'; end $$;
      create trigger fail_input_audit before insert on admin_audit for each row execute function refuse_input_audit();`);
    try {
      await expect(capture(item.wire)).rejects.toThrow(/synthetic input audit failure/);
      expect(await stored(item.reservation)).toEqual([]); expect(await audits()).toBe(before);
    } finally { await db.exec("drop trigger fail_input_audit on admin_audit"); }
    expect(await capture(item.wire)).toEqual(item.wire);
  });

  it("rejects a mismatching compile receipt and accepts the matching captured-input receipt", async () => {
    const item = await prepared(); await capture(item.wire);
    const good = await registration(item); const before = await audits();
    for (const field of ["spec_sha256", "schema_sha256", "compiler_context_sha256", "context_sha256"]) {
      const bad = structuredClone(good);
      bad.metadata.receipt.input_hashes[field] = "f".repeat(64);
      bad.metadata.receipt_sha256 = doorV44Hash(bad.metadata.receipt);
      const result = await register(bad).then(() => "accepted", (error: Error) => error.message);
      expect(result, `receipt hash ${field}`).toMatch(/DOOR_VERSION_CONFLICT input receipt mismatch/);
    }
    expect(await audits()).toBe(before);
    expect(await register(good)).toBeTruthy();
    expect(await capture(item.wire)).toEqual(item.wire);
  });

  it("refuses late first capture after legacy registration while retaining legacy history", async () => {
    const item = await prepared();
    await register(await registration(item));
    const before = await audits();
    await expect(capture(item.wire)).rejects.toThrow(/DOOR_INPUT_CONFLICT/);
    expect(await stored(item.reservation)).toEqual([]);
    expect(await audits()).toBe(before);
    expect((await db.query("select page_version from door_page_version where reservation_id=$1", [item.reservation.reservation_id])).rows)
      .toEqual([{ page_version: item.reservation.page_version }]);
  });

  it("binds inherited governed-input hashes even when the outer receipt is rehashed", async () => {
    const item = await prepared(false, true); await capture(item.wire);
    const good = await registration(item); const before = await audits();
    const bad = structuredClone(good);
    bad.metadata.receipt.input_hashes.sql_fixture_governed_sha256 = "f".repeat(64);
    bad.metadata.receipt_sha256 = doorV44Hash(bad.metadata.receipt);
    expect(verifyDoorPageVersionInputReceipt(item.record, bad.metadata.receipt).ok).toBe(false);
    const result = await register(bad).then(() => "accepted", (error: Error) => error.message);
    expect(result).toMatch(/DOOR_VERSION_CONFLICT input receipt mismatch/);
    expect(await audits()).toBe(before);
    expect(await register(good)).toBeTruthy();
  });

  it("makes capture/register ordering deterministic with no late-capture window", async () => {
    const captureFirst = await prepared();
    const matching = await registration(captureFirst);
    const first = await Promise.allSettled([capture(captureFirst.wire), register(matching)]);
    expect(first.every(result => result.status === "fulfilled")).toBe(true);
    expect(await stored(captureFirst.reservation)).toEqual([captureFirst.wire]);
    const registerFirst = await prepared();
    const next = await registration(registerFirst);
    const second = await Promise.allSettled([register(next), capture(registerFirst.wire)]);
    expect(second[0].status).toBe("fulfilled");
    expect(second[1]).toMatchObject({ status: "rejected", reason: { message: expect.stringMatching(/DOOR_INPUT_CONFLICT/) } });
    expect(await stored(registerFirst.reservation)).toEqual([]);
  });
});
