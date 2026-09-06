import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { adaptDoorMetadata } from "@/platform/pages/door-metadata";
import { GET } from "@/app/problems/ac-blowing-warm-air/route";
import manifest from "../config/ac-door-assets.json";

const source = readFileSync(join(process.cwd(), manifest.source_path), "utf8");
const jsonld = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
const visibleBody = (html: string) => html.slice(html.indexOf("<body")).replace(/<script\b[\s\S]*?<\/script>/g, "");

describe("door metadata uses real backed assets without altering the frozen drawing", () => {
  it("uses the actual preview origin everywhere and keeps local content out of indexes", async () => {
    const response = await GET(new Request("http://127.0.0.1:3188/problems/ac-blowing-warm-air"));
    const html = await response.text();
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(html).not.toContain("https://propertyresponsenetwork.com");
    const canonical = "http://127.0.0.1:3188/problems/ac-blowing-warm-air";
    expect(html).toContain('<link rel="canonical" href="' + canonical + '">');
    expect(html).toContain('<meta property="og:url" content="' + canonical + '">');
    const graph = jsonld(html)["@graph"];
    const page = graph.find((item: Record<string, string>) => item["@type"] === "WebPage");
    expect(page.dateModified).toBe("2026-09-05");
    expect(page.url).toBe(canonical);
    expect(page["@id"]).toBe(canonical + "#webpage");
    for (const image of page.image) {
      expect(image.contentUrl).toMatch(/^http:\/\/127\.0\.0\.1:3188\/images\/.+\.png$/);
    }
    const socialImage = manifest.assets.find((asset) => asset.og_image)!;
    const url = "http://127.0.0.1:3188" + socialImage.png;
    expect(html).toContain('<meta property="og:image" content="' + url + '">');
    expect(html).toContain('<meta name="twitter:image" content="' + url + '">');
    expect(html).toContain('<meta name="twitter:title"');
    expect(html).toContain('<meta name="twitter:description"');
  });

  it("leaves all body markup, SVG diagrams, visible words and original CSS unchanged", () => {
    const rendered = adaptDoorMetadata(source, "http://localhost:3188");
    expect(visibleBody(rendered)).toBe(visibleBody(source));
    expect(rendered.match(/<style>[\s\S]*?<\/style>/)![0]).toBe(source.match(/<style>[\s\S]*?<\/style>/)![0]);
    expect((rendered.match(/<img\b/g) ?? []).length).toBe(0); // row 1 remains incomplete, truthfully
  });

  it("adds only the authorized narrow methodology wrapping rule after source validation", () => {
    const rendered = adaptDoorMetadata(source, "http://localhost:3188");
    const addedStyles = [...rendered.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)]
      .map(match => match[0]).filter(style => !source.includes(style));
    expect(addedStyles).toHaveLength(1);
    const repair = addedStyles[0];
    expect(repair).toContain('id="door-narrow-methodology-repair"');
    expect(repair.match(/@media[^{]+/g)).toEqual(["@media (max-width:360px)"]);
    expect(repair.match(/#[^{]+(?=\{)/g)).toEqual([
      "#repair-record .record-method", "#repair-record .record-method a",
    ]);
    expect(repair).not.toMatch(/!important|font|color|display:|position:|overflow:hidden/);
    expect(rendered.indexOf(repair)).toBeLessThan(rendered.indexOf("</head>"));
    expect(visibleBody(rendered)).toBe(visibleBody(source));
  });

  it("cannot publish a stale source date after an unreviewed source replacement", () => {
    expect(() => adaptDoorMetadata(source.replace("What is your AC doing right now?", "Changed question"), "http://localhost"))
      .toThrow(/source-version receipt/);
    expect(() => adaptDoorMetadata(source.replace(/\r?\n/g, "\r\n"), "http://localhost")).not.toThrow();
  });

  for (const asset of manifest.assets) {
    it("the declared PNG has its actual dimensions and format: " + asset.png, async () => {
      const bytes = readFileSync(join(process.cwd(), "public", asset.png));
      const metadata = await sharp(bytes).metadata();
      expect(metadata.format).toBe("png");
      expect(metadata.hasAlpha).toBe(false); // social clients cannot choose a dark backdrop for dark labels
      expect([metadata.width, metadata.height]).toEqual([asset.width, asset.height]);
      expect(bytes.length).toBeGreaterThan(10_000);
      const svg = readFileSync(join(process.cwd(), "public", asset.svg), "utf8");
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).not.toMatch(/var\(--|color-mix\(|\{\{/);
    });
  }
});
