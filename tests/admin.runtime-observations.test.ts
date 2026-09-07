import { mkdtempSync, writeFileSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ database: false, rows: {} as Record<string, { data?: unknown; count?: unknown; error?: unknown }>, from: vi.fn() }));
vi.mock("@/platform/db/client", async original => ({ ...await original<typeof import("@/platform/db/client")>(),
  serviceConfigured: () => backend.database, requireServiceClient: () => ({ from: backend.from }), requestScopedClient: () => null,
}));
import { unguardedRuntimeStore } from "@/platform/stores/runtime";
import { readDevDb, updateDevDb } from "@/platform/stores/dev-db";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prn-runtime-observe-")); vi.stubEnv("PRN_DEV_DB_PATH", join(root, "db.json")); vi.stubEnv("PRN_RUNTIME_STORE", "file");
  backend.database = false; backend.rows = {}; backend.from.mockReset();
  backend.from.mockImplementation((table: string) => {
    const result = () => Promise.resolve(backend.rows[table] ?? { data: [], count: 0, error: null });
    const query = { select: () => query, order: () => query, eq: () => query, limit: () => query, maybeSingle: result,
      then: (yes: (value: unknown) => unknown, no?: (error: unknown) => unknown) => result().then(yes, no) };
    return query;
  });
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

describe("runtime counts and administrative reads never fabricate a healthy zero", () => {
  it("accepts a genuinely new empty file store and persisted empty collections", async () => {
    expect(await unguardedRuntimeStore().totals()).toEqual({ journeys: 0, packets: 0, consents: 0 });
    updateDevDb(() => {});
    expect(await unguardedRuntimeStore().listJourneys()).toEqual([]); expect(await unguardedRuntimeStore().listAudit()).toEqual([]);
  });
  it.each(["{broken", "{}", '{"intake_sessions":{},"packets":[],"consent_events":[]}'])("reports a damaged/incomplete established store without overwriting it: %s", async raw => {
    updateDevDb(() => {}); const filename = process.env.PRN_DEV_DB_PATH!; writeFileSync(filename, raw);
    await expect(unguardedRuntimeStore().totals()).rejects.toThrow(/damaged/);
    expect(readFileSync(filename, "utf8")).toBe(raw);
  });
  it("keeps legacy defaulting out of admin collection reads only", async () => {
    updateDevDb(() => {}); writeFileSync(process.env.PRN_DEV_DB_PATH!, "{}");
    expect(readDevDb().intake_sessions).toEqual([]);
    for (const read of [() => unguardedRuntimeStore().listJourneys(), () => unguardedRuntimeStore().listAudit(), () => unguardedRuntimeStore().getPublishedPageIds()]) await expect(read()).rejects.toThrow(/damaged/);
  });
  it("distinguishes an established missing file from first startup", async () => {
    updateDevDb(() => {}); unlinkSync(process.env.PRN_DEV_DB_PATH!);
    await expect(unguardedRuntimeStore().totals()).rejects.toThrow(/unavailable/);
  });
  it("accepts measured database zeroes", async () => {
    backend.database = true;
    expect(await unguardedRuntimeStore().totals()).toEqual({ journeys: 0, packets: 0, consents: 0 });
    expect(await unguardedRuntimeStore().listJourneys()).toEqual([]);
  });
  it.each([null, undefined, -1, 1.5, Infinity, NaN, "0"])("rejects an unavailable or invalid database count %s", async count => {
    backend.database = true; backend.rows.job_packet = { count, error: null };
    await expect(unguardedRuntimeStore().totals()).rejects.toThrow(/unavailable/);
  });
  it("does not turn source errors or null data into empty lists", async () => {
    backend.database = true;
    backend.rows.intake_session = { data: null, error: null };
    await expect(unguardedRuntimeStore().listJourneys()).rejects.toThrow(/unavailable/);
    backend.rows.intake_session = { count: 0, error: { message: "offline" } };
    await expect(unguardedRuntimeStore().totals()).rejects.toThrow(/unavailable/);
    backend.rows.published_page = { data: null, error: null }; backend.rows.admin_audit = { data: null, error: null };
    await expect(unguardedRuntimeStore().getPublishedPageIds()).rejects.toThrow(/unavailable/);
    await expect(unguardedRuntimeStore().listAudit()).rejects.toThrow(/unavailable/);
  });
  it("separates an incomplete session from a failed joined problem or packet read", async () => {
    backend.database = true; backend.rows.intake_session = { data: [{ intake_session_id: "is_fixture" }], error: null };
    backend.rows.problem_record = { data: null, error: null };
    expect(await unguardedRuntimeStore().listJourneys()).toEqual([]);
    backend.rows.problem_record = { data: null, error: { message: "offline" } };
    await expect(unguardedRuntimeStore().listJourneys()).rejects.toThrow(/problems/);
    backend.rows.problem_record = { data: { problem_id: "pb_fixture" }, error: null };
    backend.rows.job_packet = { data: null, error: { message: "offline" } };
    await expect(unguardedRuntimeStore().listJourneys()).rejects.toThrow(/packets/);
  });
});
