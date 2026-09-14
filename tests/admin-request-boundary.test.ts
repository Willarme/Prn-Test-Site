import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const state = vi.hoisted(() => ({ cookie: undefined as string | undefined, headers: new Headers({ host: "localhost:3188" }) }));
const policyRead = vi.hoisted(() => vi.fn(async () => ({ version: 1, page_factory: { internal: true } })));
const decisionRead = vi.hoisted(() => vi.fn(async () => []));
const toggle = vi.hoisted(() => vi.fn(async () => ({ engaged: true })));
const reconciliationRun = vi.hoisted(() => vi.fn(async () => ({
  verdict: "clean", run_id: "run_admin_boundary_fixture", run_key: "fixture-key",
  checks_run: 4, findings: 0, quarantined: 0, by_check: {}, scan_complete: true,
})));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }), headers: async () => state.headers }));
vi.mock("@/platform/admin/data", async original => ({ ...await original<typeof import("@/platform/admin/data")>(), policyStore: () => ({ getActive: policyRead }) }));
vi.mock("@/platform/search/decision-store", async original => ({ ...await original<typeof import("@/platform/search/decision-store")>(), opportunityDecisionStore: () => ({ list: decisionRead }) }));
vi.mock("@/platform/killswitch", async original => ({ ...await original<typeof import("@/platform/killswitch")>(), engageKillSwitch: toggle, releaseKillSwitch: toggle }));
vi.mock("@/platform/quality/reconciliation", () => ({ runReconciliation: reconciliationRun }));

import { adminAccessKind, adminConfigured, adminMode, isAdminUnlocked, passwordMatches, resetLoginAttempts, sessionCookie } from "@/platform/admin/auth";
import { guardAdminMutation, resetAdminMutationLimitForTests } from "@/platform/admin/request";
import { readAdminEmpty, readAdminForm, readAdminJson } from "@/platform/admin/body";
import { POST as login, DELETE as logout } from "@/app/api/admin/login/route";
import { GET as policy, PUT as savePolicy } from "@/app/api/admin/policy/route";
import { POST as killswitch } from "@/app/api/admin/killswitch/route";
import { POST as generate } from "@/app/api/admin/pages/generate/route";
import { POST as edit } from "@/app/api/admin/pages/edit/route";
import { POST as publish } from "@/app/api/admin/pages/publish/route";
import { POST as rollback } from "@/app/api/admin/pages/rollback/route";
import { POST as decide } from "@/app/api/admin/opportunities/decide/route";
import { POST as approve } from "@/app/api/admin/approvals/resolve/route";
import { POST as reconcile } from "@/app/api/admin/quality/reconcile/route";

const ownerPassword = "fixture owner password";
const origin = "http://localhost:3188";
function request(path = "login", options: RequestInit = {}): Request {
  const headers = new Headers({ Host: "localhost:3188", Origin: origin, "Content-Type": "application/json" });
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  return new Request(`${origin}/api/admin/${path}`, { method: "POST", ...options, headers });
}
function definedHeaders(values: Record<string, string | undefined>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) headers.set(key, value);
  return headers;
}
function signedIn(): void { state.cookie = sessionCookie(ownerPassword).value; }
function localMode(): void {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("PRN_DEV_DB_PATH", resolve("data/runtime/admin-boundary-fixture/dev-db.json"));
  vi.stubEnv("PRN_LOCAL_ADMIN_PASSWORD", "123");
  vi.stubEnv("PRN_LOCAL_ADMIN_SESSION_SECRET", randomBytes(32).toString("base64url"));
}

beforeEach(() => {
  vi.stubEnv("ADMIN_PASSWORD", ownerPassword);
  for (const key of ["PRN_LOCAL_ADMIN_PASSWORD", "PRN_LOCAL_ADMIN_SESSION_SECRET", "PRN_CLIENT_DEMO", "PRN_DEMO_PUBLIC_ORIGIN", "PRN_ADMIN_ORIGIN", "VERCEL"]) vi.stubEnv(key, "");
  vi.stubEnv("PRN_RUNTIME_STORE", "file");
  state.cookie = undefined;
  state.headers = new Headers({ host: "localhost:3188" });
  vi.clearAllMocks(); resetLoginAttempts(); resetAdminMutationLimitForTests();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("real admin route admission", () => {
  const routes = [
    ["policy", savePolicy], ["killswitch", killswitch], ["pages/generate", generate],
    ["pages/edit", edit], ["pages/publish", publish], ["pages/rollback", rollback],
    ["opportunities/decide", decide], ["approvals/resolve", approve], ["quality/reconcile", reconcile],
  ] as const;
  it("refuses the formerly public policy read before accessing its store", async () => {
    const denied = await policy(request("policy", { method: "GET" }));
    expect(denied.status).toBe(403); expect(policyRead).not.toHaveBeenCalled();
    signedIn();
    const allowed = await policy(request("policy", { method: "GET" }));
    expect(allowed.status).toBe(200); expect(policyRead).toHaveBeenCalledOnce();
    expect(allowed.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each(routes)("%s rejects unsigned sessions before work", async (path, handler) => {
    const response = await handler(request(path, { body: "{}" }));
    expect(response.status).toBe(403); expect(toggle).not.toHaveBeenCalled(); expect(decisionRead).not.toHaveBeenCalled(); expect(policyRead).not.toHaveBeenCalled();
  });
  it.each(routes)("%s rejects foreign and missing origins with a real valid session", async (path, handler) => {
    signedIn();
    for (const value of ["https://attacker.example", "http://localhost:9999", "null", ""]) {
      const incoming = request(path, { body: "{}", headers: { Origin: value } });
      if (!value) incoming.headers.delete("origin");
      expect((await handler(incoming)).status).toBe(403);
    }
    expect(toggle).not.toHaveBeenCalled(); expect(decisionRead).not.toHaveBeenCalled(); expect(policyRead).not.toHaveBeenCalled();
  });
  it.each(routes)("%s refuses an oversized or unexpected body before side effects", async (path, handler) => {
    signedIn();
    const isForm = ["pages/edit", "pages/rollback"].includes(path);
    const input = request(path, { body: "x".repeat(70000), headers: { "Content-Type": isForm ? "application/x-www-form-urlencoded" : "application/json" } });
    expect((await handler(input)).status).toBe(413);
    expect(toggle).not.toHaveBeenCalled(); expect(decisionRead).not.toHaveBeenCalled(); expect(policyRead).not.toHaveBeenCalled();
  });
  it.each(["{broken", "null", "[]", ""])('malformed generation body %s never reads decisions or runs a factory', async body => {
    signedIn(); expect((await generate(request("pages/generate", { body }))).status).toBe(400);
    expect(decisionRead).not.toHaveBeenCalled();
  });
  it("accepts one valid mutation and sanitizes a real thrown adapter error", async () => {
    signedIn();
    const body = JSON.stringify({ action: "engage", scope: "GLOBAL" });
    expect((await killswitch(request("killswitch", { body }))).status).toBe(200); expect(toggle).toHaveBeenCalledOnce();
    toggle.mockRejectedValueOnce(new Error("private provider credential fixture must stay internal"));
    const response = await killswitch(request("killswitch", { body }));
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("credential");
    policyRead.mockRejectedValueOnce(new Error("private storage path and fixture credential"));
    const failedRead = await policy(request("policy", { method: "GET" }));
    expect(failedRead.status).toBe(500); expect(await failedRead.text()).not.toContain("credential");
  });
  it("guards login and logout against cross-origin session changes", async () => {
    for (const handler of [login, logout]) {
      expect((await handler(request("login", { headers: { Origin: "https://attacker.example" } }))).status).toBe(403);
    }
  });
  it("does not let spoofed IP headers reset the global login limit", async () => {
    for (let i = 0; i < 11; i++) {
      const response = await login(request("login", { headers: { "x-forwarded-for": `198.51.100.${i}`, "x-real-ip": `198.51.100.${i}` }, body: JSON.stringify({ password: "wrong" }) }));
      expect(response.status).toBe(i < 10 ? 401 : 429);
    }
  });
  it("sets the session attributes and clears the same cookie on logout", async () => {
    const result = await login(request("login", { body: JSON.stringify({ password: ownerPassword }) }));
    expect(result.status).toBe(200);
    const cookie = result.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/SameSite=lax/i); expect(cookie).not.toContain(ownerPassword);
    const removed = await logout(request("login", { method: "DELETE" }));
    expect(removed.status).toBe(200); expect(removed.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("logs out when Next supplies a closed zero-byte request stream", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    const removed = await logout(request("login", { method: "DELETE", body: stream, duplex: "half" } as RequestInit));
    expect(removed.status).toBe(200);
    expect(removed.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("rejects logout payload bytes without clearing the session", async () => {
    const response = await logout(request("login", { method: "DELETE", body: "x", headers: { "Content-Length": "0" } }));
    expect(response.status).toBe(413);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("runs an authenticated reconciliation when Next supplies a closed zero-byte stream", async () => {
    signedIn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    const response = await reconcile(request("quality/reconcile", { body: stream, duplex: "half" } as RequestInit));
    expect(response.status).toBe(200);
    expect(reconciliationRun).toHaveBeenCalledExactlyOnceWith({ trigger: "admin_action" });
    expect(await response.json()).toMatchObject({ ok: true, verdict: "clean", checks_run: 4, findings: 0, scan_complete: true });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("rejects reconciliation payload bytes before invoking any scan", async () => {
    signedIn();
    const response = await reconcile(request("quality/reconcile", { body: "x", headers: { "Content-Length": "0" } }));
    expect(response.status).toBe(413);
    expect(reconciliationRun).not.toHaveBeenCalled();
  });
});

describe("trusted origins and finite admission", () => {
  it.each([
    { Host: "attacker.example" }, { "x-forwarded-host": "attacker.example" }, { Forwarded: "host=attacker.example" }, { "x-forwarded-proto": "https" }, { "Sec-Fetch-Site": "cross-site" },
  ])("rejects conflicting request metadata %j", async metadata => {
    signedIn(); expect((await guardAdminMutation(request("policy", { headers: definedHeaders(metadata) })))?.status).toBe(403);
  });
  it("requires a configured HTTPS public origin and preserves exact proxy agreement", async () => {
    signedIn();
    const incoming = () => new Request("http://127.0.0.1:3000/api/admin/policy", { method: "PUT", headers: { Host: "admin.example", Origin: "https://admin.example", "x-forwarded-host": "admin.example", "x-forwarded-proto": "https" } });
    expect((await guardAdminMutation(incoming()))?.status).toBe(403);
    vi.stubEnv("PRN_ADMIN_ORIGIN", "https://admin.example");
    expect(await guardAdminMutation(incoming())).toBeNull();
    vi.stubEnv("PRN_ADMIN_ORIGIN", "https://admin.example/extra");
    expect((await guardAdminMutation(incoming()))?.status).toBe(403);
  });
  it("uses one fixed global mutation window independent of supplied headers", async () => {
    signedIn();
    for (let i = 0; i < 121; i++) expect((await guardAdminMutation(request("policy", { headers: { "x-real-ip": String(i) } })))?.status ?? 200).toBe(i < 120 ? 200 : 429);
  });
});

describe("bounded bodies before parsing", () => {
  const schema = z.object({ name: z.string().min(1).max(100) });
  it("empty endpoints cancel stalled streams instead of hanging", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel });
    const pending = readAdminEmpty(request("login", { method: "DELETE", body: stream, duplex: "half" } as RequestInit));
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(["text/plain", "application/xml", "multipart/form-data", "application/json; invalid=1"])("rejects JSON sent as %s", async type => {
    const result = await readAdminJson(request("x", { headers: { "Content-Type": type }, body: '{"name":"ok"}' }), schema);
    expect(result.ok).toBe(false); if (!result.ok) expect(result.response.status).toBe(415);
  });
  it("limits actual streamed bytes even when the length is missing or dishonest", async () => {
    for (const headers of [{}, { "Content-Length": "1" }, { "Content-Length": "70000" }]) {
      const result = await readAdminJson(request("x", { headers: definedHeaders(headers), body: JSON.stringify({ name: "x".repeat(70000) }) }), schema);
      expect(result.ok).toBe(false); if (!result.ok) expect(result.response.status).toBe(413);
    }
  });
  it("refuses compressed bodies and invalid UTF-8", async () => {
    const compressed = await readAdminJson(request("x", { headers: { "Content-Encoding": "gzip" }, body: "{}" }), schema);
    expect(compressed.ok).toBe(false); if (!compressed.ok) expect(compressed.response.status).toBe(415);
    const invalid = await readAdminJson(request("x", { body: new Uint8Array([0xff]) }), schema);
    expect(invalid.ok).toBe(false);
  });
  it("cancels a stalled request body at the fixed deadline", async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel: cancelled });
    const input = new Request(`${origin}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    const pending = readAdminJson(input, schema);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).ok).toBe(false); expect(cancelled).toHaveBeenCalledOnce();
  });
  it("supports browser form submissions and rejects repeated fields or uploaded files", async () => {
    for (const mode of ["valid", "duplicate", "file"] as const) {
      const form = new FormData(); form.append("name", "ok");
      if (mode === "duplicate") form.append("name", "different");
      if (mode === "file") form.set("name", new Blob(["private"]), "fixture.txt");
      const input = new Request(`${origin}/api/admin/pages/edit`, { method: "POST", body: form });
      const result = await readAdminForm(input, schema);
      expect(result.ok).toBe(mode === "valid");
    }
    const encoded = new Request(`${origin}/api/admin/pages/edit`, { method: "POST", body: new URLSearchParams({ name: "ok" }) });
    expect((await readAdminForm(encoded, schema)).ok).toBe(true);
  });
});

describe("local-only temporary password and canonical sessions", () => {
  it("accepts the explicitly isolated local mode without replacing normal owner access", async () => {
    localMode();
    expect(await adminAccessKind(request())).toBe("local-demo");
    expect(passwordMatches("123", request())).toBe(true); expect(passwordMatches(ownerPassword, request())).toBe(true);
    const result = await login(request("login", { body: JSON.stringify({ password: "123" }) }));
    expect(result.status).toBe(200);
    state.cookie = sessionCookie("123", request()).value;
    expect(await isAdminUnlocked(request())).toBe(true); expect(await adminMode()).toBe("unlocked");
    expect(await isAdminUnlocked(request("policy", { headers: { "x-forwarded-host": "public.example" } }))).toBe(false);
  });
  it("accepts only Next's exact local forwarding metadata", async () => {
    localMode();
    const direct = request("login", { headers: { "x-forwarded-host": "localhost:3188", "x-forwarded-proto": "http", "x-forwarded-for": "::ffff:127.0.0.1" } });
    expect(passwordMatches("123", direct)).toBe(true);
    for (const metadata of [{ "x-forwarded-for": "198.51.100.1" }, { "x-forwarded-for": "127.0.0.1, 198.51.100.1" }, { "x-real-ip": "198.51.100.1" }, { Forwarded: "for=127.0.0.1" }]) {
      expect(passwordMatches("123", request("login", { headers: definedHeaders(metadata) }))).toBe(false);
    }
  });
  it.each([
    ["NODE_ENV", "production"], ["NODE_ENV", "test"], ["PRN_RUNTIME_STORE", "supabase"],
    ["PRN_DEV_DB_PATH", resolve("data/runtime/dev-db.json")], ["PRN_DEV_DB_PATH", "relative/db.json"],
    ["PRN_DEV_DB_PATH", resolve("data/private/db.json")], ["PRN_LOCAL_ADMIN_SESSION_SECRET", "short"],
    ["PRN_CLIENT_DEMO", "1"], ["PRN_DEMO_PUBLIC_ORIGIN", "https://public.example"],
    ["PRN_ADMIN_ORIGIN", "https://admin.example"], ["VERCEL", "1"],
  ])("fails closed for local mode with %s=%s while keeping the owner password", async (name, value) => {
    localMode(); vi.stubEnv(name, value);
    expect(passwordMatches("123", request())).toBe(false); expect(passwordMatches(ownerPassword, request())).toBe(true);
  });
  it("rejects local sessions at public hosts and after key/password rotation", async () => {
    localMode(); state.cookie = sessionCookie("123", request()).value;
    expect(await isAdminUnlocked(new Request("https://public.example/admin"))).toBe(false);
    vi.stubEnv("PRN_LOCAL_ADMIN_SESSION_SECRET", randomBytes(32).toString("base64url"));
    expect(await isAdminUnlocked(request())).toBe(false);
    state.cookie = sessionCookie("123", request()).value; vi.stubEnv("PRN_LOCAL_ADMIN_PASSWORD", "changed");
    expect(await isAdminUnlocked(request())).toBe(false);
  });
  it("rejects weak production passwords and local credential fallback", async () => {
    localMode(); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ADMIN_PASSWORD", "123");
    expect(adminConfigured()).toBe(false); expect(await adminAccessKind(request())).toBe("unconfigured");
    expect((await login(request("login", { body: JSON.stringify({ password: "123" }) }))).status).toBe(400);
  });
  it("rejects canonical-shape violations, signed future timestamps and real expiry", async () => {
    vi.useFakeTimers(); const now = new Date("2026-09-06T08:00:00Z"); vi.setSystemTime(now);
    const valid = sessionCookie(ownerPassword).value;
    for (const invalid of [valid + ".extra", valid.toUpperCase(), valid + "00", valid.replace(".owner.", ".local-demo."), valid.replace(/.$/, "z")]) {
      state.cookie = invalid; expect(await isAdminUnlocked()).toBe(false);
    }
    vi.setSystemTime(now.getTime() + 1000); state.cookie = sessionCookie(ownerPassword).value;
    vi.setSystemTime(now); expect(await isAdminUnlocked()).toBe(false);
    state.cookie = valid; vi.setSystemTime(now.getTime() + 12 * 60 * 60 * 1000); expect(await isAdminUnlocked()).toBe(false);
  });
});
