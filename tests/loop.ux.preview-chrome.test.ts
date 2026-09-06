import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/pages/[...path]/route";
import { addPreviewChrome } from "@/platform/pages/preview-chrome";
import { wirePreviewFeedback } from "@/platform/pages/preview-feedback";

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

describe("feature preview chrome leaves the approved document intact", () => {
  for (const [slug, file, label] of PAGES) {
    it(`${slug}: preserves original styles and bytes except the scope opening tag and exact navigation annotations`, () => {
      const source = readFileSync(join(process.cwd(), "public/feature", file), "utf8").replace(/\r\n/g, "\n");
      const wired = wirePreviewFeedback(source, file);
      const html = addPreviewChrome(wired, slug);
      expect(sourceStyles(html)).toEqual(sourceStyles(source));
      expect(notice(html)).toBe(notice(wired));
      expect(html).toContain(`aria-current="page"><i class="prn-preview-mark" aria-hidden="true"></i>${label}</span>`);
      const unwrapped = html.replace(/<style data-preview-chrome-style>[\s\S]*?<\/style>/, "")
        .replace(/<nav data-preview-chrome="navigation"[\s\S]*?<\/nav>/, "");
      expect(stripNoticePresentation(stripNavigationAnnotations(unwrapped))).toBe(stripNoticePresentation(wired));
      expect(addPreviewChrome(html, slug)).toBe(html);
    });

    it(`${slug}: marks only the original navigation and retains every link and founder word`, () => {
      const source = readFileSync(join(process.cwd(), "public/feature", file), "utf8");
      const html = addPreviewChrome(wirePreviewFeedback(source, file), slug);
      expect(html.match(/<div data-preview-original-nav /g)).toHaveLength(1);
      expect(html.match(/<div data-preview-original-nav-bar /g)).toHaveLength(1);
      expect(html.match(/<div data-preview-original-nav-links /g)).toHaveLength(1);
      expect(html.match(/<div data-preview-original-ribbon /g) ?? []).toHaveLength(slug === "provider-os" ? 0 : 1);
      const links = html.match(/<div data-preview-original-nav-links[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
      expect([...links.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(match => match[2]))
        .toEqual(["Overview", "Dashboard", "Trust Network", "SmartQuote", "Home Memory", "For providers"]);
      if (slug !== "provider-os") expect(html).toMatch(/<div data-preview-original-ribbon[^>]*><div[^>]*><b[^>]*>FREE<\/b>for Founders<\/div><\/div>/);
    });

    it(`${slug}: the served route exposes the three public destinations exactly once`, async () => {
      const response = await GET(new Request(`http://localhost/pages/${slug}`), { params: Promise.resolve({ path: [slug] }) });
      expect(response.status).toBe(200);
      const html = await response.text();
      const nav = html.match(/<nav data-preview-chrome="navigation"[\s\S]*?<\/nav>/)?.[0] ?? "";
      expect(html.match(/<nav data-preview-chrome="navigation"/g)).toHaveLength(1);
      expect([...nav.matchAll(/href="([^"]+)"/g)].map(match => match[1])).toEqual(["/demo", "/demo/all", "/ac-blowing-warm-air"]);
      expect(nav).not.toContain("/admin");
    });
  }

  it("rejects unknown stage labels instead of interpolating unchecked input", () => {
    expect(() => addPreviewChrome("<html><head></head><body></body></html>", '<script>')).toThrow("Unknown feature preview stage");
  });

  it("does not silently apply the original-nav repair to a changed source structure", () => {
    const source = readFileSync(join(process.cwd(), "public/feature/One Connected Home.dc.html"), "utf8");
    expect(() => addPreviewChrome(source.replace("gap:20px;height:64px", "gap:20px;height:72px"), "overview"))
      .toThrow("Feature preview navigation structure changed");
  });
});
