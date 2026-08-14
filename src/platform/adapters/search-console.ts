/**
 * Google Search Console adapter — the owned first-party feedback loop
 * (#23 §1.1: MANDATORY). Real implementation lands once the production domain
 * is verified in Search Console (owner action) and uses READ-ONLY OAuth —
 * this interface deliberately has no write methods (#23 §8.2/§8.4). Sitemap
 * publication happens by serving /sitemap.xml from the site itself; any
 * Search Console sitemap submission is an owner/publish-wave action outside
 * this adapter (Decision D-8).
 * Until then the fixture keeps every consumer honest against the contract.
 */
export interface SearchAnalyticsQuery {
  property_url: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  dimensions: ReadonlyArray<"date" | "page" | "query" | "device" | "country">;
}

export interface SearchAnalyticsRow {
  date: string;
  page_path: string;
  query: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
  avg_position: number;
}

export interface SearchConsoleAdapter {
  readonly vendor: string;
  querySearchAnalytics(query: SearchAnalyticsQuery): Promise<SearchAnalyticsRow[]>;
  listSitemaps(propertyUrl: string): Promise<string[]>;
}

export class FixtureSearchConsoleAdapter implements SearchConsoleAdapter {
  readonly vendor = "fixture";

  async querySearchAnalytics(query: SearchAnalyticsQuery): Promise<SearchAnalyticsRow[]> {
    return [
      {
        date: query.start_date,
        page_path: "/problems/ac-not-turning-on",
        query: "ac not turning on",
        impressions: 120,
        clicks: 9,
        ctr: 0.075,
        avg_position: 6.2,
      },
      {
        date: query.start_date,
        page_path: "/problems/ac-not-turning-on",
        query: "why is my ac not turning on",
        impressions: 45,
        clicks: 2,
        ctr: 0.044,
        avg_position: 9.8,
      },
    ];
  }

  async listSitemaps(_propertyUrl: string): Promise<string[]> {
    return ["/sitemap.xml"];
  }
}
