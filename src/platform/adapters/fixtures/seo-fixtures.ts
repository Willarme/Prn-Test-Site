import type { SeoMetricSnapshot, SerpSnapshot } from "@/domain/search/contracts";
import type { GeographyScope } from "@/domain/shared/primitives";

/**
 * Deterministic fixture data derived from the owner's seed research workbook
 * (Trial_Run_Home_Tools_Keyword_SERP_Research.xlsx, researched 2026-08-10).
 * Geography was not stated in the workbook; US-national is ASSUMED per the
 * Ahrefs Queue capture spec ("US volume") — records carry geography_assumed.
 */
export const FIXTURE_GEOGRAPHY: GeographyScope = { mode: "national", country: "US" };

export interface FixtureKeywordRow {
  keyword: string;
  cluster: string;
  problem_family_hint: string | null;
  volume_monthly: number | null;
  keyword_difficulty: number | null; // 0 is a REAL value; null = unknown
  cpc_usd: number | null;
  opportunity_score: number | null;
  source_note: string;
}

export const FIXTURE_KEYWORD_ROWS: readonly FixtureKeywordRow[] = [
  {
    keyword: "ac not turning on",
    cluster: "HVAC",
    problem_family_hint: "hvac",
    volume_monthly: 3300,
    keyword_difficulty: 3,
    cpc_usd: null,
    opportunity_score: 84,
    source_note: "Trial - Problem Intent, priority 1; public dataset, verify via vendor API",
  },
  {
    keyword: "ac blowing warm air",
    cluster: "HVAC",
    problem_family_hint: "hvac",
    volume_monthly: 1700,
    keyword_difficulty: 0,
    cpc_usd: null,
    opportunity_score: null,
    source_note: "Trial - Problem Intent, priority 2; KD 0 is a real observed value",
  },
  {
    keyword: "electrical burning smell",
    cluster: "Electrical",
    problem_family_hint: "electrical",
    volume_monthly: 6800,
    keyword_difficulty: 42,
    cpc_usd: null,
    opportunity_score: null,
    source_note: "Trial - Problem Intent, priority 20; tier B - validate; safety-sensitive intent",
  },
  {
    keyword: "water dripping from ceiling",
    cluster: "Plumbing / Water damage",
    problem_family_hint: "plumbing",
    volume_monthly: null,
    keyword_difficulty: null,
    cpc_usd: null,
    opportunity_score: null,
    source_note: "Needs vendor validation; metrics unknown, not zero",
  },
  {
    keyword: "concrete slab calculator",
    cluster: "Concrete",
    problem_family_hint: null,
    volume_monthly: 49500,
    keyword_difficulty: null,
    cpc_usd: null,
    opportunity_score: 88,
    source_note: "Trial - Calculators, priority 2; GREENLIGHT FOR AHREFS CHECK; tool intent",
  },
] as const;

export function fixtureMetricSnapshot(keyword: string, index: number): SeoMetricSnapshot {
  const row = FIXTURE_KEYWORD_ROWS.find((r) => r.keyword === keyword);
  return {
    metric_snapshot_id: `fixture_metric_${index}`,
    schema_version: "1.0.0",
    keyword,
    vendor: "fixture",
    geography: FIXTURE_GEOGRAPHY,
    queried_at: "2026-08-10T00:00:00Z",
    volume_monthly: row?.volume_monthly ?? null,
    keyword_difficulty: row?.keyword_difficulty ?? null,
    cpc_usd: row?.cpc_usd ?? null,
    competition: null,
    trend_12mo: null,
    raw_vendor_ref: null,
    vendor_cost_usd: 0,
    rate_version: null,
  };
}

export function fixtureSerpSnapshot(keyword: string): SerpSnapshot {
  return {
    serp_snapshot_id: `fixture_serp_${keyword.replace(/\s+/g, "_")}`,
    schema_version: "1.0.0",
    keyword,
    geography: FIXTURE_GEOGRAPHY,
    queried_at: "2026-08-10T00:00:00Z",
    results: [
      {
        position: 1,
        url: `https://example-competitor.com/${keyword.replace(/\s+/g, "-")}`,
        title: `Fixture result for ${keyword}`,
        domain: "example-competitor.com",
        page_type: "article",
        domain_rating: 55,
      },
      {
        position: 2,
        url: `https://example-forum.com/thread/${keyword.replace(/\s+/g, "-")}`,
        title: null,
        domain: "example-forum.com",
        page_type: "forum",
        domain_rating: 30,
      },
    ],
    weakness_note: "fixture: position 2 is a weak forum result",
    vendor_cost_usd: 0,
  };
}
