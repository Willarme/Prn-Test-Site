import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureStateRow, SetFeatureStatesInput } from "@/domain/features/types";
import type { RuntimeStore } from "@/platform/stores/runtime";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { sessionCookie } from "@/platform/admin/auth";
import { resetAdminMutationLimitForTests } from "@/platform/admin/request";
import { GET, PUT } from "@/app/api/admin/features/route";
import { featureHref, featureRouteRefusal, invalidateFeatureStates, readFeatureSnapshot, saveFeatureChanges, stateIn } from "@/platform/features/state";

const context = vi.hoisted(() => ({ cookie: "", constructorFailure: false }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => context.cookie ? { value: context.cookie } : undefined }), headers: async () => new Headers() }));
vi.mock("@/platform/stores/runtime", () => ({ runtimeStore: () => { if (context.constructorFailure) throw new Error("PRIVATE_CONSTRUCTOR_DETAIL"); return store; } }));
let rows: FeatureStateRow[];
const row = (feature_id: string, state: FeatureStateRow["state"] = "LIVE", tenant_id = DEFAULT_TENANT_ID, version = 1): FeatureStateRow => ({ tenant_id, feature_id, state, version, actor: "prior-owner", reason: "Prior approved state", decision_ref: "D5", updated_at: "2026-09-13T12:00:00Z" });
const store = {
  listFeatureStates: vi.fn(async (tenant: string) => rows.filter(r => r.tenant_id === tenant).map(r => ({ ...r }))),
  listFeatureInterestCounts: vi.fn(async () => [{ feature_id: "product_home_memory", yes: 4, no: 1, maybe: 2, total: 7 }]),
  setFeatureStates: vi.fn(async (input: SetFeatureStatesInput) => {
    // Persistence contract double: a stale caller must receive an actual conflict.
    if (input.changes.some(change => (rows.find(r => r.tenant_id === input.tenant_id && r.feature_id === change.feature_id)?.version ?? 0) !== change.expected_version)) throw Object.assign(new Error("PRIVATE_CONFLICT_DETAIL"), { code: "FEATURE_STATE_CONFLICT" });
    const changed = input.changes.map(change => ({ ...row(change.feature_id, change.state, input.tenant_id, change.expected_version + 1), actor: input.actor, reason: input.reason, decision_ref: input.decision_ref, updated_at: input.at }));
    rows = [...rows.filter(r => !changed.some(c => c.tenant_id === r.tenant_id && c.feature_id === r.feature_id)), ...changed];
    return changed;
  }),
};
const asStore = (value = store) => value as unknown as RuntimeStore;
const endpoint = "http://localhost/api/admin/features";
const change = (overrides: object = {}) => ({ mode: "changes", reason: "Restore approved action", changes: [{ feature_id: "keep", state: "LIVE", expected_version: 1 }], ...overrides });
const put = (body: object, headers: Record<string, string> = {}) => new Request(endpoint, { method: "PUT", headers: { "content-type": "application/json", origin: "http://localhost", ...headers }, body: JSON.stringify(body) });
const signIn = () => { context.cookie = sessionCookie("synthetic-admin-password").value; };
beforeEach(() => {
  rows = [row("keep", "HIDDEN"), row("job_packet"), row("product_home_memory", "PREVIEW")];
  context.cookie = ""; context.constructorFailure = false;
  store.listFeatureStates.mockClear(); store.listFeatureInterestCounts.mockClear(); store.setFeatureStates.mockClear();
  vi.stubEnv("ADMIN_PASSWORD", "synthetic-admin-password"); vi.stubEnv("PRN_ADMIN_ORIGIN", "");
  invalidateFeatureStates(); resetAdminMutationLimitForTests();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); invalidateFeatureStates(); });

describe("feature snapshot lifetime and isolation", () => {
  it("refreshes at the exact 30-second boundary and exposes changed state", async () => {
    const initial = await readFeatureSnapshot({ store: asStore(), now: 100_000 });
    rows[0] = row("keep", "LIVE");
    const warm = await readFeatureSnapshot({ store: asStore(), now: 129_999 });
    expect(warm).toBe(initial); expect(stateIn(warm, "keep")).toBe("HIDDEN");
    const expired = await readFeatureSnapshot({ store: asStore(), now: 130_000 });
    expect(stateIn(expired, "keep")).toBe("LIVE"); expect(store.listFeatureStates).toHaveBeenCalledTimes(2);
  });
  it("invalidates immediately after a confirmed write, without a deployment or cache wait", async () => {
    const before = await readFeatureSnapshot({ store: asStore() }); expect(featureHref(before, "/keep/token")).toBeNull();
    await saveFeatureChanges([{ feature_id: "keep", state: "LIVE", expected_version: 1 }], "Approved restore", { store: asStore() });
    const after = await readFeatureSnapshot({ store: asStore() }); expect(featureHref(after, "/keep/token")).toBe("/keep/token");
    expect(store.listFeatureStates).toHaveBeenCalledTimes(2);
  });
  it("a pending LIVE read cannot restore access after a confirmed HIDDEN write invalidates it", async () => {
    rows[0] = row("keep", "LIVE");
    const capturedLiveRows = rows.map(value => ({ ...value }));
    let releaseRead!: (value: FeatureStateRow[]) => void;
    store.listFeatureStates.mockImplementationOnce(() => new Promise(resolve => { releaseRead = resolve; }));
    const pending = readFeatureSnapshot({ store: asStore() });
    expect(store.listFeatureStates).toHaveBeenCalledTimes(1);

    await saveFeatureChanges([{ feature_id: "keep", state: "HIDDEN", expected_version: 1 }], "Hide approved action", { store: asStore() });
    expect(rows.find(value => value.feature_id === "keep")).toMatchObject({ state: "HIDDEN", version: 2 });
    releaseRead(capturedLiveRows);
    const stale = await pending;
    expect(stale.verified).toBe(false);
    expect(stateIn(stale, "keep")).toBe("HIDDEN");
    expect(featureHref(stale, "/keep/held-token")).toBeNull();

    const current = await readFeatureSnapshot({ store: asStore() });
    expect(current.verified).toBe(true);
    expect(stateIn(current, "keep")).toBe("HIDDEN");
    expect(current.rows.get("keep")!.version).toBe(2);
    expect(store.listFeatureStates).toHaveBeenCalledTimes(2);
  });
  it.each([30_000, 60_000])("the first store response fails closed when it arrives %i ms after its read began", async delay => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_800_000_000_000);
    rows[0] = row("keep", "LIVE");
    const capturedLiveRows = rows.map(value => ({ ...value }));
    let releaseRead!: (value: FeatureStateRow[]) => void;
    store.listFeatureStates.mockImplementationOnce(() => new Promise(resolve => { releaseRead = resolve; }));
    const pending = readFeatureSnapshot({ store: asStore() });
    expect(store.listFeatureStates).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_800_000_000_000 + delay);
    releaseRead(capturedLiveRows);
    const stale = await pending;
    expect(stale.verified).toBe(false);
    expect(stateIn(stale, "keep")).toBe("HIDDEN");
    expect(featureHref(stale, "/keep/held-token")).toBeNull();

    // The rejected response must not become a fresh LIVE cache entry.
    rows[0] = row("keep", "HIDDEN", DEFAULT_TENANT_ID, 2);
    const current = await readFeatureSnapshot({ store: asStore() });
    expect(current.verified).toBe(true);
    expect(stateIn(current, "keep")).toBe("HIDDEN");
    expect(store.listFeatureStates).toHaveBeenCalledTimes(2);
  });
  it("failure of an invalidated pending read cannot evict the newer post-save cache", async () => {
    rows[0] = row("keep", "LIVE");
    let failRead!: (error: Error) => void;
    store.listFeatureStates.mockImplementationOnce(() => new Promise((_resolve, reject) => { failRead = reject; }));
    const pending = readFeatureSnapshot({ store: asStore() });
    await saveFeatureChanges([{ feature_id: "keep", state: "HIDDEN", expected_version: 1 }], "Hide approved action", { store: asStore() });
    const newer = await readFeatureSnapshot({ store: asStore() });
    expect(newer.verified).toBe(true);
    expect(stateIn(newer, "keep")).toBe("HIDDEN");

    failRead(new Error("PRIVATE_OLD_GENERATION_FAILURE"));
    expect((await pending).verified).toBe(false);
    const retained = await readFeatureSnapshot({ store: asStore() });
    expect(retained).toBe(newer);
    expect(store.listFeatureStates).toHaveBeenCalledTimes(2);
  });
  it("fails closed after cached LIVE expires and never reuses it during an outage", async () => {
    rows[0] = row("keep"); await readFeatureSnapshot({ store: asStore(), now: 1_000 });
    store.listFeatureStates.mockRejectedValueOnce(new Error("PRIVATE_DB_FAILURE")).mockRejectedValueOnce(new Error("PRIVATE_DB_FAILURE"));
    for (const now of [31_000, 31_001]) { const failed = await readFeatureSnapshot({ store: asStore(), now }); expect(failed.verified).toBe(false); expect(featureHref(failed, "/keep/token")).toBeNull(); }
    expect(store.listFeatureStates).toHaveBeenCalledTimes(3);
  });
  it("handles a failed store constructor as unavailable rather than an uncaught customer error", async () => {
    context.constructorFailure = true; const snapshot = await readFeatureSnapshot();
    expect(snapshot.verified).toBe(false); expect(stateIn(snapshot, "job_packet")).toBe("HIDDEN");
  });
  it("isolates tenant and store caches and rejects wrong-tenant records returned by an adapter", async () => {
    rows.push(row("keep", "LIVE", "tenant_b"));
    const a = await readFeatureSnapshot({ store: asStore(), tenantId: DEFAULT_TENANT_ID });
    const b = await readFeatureSnapshot({ store: asStore(), tenantId: "tenant_b" });
    expect(stateIn(a, "keep")).toBe("HIDDEN"); expect(stateIn(b, "keep")).toBe("LIVE");
    const other = { ...store, listFeatureStates: vi.fn(async () => [row("keep", "LIVE", "tenant_b"), row("job_packet", "LIVE", DEFAULT_TENANT_ID)]) };
    const isolated = await readFeatureSnapshot({ store: asStore(other), tenantId: DEFAULT_TENANT_ID });
    expect(stateIn(isolated, "keep")).toBe("HIDDEN"); expect(stateIn(isolated, "job_packet")).toBe("LIVE");
  });
  it("unknown features and PREVIEW functional flows refuse while preview product artwork is allowed", async () => {
    rows.push(row("unknown_feature"), row("ask", "PREVIEW"));
    const snapshot = await readFeatureSnapshot({ store: asStore() });
    expect(stateIn(snapshot, "unknown_feature")).toBe("HIDDEN"); expect(stateIn(snapshot, "ask")).toBe("HIDDEN");
    expect((await featureRouteRefusal("/ask/held-token", { store: asStore() }))?.status).toBe(404);
    expect(await featureRouteRefusal("/pages/home-memory?source=test", { store: asStore() })).toBeNull();
    expect((await featureRouteRefusal("/pages/home-memory", { api: true, store: asStore() }))?.status).toBe(404);
  });
});

describe("admin features read and mutation boundary", () => {
  it("refuses missing and forged sessions before storage access", async () => {
    for (const cookie of ["", "v3.owner.1800000000000." + "0".repeat(64)]) {
      context.cookie = cookie;
      expect((await GET(new Request(endpoint))).status).toBe(403); expect((await PUT(put(change()))).status).toBe(403);
    }
    expect(store.listFeatureStates).not.toHaveBeenCalled(); expect(store.setFeatureStates).not.toHaveBeenCalled();
  });
  it("shows stored actor/reason/version and interest count with private no-store headers", async () => {
    signIn(); const response = await GET(new Request(endpoint)); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.features.find((f: { id: string }) => f.id === "keep")).toMatchObject({ state: "HIDDEN", version: 1, actor: "prior-owner", reason: "Prior approved state", recorded: true });
    expect(body.features.find((f: { id: string }) => f.id === "product_home_memory").interest.total).toBe(7);
  });
  it.each([{ origin: "https://attacker.example" }, { origin: "" }, { "sec-fetch-site": "cross-site" }, { "x-forwarded-host": "attacker.example" }, { host: "attacker.example" }])("refuses cross-origin or spoofed mutation metadata %j before writes", async headers => {
    signIn(); expect((await PUT(put(change(), Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"))))).status).toBe(403); expect(store.setFeatureStates).not.toHaveBeenCalled();
  });
  it("propagates caller CAS versions and confirms the write, then refuses an independently stale client", async () => {
    signIn(); const first = await PUT(put(change())); expect(first.status).toBe(200);
    expect(store.setFeatureStates.mock.calls[0]![0]).toMatchObject({ tenant_id: DEFAULT_TENANT_ID, actor: "authenticated-owner", reason: "Restore approved action", changes: [{ feature_id: "keep", state: "LIVE", expected_version: 1 }] });
    expect((await first.json()).features.find((f: { id: string }) => f.id === "keep")).toMatchObject({ state: "LIVE", version: 2 });
    const stale = await PUT(put(change())); expect(stale.status).toBe(409); expect(await stale.text()).not.toContain("PRIVATE_CONFLICT_DETAIL");
    expect(rows.find(r => r.feature_id === "keep")!.version).toBe(2);
  });
  it("applies a preset from a complete client version map without activating unbuilt or owner-unruled pages", async () => {
    signIn();
    const view = await (await GET(new Request(endpoint))).json();
    const expected_versions = Object.fromEntries(view.features.map((f: { id: string; version: number }) => [f.id, f.version]));
    const response = await PUT(put({ mode: "preset", preset: "show_all", expected_versions, reason: "Review saved feature designs" }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.features.find((f: { id: string }) => f.id === "keep")).toMatchObject({ state: "LIVE", version: 2 });
    for (const id of ["about", "issue_library", "faq", "feature_lab", "staged_listing"]) expect(result.features.find((f: { id: string }) => f.id === id).state).toBe("HIDDEN");
    expect(store.setFeatureStates.mock.calls[0]![0].changes.find(c => c.feature_id === "keep")!.expected_version).toBe(1);
  });
  it.each([
    "find", "customer_profile", "account_details", "home_memory", "trust_network",
    "smartquote", "dashboard", "statistics_library", "statistics_categories", "statistics_all",
  ])("keeps after-launch %s hidden in show_all and refuses direct LIVE without writes", async feature_id => {
    signIn();
    const direct = await PUT(put(change({ changes: [{ feature_id, state: "LIVE", expected_version: 0 }] })));
    expect(direct.status).toBe(422);
    expect(store.setFeatureStates).not.toHaveBeenCalled();
    expect(rows.some(value => value.feature_id === feature_id)).toBe(false);

    const view = await (await GET(new Request(endpoint))).json();
    const expected_versions = Object.fromEntries(view.features.map((feature: { id: string; version: number }) => [feature.id, feature.version]));
    const response = await PUT(put({ mode: "preset", preset: "show_all", expected_versions, reason: "Inspect available saved designs" }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.features.find((feature: { id: string }) => feature.id === feature_id).state).toBe("HIDDEN");
    expect(rows.find(value => value.feature_id === feature_id)?.state ?? "HIDDEN").toBe("HIDDEN");
  });
  it("refuses an atomic multi-feature request when one member has a stale version", async () => {
    signIn(); const before = JSON.stringify(rows);
    const response = await PUT(put(change({ changes: [
      { feature_id: "keep", state: "LIVE", expected_version: 1 },
      { feature_id: "job_packet", state: "HIDDEN", expected_version: 0 },
    ] })));
    expect(response.status).toBe(409); expect(JSON.stringify(rows)).toBe(before);
  });
  it.each([
    change({ changes: [{ feature_id: "keep", state: "PREVIEW", expected_version: 1 }] }),
    change({ changes: [{ feature_id: "feature_lab", state: "LIVE", expected_version: 0 }] }),
    change({ changes: [{ feature_id: "about", state: "LIVE", expected_version: 0 }] }),
    change({ changes: [{ feature_id: "issue_library", state: "HIDDEN", expected_version: 0 }] }),
    change({ changes: [{ feature_id: "about", state: "HIDDEN", expected_version: 0 }] }),
    change({ changes: [{ feature_id: "faq", state: "HIDDEN", expected_version: 0 }] }),
  ])("keeps functional PREVIEW, retired and owner-unruled features closed", async body => {
    signIn(); expect((await PUT(put(body))).status).toBe(422); expect(store.setFeatureStates).not.toHaveBeenCalled();
  });
  it.each([
    change({ changes: [{ feature_id: "unknown_feature", state: "LIVE", expected_version: 0 }] }),
    change({ changes: [{ feature_id: "keep", state: "LIVE", expected_version: 1 }, { feature_id: "keep", state: "HIDDEN", expected_version: 1 }] }),
    change({ tenant_id: "tenant_b" }), change({ actor: "invented-owner" }), change({ reason: "" }),
    { mode: "preset", preset: "launch", expected_versions: {}, reason: "Apply launch" },
  ])("rejects invalid or injectable request %j without any partial write", async body => {
    signIn(); expect((await PUT(put(body))).status).toBe(400); expect(store.setFeatureStates).not.toHaveBeenCalled();
  });
  it("reports unavailable data and does not invent successful writes or interest counts", async () => {
    signIn(); store.listFeatureStates.mockRejectedValueOnce(new Error("PRIVATE_STATE_DETAIL"));
    const failed = await PUT(put(change())); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("PRIVATE_STATE_DETAIL"); expect(store.setFeatureStates).not.toHaveBeenCalled();
    store.listFeatureInterestCounts.mockRejectedValueOnce(new Error("PRIVATE_COUNTS_DETAIL"));
    const body = await (await GET(new Request(endpoint))).json(); expect(body.interest_available).toBe(false); expect(body.features.every((f: { interest: unknown }) => f.interest === null)).toBe(true);
  });
  it("does not acknowledge an unconfirmed persistence write", async () => {
    signIn(); store.setFeatureStates.mockRejectedValueOnce(new Error("PRIVATE_WRITE_DETAIL"));
    const response = await PUT(put(change())); expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE_WRITE_DETAIL");
  });
  it("enforces JSON and the bounded request size before storage writes", async () => {
    signIn(); expect((await PUT(put(change(), { "content-type": "text/plain" }))).status).toBe(415);
    expect((await PUT(put(change(), { "content-length": "24577" }))).status).toBe(413); expect(store.setFeatureStates).not.toHaveBeenCalled();
  });
});
