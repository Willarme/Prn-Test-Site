import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doorPageVersionStore, listDoorPageIdentities } from "@/platform/search/door-page-version-store";
import type { DoorPageVersionCatalog } from "@/domain/search/door-v44/page-version";

type Row = DoorPageVersionCatalog["identities"][number];
const tenant = "catalog_test";
const row = (n = 0): Row => { const suffix = String(n).padStart(4, "0"); return { tenant_id: tenant, page_id: `page_${suffix}`, canonical_intent_id: `intent_${suffix}`, canonical_url: `https://fixture.example/problems/door-${suffix}`, canonical_path: `/problems/door-${suffix}`, latest_version: 1 }; };
type Reply = { data: unknown; count: unknown; error: unknown };
function remote(replies: Reply[]) {
  const calls: Array<{ table: string; columns?: string; options?: unknown; tenant?: string; order?: unknown; range?: [number, number] }> = [];
  const pending = [...replies];
  const client = { from(table: string) {
    const call: (typeof calls)[number] = { table }; calls.push(call);
    const query = {
      select(columns: string, options: unknown) { call.columns = columns; call.options = options; return query; },
      eq(key: string, value: string) { expect(key).toBe("tenant_id"); call.tenant = value; return query; },
      order(key: string, options: unknown) { call.order = { key, options }; return query; },
      range(start: number, end: number) { call.range = [start, end]; return query; },
      then(resolve: (value: Reply) => unknown) { const reply = pending.shift(); if (!reply) throw new Error("unexpected extra database read"); return Promise.resolve(resolve(reply)); },
    }; return query;
  } } as unknown as SupabaseClient;
  return { client, calls };
}
const reply = (data: unknown, count: unknown, error: unknown = null): Reply => ({ data, count, error });
let directory: string, file: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "door-catalog-reader-")); file = join(directory, "db.json"); vi.stubEnv("PRN_DEV_DB_PATH", file); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });
async function reserve(value: Row, expected = 0, operation = "first") {
  return doorPageVersionStore(() => null).reserveVersion({ tenant_id: value.tenant_id, page_id: value.page_id, canonical_intent_id: value.canonical_intent_id, canonical_url: value.canonical_url,
    operation_id: operation, expected_latest_version: expected, actor: "synthetic-test", reason: "Offline catalog reader fixture", at: "2026-09-13T20:00:00Z" });
}

describe("admin catalog identity discovery", () => {
  it("reads actual reserved identities sorted by page id, retains gaps and filters tenants", async () => {
    await reserve(row(2)); await reserve(row(1)); await reserve(row(1), 1, "next"); await reserve({ ...row(3), tenant_id: "other" });
    const before = readFileSync(file, "utf8");
    expect(await listDoorPageIdentities(tenant, () => null)).toEqual([{ ...row(1), latest_version: 2 }, row(2)]);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(await doorPageVersionStore(() => null).listVersions(tenant, row(1).page_id)).toEqual([]);
  });
  it("returns a truthful empty file catalog", async () => { expect(await listDoorPageIdentities(tenant, () => null)).toEqual([]); });
  it("refuses corrupt file lineage instead of treating it as an empty list", async () => {
    await reserve(row()); const raw = JSON.parse(readFileSync(file, "utf8")); raw.door_page_version_catalog[0].reservations = []; writeFileSync(file, JSON.stringify(raw));
    await expect(listDoorPageIdentities(tenant, () => null)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" });
  });
  it("reads beyond the default 1000-row limit using counted explicit ranges", async () => {
    const rows = Array.from({ length: 1001 }, (_, n) => row(n));
    const r = remote([...Array.from({ length: 5 }, (_, n) => reply(rows.slice(n * 250, n * 250 + 250), rows.length)), reply(null, rows.length)]);
    expect(await listDoorPageIdentities(tenant, () => r.client)).toEqual(rows);
    expect(r.calls.map(c => c.range)).toEqual([[0,249],[250,499],[500,749],[750,999],[1000,1249],undefined]);
    expect(r.calls.every(c => c.table === "door_page_identity" && c.tenant === tenant)).toBe(true);
    expect(r.calls[0].options).toEqual({ count: "exact" }); expect(r.calls[0].order).toEqual({ key: "page_id", options: { ascending: true } });
    expect(r.calls.at(-1)?.options).toEqual({ count: "exact", head: true });
  });
  it("returns an exact empty remote count and deterministic ordering", async () => {
    const empty = remote([reply([], 0), reply(null, 0)]); expect(await listDoorPageIdentities(tenant, () => empty.client)).toEqual([]);
    const unordered = remote([reply([row(2), row(1)], 2), reply(null, 2)]); expect(await listDoorPageIdentities(tenant, () => unordered.client)).toEqual([row(1), row(2)]);
  });
  it.each([
    ["cross-tenant", { ...row(), tenant_id: "foreign" }], ["extra fields", { ...row(), secret: "never-return" }],
    ["path drift", { ...row(), canonical_path: "/problems/other" }], ["noncanonical URL", { ...row(), canonical_url: row().canonical_url + "/" }],
    ["credentials", { ...row(), canonical_url: "https://user:pass@fixture.example/problems/door-0000" }],
    ["zero version", { ...row(), latest_version: 0 }], ["fractional version", { ...row(), latest_version: 1.5 }],
    ["unsafe version", { ...row(), latest_version: Number.MAX_SAFE_INTEGER }],
  ])("refuses %s remote identity", async (_label, value) => {
    const r = remote([reply([value], 1)]); await expect(listDoorPageIdentities(tenant, () => r.client)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" });
  });
  it.each(["page", "path", "intent"])("refuses duplicate %s identity", async kind => {
    const second = row(1); if (kind === "page") second.page_id = row().page_id;
    if (kind === "path") { second.canonical_path = row().canonical_path; second.canonical_url = row().canonical_url; }
    if (kind === "intent") second.canonical_intent_id = row().canonical_intent_id;
    const r = remote([reply([row(), second], 2)]); await expect(listDoorPageIdentities(tenant, () => r.client)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" });
  });
  it.each([null, -1, 1.5, "1"])("refuses absent or invalid exact count %s", async count => {
    const r = remote([reply([row()], count)]); await expect(listDoorPageIdentities(tenant, () => r.client)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" });
  });
  it("refuses truncated pages and final count drift", async () => {
    const truncated = remote([reply([row()], 251)]); await expect(listDoorPageIdentities(tenant, () => truncated.client)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" });
    const drift = remote([reply([row()], 1), reply(null, 2)]); await expect(listDoorPageIdentities(tenant, () => drift.client)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" });
  });
  it("refuses cross-page repetition and count changes during pagination", async () => {
    const rows = Array.from({ length: 250 }, (_, n) => row(n));
    const repeated = remote([reply(rows, 251), reply([row()], 251), reply(null, 251)]);
    await expect(listDoorPageIdentities(tenant, () => repeated.client)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" });
    const changed = remote([reply(rows, 251), reply([row(250)], 252)]);
    await expect(listDoorPageIdentities(tenant, () => changed.client)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" });
  });
  it("refuses oversized catalogs without returning partial rows", async () => {
    const r = remote([reply([row()], 10001)]); await expect(listDoorPageIdentities(tenant, () => r.client)).rejects.toMatchObject({ code: "DOOR_VERSION_UNAVAILABLE" });
    expect(r.calls).toHaveLength(1);
  });
  it.each(["missing schema", "connection failure", "final count failure"])("never falls back to file on %s", async kind => {
    await reserve(row()); const before = readFileSync(file, "utf8");
    const error = { message: kind, code: kind === "missing schema" ? "42P01" : "08006" };
    const r = remote(kind === "final count failure" ? [reply([row()], 1), reply(null, null, error)] : [reply(null, null, error)]);
    await expect(listDoorPageIdentities(tenant, () => r.client)).rejects.toMatchObject({ code: "DOOR_VERSION_UNAVAILABLE" }); expect(readFileSync(file, "utf8")).toBe(before);
  });
  it("rejects invalid tenant before touching provider; provider failure stays unavailable", async () => {
    const provider = vi.fn(() => null); await expect(listDoorPageIdentities("../foreign", provider)).rejects.toMatchObject({ code: "DOOR_VERSION_INVALID" }); expect(provider).not.toHaveBeenCalled();
    await expect(listDoorPageIdentities(tenant, () => { throw new Error("configured failure"); })).rejects.toMatchObject({ code: "DOOR_VERSION_UNAVAILABLE" });
  });
});
