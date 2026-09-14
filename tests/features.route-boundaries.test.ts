import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FEATURES, requiredFeaturesForPath } from "@/platform/features/registry";
import { featureRouteRefusal, invalidateFeatureStates, stateIn } from "@/platform/features/state";
import { middleware } from "@/middleware";
import { featureSnapshot } from "./helpers/feature-snapshot";
import type { FeatureState } from "@/domain/features/types";
import { renderCustomerHeader, renderCustomerFooter } from "@/platform/pages/customer-shell";
import { rewriteInterPageLinks } from "@/platform/pages/inter-page-links";

const spies = vi.hoisted(() => ({ rows: vi.fn(), verify: vi.fn(), body: vi.fn(), owner: vi.fn(), consume: vi.fn(), share: vi.fn() }));
const store = { listFeatureStates: spies.rows };
vi.mock("@/platform/stores/runtime", async importOriginal => ({
  ...await importOriginal<typeof import("@/platform/stores/runtime")>(), runtimeStore: () => store,
}));
vi.mock("@/platform/links/tokens", async importOriginal => ({
  ...await importOriginal<typeof import("@/platform/links/tokens")>(),
  verifyLinkForRoute: spies.verify,
}));
vi.mock("@/platform/links/owner", () => ({ ownerAllowed: spies.owner }));
vi.mock("@/platform/links/body", async importOriginal => ({
  ...await importOriginal<typeof import("@/platform/links/body")>(), readBody: spies.body,
}));
vi.mock("@/platform/links/ledger", async importOriginal => ({
  ...await importOriginal<typeof import("@/platform/links/ledger")>(), consumeKeepLink: spies.consume,
}));
vi.mock("@/platform/results/share", async importOriginal => ({
  ...await importOriginal<typeof import("@/platform/results/share")>(), buildShareMessage: spies.share,
}));

function seed(overrides: Record<string, FeatureState> = {}, defaultState?: FeatureState) {
  const snapshot = featureSnapshot(overrides, defaultState);
  spies.rows.mockResolvedValue([...snapshot.rows.values()]);
  invalidateFeatureStates();
  return snapshot;
}
beforeEach(() => { vi.clearAllMocks(); seed(); });

const ROUTES = [
  "/keep/token", "/api/keep", "/claim/magic", "/ask/token", "/api/ask",
  "/links/request", "/api/links/revoke", "/p/token",
  "/results/request/send", "/api/results/request/send", "/results/request/find",
  "/account", "/account/settings", "/account/home-memory", "/account/trust-network",
  "/account/smartquote", "/account/dashboard", "/api/account/settings", "/my-home", "/api/my-home",
  "/local-records", "/local-records/cooling", "/local-records/all", "/api/local-records/cooling",
  "/problems", "/about", "/faq", "/future/diy-packet", "/demo", "/pages/provider-os",
  "/start", "/problems/ac-blowing-warm-air", "/api/intake/start", "/api/intake/walkthrough",
  "/api/intake/answer", "/complete/request", "/results/request", "/packet/request",
  "/local-records/methodology", "/repair-records/methodology", "/terms", "/privacy",
  ...FEATURES.flatMap(feature => feature.marketing_path ? [feature.marketing_path] : []),
];

describe("persisted feature × state × route boundaries", () => {
  for (const path of ROUTES) {
    const ids = requiredFeaturesForPath(path);
    it(`${path} has an explicit classification`, () => expect(ids.length).toBeGreaterThan(0));
    for (const id of ids) for (const state of ["LIVE", "PREVIEW", "HIDDEN"] as const) {
      it(`${path}: ${id}=${state}`, async () => {
        seed({ [id]: state }, "LIVE");
        const definition = FEATURES.find(feature => feature.id === id);
        const allowed = state === "LIVE" || (state === "PREVIEW" && definition?.marketing_path === path);
        for (const input of [path, `/%${path.charCodeAt(1).toString(16)}${path.slice(2)}`]) {
          const response = await middleware(new NextRequest(`https://example.test${input}`));
          expect(response.status).toBe(allowed ? 200 : 404);
        }
        if (definition?.marketing_path === path && state === "PREVIEW") {
          expect((await featureRouteRefusal(path, { api: true }))?.status).toBe(404);
        }
      });
    }
  }
  it("all feature rows fail closed without a verified snapshot", () => {
    for (const feature of FEATURES) expect(stateIn({ ...featureSnapshot({}, "LIVE"), verified: false }, feature.id)).toBe("HIDDEN");
  });
  it("does not read state for unrelated assets or admin", async () => {
    for (const path of ["/_next/static/chunk.js", "/images/diagram.svg", "/admin/features"]) {
      expect((await middleware(new NextRequest(`https://example.test${path}`))).status).toBe(200);
    }
    expect(spies.rows).not.toHaveBeenCalled();
  });
  it("hides classified routes on store failure and malformed encoding", async () => {
    spies.rows.mockRejectedValue(new Error("store unavailable"));
    expect((await middleware(new NextRequest("https://example.test/keep/held"))).status).toBe(404);
    expect((await middleware(new NextRequest("https://example.test/%ZZ"))).status).toBe(404);
  });
});

describe("raw feature boundary", () => {
  const aliases = ["One Connected Home.dc.html", "Dashboard v3.dc.html", "Trust Network v3.dc.html", "Home Memory v2.dc.html", "SmartQuote v3.dc.html", "Provider OS v2.dc.html", "support.js", "vendor/react.js", "vendor/react-dom.js", "vendor/babel.js"];
  it.each(aliases)("keeps %s navigation query parameters and refuses submitted bodies", async file => {
    const url = `https://example.test/feature/${encodeURI(file)}?source=old`;
    const response = await middleware(new NextRequest(url));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("?source=old");
    const post = await middleware(new NextRequest(url, { method: "POST" }));
    expect(post.status).toBe(405);
    expect(post.headers.get("location")).toBeNull();
  });
  it.each(["/feature", "/feature/unknown.html", "/%66eature/unknown.html"])("refuses unknown file %s", async path => {
    expect((await middleware(new NextRequest(`https://example.test${path}`))).status).toBe(404);
  });
});

describe("held tokens and actions", () => {
  it("refuses all direct page calls before token/owner/claim handling", async () => {
    const cases = [
      [import("@/app/keep/[token]/page"), { params: Promise.resolve({ token: "held" }), searchParams: Promise.resolve({}) }],
      [import("@/app/claim/[magic]/page"), { params: Promise.resolve({ magic: "held" }) }],
      [import("@/app/ask/[token]/page"), { params: Promise.resolve({ token: "held" }), searchParams: Promise.resolve({}) }],
      [import("@/app/links/[request_id]/page"), { params: Promise.resolve({ request_id: "held" }), searchParams: Promise.resolve({}) }],
      [import("@/app/results/[request_id]/send/page"), { params: Promise.resolve({ request_id: "held" }) }],
      [import("@/app/results/[request_id]/find/page"), { params: Promise.resolve({ request_id: "held" }) }],
    ] as const;
    for (const [module, props] of cases) {
      const page = (await module).default as (props: unknown) => Promise<unknown>;
      await expect(page(props)).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    }
    expect(spies.verify).not.toHaveBeenCalled();
    expect(spies.owner).not.toHaveBeenCalled();
    expect(spies.consume).not.toHaveBeenCalled();
  });
  it("refuses API handlers before reading bodies and shared packet tokens", async () => {
    for (const module of [await import("@/app/api/keep/route"), await import("@/app/api/ask/route"), await import("@/app/api/links/revoke/route")]) {
      expect((await module.POST(new Request("https://example.test/", { method: "POST", body: "private=held" }))).status).toBe(404);
    }
    const packet = await import("@/app/p/[token]/route");
    expect((await packet.GET(new Request("https://example.test/p/held"), { params: Promise.resolve({ token: "held" }) })).status).toBe(404);
    expect(spies.body).not.toHaveBeenCalled();
    expect(spies.verify).not.toHaveBeenCalled();
  });
  it("refuses a direct server action before reading form values or minting links", async () => {
    const { makeShareLink } = await import("@/app/results/[request_id]/send/actions");
    const data = new FormData();
    const get = vi.spyOn(data, "get");
    expect((await makeShareLink({ status: "idle" }, data)).status).toBe("error");
    expect(get).not.toHaveBeenCalled();
    expect(spies.owner).not.toHaveBeenCalled();
    expect(spies.share).not.toHaveBeenCalled();
  });
  it("LIVE restoration reaches the existing token gate without granting ownership", async () => {
    seed({}, "LIVE");
    spies.body.mockResolvedValue({ data: { token: "invalid" }, wantsJson: true });
    spies.verify.mockResolvedValue({ ok: false, reason: "invalid" });
    const keep = await import("@/app/api/keep/route");
    expect((await keep.POST(new Request("https://example.test/api/keep", { method: "POST" }))).status).toBe(403);
    expect(spies.body).toHaveBeenCalledOnce();
    expect(spies.verify).toHaveBeenCalledWith("invalid", "keep");
    expect(spies.consume).not.toHaveBeenCalled();
  });
  it("functional PREVIEW does not reach token verification", async () => {
    seed({ keep: "PREVIEW" }, "LIVE");
    const keep = await import("@/app/api/keep/route");
    expect((await keep.POST(new Request("https://example.test/api/keep", { method: "POST" }))).status).toBe(404);
    expect(spies.body).not.toHaveBeenCalled();
    expect(spies.verify).not.toHaveBeenCalled();
  });
});

describe("one snapshot for the customer shell", () => {
  it("hides unbuilt navigation and links hidden product originals without modifying source", () => {
    const snapshot = seed({ product_dashboard: "HIDDEN" });
    const header = renderCustomerHeader(snapshot), footer = renderCustomerFooter(snapshot);
    for (const href of ["/about", "/faq", "/problems/", "/pages/dashboard"]) {
      expect(header).not.toContain(`href="${href}"`);
      expect(footer).not.toContain(`href="${href}"`);
    }
    expect(header).toContain('href="/pages/trust-network"');
    expect(header).toContain('href="/start"');
    expect(footer).toContain('href="/admin"');
    expect(rewriteInterPageLinks('<a href="Dashboard v3.dc.html">Dashboard</a>', snapshot)).toBe("");
    expect(spies.rows).not.toHaveBeenCalled();
  });
  it("restores ordinary links when their persisted state becomes LIVE", () => {
    const live = renderCustomerHeader(featureSnapshot({}, "LIVE"));
    expect(live).toContain('href="/about"');
    const hidden = renderCustomerHeader(featureSnapshot({}, "HIDDEN"));
    expect(hidden).not.toContain('href="/start"');
    expect(hidden).not.toContain('href="/pages/');
  });
  it("compatibility flags reflect the same saved state and retain integration gates", async () => {
    seed({ intake: "HIDDEN", job_packet: "LIVE", trust_network: "LIVE" });
    const { getFeatureFlags, DEFAULT_FLAGS } = await import("@/platform/flags");
    const flags = await getFeatureFlags();
    expect(flags.find(flag => flag.flag_key === "intake_shell_enabled")?.enabled).toBe(false);
    expect(flags.find(flag => flag.flag_key === "results_shell_enabled")?.enabled).toBe(true);
    expect(flags.find(flag => flag.flag_key === "trust_enabled")?.enabled).toBe(true);
    for (const key of ["sms_enabled", "mcp_enabled", "monetization_enabled"]) {
      expect(flags.find(flag => flag.flag_key === key)).toEqual(DEFAULT_FLAGS.find(flag => flag.flag_key === key));
    }
    expect(DEFAULT_FLAGS.find(flag => flag.flag_key === "feature_lab_enabled")).toMatchObject({ enabled: false, decision_ref: "T6-29:R2:c6ff9a" });
  });
});
