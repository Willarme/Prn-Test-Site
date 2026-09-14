import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformClientProvider } from "@/platform/db/client";
import { resetServiceClient, serviceClient } from "@/platform/db/client";

const state = vi.hoisted(() => ({ unlocked: true, provider: vi.fn(), totals: vi.fn() }));
vi.mock("@/platform/db/client", async original => ({ ...await original<typeof import("@/platform/db/client")>(), serviceClientProvider: state.provider }));
vi.mock("@/platform/stores/runtime", () => ({ runtimeStore: () => ({ kind: "file", totals: state.totals }) }));
vi.mock("@/platform/admin/auth", async original => ({ ...await original<typeof import("@/platform/admin/auth")>(), isAdminUnlocked: async () => state.unlocked }));
vi.mock("@/components/admin/AdminGate", () => ({ adminGate: async () => state.unlocked ? null : createElement("p", null, "LOCKED_CONNECTIONS") }));

import { connectionReadiness, checkConnections } from "@/platform/admin/connections";
import { resetAdminMutationLimitForTests } from "@/platform/admin/request";
import { POST } from "@/app/api/admin/connections/check/route";
import ConnectionsPage from "@/app/admin/connections/page";
import { connectionReport } from "@/components/admin/ConnectionDiagnostics";

const SENTINEL = "SYNTHETIC_CREDENTIAL_OR_PRIVATE_ROW";
const variables = ["PRN_RUNTIME_STORE", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_JWT_SECRET", "OPENROUTER_API_KEY", "EMAIL_MODE", "RESEND_API_KEY", "DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "GSC_OAUTH_REFRESH_TOKEN", "GSC_PROPERTY_URL", "PRN_ADMIN_ORIGIN"];
beforeEach(() => {
  for (const name of variables) vi.stubEnv(name, "");
  state.unlocked = true; state.provider.mockReset(); state.totals.mockReset();
  state.totals.mockResolvedValue({ journeys: 123, packets: 456, consents: 789 });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external provider may be called by these checks"); }));
  resetAdminMutationLimitForTests(); resetServiceClient();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetServiceClient(); });

function request(options: { origin?: string | null; body?: string; contentType?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost:3188", "content-type": options.contentType ?? "application/json" };
  if (options.origin !== null) headers.origin = options.origin ?? "http://localhost:3188";
  return new Request("http://localhost:3188/api/admin/connections/check", { method: "POST", headers, body: options.body ?? "{}" });
}
function configureDatabase() { vi.stubEnv("SUPABASE_URL", "https://synthetic-project.invalid"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SENTINEL); }

function database(failures: string[] = [], stall = false) {
  const calls: Array<{ table: string; select?: string; head?: boolean; limit?: number; retry?: boolean; signal?: AbortSignal }> = [];
  const client = {
    from(table: string) {
      const call: typeof calls[number] = { table }; calls.push(call);
      const chain = {
        select(columns: string, options: { head: boolean }) { call.select = columns; call.head = options.head; return chain; },
        limit(limit: number) { call.limit = limit; return chain; },
        retry(enabled: boolean) { call.retry = enabled; return chain; },
        async abortSignal(signal: AbortSignal) {
          call.signal = signal;
          if (stall) return new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error(SENTINEL)), { once: true }));
          return { error: failures.includes(table) ? { message: SENTINEL } : null, status: failures.includes(table) ? 400 : 200, data: [{ private: SENTINEL }] };
        },
      };
      return chain;
    },
  };
  state.provider.mockImplementation((() => client) as unknown as PlatformClientProvider);
  return calls;
}

describe("truthful connection readiness", () => {
  it.each([
    ["", "", false],
    [SENTINEL, "", false],
    ["", SENTINEL, false],
    [SENTINEL, SENTINEL, true],
  ])("reads search readiness through the adapter for a complete credential pair without a call", (login, password, expected) => {
    vi.stubEnv("DATAFORSEO_LOGIN", login); vi.stubEnv("DATAFORSEO_PASSWORD", password);
    const readiness = connectionReadiness();
    expect(readiness.search).toBe(expected);
    expect(JSON.stringify(readiness)).not.toContain(SENTINEL);
    expect(fetch).not.toHaveBeenCalled(); expect(state.provider).not.toHaveBeenCalled();
  });
  it("uses the runtime's local fallback when database credentials are absent and defaults email to preview", async () => {
    expect(connectionReadiness()).toMatchObject({ storage: "local", file_override: false, email: "preview" });
    const html = renderToStaticMarkup(await ConnectionsPage());
    expect(html).toContain("Local file fallback"); expect(html).toContain("Preview only");
    expect(html).not.toContain("Firebase"); expect(html).not.toContain("Project not identified");
    expect(state.provider).not.toHaveBeenCalled(); expect(state.totals).not.toHaveBeenCalled();
  });
  it.each(["", "preview", "LIVE", "typo"])("email remains preview for mode %j even with a key", mode => {
    vi.stubEnv("EMAIL_MODE", mode); vi.stubEnv("RESEND_API_KEY", SENTINEL);
    expect(connectionReadiness().email).toBe("preview");
  });
  it("shows live email as only configured, never delivery verified", async () => {
    vi.stubEnv("EMAIL_MODE", "live"); expect(connectionReadiness().email).toBe("unconfigured");
    vi.stubEnv("RESEND_API_KEY", SENTINEL); expect(connectionReadiness().email).toBe("configured");
    const html = renderToStaticMarkup(await ConnectionsPage());
    expect(html).toContain("Provider configuration is distinct from a verified delivery");
    expect(html).not.toContain(SENTINEL); expect(fetch).not.toHaveBeenCalled();
  });
  it("serializes presence only, even when every provider credential and private property URL is set", async () => {
    for (const name of variables.filter(name => !["PRN_RUNTIME_STORE", "EMAIL_MODE", "PRN_ADMIN_ORIGIN"].includes(name))) vi.stubEnv(name, SENTINEL);
    const readiness = connectionReadiness();
    expect(readiness).toMatchObject({ storage: "database", openrouter: true, search: true, search_console: true, request_scope: true });
    expect(JSON.stringify(readiness)).not.toContain(SENTINEL);
    expect(renderToStaticMarkup(await ConnectionsPage())).not.toContain(SENTINEL);
    expect(state.provider).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("bounded diagnostic reads", () => {
  it("the explicit file override performs no database, AI, email or search-provider call even with credentials", async () => {
    configureDatabase(); vi.stubEnv("PRN_RUNTIME_STORE", "file"); vi.stubEnv("OPENROUTER_API_KEY", SENTINEL);
    vi.stubEnv("EMAIL_MODE", "live"); vi.stubEnv("RESEND_API_KEY", SENTINEL);
    state.provider.mockImplementation(() => { throw new Error("must not initialize the database"); });
    const report = await checkConnections();
    expect(report.mode).toBe("local"); expect(report.checks[0]).toMatchObject({ name: "Local request store", status: "pass" });
    expect(report.checks.find(check => check.name === "Supabase")?.detail).toContain("override is active");
    expect(state.provider).not.toHaveBeenCalled(); expect(state.totals).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain(SENTINEL);
    expect(JSON.stringify(report)).not.toContain("123");
    expect(report.checks.some(check => check.name === "Firebase")).toBe(false);
  });
  it("checks the admin and full-loop tables with HEAD requests, one-row limits and eight-second aborts without returning row bodies", async () => {
    configureDatabase(); const calls = database(["job_packet", "feedback", "issued_request_links", "request_keep_state"]);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const report = await checkConnections();
    expect(calls.map(call => call.table)).toEqual(["intake_session", "job_packet", "admin_audit", "agent_run_ledger", "approval_item", "link_revocations", "keep_claims", "magic_links", "ask_answers", "feedback", "email_outbox", "job_addresses", "signups", "issued_request_links", "request_keep_state"]);
    expect(calls.every(call => call.head === true && call.limit === 1 && call.retry === false && call.signal instanceof AbortSignal)).toBe(true);
    expect(timeout).toHaveBeenCalledTimes(15); expect(timeout.mock.calls.every(call => call[0] === 8000)).toBe(true);
    expect(report.checks.find(check => check.name === "job_packet")?.status).toBe("unavailable");
    expect(report.checks.find(check => check.name === "approval_item")?.status).toBe("pass");
    expect(report.checks.find(check => check.name === "feedback")).toMatchObject({status: "unavailable", detail: expect.stringContaining("Check its migration")});
    for (const name of ["issued_request_links", "request_keep_state"]) {
      expect(report.checks.find(check => check.name === name)).toMatchObject({ status: "unavailable", detail: expect.stringContaining("Check its migration") });
    }
    expect(report.checks.find(check => check.name === "Customer row isolation")?.status).toBe("unavailable");
    expect(JSON.stringify(report)).not.toContain(SENTINEL); expect(state.totals).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("an abort completes as unavailable rather than hanging or leaking the adapter failure", async () => {
    vi.useFakeTimers(); configureDatabase(); database([], true);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => { const controller = new AbortController(); setTimeout(() => controller.abort(), milliseconds); return controller.signal; });
    const pending = checkConnections(); await vi.advanceTimersByTimeAsync(8000);
    const report = await pending;
    expect(report.checks.slice(0, 15).every(check => check.status === "unavailable")).toBe(true);
    expect(JSON.stringify(report)).not.toContain(SENTINEL);
  });
  it.each([200, 206, 204, 404, 401, 503])("uses the installed client without mistaking bodyless HTTP %s for readable table evidence", async status => {
    configureDatabase();
    const fetchMock = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal("fetch", fetchMock);
    state.provider.mockImplementation(serviceClient);
    const report = await checkConnections();
    expect(report.checks.slice(0, 15).every(check => check.status === ([200, 206].includes(status) ? "pass" : "unavailable"))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(15);
    expect(fetchMock.mock.calls.every(call => (call as unknown as [unknown, RequestInit])[1]?.method === "HEAD")).toBe(true);
    expect(JSON.stringify(report)).not.toContain(SENTINEL);
  });
  it("keeps initialization and local read failures generic and does not call them connected", async () => {
    state.totals.mockRejectedValue(new Error(SENTINEL));
    let report = await checkConnections(); expect(report.checks[0].status).toBe("unavailable"); expect(JSON.stringify(report)).not.toContain(SENTINEL);
    configureDatabase(); state.provider.mockImplementation(() => { throw new Error(SENTINEL); });
    report = await checkConnections(); expect(report.checks[0]).toMatchObject({ name: "Supabase", status: "unavailable" }); expect(JSON.stringify(report)).not.toContain(SENTINEL);
  });
  it("records request-scoped credentials as unverified isolation, never a passing cross-customer test", async () => {
    configureDatabase(); database(); vi.stubEnv("SUPABASE_ANON_KEY", SENTINEL); vi.stubEnv("SUPABASE_JWT_SECRET", SENTINEL);
    const check = (await checkConnections()).checks.find(row => row.name === "Customer row isolation")!;
    expect(check.status).toBe("skipped"); expect(check.detail).toContain("does not prove row-level isolation");
  });
});

describe("connection diagnostic HTTP boundary", () => {
  it("checks authorization and origin before any diagnostic or private read", async () => {
    state.unlocked = false;
    expect((await POST(request())).status).toBe(403);
    expect(renderToStaticMarkup(await ConnectionsPage())).toContain("LOCKED_CONNECTIONS");
    state.unlocked = true;
    expect((await POST(request({ origin: "https://attacker.example" }))).status).toBe(403);
    expect((await POST(request({ origin: null }))).status).toBe(403);
    expect(state.totals).not.toHaveBeenCalled(); expect(state.provider).not.toHaveBeenCalled();
  });
  it("rejects unexpected or oversized input before storage and returns a private valid receipt for the authorized empty request", async () => {
    expect((await POST(request({ body: '{"unexpected":true}' }))).status).toBe(400);
    expect((await POST(request({ body: "x".repeat(129) }))).status).toBe(413);
    expect((await POST(request({ contentType: "text/plain" }))).status).toBe(415);
    expect(state.totals).not.toHaveBeenCalled();
    const response = await POST(request());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(connectionReport(await response.json())?.mode).toBe("local");
  });
  it("returns stable public error wording rather than a raw failing database adapter message", async () => {
    configureDatabase(); state.provider.mockImplementation(() => { throw new Error(SENTINEL); });
    const response = await POST(request()); const body = await response.text();
    expect(response.status).toBe(200); expect(body).toContain("unavailable"); expect(body).not.toContain(SENTINEL);
  });
  it("rejects malformed browser receipts and projects only the known receipt fields", () => {
    expect(connectionReport({ checked_at: "invalid", mode: "local", checks: [] })).toBeNull();
    expect(connectionReport({ checked_at: "2026-09-06T00:00:00Z", mode: "local", checks: [{ status: "pass" }] })).toBeNull();
    const valid = connectionReport({ checked_at: "2026-09-06T00:00:00Z", mode: "local", raw: SENTINEL,
      checks: [{ name: "File runtime", status: "pass", detail: "A read completed", secret: SENTINEL }] });
    expect(valid).not.toBeNull(); expect(JSON.stringify(valid)).not.toContain(SENTINEL);
  });
});
