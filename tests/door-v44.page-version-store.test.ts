import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";
import { compileDoorV44Page } from "@/domain/search/door-v44/compiler";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { doorPageVersionMetadata, type DoorPageVersionMetadata, type DoorPageReserveInput } from "@/domain/search/door-v44/page-version";
import { doorPageVersionStore } from "@/platform/search/door-page-version-store";
import { readDevDb, updateDevDb } from "@/platform/stores/dev-db";

let directory: string; let dbPath: string; let metadata: DoorPageVersionMetadata;
const at = "2026-09-13T20:00:00Z";
beforeAll(async () => {
  const f = await compilerFixture(); const c = await compileDoorV44Page(f.spec, f.context);
  expect(c.ok).toBe(true); if (!c.ok) throw new Error("fixture compile failed");
  metadata = doorPageVersionMetadata({ ok: true, compiled: c, artifact_hash: c.receipt.artifact_hash, directory: "excluded-local-root", provenance_status: "unattested" });
}, 20_000);
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "door-page-catalog-")); dbPath = join(directory, "store.json"); vi.stubEnv("PRN_DEV_DB_PATH", dbPath); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });
const store = () => doorPageVersionStore(() => null);
const reserveInput = (overrides: Partial<DoorPageReserveInput> = {}): DoorPageReserveInput => ({ tenant_id: metadata.receipt.tenant_id, page_id: metadata.receipt.page_id, canonical_intent_id: metadata.receipt.canonical_intent_id, canonical_url: metadata.receipt.canonical_url, operation_id: "fixture_operation", expected_latest_version: 0, actor: "fixture_actor", reason: "Candidate storage test", at, ...overrides });
async function registration() { const input = reserveInput(); const r = await store().reserveVersion(input); return { tenant_id: input.tenant_id, page_id: input.page_id, reservation_id: r.reservation_id, metadata: structuredClone(metadata), actor: input.actor, reason: input.reason, at }; }
function corrupt(fn: (db: ReturnType<typeof readDevDb>) => void) { const db = JSON.parse(readFileSync(dbPath, "utf8")); fn(db); writeFileSync(dbPath, JSON.stringify(db)); }
const mocked = (value: unknown, error: unknown = null) => ({ rpc: vi.fn().mockResolvedValue({ data: value, error }), from: vi.fn(() => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: value, error }) }) }) })) }) as unknown as SupabaseClient;

describe("candidate PageVersion file catalogue", () => {
  it("retains full immutable receipt metadata without recording directory or implicit publication", async () => {
    updateDevDb((db) => { db.published_page_ids.push("unrelated-existing"); db.signups.push({ fixture: "preserve" } as never); });
    const input = await registration(); const result = await store().registerVersion(input);
    expect(result.metadata).toEqual(metadata); expect(JSON.stringify(result)).not.toContain("excluded-local-root");
    expect(await store().getVersion(input.tenant_id, input.page_id, 1)).toEqual(result);
    expect(readDevDb().published_page_ids).toEqual(["unrelated-existing"]); expect(readDevDb().signups).toEqual([{ fixture: "preserve" }]);
    expect(result.metadata.receipt.release_ready).toBe(false); expect(readDevDb().admin_audit.map((a) => a.action)).toEqual(["door_page_version_reserved", "door_page_version_registered"]);
  });
  it("serializes competing reservations and preserves an unregistered gap across fresh instances", async () => {
    const input = reserveInput(); const outcomes = await Promise.allSettled([store().reserveVersion(input), store().reserveVersion({ ...input, operation_id: "competitor" })]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1); expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
    const second = await store().reserveVersion({ ...input, operation_id: "second", expected_latest_version: 1 }); expect(second.page_version).toBe(2);
    expect(await store().listVersions(input.tenant_id, input.page_id)).toEqual([]); expect(await store().getVersion(input.tenant_id, input.page_id, 1)).toBeNull();
    expect((await store().getReservation(input.tenant_id, input.page_id, "second"))?.page_version).toBe(2);
  });
  it("persists one CAS winner across genuinely separate worker processes", async () => {
    const run = promisify(execFile); const input = reserveInput();
    const script = "const {doorPageVersionStore}=require('./src/platform/search/door-page-version-store.ts'); doorPageVersionStore(()=>null).reserveVersion(JSON.parse(process.argv[1])).then(r=>process.stdout.write(JSON.stringify({version:r.page_version}))).catch(e=>process.stdout.write(JSON.stringify({error:e.code})));";
    const outcomes = await Promise.all(["worker_one", "worker_two", "worker_three"].map((operation_id) => run(process.execPath, ["--import", "tsx", "--eval", script, JSON.stringify({ ...input, operation_id })], { cwd: process.cwd(), env: { ...process.env, PRN_DEV_DB_PATH: dbPath }, timeout: 15000 }).then((r) => JSON.parse(r.stdout))));
    expect(outcomes.filter((r) => r.version === 1)).toHaveLength(1); expect(outcomes.filter((r) => r.error === "DOOR_VERSION_CONFLICT")).toHaveLength(2);
    expect(readDevDb().admin_audit).toHaveLength(1); expect((await store().reserveVersion({ ...input, operation_id: "after_restart", expected_latest_version: 1 })).page_version).toBe(2);
  }, 20_000);
  it("exact retries are idempotent after later allocations without duplicate audit", async () => {
    const input = reserveInput(); const r = await store().reserveVersion(input); await store().reserveVersion({ ...input, operation_id: "next", expected_latest_version: 1 });
    expect(await store().reserveVersion(input)).toEqual(r); expect(readDevDb().admin_audit).toHaveLength(2);
    const reg = { tenant_id: input.tenant_id, page_id: input.page_id, reservation_id: r.reservation_id, metadata, actor: input.actor, reason: input.reason, at };
    const v = await store().registerVersion(reg); expect(await store().registerVersion(reg)).toEqual(v); expect(readDevDb().admin_audit).toHaveLength(3);
  });
  it.each([{ actor: "changed" }, { reason: "changed" }, { at: "2026-09-14T20:00:00Z" }, { expected_latest_version: 1 }, { canonical_url: "https://fixture.example/problems/changed" }, { canonical_intent_id: "changed" }])("refuses changed retry %j without a write", async (change) => {
    const input = reserveInput(); await store().reserveVersion(input); const before = readFileSync(dbPath, "utf8");
    await expect(store().reserveVersion({ ...input, ...change })).rejects.toMatchObject({ code: "DOOR_VERSION_CONFLICT" }); expect(readFileSync(dbPath, "utf8")).toBe(before);
  });
  it("preserves tenant/path/intent identity boundaries", async () => {
    const input = reserveInput(); await store().reserveVersion(input);
    await expect(store().reserveVersion({ ...input, page_id: "other", operation_id: "other", canonical_intent_id: "other" })).rejects.toMatchObject({ code: "DOOR_VERSION_CONFLICT" });
    await expect(store().reserveVersion({ ...input, page_id: "other", operation_id: "other", canonical_url: "https://fixture.example/problems/other" })).rejects.toMatchObject({ code: "DOOR_VERSION_CONFLICT" });
    expect((await store().reserveVersion({ ...input, tenant_id: "other_tenant" })).page_version).toBe(1);
    expect(await store().getReservation("absent_tenant", input.page_id, input.operation_id)).toBeNull();
  });
  it.each(["tenant_id", "page_id", "reservation_id"] as const)("refuses registration with foreign %s", async (field) => {
    const input = await registration(); await expect(store().registerVersion({ ...input, [field]: field === "reservation_id" ? "0".repeat(64) : "other" })).rejects.toMatchObject({ code: "DOOR_VERSION_CONFLICT" });
    expect(readDevDb().door_page_version_catalog[0].versions).toHaveLength(0);
  });
  it("refuses immutable metadata replacement even with a recalculated receipt hash", async () => {
    const input = await registration(); await store().registerVersion(input); const changed = structuredClone(input); changed.metadata.receipt.pending_checks.push("extra"); changed.metadata.receipt_sha256 = doorV44Hash(changed.metadata.receipt);
    await expect(store().registerVersion(changed)).rejects.toMatchObject({ code: "DOOR_VERSION_CONFLICT" }); expect(readDevDb().admin_audit).toHaveLength(2);
  });
  it("returns detached data so callers cannot mutate persisted metadata", async () => {
    const input = await registration(); const result = await store().registerVersion(input); result.metadata.receipt.source_ids.push("mutated"); input.metadata.receipt.source_ids.push("input_mutated");
    expect((await store().getVersion(input.tenant_id, input.page_id, 1))?.metadata).toEqual(metadata);
  });
  it.each(["missing-reservations", "duplicate-reservation", "counter", "metadata", "missing-catalog"])("fails closed on %s without repairing bytes", async (kind) => {
    const input = await registration(); await store().registerVersion(input);
    corrupt((db) => { const c = db.door_page_version_catalog[0]; if (kind === "missing-reservations") delete (c as Partial<typeof c>).reservations; if (kind === "duplicate-reservation") c.reservations.push(c.reservations[0]); if (kind === "counter") c.identities[0].latest_version++; if (kind === "metadata") c.versions[0].metadata.receipt.source_ids.push("changed"); if (kind === "missing-catalog") delete (db as Partial<typeof db>).door_page_version_catalog; });
    const bytes = readFileSync(dbPath, "utf8"); await expect(store().listVersions(input.tenant_id, input.page_id)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" }); await expect(store().reserveVersion(reserveInput({ operation_id: "new", expected_latest_version: 1 }))).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" }); expect(readFileSync(dbPath, "utf8")).toBe(bytes);
  });
  it("rejects getters before evaluating them and caps allocation below SQL integer overflow", async () => {
    const getter = vi.fn(() => "bad"); const input = reserveInput(); Object.defineProperty(input, "actor", { get: getter, enumerable: true });
    await expect(store().reserveVersion(input)).rejects.toMatchObject({ code: "DOOR_VERSION_INVALID" }); expect(getter).not.toHaveBeenCalled();
    await expect(store().reserveVersion(reserveInput({ expected_latest_version: 2147483646 }))).rejects.toMatchObject({ code: "DOOR_VERSION_INVALID" });
  });
});
describe("configured Supabase adapter", () => {
  it("propagates client construction failure without choosing the file store", () => { expect(() => doorPageVersionStore(() => { throw new Error("unavailable"); })).toThrow("DOOR_VERSION_UNAVAILABLE"); });
  it("does not fall back to files after RPC failure", async () => {
    await store().reserveVersion(reserveInput()); const bytes = readFileSync(dbPath, "utf8");
    await expect(doorPageVersionStore(() => mocked(null, { message: "network unavailable" })).reserveVersion(reserveInput())).rejects.toMatchObject({ code: "DOOR_VERSION_UNAVAILABLE" }); expect(readFileSync(dbPath, "utf8")).toBe(bytes);
  });
  it("rejects self-consistent foreign RPC reservation responses", async () => {
    const foreign = await store().reserveVersion(reserveInput({ tenant_id: "foreign" }));
    await expect(doorPageVersionStore(() => mocked(foreign)).reserveVersion(reserveInput())).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" });
  });
  it("rejects self-consistent foreign read responses", async () => {
    const r = await store().reserveVersion(reserveInput({ tenant_id: "foreign" })); const input = reserveInput();
    await expect(doorPageVersionStore(() => mocked([r])).getReservation(input.tenant_id, input.page_id, input.operation_id)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" });
  });
  it("rejects changed registration responses and keeps error codes stable", async () => {
    const input = await registration(); const v = await store().registerVersion(input); v.actor = "foreign_actor";
    await expect(doorPageVersionStore(() => mocked(v)).registerVersion(input)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" });
    await expect(doorPageVersionStore(() => mocked(null, { message: "DOOR_VERSION_CONFLICT" })).registerVersion(input)).rejects.toMatchObject({ code: "DOOR_VERSION_CONFLICT" });
  });
});
