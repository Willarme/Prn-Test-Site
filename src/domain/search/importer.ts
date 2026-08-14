import { SearchOpportunity } from "@/domain/search/contracts";

/**
 * Seed-workbook importer (Door Wave 1). Consumes the JSON produced by
 * tools/convert-seed-xlsx.py (the only xlsx reader) and yields validated
 * SearchOpportunity records. Rules from docs/canon/seed-import-map.md:
 *  - keyword is the natural dedupe key; duplicate rows across sheets merge,
 *    richest row wins per field, provenance lists every source sheet
 *  - KD 0 is real; null is unknown — never coerced
 *  - geography was absent in the workbook: US-national assumed and flagged
 */
export interface SeedRow {
  sheet: string;
  row: number;
  keyword: string;
  keyword_raw: string;
  cluster: string | null;
  volume_monthly: number | null;
  keyword_difficulty: number | null;
  cpc_usd: number | null;
  opportunity_score: number | null;
  tier: string | null;
  recommendation_note: string | null;
  serp_example_urls: string[];
  metric_source_type: string | null;
  metric_source_url: string | null;
  research_date: string | null;
}

export interface SeedFile {
  source_workbook: string;
  per_sheet_counts: Record<string, number>;
  rows: SeedRow[];
}

import { classifyIntentPrnSide, inferProblemFamily } from "@/domain/search/intent-classifier";

function inferIntentType(row: SeedRow): SearchOpportunity["intent_type"] {
  if (row.sheet === "Trial - Problem Intent") return "problem";
  const classified = classifyIntentPrnSide(`${row.keyword} ${row.cluster ?? ""}`, null);
  if (classified !== "unknown") return classified;
  if (row.sheet === "Trial - Calculators") return "tool";
  return "unknown";
}

/** Merge duplicate keyword rows: prefer non-null, then higher-information sheets. */
function mergeRows(rows: SeedRow[]): SeedRow {
  const sorted = [...rows].sort((a, b) => {
    const score = (r: SeedRow) =>
      (r.opportunity_score !== null ? 4 : 0) +
      (r.volume_monthly !== null ? 2 : 0) +
      (r.keyword_difficulty !== null ? 1 : 0);
    return score(b) - score(a);
  });
  const base = { ...sorted[0] };
  for (const row of sorted.slice(1)) {
    base.cluster ??= row.cluster;
    base.volume_monthly ??= row.volume_monthly;
    base.keyword_difficulty ??= row.keyword_difficulty;
    base.cpc_usd ??= row.cpc_usd;
    base.opportunity_score ??= row.opportunity_score;
    base.tier ??= row.tier;
    base.recommendation_note ??= row.recommendation_note;
    base.metric_source_type ??= row.metric_source_type;
    base.metric_source_url ??= row.metric_source_url;
    base.research_date ??= row.research_date;
    if (base.serp_example_urls.length === 0) base.serp_example_urls = row.serp_example_urls;
  }
  return base;
}

export function slugify(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

import { shortHash } from "@/domain/shared/hash";
export { shortHash };

export function importSeedRows(file: SeedFile, importedAt: string): SearchOpportunity[] {
  const byKeyword = new Map<string, SeedRow[]>();
  for (const row of file.rows) {
    const list = byKeyword.get(row.keyword) ?? [];
    list.push(row);
    byKeyword.set(row.keyword, list);
  }

  const opportunities: SearchOpportunity[] = [];
  for (const [keyword, rows] of byKeyword) {
    const merged = mergeRows(rows);
    const sheets = rows.map((r) => r.sheet).join(" + ");
    const seedEvidence = [
      merged.tier ? `tier: ${merged.tier}` : null,
      merged.recommendation_note ? `note: ${merged.recommendation_note}` : null,
      merged.serp_example_urls.length > 0 ? `SERP examples: ${merged.serp_example_urls.join(" ; ")}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    opportunities.push(
      SearchOpportunity.parse({
        search_opportunity_id: `so_seed_${slugify(keyword)}_${shortHash(keyword)}`,
        schema_version: "1.0.0",
        keyword,
        intent_cluster_id: null,
        cluster_label: merged.cluster,
        problem_family_hint: inferProblemFamily(keyword, merged.cluster),
        source: "seed_import",
        geography: { mode: "national", country: "US" },
        geography_assumed: true,
        volume_monthly: merged.volume_monthly,
        keyword_difficulty: merged.keyword_difficulty,
        cpc_usd: merged.cpc_usd,
        intent_type: inferIntentType(merged),
        // Seed scores are the owner's manual rubric — kept as provenance, not
        // trusted as the A04 score (that is computed fresh with versioned
        // components at discovery time).
        opportunity_score: null,
        score_components: merged.opportunity_score !== null ? { seed_manual_score: merged.opportunity_score } : null,
        recommendation: null,
        status: "candidate",
        metric_snapshot_ids: [],
        serp_snapshot_ids: [],
        provenance: {
          source_type: merged.metric_source_type ?? "seed workbook (unvalidated public estimate)",
          source_url: merged.metric_source_url,
          confidence_note:
            `Imported from ${file.source_workbook} (${sheets}); geography assumed US-national; metrics require vendor validation.` +
            (seedEvidence ? ` Seed evidence — ${seedEvidence}` : ""),
        },
        vendor_cost_usd: null,
        researched_at: merged.research_date ? `${merged.research_date}T00:00:00Z` : null,
        created_at: importedAt,
        updated_at: null,
      })
    );
  }
  return opportunities;
}
