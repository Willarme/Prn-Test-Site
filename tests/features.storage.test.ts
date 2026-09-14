import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureInterestInput, SetFeatureStatesInput } from "@/domain/features/types";
const mock = vi.hoisted(() => ({ configured: false, rpc: vi.fn() }));
vi.mock("@/platform/db/client", () => ({ serviceConfigured: () => mock.configured,
  requireServiceClient: () => ({ rpc: mock.rpc }), requestScopedClient: () => null, serviceClientProvider: () => null }));
import { FeatureStateConflictError, FeatureInterestRateLimitError, FeatureInterestUnavailableError, unguardedRuntimeStore } from "@/platform/stores/runtime";
import { readDevDb, updateDevDbAtomic } from "@/platform/stores/dev-db";
import { applyQualityGuard } from "@/platform/quality/ingest";
let dir: string;
const at = "2026-09-13T12:00:00.000Z";
const change = (feature = "marketing", expected_version = 0): SetFeatureStatesInput => ({ tenant_id: "trial",
  changes: [{ feature_id: feature, state: "PREVIEW", expected_version }], actor: "system", reason: "fixture", decision_ref: "test-only", at });
const interest = (): FeatureInterestInput => ({ tenant_id: "trial", feature_id: "marketing", feature_version: 1,
  page: "/pages/marketing", answer: "yes", visitor_hash: "a".repeat(64), dedupe_key: "b".repeat(64), created_at: at });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feature-store-test-"));
  vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "store.json")); vi.stubEnv("VERCEL", ""); vi.stubEnv("NODE_ENV", "test");
  mock.configured = false; mock.rpc.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });
describe("feature storage adapters", () => {
  it("persists versioned changes with audit and preserves all unrelated collections", async () => {
    updateDevDbAtomic(db => { db.published_page_ids.push("existing"); db.quality_findings.push({ fixture: true }); });
    const before = readDevDb();
    const store = applyQualityGuard(unguardedRuntimeStore());
    expect(await store.listFeatureStates("trial")).toEqual([]);
    expect((await store.setFeatureStates(change()))[0]).toMatchObject({ version: 1, state: "PREVIEW" });
    const restarted = unguardedRuntimeStore();
    expect((await restarted.listFeatureStates("trial"))[0].version).toBe(1);
    expect(await restarted.listFeatureStates("other")).toEqual([]);
    const after = readDevDb();
    for (const key of Object.keys(before) as Array<keyof typeof before>) {
      if (key !== "feature_states" && key !== "admin_audit") expect(after[key]).toEqual(before[key]);
    }
    expect(after.admin_audit).toHaveLength(1);
    expect(JSON.parse(after.admin_audit[0].detail!)).toMatchObject({ previous_version: 0, previous_state: null, version: 1, actor: "system" });
  });
  it("rolls back every bulk change and audit on one stale expected version", async () => {
    const store = unguardedRuntimeStore(); await store.setFeatureStates(change());
    const bytes = readFileSync(join(dir, "store.json"), "utf8");
    const input = change("first"); input.changes.push(change().changes[0]);
    await expect(store.setFeatureStates(input)).rejects.toBeInstanceOf(FeatureStateConflictError);
    expect(readFileSync(join(dir, "store.json"), "utf8")).toBe(bytes);
    expect((await store.setFeatureStates({ ...change("marketing", 1), changes: [{ feature_id: "marketing", state: "HIDDEN", expected_version: 1 }] }))[0].version).toBe(2);
  });
  it("deduplicates after re-instantiation and returns only tenant aggregate counts", async () => {
    const store = applyQualityGuard(unguardedRuntimeStore());
    await store.setFeatureStates(change());
    expect(await store.recordFeatureInterest({ ...interest(), raw_ip: "must-not-persist" } as FeatureInterestInput)).toEqual({ created: true });
    expect(await unguardedRuntimeStore().recordFeatureInterest(interest())).toEqual({ created: false });
    expect(await store.recordFeatureInterest({ ...interest(), dedupe_key: "c".repeat(64) })).toEqual({ created: false });
    await store.setFeatureStates({ ...change(), tenant_id: "other" });
    await store.recordFeatureInterest({ ...interest(), tenant_id: "other", answer: "no" });
    expect(await store.listFeatureInterestCounts("trial")).toEqual([{ feature_id: "marketing", yes: 1, no: 0, maybe: 0, total: 1 }]);
    expect(readFileSync(join(dir, "store.json"), "utf8")).not.toContain("must-not-persist");
    expect(readDevDb().admin_audit.filter(r => r.action === "feature_interest_recorded")).toHaveLength(2);
    await expect(store.recordFeatureInterest({ ...interest(), page: "/pages/marketing?email=private" })).rejects.toThrow(/Invalid/);
  });
  it("rejects local feature storage in production and hosted previews", async () => {
    const store = unguardedRuntimeStore(); vi.stubEnv("NODE_ENV", "production");
    await expect(store.listFeatureStates("trial")).rejects.toThrow(/Shared feature storage/);
    await expect(store.setFeatureStates(change())).rejects.toThrow(/Shared feature storage/);
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("VERCEL", "1");
    await expect(store.recordFeatureInterest(interest())).rejects.toThrow(/Shared feature storage/);
  });
  it("forwards one atomic RPC and maps conflicts without a local fallback", async () => {
    mock.configured = true; const store = unguardedRuntimeStore();
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002" } });
    await expect(store.setFeatureStates(change())).rejects.toBeInstanceOf(FeatureStateConflictError);
    expect(mock.rpc).toHaveBeenCalledWith("set_feature_states", { p_tenant_id: "trial", p_changes: change().changes,
      p_actor: "system", p_reason: "fixture", p_decision_ref: "test-only", p_at: at });
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: "42P01" } });
    await expect(store.recordFeatureInterest(interest())).rejects.toThrow(/unavailable/);
    expect(readDevDb().feature_interest).toEqual([]);
  });
  it("rejects stale/absent previews and caps persisted visitor responses across store instances", async () => {
    const store = unguardedRuntimeStore();
    await expect(store.recordFeatureInterest(interest())).rejects.toBeInstanceOf(FeatureInterestUnavailableError);
    await store.setFeatureStates({ ...change(), changes: Array.from({ length: 21 }, (_, n) => change(`feature_${n}`).changes[0]) });
    const input = (n: number) => ({ ...interest(), feature_id: `feature_${n}`, dedupe_key: n.toString(16).padStart(64, "0") });
    await expect(store.recordFeatureInterest({ ...input(0), feature_version: 0 })).rejects.toBeInstanceOf(FeatureInterestUnavailableError);
    for (let n = 0; n < 20; n++) await unguardedRuntimeStore().recordFeatureInterest(input(n));
    await expect(unguardedRuntimeStore().recordFeatureInterest(input(20))).rejects.toBeInstanceOf(FeatureInterestRateLimitError);
    expect(await store.recordFeatureInterest(input(0))).toEqual({ created: false });
    expect(readDevDb().feature_interest).toHaveLength(20);
    expect(await store.recordFeatureInterest({ ...input(20), created_at: "2026-09-13T12:01:01.000Z" })).toEqual({ created: true });
    await store.setFeatureStates({ ...change("feature_0", 1), changes: [{ feature_id: "feature_0", state: "HIDDEN", expected_version: 1 }] });
    await expect(store.recordFeatureInterest({ ...input(0), visitor_hash: "d".repeat(64), dedupe_key: "e".repeat(64) })).rejects.toBeInstanceOf(FeatureInterestUnavailableError);
  });
});
