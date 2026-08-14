import type { SeoMetricSnapshot, SerpSnapshot } from "@/domain/search/contracts";
import type { GeographyScope } from "@/domain/shared/primitives";
import {
  FIXTURE_KEYWORD_ROWS,
  fixtureMetricSnapshot,
  fixtureSerpSnapshot,
} from "@/platform/adapters/fixtures/seo-fixtures";

/**
 * Vendor-neutral SEO data adapter (#23 §1.2). HARD RULE: nothing outside an
 * implementation of this interface may know vendor-specific field names or
 * credentials. Credentials live in server-side env secrets only — never in
 * browser code, logs, PageSpecs, or admin UI.
 *
 * EVERY method reports its vendor cost (on the result envelope or on each
 * snapshot) so the budget brake sees real spend — paid endpoints with
 * unreported costs are how budgets get silently blown (#23 §8.3).
 */
export interface KeywordIdea {
  keyword: string;
  source_seed: string | null;
}

export interface DiscoverIdeasResult {
  ideas: KeywordIdea[];
  vendor_cost_usd: number;
}

export interface IntentClassification {
  keyword: string;
  intent_type: "problem" | "tool" | "informational" | "commercial" | "unknown";
  confidence: "high" | "medium" | "low";
}

export interface SearchIntentResult {
  classifications: IntentClassification[];
  vendor_cost_usd: number;
}

export interface TrendSeries {
  keyword: string;
  monthly: number[];
}

export interface SeoDataAdapter {
  readonly vendor: string;
  discoverIdeas(seeds: string[], geography: GeographyScope): Promise<DiscoverIdeasResult>;
  getKeywordMetrics(keywords: string[], geography: GeographyScope): Promise<SeoMetricSnapshot[]>;
  getSearchIntent(keywords: string[]): Promise<SearchIntentResult>;
  getSerpSnapshot(keyword: string, geography: GeographyScope): Promise<SerpSnapshot>;
  getTrend(keywords: string[], geography: GeographyScope): Promise<TrendSeries[]>;
}

/** Deterministic fixture implementation used until Door Wave 1 goes live. */
export class FixtureSeoDataAdapter implements SeoDataAdapter {
  readonly vendor = "fixture";

  async discoverIdeas(seeds: string[], _geography: GeographyScope): Promise<DiscoverIdeasResult> {
    return {
      ideas: FIXTURE_KEYWORD_ROWS.map((row) => ({
        keyword: row.keyword,
        source_seed: seeds[0] ?? null,
      })),
      vendor_cost_usd: 0,
    };
  }

  async getKeywordMetrics(
    keywords: string[],
    _geography: GeographyScope
  ): Promise<SeoMetricSnapshot[]> {
    return keywords.map((keyword, i) => fixtureMetricSnapshot(keyword, i));
  }

  async getSearchIntent(keywords: string[]): Promise<SearchIntentResult> {
    return {
      classifications: keywords.map((keyword) => {
        const row = FIXTURE_KEYWORD_ROWS.find((r) => r.keyword === keyword);
        const isTool =
          row?.cluster.toLowerCase().includes("calculator") || keyword.includes("calculator");
        return {
          keyword,
          intent_type: isTool ? ("tool" as const) : row ? ("problem" as const) : ("unknown" as const),
          confidence: row ? ("high" as const) : ("low" as const),
        };
      }),
      vendor_cost_usd: 0,
    };
  }

  async getSerpSnapshot(keyword: string, _geography: GeographyScope): Promise<SerpSnapshot> {
    return fixtureSerpSnapshot(keyword);
  }

  async getTrend(keywords: string[], _geography: GeographyScope): Promise<TrendSeries[]> {
    return keywords.map((keyword) => ({
      keyword,
      monthly: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
    }));
  }
}
