import type { SearchOpportunity } from "@/domain/search/contracts";
import type { SeoFactoryPolicy } from "@/domain/search/policy";

/**
 * A04 deterministic scoring v1 (Tier-0 in the #23 §2.1 router: code, not an
 * LLM). Versioned so later revisions never silently change historical scores.
 *
 * Components (each 0-100, weighted):
 *  - demand: log-scaled monthly volume
 *  - winnability: inverse keyword difficulty (unknown KD = null, see below)
 *  - intent_fit: problem intent feeds the packet engine best (D-3 track)
 *  - seed_prior: the owner's manual rubric score when present
 *
 * Unknown KD does NOT silently count as easy or hard: the opportunity is
 * scored with a neutral winnability and flagged needs_enrichment — it cannot
 * qualify for a NEW page until real vendor metrics exist (#23 progressive
 * enrichment).
 */
export const SCORING_VERSION = "1.0.0";

const WEIGHTS = { demand: 0.3, winnability: 0.3, intent_fit: 0.25, seed_prior: 0.15 };

export function demandScore(volumeMonthly: number | null): number {
  if (volumeMonthly === null || volumeMonthly <= 0) return 0;
  // 100 volume -> ~33, 1k -> ~50, 10k -> ~67, 100k+ -> 83+, capped at 100.
  return Math.min(100, (Math.log10(volumeMonthly) / 6) * 100);
}

export function winnabilityScore(keywordDifficulty: number | null): number {
  if (keywordDifficulty === null) return 50; // neutral, paired with needs_enrichment
  return Math.max(0, 100 - keywordDifficulty * 2); // KD 0 -> 100, KD 50+ -> 0
}

export function intentFitScore(intentType: SearchOpportunity["intent_type"]): number {
  switch (intentType) {
    case "problem":
      return 100;
    case "tool":
      return 70;
    case "informational":
      return 50;
    case "commercial":
      return 40;
    default:
      return 30;
  }
}

export interface ScoredOpportunity {
  opportunity: SearchOpportunity;
  score: number;
  components: Record<string, number>;
  needs_enrichment: boolean;
}

export function scoreOpportunity(opportunity: SearchOpportunity): ScoredOpportunity {
  const seedPrior = opportunity.score_components?.seed_manual_score ?? null;
  const components: Record<string, number> = {
    demand: demandScore(opportunity.volume_monthly),
    winnability: winnabilityScore(opportunity.keyword_difficulty),
    intent_fit: intentFitScore(opportunity.intent_type),
    seed_prior: seedPrior ?? 50,
  };
  const score =
    components.demand * WEIGHTS.demand +
    components.winnability * WEIGHTS.winnability +
    components.intent_fit * WEIGHTS.intent_fit +
    components.seed_prior * WEIGHTS.seed_prior;
  return {
    opportunity,
    score: Math.round(score * 10) / 10,
    components: { ...components, scoring_version_1: 1 },
    needs_enrichment:
      opportunity.keyword_difficulty === null || opportunity.volume_monthly === null,
  };
}

/**
 * Threshold gate (#23 §1.3): quality outranks quota. An opportunity with
 * unknown metrics can never qualify — it needs enrichment first, and the
 * agent may NEVER lower thresholds to fill slots.
 */
export function qualifiesForNewPage(scored: ScoredOpportunity, policy: SeoFactoryPolicy): boolean {
  if (scored.needs_enrichment) return false;
  if (scored.score < policy.min_opportunity_score) return false;
  const { volume_monthly, keyword_difficulty } = scored.opportunity;
  if (policy.min_search_volume !== null && (volume_monthly ?? 0) < policy.min_search_volume) {
    return false;
  }
  if (
    policy.max_keyword_difficulty !== null &&
    keyword_difficulty !== null &&
    keyword_difficulty > policy.max_keyword_difficulty
  ) {
    return false;
  }
  if (policy.allowed_categories.length > 0) {
    // Known family must be in the allowed list. Unknown family is allowed only
    // when the owner keeps the "general_home_problem" catch-all in the list —
    // removing it makes the gate strict (only classified categories pass).
    const family = scored.opportunity.problem_family_hint;
    const inCategory =
      family !== null
        ? policy.allowed_categories.includes(family)
        : policy.allowed_categories.includes("general_home_problem");
    if (!inCategory) return false;
  }
  return true;
}
