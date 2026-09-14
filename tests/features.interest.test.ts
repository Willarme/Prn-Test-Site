import { runInNewContext } from "node:vm";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureInterestInput, FeatureStateRow } from "@/domain/features/types";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { POST } from "@/app/api/feature-interest/route";
import { addFeatureInterestPrompt, anonymousFeatureVisitor, FEATURE_INTEREST_TTL_SECONDS, FEATURE_VISITOR_COOKIE, featureVisitorCookie, interestHashes } from "@/platform/features/interest";
import { invalidateFeatureStates } from "@/platform/features/state";

vi.mock("@/platform/stores/runtime", () => ({ runtimeStore: () => store }));
const endpoint = "https://preview.example/api/feature-interest";
const now = 1_800_000_000_000;
const featureRow = (overrides: Partial<FeatureStateRow> = {}): FeatureStateRow => ({ tenant_id: DEFAULT_TENANT_ID, feature_id: "product_home_memory", state: "PREVIEW", version: 3, actor: "test-owner", reason: "Approved product preview", decision_ref: "D5", updated_at: "2026-09-13T12:00:00Z", ...overrides });
let row: FeatureStateRow;
const store = {
  listFeatureStates: vi.fn(async () => [row]),
  recordFeatureInterest: vi.fn(async (_input: FeatureInterestInput) => ({ created: true })),
};
const body = (overrides: object = {}) => ({ feature_id: "product_home_memory", feature_version: 3, page: "/pages/home-memory", answer: "yes", ...overrides });
function cookieAt(time = now) { return featureVisitorCookie(new Request("https://preview.example/pages/home-memory"), time)!.split(";")[0]!; }
function request(payload: object = body(), options: { cookie?: string; headers?: Record<string, string> } = {}) {
  return new Request(endpoint, { method: "POST", headers: { "content-type": "application/json", origin: "https://preview.example", cookie: options.cookie ?? cookieAt(), ...options.headers }, body: JSON.stringify(payload) });
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  vi.stubEnv("LINK_SIGNING_SECRET", "synthetic-feature-interest-secret-00000000"); vi.stubEnv("PRN_ADMIN_ORIGIN", "https://preview.example");
  row = featureRow(); store.listFeatureStates.mockReset().mockImplementation(async () => [row]); store.recordFeatureInterest.mockReset().mockResolvedValue({ created: true });
  invalidateFeatureStates();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); invalidateFeatureStates(); });

describe("anonymous visitor capability", () => {
  it("sets a random signed HttpOnly cookie and preserves it for the full TTL without storing identity", () => {
    const header = featureVisitorCookie(new Request("https://preview.example/"), now)!;
    expect(header).toContain("HttpOnly; SameSite=Lax"); expect(header).toContain("Secure"); expect(header).toContain(`Max-Age=${FEATURE_INTEREST_TTL_SECONDS}`);
    const cookie = header.split(";")[0]!; const req = new Request(endpoint, { headers: { cookie } });
    const id = anonymousFeatureVisitor(req, now); expect(id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(featureVisitorCookie(req, now + 1)).toBeNull();
    expect(anonymousFeatureVisitor(req, now + FEATURE_INTEREST_TTL_SECONDS * 1000 - 1)).toBe(id);
    expect(anonymousFeatureVisitor(req, now + FEATURE_INTEREST_TTL_SECONDS * 1000)).toBeNull();
    expect(anonymousFeatureVisitor(req, now - 1000)).toBeNull();
    expect(cookieAt()).not.toBe(cookie);
  });
  it("rejects tampering, rotation and unavailable signing configuration", () => {
    const cookie = cookieAt(); const req = new Request(endpoint, { headers: { cookie } });
    const forged = cookie.slice(0, -1) + (cookie.endsWith("a") ? "b" : "a");
    expect(anonymousFeatureVisitor(new Request(endpoint, { headers: { cookie: forged } }), now)).toBeNull();
    vi.stubEnv("LINK_SIGNING_SECRET", "synthetic-rotated-feature-secret-0000000"); expect(anonymousFeatureVisitor(req, now)).toBeNull();
    vi.stubEnv("LINK_SIGNING_SECRET", ""); expect(anonymousFeatureVisitor(req, now)).toBeNull(); expect(() => featureVisitorCookie(new Request(endpoint), now)).toThrow("unavailable");
  });
  it("scopes stored hashes to tenant, visitor, feature and version without plaintext visitor IDs", () => {
    const a = interestHashes("visitor-a", "tenant-a", "product_home_memory", 1);
    expect(a.visitor_hash).toMatch(/^[a-f0-9]{64}$/); expect(a.dedupe_key).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toEqual(interestHashes("visitor-a", "tenant-a", "product_home_memory", 1));
    for (const args of [["visitor-b", "tenant-a", "product_home_memory", 1], ["visitor-a", "tenant-b", "product_home_memory", 1], ["visitor-a", "tenant-a", "product_dashboard", 1], ["visitor-a", "tenant-a", "product_home_memory", 2]] as const) expect(interestHashes(args[0], args[1], args[2], args[3]).dedupe_key).not.toBe(a.dedupe_key);
  });
});

describe("anonymous interest API", () => {
  it("persists only the minimal declared fields and acknowledges both new and confirmed duplicate answers", async () => {
    const cookie = cookieAt(); const req = request(body(), { cookie, headers: { "x-forwarded-for": "203.0.113.42", "user-agent": "PRIVATE_AGENT", referer: "https://preview.example/private?email=PRIVATE_EMAIL" } });
    const response = await POST(req); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, recorded: true, created: true });
    const saved = store.recordFeatureInterest.mock.calls[0]![0];
    expect(Object.keys(saved).sort()).toEqual(["answer", "created_at", "dedupe_key", "feature_id", "feature_version", "page", "tenant_id", "visitor_hash"].sort());
    expect(saved).toMatchObject({ ...body(), tenant_id: DEFAULT_TENANT_ID }); expect(JSON.stringify(saved)).not.toMatch(/PRIVATE_|203\.0\.113|prn_feature_visitor/);
    expect(saved.visitor_hash).not.toContain(anonymousFeatureVisitor(new Request(endpoint, { headers: { cookie } }))!);
    store.recordFeatureInterest.mockResolvedValueOnce({ created: false });
    expect(await (await POST(request(body(), { cookie }))).json()).toEqual({ ok: true, recorded: true, created: false });
    expect(store.recordFeatureInterest.mock.calls[1]![0].dedupe_key).toBe(saved.dedupe_key);
  });
  it.each([{ email: "private@example.test" }, { visitor_id: "supplied" }, { tenant_id: "tenant-b" }, { context: { phone: "555" } }, { answer: "up" }, { feature_version: 0 }, { page: "/pages/home-memory?request=private" }])("rejects undeclared identity/context or invalid fields %j", async extra => {
    expect((await POST(request(body(extra)))).status).toBe(400); expect(store.recordFeatureInterest).not.toHaveBeenCalled();
  });
  it("rejects the retired concept payload even if a caller retained the old form", async () => {
    const response = await POST(request({ concept: "home-memory", kind: "thumb", thumb: "up", landing_path: "/future/home-memory" }));
    expect(response.status).toBe(400); expect(store.recordFeatureInterest).not.toHaveBeenCalled();
  });
  it.each([{ feature_id: "keep", page: "/keep/token" }, { feature_id: "made_up", page: "/pages/home-memory" }, { page: "/pages/dashboard" }])("refuses unknown, hidden-flow or wrong-product context %j", async overrides => {
    expect((await POST(request(body(overrides)))).status).toBe(404); expect(store.recordFeatureInterest).not.toHaveBeenCalled();
  });
  it.each(["HIDDEN", "LIVE"] as const)("a %s feature cannot collect preview interest", async state => {
    row = featureRow({ state }); expect((await POST(request())).status).toBe(409); expect(store.recordFeatureInterest).not.toHaveBeenCalled();
  });
  it("rechecks the current version instead of accepting a cached prior preview", async () => {
    expect((await POST(request())).status).toBe(200); row = featureRow({ version: 4 });
    expect((await POST(request())).status).toBe(409); expect(store.recordFeatureInterest).toHaveBeenCalledTimes(1);
  });
  it.each([{ origin: "https://attacker.example" }, { origin: "" }, { "sec-fetch-site": "cross-site" }, { origin: "https://preview.example/private" }, { origin: "https://user:pass@preview.example" }])("rejects cross-origin metadata %j before persistence", async headers => {
    expect((await POST(request(body(), { headers: Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string")) }))).status).toBe(403); expect(store.recordFeatureInterest).not.toHaveBeenCalled();
  });
  it.each(["", `${FEATURE_VISITOR_COOKIE}=forged`])("requires a valid anonymous capability: %s", async cookie => {
    expect((await POST(request(body(), { cookie }))).status).toBe(403); expect(store.recordFeatureInterest).not.toHaveBeenCalled();
  });
  it("expired visitor cookies cannot record and a missing signing secret cannot accept an old cookie", async () => {
    const cookie = cookieAt(now - FEATURE_INTEREST_TTL_SECONDS * 1000); expect((await POST(request(body(), { cookie }))).status).toBe(403);
    const valid = cookieAt(); vi.stubEnv("LINK_SIGNING_SECRET", ""); expect((await POST(request(body(), { cookie: valid }))).status).toBe(403); expect(store.recordFeatureInterest).not.toHaveBeenCalled();
  });
  it.each([["FEATURE_INTEREST_RATE_LIMIT", 429], ["FEATURE_INTEREST_UNAVAILABLE", 409], ["OTHER", 503]] as const)("never reports saved on storage failure %s", async (code, status) => {
    store.recordFeatureInterest.mockRejectedValueOnce(Object.assign(new Error("PRIVATE_STORAGE_DETAIL"), { code }));
    const response = await POST(request()); expect(response.status).toBe(status); expect(await response.json()).toEqual({ ok: false, recorded: false });
    if (status === 429) expect(response.headers.get("retry-after")).toBe("60");
  });
  it("refuses unverifiable feature storage and oversized bodies without a write", async () => {
    store.listFeatureStates.mockRejectedValueOnce(new Error("PRIVATE_STATE_DETAIL")); expect((await POST(request())).status).toBe(503);
    expect((await POST(request(body(), { headers: { "content-length": "2049" } }))).status).toBe(413); expect(store.recordFeatureInterest).not.toHaveBeenCalled();
  });
});

// Execute the exact serving-adapter JavaScript with the small DOM surface it uses.
// This is a script behavior proof, not a browser/layout acceptance claim.
function popup(storage = new Map<string, string>(), time = now, overrides: Partial<FeatureStateRow> = {}, options: { storageFailure?: boolean; receipt?: object; responseOk?: boolean } = {}) {
  type Callback = (event?: { key?: string; preventDefault(): void }) => unknown;
  const listeners = () => new Map<string, Callback>();
  const buttons = ["yes", "maybe", "no"].map(answer => ({ disabled: false, events: listeners(), getAttribute: (name: string) => name === "data-interest-answer" ? answer : null, addEventListener(name: string, fn: Callback) { this.events.set(name, fn); } }));
  const close = { events: listeners(), addEventListener(name: string, fn: Callback) { this.events.set(name, fn); } };
  const status = { textContent: "" };
  const main = { attrs: new Map<string, string>(), focus: vi.fn(), getAttribute(name: string) { return this.attrs.get(name) ?? null; }, setAttribute(name: string, value: string) { this.attrs.set(name, value); }, removeAttribute(name: string) { this.attrs.delete(name); } };
  const box = { hidden: true, events: listeners(), contains: () => true, querySelectorAll: () => buttons, addEventListener(name: string, fn: Callback) { this.events.set(name, fn); } };
  const document = { activeElement: buttons[0], body: main, querySelector: () => main, getElementById: (id: string) => id === "prn-interest" ? box : id === "prn-interest-status" ? status : close };
  const fetch = vi.fn(async () => ({ ok: options.responseOk ?? true, json: async () => options.receipt ?? { recorded: true } }));
  const html = addFeatureInterestPrompt("<!doctype html><body><main>Approved artwork</main></body>", featureRow(overrides), "/pages/home-memory");
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
  if (script) runInNewContext(script, { document, Date: { now: () => time }, localStorage: { getItem: (key: string) => { if (options.storageFailure) throw new Error("blocked"); return storage.get(key) ?? null; }, setItem: (key: string, value: string) => storage.set(key, value) }, fetch });
  return { box, buttons, close, status, main, fetch, html, storage };
}

describe("preview interest popup script behavior", () => {
  it("prompts once per browser/feature/version within TTL, and prompts on another browser, version or expiry", () => {
    const storage = new Map<string, string>(); expect(popup(storage).box.hidden).toBe(false);
    expect(popup(storage, now + 1).box.hidden).toBe(true);
    expect(popup(new Map(), now + 1).box.hidden).toBe(false);
    expect(popup(storage, now + 1, { version: 4 }).box.hidden).toBe(false);
    expect(popup(storage, now + 1, { feature_id: "product_dashboard" }).box.hidden).toBe(false);
    expect(popup(storage, now + FEATURE_INTEREST_TTL_SECONDS * 1000).box.hidden).toBe(false);
  });
  it("leaves artwork unchanged when LIVE/HIDDEN and suppresses prompts when storage cannot track a visit", () => {
    for (const state of ["LIVE", "HIDDEN"] as const) expect(popup(new Map(), now, { state }).html).toBe("<!doctype html><body><main>Approved artwork</main></body>");
    const blocked = popup(new Map(), now, {}, { storageFailure: true }); expect(blocked.box.hidden).toBe(true); expect(blocked.fetch).not.toHaveBeenCalled();
  });
  it("dismissal and Escape close without submitting and restore focus", () => {
    const p = popup(); p.close.events.get("click")!(); expect(p.box.hidden).toBe(true); expect(p.fetch).not.toHaveBeenCalled(); expect(p.main.focus).toHaveBeenCalled(); expect(p.main.attrs.has("tabindex")).toBe(false);
    const q = popup(); const preventDefault = vi.fn(); q.box.events.get("keydown")!({ key: "Escape", preventDefault }); expect(preventDefault).toHaveBeenCalled(); expect(q.box.hidden).toBe(true); expect(q.fetch).not.toHaveBeenCalled();
  });
  it("submits the minimal answer and shows success only after the saved receipt", async () => {
    const p = popup(); await p.buttons[0]!.events.get("click")!();
    expect(p.fetch).toHaveBeenCalledTimes(1); const [path, init] = p.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/feature-interest"); expect(init.credentials).toBe("same-origin"); expect(JSON.parse(init.body as string)).toEqual(body());
    expect(p.status.textContent).toContain("was saved"); expect(p.buttons.every(button => button.disabled)).toBe(true);
  });
  it.each([{ responseOk: false, receipt: { recorded: false } }, { responseOk: true, receipt: { recorded: false } }])("an unconfirmed receipt leaves a truthful retry state", async options => {
    const p = popup(new Map(), now, {}, options); await p.buttons[0]!.events.get("click")!();
    expect(p.status.textContent).toContain("could not be saved"); expect(p.buttons.every(button => !button.disabled)).toBe(true);
  });
});
