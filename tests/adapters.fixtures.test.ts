import { describe, expect, it } from "vitest";
import { SeoMetricSnapshot, SerpSnapshot } from "@/domain/search/contracts";
import { FixtureSeoDataAdapter } from "@/platform/adapters/seo-data";
import { FixtureSearchConsoleAdapter } from "@/platform/adapters/search-console";
import { FIXTURE_KEYWORD_ROWS } from "@/platform/adapters/fixtures/seo-fixtures";

describe("FixtureSeoDataAdapter honors the SeoDataAdapter contract", () => {
  const adapter = new FixtureSeoDataAdapter();

  it("returns keyword ideas from seed rows", async () => {
    const ideas = await adapter.discoverIdeas(["home problems"], { mode: "national", country: "US" });
    expect(ideas.length).toBe(FIXTURE_KEYWORD_ROWS.length);
    expect(ideas.map((i) => i.keyword)).toContain("ac not turning on");
  });

  it("returns metric snapshots that parse against the domain contract", async () => {
    const snapshots = await adapter.getKeywordMetrics(
      ["ac not turning on", "ac blowing warm air", "water dripping from ceiling"],
      { mode: "national", country: "US" }
    );
    for (const snap of snapshots) {
      expect(SeoMetricSnapshot.safeParse(snap).success).toBe(true);
    }
    const kdZero = snapshots.find((s) => s.keyword === "ac blowing warm air")!;
    expect(kdZero.keyword_difficulty).toBe(0); // real zero survives normalization
    const unknown = snapshots.find((s) => s.keyword === "water dripping from ceiling")!;
    expect(unknown.keyword_difficulty).toBeNull(); // unknown stays null, never coerced to 0
  });

  it("returns SERP snapshots that parse against the domain contract", async () => {
    const serp = await adapter.getSerpSnapshot("ac not turning on", {
      mode: "national",
      country: "US",
    });
    expect(SerpSnapshot.safeParse(serp).success).toBe(true);
  });

  it("classifies tool vs problem intent from seed clusters", async () => {
    const intents = await adapter.getSearchIntent(["concrete slab calculator", "ac not turning on"]);
    expect(intents.find((i) => i.keyword === "concrete slab calculator")!.intent_type).toBe("tool");
    expect(intents.find((i) => i.keyword === "ac not turning on")!.intent_type).toBe("problem");
  });
});

describe("FixtureSearchConsoleAdapter honors the SearchConsoleAdapter contract", () => {
  const adapter = new FixtureSearchConsoleAdapter();

  it("returns search analytics rows with the contract shape", async () => {
    const rows = await adapter.querySearchAnalytics({
      property_url: "https://example.com",
      start_date: "2026-08-01",
      end_date: "2026-08-07",
      dimensions: ["date", "page", "query"],
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.impressions).toBeGreaterThanOrEqual(0);
      expect(row.ctr).toBeGreaterThanOrEqual(0);
      expect(row.ctr).toBeLessThanOrEqual(1);
      expect(row.page_path.startsWith("/")).toBe(true);
    }
  });

  it("lists sitemaps read-only — the adapter has no write surface (D-8)", async () => {
    expect(await adapter.listSitemaps("https://example.com")).toContain("/sitemap.xml");
    expect("submitSitemap" in adapter).toBe(false);
  });
});
