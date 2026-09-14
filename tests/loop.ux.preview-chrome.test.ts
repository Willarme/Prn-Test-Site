import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/pages/[...path]/route";
import { addPreviewChrome } from "@/platform/pages/preview-chrome";
import { wirePreviewFeedback } from "@/platform/pages/preview-feedback";
import { featureSnapshot } from "./helpers/feature-snapshot";
import { readFeatureSnapshot } from "@/platform/features/state";
import { anonymousFeatureVisitor } from "@/platform/features/interest";

let snapshot = featureSnapshot({}, "LIVE");
vi.mock("@/platform/features/state", async importOriginal => ({
  ...await importOriginal<typeof import("@/platform/features/state")>(),
  readFeatureSnapshot: vi.fn(async () => snapshot),
}));
beforeEach(() => { vi.clearAllMocks(); snapshot = featureSnapshot({}, "LIVE"); });
afterEach(() => { vi.unstubAllEnvs(); });

const PAGES = [
  ["overview", "One Connected Home.dc.html", "One Connected Home"],
  ["dashboard", "Dashboard v3.dc.html", "Dashboard"],
  ["trust-network", "Trust Network v3.dc.html", "Trust Network"],
  ["smartquote", "SmartQuote v3.dc.html", "SmartQuote"],
  ["home-memory", "Home Memory v2.dc.html", "Home Memory"],
  ["provider-os", "Provider OS v2.dc.html", "Provider OS"],
] as const;

const sourceStyles = (html: string) => [...html.matchAll(/<style\b(?![^>]*data-preview-chrome-style)[^>]*>[\s\S]*?<\/style>/gi)].map(match => match[0]);
const notice = (html: string) => html.match(/<aside\b[^>]*data-preview-scope[^>]*>([\s\S]*?)<\/aside>/)?.[1];
const stripNoticePresentation = (html: string) => html.replace(/<aside\b[^>]*data-preview-scope[^>]*>/, "<aside data-preview-scope>");
const stripNavigationAnnotations = (html: string) => html.replace(/\sdata-preview-original-(?:nav(?:-bar|-links)?|ribbon)(?=\s|>)/g, "");
const stripLayoutAnnotations = (html: string) => html.replace(/\sdata-preview-grid="(?:stack|tiles)"(?=\s|>)/g, "")
  .replace(/\sdata-preview-fluid-copy(?=\s|>)/g, "");

describe("feature preview chrome leaves the approved document intact", () => {
  for (const [slug, file, label] of PAGES) {
    it(`${slug}: preserves original styles and bytes except the scope opening tag and exact navigation/layout annotations`, () => {
      const source = readFileSync(join(process.cwd(), "public/feature", file), "utf8").replace(/\r\n/g, "\n");
      const wired = wirePreviewFeedback(source, file);
      const html = addPreviewChrome(wired, slug, snapshot);
      expect(sourceStyles(html)).toEqual(sourceStyles(source));
      expect(notice(html)).toBe(notice(wired));
      expect(html).toContain(`aria-current="page"><i class="prn-preview-mark" aria-hidden="true"></i>${label}</span>`);
      const unwrapped = html.replace(/<style data-preview-chrome-style>[\s\S]*?<\/style>/, "")
        .replace(/<header\b[^>]*data-customer-shell="header"[\s\S]*?<\/header>/, "")
        .replace(/<footer\b[^>]*data-customer-shell="footer"[\s\S]*?<\/footer>/, "")
        .replace(/<nav data-preview-chrome="navigation"[\s\S]*?<\/nav>/, "");
      expect(stripNoticePresentation(stripNavigationAnnotations(stripLayoutAnnotations(unwrapped)))).toBe(stripNoticePresentation(wired));
      expect(addPreviewChrome(html, slug, snapshot)).toBe(html);
    });

    it(`${slug}: marks only the original navigation and retains every link and founder word`, () => {
      const source = readFileSync(join(process.cwd(), "public/feature", file), "utf8");
      const html = addPreviewChrome(wirePreviewFeedback(source, file), slug, snapshot);
      expect(html.match(/<div data-preview-original-nav /g)).toHaveLength(1);
      expect(html.match(/<div data-preview-original-nav-bar /g)).toHaveLength(1);
      expect(html.match(/<div data-preview-original-nav-links /g)).toHaveLength(1);
      expect(html.match(/<div data-preview-original-ribbon /g) ?? []).toHaveLength(slug === "provider-os" ? 0 : 1);
      const links = html.match(/<div data-preview-original-nav-links[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
      expect([...links.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(match => match[2]))
        .toEqual(["Overview", "Dashboard", "Trust Network", "SmartQuote", "Home Memory", "For providers"]);
      if (slug !== "provider-os") expect(html).toMatch(/<div data-preview-original-ribbon[^>]*><div[^>]*><b[^>]*>FREE<\/b>for Founders<\/div><\/div>/);
    });

    it(`${slug}: the served route replaces demo destinations with the customer directory`, async () => {
      const response = await GET(new Request(`http://localhost/pages/${slug}`), { params: Promise.resolve({ path: [slug] }) });
      expect(response.status).toBe(200);
      expect(readFeatureSnapshot).toHaveBeenCalledOnce();
      const html = await response.text();
      const nav = html.match(/<nav data-preview-chrome="navigation"[\s\S]*?<\/nav>/)?.[0] ?? "";
      expect(html.match(/<nav data-preview-chrome="navigation"/g)).toHaveLength(1);
      expect([...nav.matchAll(/href="([^"]+)"/g)].map(match => match[1])).toEqual(["/problems/ac-blowing-warm-air"]);
      expect(nav).not.toContain("/admin");
      expect(html).toContain('aria-label="Main navigation"');
      expect(html).toContain('aria-label="Footer directory"');
      expect(html).not.toMatch(/href="(?:\/demo(?:\/all)?|\/pages\/provider-os)"/);
    });
  }

  it("rejects unknown stage labels instead of interpolating unchecked input", () => {
    expect(() => addPreviewChrome("<html><head></head><body></body></html>", '<script>', snapshot)).toThrow("Unknown feature preview stage");
  });

  it("does not silently apply the original-nav repair to a changed source structure", () => {
    const source = readFileSync(join(process.cwd(), "public/feature/One Connected Home.dc.html"), "utf8");
    expect(() => addPreviewChrome(source.replace("gap:20px;height:64px", "gap:20px;height:72px"), "overview", snapshot))
      .toThrow("Feature preview navigation structure changed");
  });
});

describe("persisted product-preview serving states", () => {
  const products = [
    ["dashboard", "product_dashboard"], ["trust-network", "product_trust_network"],
    ["smartquote", "product_smartquote"], ["home-memory", "product_home_memory"],
  ] as const;
  for (const [slug, id] of products) {
    it(`${slug}: PREVIEW serves the prompt and a signed anonymous cookie`, async () => {
      vi.stubEnv("LINK_SIGNING_SECRET", "synthetic-preview-test-secret-at-least-32");
      snapshot = featureSnapshot({ [id]: "PREVIEW" });
      const response = await GET(new Request(`https://example.test/pages/${slug}`), { params: Promise.resolve({ path: [slug] }) });
      expect(response.status).toBe(200);
      expect(readFeatureSnapshot).toHaveBeenCalledOnce();
      const html = await response.text();
      expect(html).toContain('id="prn-interest"');
      expect(html).toContain("Not live yet, would you use this?");
      expect(html).toContain(`"feature_id":"${id}","feature_version":1,"page":"/pages/${slug}"`);
      for (const href of ["/about", "/faq", "/problems/"]) expect(html).not.toContain(`href="${href}"`);
      const cookie = response.headers.get("set-cookie")!;
      expect(cookie).toContain("HttpOnly; SameSite=Lax");
      expect(cookie).toContain("Secure");
      const returning = new Request(`https://example.test/pages/${slug}`, { headers: { cookie: cookie.split(";")[0]! } });
      expect(anonymousFeatureVisitor(returning)).toMatch(/^[A-Za-z0-9_-]{32}$/);
      const reopened = await GET(returning, { params: Promise.resolve({ path: [slug] }) });
      expect(reopened.headers.get("set-cookie")).toBeNull();
    });
    it(`${slug}: HIDDEN refuses the page and LIVE restores it without a preview prompt`, async () => {
      snapshot = featureSnapshot({ [id]: "HIDDEN" });
      const hidden = await GET(new Request(`http://localhost/pages/${slug}`), { params: Promise.resolve({ path: [slug] }) });
      expect(hidden.status).toBe(404);
      expect(hidden.headers.get("set-cookie")).toBeNull();
      snapshot = featureSnapshot({ [id]: "LIVE" });
      const live = await GET(new Request(`http://localhost/pages/${slug}`), { params: Promise.resolve({ path: [slug] }) });
      expect(live.status).toBe(200);
      expect(await live.text()).not.toContain('id="prn-interest"');
    });
  }
});
