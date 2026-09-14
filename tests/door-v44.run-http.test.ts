import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCookie } from "@/platform/admin/auth";
import { resetAdminMutationLimitForTests } from "@/platform/admin/request";
import * as create from "@/app/api/admin/page-runs/route";
import * as read from "@/app/api/admin/page-runs/[run_id]/route";
import * as advance from "@/app/api/admin/page-runs/[run_id]/advance/route";
import * as fixtures from "@/app/api/admin/page-runs/fixtures/route";
import * as preview from "@/app/admin/page-creator/runs/[run_id]/items/[fixture_id]/preview/route";
import * as asset from "@/app/admin/page-creator/runs/[run_id]/items/[fixture_id]/preview/assets/[asset]/route";

const state = vi.hoisted(() => ({ cookie: "", create: vi.fn(), read: vi.fn(), advance: vi.fn(), catalog: vi.fn(), store: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }) }));
vi.mock("@/platform/admin/door-page-runs", async importOriginal => ({ ...await importOriginal<typeof import("@/platform/admin/door-page-runs")>(), createDoorRun: state.create, readDoorRun: state.read, advanceDoorRun: state.advance, doorRunCatalog: state.catalog }));
vi.mock("@/platform/search/door-page-run-store", () => ({ doorPageRunStore: state.store }));
const origin = "https://owner.example", password = "fixture-run-http-owner-password";
const validBody = { mode: "fixture", dry_run: true, opportunity_ids: ["F01"], count: 1, reason: "Check the known control" };
function request(method = "POST", body: unknown = validBody, extra: Record<string, string> = {}) {
  return new Request(origin + "/api/admin/page-runs", { method, headers: { origin, "content-type": "application/json", "idempotency-key": randomUUID(), ...extra }, ...(method === "GET" || method === "HEAD" ? {} : { body: JSON.stringify(body) }) });
}
const runId = `run-${randomUUID()}`;
const context = { params: Promise.resolve({ run_id: runId }) };
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("ADMIN_PASSWORD", password); vi.stubEnv("PRN_ADMIN_ORIGIN", origin); state.cookie = sessionCookie(password).value; resetAdminMutationLimitForTests(); });
describe("owner run API boundaries", () => {
  it("requires real sign-in before request data, params, package IO or stores", async () => {
    state.cookie = "";
    const hidden = { get params(): Promise<{ run_id: string; fixture_id: string; asset: string }> { throw new Error("private params accessed"); } };
    for (const response of [await create.POST(request()), await fixtures.GET(request("GET")), await read.GET(request("GET"), hidden), await advance.POST(request(), hidden), await preview.GET(request("GET"), hidden), await asset.GET(request("GET"), hidden)]) {
      expect(response.status).toBe(403); expect(response.headers.get("Cache-Control")).toContain("private, no-store");
      expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    }
    for (const spy of [state.create, state.read, state.advance, state.catalog, state.store]) expect(spy).not.toHaveBeenCalled();
  });
  it("denies forged cookies and cross-origin writes before work", async () => {
    state.cookie += "forged"; expect((await create.POST(request())).status).toBe(403);
    state.cookie = sessionCookie(password).value;
    expect((await create.POST(request("POST", validBody, { origin: "https://attacker.example" }))).status).toBe(403);
    expect(state.create).not.toHaveBeenCalled();
  });
  it.each([
    { ...validBody, count: 2 }, { ...validBody, opportunity_ids: ["F01", "F01"], count: 2 },
    { ...validBody, opportunity_ids: ["F12"] }, { ...validBody, tenant_id: "foreign" },
    { ...validBody, actor: "Melissa" }, { ...validBody, mode: "unknown" }, { ...validBody, reason: "" },
  ])("rejects invalid request or caller-owned authority %j", async body => {
    expect((await create.POST(request("POST", body))).status).toBe(400); expect(state.create).not.toHaveBeenCalled();
  });
  it("requires a canonical creation key, bounds body size, and refuses stale-request fields", async () => {
    expect((await create.POST(request("POST", validBody, { "idempotency-key": "x" }))).status).toBe(400);
    expect((await create.POST(request("POST", validBody, { "content-length": "8193" }))).status).toBe(413);
    expect((await advance.POST(request("POST", { expected_revision: 1, outcome: "BUILT" }), context)).status).toBe(400);
    expect((await advance.POST(request("POST", { expected_revision: -1 }), context)).status).toBe(400);
    expect(state.create).not.toHaveBeenCalled(); expect(state.advance).not.toHaveBeenCalled();
  });
  it("uses the validated key and returns202 without spawning work", async () => {
    const key = randomUUID(); state.create.mockResolvedValue({ run_id: `run-${key}` });
    const result = await create.POST(request("POST", validBody, { "idempotency-key": key }));
    expect(result.status).toBe(202); expect(await result.json()).toEqual({ run: { run_id: `run-${key}` } });
    expect(state.create).toHaveBeenCalledWith(key, validBody); expect(state.advance).not.toHaveBeenCalled();
  });
  it("runs only explicit supported methods and strips HEAD bodies", async () => {
    expect((await create.GET(request("GET"))).status).toBe(405);
    expect((await read.POST(request(), context)).status).toBe(405);
    expect((await advance.GET(request("GET"), context)).status).toBe(405);
    state.read.mockResolvedValue({ run_id: runId });
    const result = await read.HEAD(request("HEAD"), context); expect(result.status).toBe(200); expect(await result.text()).toBe("");
    state.cookie = ""; expect(await (await read.HEAD(request("HEAD"), context)).text()).toBe("");
  });
  it("returns404 for malformed identities and redacts dependency errors", async () => {
    expect((await read.GET(request("GET"), { params: Promise.resolve({ run_id: "../private" }) })).status).toBe(404);
    state.read.mockRejectedValue(new Error("secret database path and token"));
    const result = await read.GET(request("GET"), context); expect(result.status).toBe(503); expect(await result.text()).not.toContain("secret");
  });
});
