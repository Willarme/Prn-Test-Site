import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { loadDoorV44PublicSelection, doorV44RuntimeResponse, readDoorV44FreshFence } from "@/platform/pages/door-v44-runtime-public";
import { middleware } from "@/middleware";
import { featureSnapshot } from "./helpers/feature-snapshot";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), serving: vi.fn(), authority: vi.fn(), features: vi.fn(), artifact: vi.fn() }));
vi.mock("@/platform/search/door-page-selection-store", () => ({ doorPageSelectionStore: () => ({ getGuard: mocks.guard, getServingSnapshot: mocks.serving }) }));
vi.mock("@/platform/pages/door-v44-runtime-authority", () => ({ doorRuntimeAuthorityConfig: () => ({}), readDoorRuntimeAuthority: mocks.authority }));
vi.mock("@/domain/search/door-v44/artifact-store", () => ({ readDoorV44Artifact: mocks.artifact }));
vi.mock("@/platform/features/state", async original => ({ ...await original<typeof import("@/platform/features/state")>(), readFeatureSnapshot: mocks.features, featureRouteRefusal: async () => null }));
const policy = { synthetic: "consumer contract fixture, not a publish authority" };
const fence = { revision: 1, dependency_revision: 1, hold_revision: 1, dependencies_sha256: "a".repeat(64), environment_sha256: "b".repeat(64), holds_sha256: "c".repeat(64) };
beforeEach(() => {
  vi.clearAllMocks(); mocks.features.mockResolvedValue(featureSnapshot({}, "LIVE"));
  mocks.authority.mockResolvedValue({ ok: false, code: "DOOR_AUTHORITY_UNAVAILABLE" });
  mocks.guard.mockResolvedValue(null);
  mocks.serving.mockResolvedValue({ tenant_id: "prn", revision: 0, selection_sha256: null, guard_revision: 0, fence: null, origin: null, index_policy: null, entries: [],
    managed: [{ page_id: "reserved", canonical_path: "/problems/reserved", kind: "catalog" }], as_of: new Date().toISOString(), guard_status: "unconfigured" });
});
describe("real runtime adapter dispatch contract", () => {
  it("asks the catalog for managed identities even with no authority config", async () => {
    const result = await loadDoorV44PublicSelection();
    expect(mocks.features).toHaveBeenCalledWith({ tenantId: "prn", fresh: true });
    expect(mocks.serving).toHaveBeenCalledWith("prn", null);
    expect(result.snapshot.managed).toHaveLength(1); expect(result.entries).toEqual([]); expect(mocks.artifact).not.toHaveBeenCalled();
  });
  it("preserves the exact provided directory feature snapshot", async () => {
    const snapshot = featureSnapshot({}, "LIVE");
    const result = await loadDoorV44PublicSelection(snapshot);
    expect(result.context.features).toBe(snapshot); expect(mocks.features).not.toHaveBeenCalled(); expect(mocks.authority.mock.calls[0][0]).toBe(snapshot);
  });
  it("blocks reserved and unknown asset paths while allowing definitively unmanaged legacy flow", async () => {
    expect((await doorV44RuntimeResponse(new Request("https://fixture.invalid/problems/reserved")))?.status).toBe(404);
    expect((await doorV44RuntimeResponse(new Request("https://fixture.invalid/media/door-v44/unknown.png")))?.status).toBe(404);
    expect(await doorV44RuntimeResponse(new Request("https://fixture.invalid/problems/unmanaged"))).toBeNull();
  });
  it("refuses store corruption without converting it into unmanaged fallback", async () => {
    mocks.serving.mockRejectedValue(new Error("private adapter diagnostic"));
    const result = await doorV44RuntimeResponse(new Request("https://fixture.invalid/problems/unmanaged"));
    expect(result?.status).toBe(503); expect(await result?.text()).toBe("Page unavailable"); expect(result?.headers.get("cache-control")).toContain("no-store");
  });
  it("will not echo a persisted guard when actual authority is unavailable or policy differs", async () => {
    mocks.guard.mockResolvedValue({ tenant_id: "prn", state: { policy_sha256: doorV44Hash(policy), release_policy: policy, fence } });
    await loadDoorV44PublicSelection(); expect(mocks.serving).toHaveBeenLastCalledWith("prn", null);
    mocks.authority.mockResolvedValue({ ok: true, policy_sha256: "d".repeat(64), origin: "https://fixture.invalid", artifactRoot: "unused", fence });
    await loadDoorV44PublicSelection(); expect(mocks.serving).toHaveBeenLastCalledWith("prn", null);
    mocks.authority.mockResolvedValue({ ok: true, policy_sha256: doorV44Hash(policy), origin: "https://fixture.invalid", artifactRoot: "unused", fence });
    await loadDoorV44PublicSelection(); expect(mocks.serving).toHaveBeenLastCalledWith("prn", fence);
  });
  it("fresh write authority refuses a foreign guard", async () => {
    const guard = { tenant_id: "foreign", state: { policy_sha256: doorV44Hash(policy), release_policy: policy, fence } };
    expect(await readDoorV44FreshFence("prn", guard as unknown as Parameters<typeof readDoorV44FreshFence>[1])).toBeNull(); expect(mocks.features).not.toHaveBeenCalled();
  });
  it("middleware dispatches encoded managed paths before the legacy handler", async () => {
    expect((await middleware(new NextRequest("https://fixture.invalid/%70roblems/reserved"))).status).toBe(404);
    expect((await middleware(new NextRequest("https://fixture.invalid/problems/reserved", { method: "POST" }))).status).toBe(405);
    expect((await middleware(new NextRequest("https://fixture.invalid/media/door-v44/unknown.png"))).status).toBe(404);
  });
  it("middleware preserves the frozen AC handler and unrelated paths without reading v44 storage", async () => {
    for (const path of ["/problems/ac-blowing-warm-air", "/admin", "/logo.svg"]) expect((await middleware(new NextRequest(`https://fixture.invalid${path}`))).headers.get("x-middleware-next")).toBe("1");
    expect(mocks.guard).not.toHaveBeenCalled();
  });
});
