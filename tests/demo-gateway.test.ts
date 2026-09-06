import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// The production boundary is a dependency-free native Node CLI, imported without
// starting its listener. All transport below is injected and opens no sockets.
// Use Node's loader for this standalone ESM CLI. Vite's transformed dynamic
// import rejects its CRLF Windows checkout even though native Node accepts it.
const requireScript = createRequire(import.meta.url);
const { createDemoGateway, parseTarget, routeAllowed, ACCESS_COOKIE } = requireScript("../scripts/demo-gateway.mjs");
const ORIGIN = "https://demo.example.test";
type Input = { target: string; method?: string; headers?: HeadersInit; body?: Uint8Array | AsyncIterable<Uint8Array> };
type Handle = (input: Input) => Promise<Response>;

function setup(overrides: Record<string, unknown> = {}) {
  const inviteSecret = randomBytes(32).toString("base64url");
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const clock = { now: 1_800_000_000_000 };
  const handle: Handle = createDemoGateway({
    publicOrigin: ORIGIN, inviteSecret, sessionSecret: randomBytes(32).toString("base64url"),
    now: () => clock.now,
    fetchImpl: async (url: URL, init: RequestInit) => { calls.push({ url, init }); return new Response("fixture upstream"); },
    ...overrides,
  });
  const request = (target: string, init: Omit<Input, "target"> = {}) => {
    const headers = new Headers({ host: new URL(ORIGIN).host, ...Object.fromEntries(new Headers(init.headers)) });
    return handle({ ...init, target, headers });
  };
  const enter = async (suffix = "") => {
    const response = await request(`/invite/${inviteSecret}${suffix}`);
    expect(response.status).toBe(303);
    return { response, cookie: response.headers.getSetCookie()[0].split(";")[0] };
  };
  return { request, enter, calls, clock, inviteSecret };
}

describe("private invitation and session boundary", () => {
  it("exchanges a random invitation for a secure host-only session without proxying the secret", async () => {
    const demo = setup();
    expect((await demo.request("/demo")).status).toBe(401);
    const { response, cookie } = await demo.enter();
    expect(response.headers.get("location")).toBe("/demo");
    const header = response.headers.getSetCookie()[0];
    for (const flag of ["Path=/", "Secure", "HttpOnly", "SameSite=Lax"]) expect(header).toContain(flag);
    expect(header).not.toContain("Domain=");
    expect(header).not.toContain(demo.inviteSecret);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(demo.calls).toHaveLength(0);
    expect((await demo.request("/demo", { headers: { cookie } })).status).toBe(200);
    expect(demo.calls[0].url.pathname).toBe("/demo");
    expect(new Headers(demo.calls[0].init.headers).get("cookie")).toBeNull();
  });

  it("recognizes only the explicit all-directory invitation destination", async () => {
    const demo = setup();
    expect((await demo.enter("?to=all")).response.headers.get("location")).toBe("/demo/all");
    for (const query of ["?to=/admin", "?to=https://other.test", "?to=all&to=all", "?to=all&extra=1"]) {
      expect((await demo.request(`/invite/${demo.inviteSecret}${query}`)).status).toBe(401);
    }
  });

  it("refuses forged, duplicate and expired sessions", async () => {
    const demo = setup({ sessionTtlMs: 1000 });
    const { cookie } = await demo.enter();
    const name = cookie.split("=")[0];
    for (const value of [`${name}=fake`, `${cookie}; ${cookie}`]) {
      expect((await demo.request("/demo", { headers: { cookie: value } })).status).toBe(401);
    }
    demo.clock.now += 1001;
    expect((await demo.request("/demo", { headers: { cookie } })).status).toBe(401);
    expect(demo.calls).toHaveLength(0);
  });

  it("caps invitation attempts and resets the bounded window", async () => {
    const demo = setup({ maxInvitesPerMinute: 1 });
    await demo.enter();
    expect((await demo.request(`/invite/${demo.inviteSecret}`)).status).toBe(429);
    demo.clock.now += 60_000;
    await demo.enter();
  });
});

describe("customer allowlist holds after invitation", () => {
  it.each(["/admin", "/admin/requests", "/api/admin/login", "/api/admin/pages/publish", "/staged/ac", "/.env.local", "/data/runtime/dev-db.json", "/src/platform/admin/auth.ts", "/package.json", "/feature/Dashboard.html", "/_next/static/chunks/app/admin/page.js", "/_next/static/chunks/app/page.js.map", "/_next/image?url=http://127.0.0.1/admin"])('denies %s', async target => {
    const demo = setup();
    const { cookie } = await demo.enter();
    expect((await demo.request(target, { headers: { cookie } })).status).toBe(404);
    expect(demo.calls).toHaveLength(0);
  });

  it.each(["/demo/../admin", "/demo/%2e%2e/admin", "/%252e%252e/admin", "/demo%2f..%2fadmin", "/demo\\..\\admin", "//other.test/demo", "https://other.test/demo", "/demo%00", "/demo%", "/demo#fragment"])('rejects raw traversal or malformed target %s', async target => {
    expect(parseTarget(target)).toBeNull();
    const demo = setup();
    const { cookie } = await demo.enter();
    expect((await demo.request(target, { headers: { cookie } })).status).toBe(400);
    expect(demo.calls).toHaveLength(0);
  });

  it("admits the current full-loop routes and encoded Next assets without admitting extra methods", () => {
    for (const target of ["/demo", "/demo/all", "/cooling/", "/what-this-tool-can-help-with/", "/problems/ac-blowing-warm-air", "/complete/rq_fixture", "/results/rq_fixture/send", "/packet/rq_fixture/pdf", "/mail/sm_fixture", "/pages/home-memory", "/pages/vendor/react.js", "/_next/static/chunks/app/complete/%5Brequest_id%5D/page-123.js", "/_next/static/media/fixture-s.p.woff2", "/images/central-ac-where-to-look-safe-vs-licensed-zones.svg"]) {
      expect(routeAllowed(parseTarget(target), "GET"), target).toBe(true);
      expect(routeAllowed(parseTarget(target), "DELETE"), target).toBe(false);
    }
    for (const target of ["/demo/start", "/complete/rq_fixture", "/results/rq_fixture/send", "/api/intake/start", "/api/signup"]) expect(routeAllowed(parseTarget(target), "POST")).toBe(true);
  });

  it("permits only well-formed private media refs and retains owner proof for the upstream gate", async () => {
    const demo = setup();
    const { cookie } = await demo.enter();
    const valid = "/api/intake/media?ref=local%2Frq_fixture%2Fdoor_photo%2Fev_fixture.jpg&k=signed-owner-fixture";
    expect((await demo.request(valid, { headers: { cookie: `${cookie}; prn_owner_fixture=signed-fixture` } })).status).toBe(200);
    expect(new Headers(demo.calls[0].init.headers).get("cookie")).toBe("prn_owner_fixture=signed-fixture");
    for (const ref of ["local/rq_fixture/../../.env.local", "local/rq_fixture/%2e%2e/.env.local", "local/rq_fixture/door_photo/ev_fixture.jpg/../../private", "local/rq_fixture/door_photo/ev_fixture.json"]) {
      expect((await demo.request(`/api/intake/media?ref=${encodeURIComponent(ref)}`, { headers: { cookie } })).status).toBe(404);
    }
    expect((await demo.request(valid + "&ref=local/rq_fixture/x/ev_x.jpg", { headers: { cookie } })).status).toBe(404);
    expect(demo.calls).toHaveLength(1);
  });
});

describe("trusted proxy metadata and redirects", () => {
  it("refuses a different host or cross-origin mutation and overwrites forwarded headers", async () => {
    const demo = setup();
    const { cookie } = await demo.enter();
    expect((await demo.request("/demo", { headers: { host: "other.test", cookie } })).status).toBe(400);
    for (const origin of ["https://other.test", "null", ""]) {
      expect((await demo.request("/api/intake", { method: "POST", headers: { cookie, origin } })).status).toBe(403);
    }
    const result = await demo.request("/api/intake", { method: "POST", headers: {
      cookie: `${cookie}; prn_admin=forged; prn_owner_fixture=owner`, origin: ORIGIN,
      "x-forwarded-host": "evil.test", "x-forwarded-proto": "http", "x-middleware-subrequest": "middleware",
      "x-invoke-path": "/admin", "x-original-url": "/admin", "content-type": "application/json",
    }, body: Buffer.from('{"description":"synthetic"}') });
    expect(result.status).toBe(200);
    const forwarded = new Headers(demo.calls[0].init.headers);
    expect(forwarded.get("host")).toBe("demo.example.test");
    expect(forwarded.get("x-forwarded-host")).toBe("demo.example.test");
    expect(forwarded.get("x-forwarded-proto")).toBe("https");
    expect(forwarded.get("origin")).toBe(ORIGIN);
    expect(forwarded.get("cookie")).toBe("prn_owner_fixture=owner");
    for (const header of ["x-middleware-subrequest", "x-invoke-path", "x-original-url"]) expect(forwarded.has(header)).toBe(false);
  });

  it("rejects action headers outside customer action pages and private Next navigation paths", async () => {
    const demo = setup();
    const { cookie } = await demo.enter();
    expect((await demo.request("/api/intake", { method: "POST", headers: { cookie, origin: ORIGIN, "next-action": "id" } })).status).toBe(403);
    expect((await demo.request("/demo", { headers: { cookie, "next-url": "/admin" } })).status).toBe(403);
    expect((await demo.request("/results/rq_fixture/send", { method: "POST", headers: { cookie, origin: ORIGIN, "next-action": "id" }, body: Buffer.from("fixture") })).status).toBe(200);
  });

  it("rewrites internal redirects and preserves separate Set-Cookie headers", async () => {
    const cookies = ["prn_owner_one=a; Path=/; HttpOnly; SameSite=Lax", "prn_owner_two=b; Domain=127.0.0.1; Path=/; HttpOnly; Expires=Wed, 01 Jan 2031 00:00:00 GMT"];
    const demo = setup({ fetchImpl: async () => {
      const headers = new Headers({ location: "http://127.0.0.1:3189/complete/rq_fixture?k=owner", "x-action-redirect": "/results/rq_fixture;push" });
      for (const cookie of cookies) headers.append("set-cookie", cookie);
      headers.append("set-cookie", "prn_admin=private; Path=/");
      headers.append("set-cookie", `${ACCESS_COOKIE}=overwrite; Path=/`);
      return new Response(null, { status: 303, headers });
    } });
    const { cookie } = await demo.enter();
    const response = await demo.request("/api/intake/start", { method: "POST", headers: { cookie, origin: ORIGIN } });
    expect(response.headers.get("location")).toBe(`${ORIGIN}/complete/rq_fixture?k=owner`);
    expect(response.headers.get("x-action-redirect")).toBe(`${ORIGIN}/results/rq_fixture;push`);
    expect(response.headers.getSetCookie()).toHaveLength(2);
    for (const value of response.headers.getSetCookie()) { expect(value).toContain("Secure"); expect(value).not.toContain("Domain="); }
    expect(response.headers.getSetCookie()[1]).toContain("Expires=Wed, 01 Jan 2031 00:00:00 GMT");
  });

  it.each(["https://evil.test/collect", "//evil.test/collect", "/admin", "http://127.0.0.1:3189/.env.local"])("refuses an upstream redirect to %s", async location => {
    const demo = setup({ fetchImpl: async () => new Response(null, { status: 303, headers: { location } }) });
    const { cookie } = await demo.enter();
    expect((await demo.request("/demo", { headers: { cookie } })).status).toBe(502);
  });
});

describe("bounded transport", () => {
  it("limits declared and streamed bodies without forwarding them", async () => {
    const demo = setup({ maxBodyBytes: 4 });
    const { cookie } = await demo.enter();
    const headers = { cookie, origin: ORIGIN };
    expect((await demo.request("/api/intake", { method: "POST", headers: { ...headers, "content-length": "5" }, body: Buffer.from("large") })).status).toBe(413);
    async function* chunks() { yield Buffer.from("one"); yield Buffer.from("two"); }
    expect((await demo.request("/api/intake", { method: "POST", headers, body: chunks() })).status).toBe(413);
    expect((await demo.request("/api/intake", { method: "POST", headers: { ...headers, "content-encoding": "gzip" }, body: Buffer.from("x") })).status).toBe(415);
    expect(demo.calls).toHaveLength(0);
  });

  it("limits concurrency, times out a hung upstream, and releases the slot", async () => {
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    let hang = true;
    const demo = setup({ timeoutMs: 25, maxConcurrent: 1, fetchImpl: () => {
      started();
      return hang ? new Promise<Response>(() => {}) : Promise.resolve(new Response("recovered"));
    } });
    const { cookie } = await demo.enter();
    const pending = demo.request("/demo", { headers: { cookie } });
    await ready;
    expect((await demo.request("/demo", { headers: { cookie } })).status).toBe(429);
    expect((await pending).status).toBe(504);
    hang = false;
    expect((await demo.request("/demo", { headers: { cookie } })).status).toBe(200);
  });

  it("caps response bytes and per-session mutations", async () => {
    const demo = setup({ maxResponseBytes: 4, maxMutationsPerMinute: 1 });
    const { cookie } = await demo.enter();
    const mutation = { method: "POST", headers: { cookie, origin: ORIGIN } };
    expect((await demo.request("/api/intake", mutation)).status).toBe(502);
    expect((await demo.request("/api/intake", mutation)).status).toBe(429);
    demo.clock.now += 60_000;
    expect((await demo.request("/api/intake", mutation)).status).toBe(502);
  });

  it("rejects a non-loopback upstream and invalid public origin", () => {
    expect(() => setup({ upstream: "https://other.test" })).toThrow("loopback");
    expect(() => setup({ upstream: "http://127.0.0.1:3189/admin" })).toThrow("loopback");
    expect(() => setup({ publicOrigin: "http://demo.example.test" })).toThrow("HTTPS");
    expect(() => setup({ publicOrigin: "https://demo.example.test/path" })).toThrow("HTTPS");
  });
});
