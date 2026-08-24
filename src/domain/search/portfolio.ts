import type { SearchOpportunity } from "@/domain/search/contracts";
import type { SeoFactoryPolicy } from "@/domain/search/policy";
import { recommend } from "@/domain/search/recommend";
import { scoreOpportunity } from "@/domain/search/scoring";

/**
 * Evaluate an existing portfolio WITHOUT vendor calls: score every record,
 * then recommend in descending-score order so the strongest keyword in each
 * intent family wins (same rules as discovery, minus the vendor step). Used
 * by the factory runner and the admin dashboard.
 */
export interface PortfolioSummary {
  total: number;
  by_recommendation: Record<string, number>;
  by_intent: Record<string, number>;
  needs_enrichment: number;
}

export function evaluatePortfolio(
  opportunities: SearchOpportunity[],
  policy: SeoFactoryPolicy
): { opportunities: SearchOpportunity[]; summary: PortfolioSummary } {
  // Weights come from policy now (C12). With the shipped defaults this is the
  // same arithmetic it always was.
  const scored = opportunities
    .map((o) => scoreOpportunity(o, policy))
    .sort((a, b) => b.score - a.score);
  const seen: SearchOpportunity[] = [];
  const out: SearchOpportunity[] = [];
  const byRec: Record<string, number> = {};
  const byIntent: Record<string, number> = {};
  let newCount = 0;
  let needsEnrichment = 0;

  for (const s of scored) {
    const rec = recommend(s, seen, policy);
    let finalRec = rec.recommendation;
    if (finalRec === "NEW" && newCount >= policy.max_new_pages_per_period) finalRec = "WATCH";
    if (finalRec === "NEW") newCount++;
    if (s.needs_enrichment) needsEnrichment++;
    const seedPrior = s.opportunity.score_components?.seed_manual_score;
    const stored: SearchOpportunity = {
      ...s.opportunity,
      opportunity_score: s.score,
      score_version: s.score_version,
      score_components: {
        ...s.components,
        ...(seedPrior !== undefined ? { seed_manual_score: seedPrior } : {}),
      },
      recommendation: finalRec,
    };
    out.push(stored);
    seen.push(stored);
    byRec[finalRec] = (byRec[finalRec] ?? 0) + 1;
    byIntent[stored.intent_type] = (byIntent[stored.intent_type] ?? 0) + 1;
  }

  return {
    opportunities: out,
    summary: {
      total: out.length,
      by_recommendation: byRec,
      by_intent: byIntent,
      needs_enrichment: needsEnrichment,
    },
  };
}
