import type { SearchOpportunity } from "@/domain/search/contracts";
import type { OpportunityRecommendation } from "@/domain/search/lifecycle";
import type { SeoFactoryPolicy } from "@/domain/search/policy";
import { qualifiesForNewPage, type ScoredOpportunity } from "@/domain/search/scoring";

/**
 * Near-duplicate / cannibalization detection (deterministic v1). Two keywords
 * are the same intent family when their token sets overlap heavily or one
 * contains the other. This is intentionally conservative: ambiguous cases
 * become MERGE/EXPAND, never a second NEW page (#23 §0.2 doorway-abuse rule).
 */
// Negations ("not", "won't") are NOT stopwords: "won't turn on" and
// "won't turn off" are different home problems and must stay distinct.
const STOPWORDS = new Set(["a", "an", "the", "is", "my", "why", "how", "to", "in", "of", "for", "do", "does", "what"]);

/** Conservative suffix stemming so "turning"/"turn", "leaks"/"leak" match. */
function stem(token: string): string {
  // All negation spellings collapse to one marker: "won't"/"wont"/"doesnt"
  // carry the same signal as "not" — but "on" vs "off" stays distinct.
  if (token === "wont" || token === "doesnt" || token === "isnt" || token === "cant") return "not";
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export function keywordTokens(keyword: string): Set<string> {
  return new Set(
    keyword
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
      .map(stem)
  );
}

export function sameIntentFamily(a: string, b: string): boolean {
  const ta = keywordTokens(a);
  const tb = keywordTokens(b);
  if (ta.size === 0 || tb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const jaccard = shared / (ta.size + tb.size - shared);
  const containment = shared / Math.min(ta.size, tb.size);
  // 0.7 bar: "ac won't turn on"/"ac not turning on" normalize to identical
  // sets (1.0), while "won't turn on"/"won't turn off" score 0.6 and stay
  // distinct — negated opposites are different home problems.
  return jaccard >= 0.7 || containment >= 0.99;
}

export interface RecommendationResult {
  recommendation: OpportunityRecommendation;
  reason: string;
  duplicate_of: string | null; // search_opportunity_id of the existing overlap
}

/**
 * Assign NEW/EXPAND/MERGE/WATCH/REJECT for one scored candidate against the
 * existing portfolio (#23 §1.2). Only NEW consumes the new-page quota.
 */
/**
 * A record can absorb a MERGE only if it is (or is becoming) an actual page:
 * approved, or currently recommended NEW/EXPAND. WATCH/REJECT records never
 * block a better keyword in the same family — otherwise vendor list ordering
 * could starve a whole intent family of its one page.
 */
export function isMergeTarget(record: SearchOpportunity): boolean {
  if (record.status === "approved") return true;
  if (record.status === "rejected" || record.status === "retired" || record.status === "merged") {
    return false;
  }
  return record.recommendation === "NEW" || record.recommendation === "EXPAND";
}

export function recommend(
  scored: ScoredOpportunity,
  existing: SearchOpportunity[],
  policy: SeoFactoryPolicy
): RecommendationResult {
  const overlap = existing.find(
    (e) =>
      e.search_opportunity_id !== scored.opportunity.search_opportunity_id &&
      // Identical keyword = the same opportunity being re-enriched (an update,
      // not cannibalization); only DIFFERENT keywords can overlap.
      e.keyword !== scored.opportunity.keyword &&
      isMergeTarget(e) &&
      sameIntentFamily(e.keyword, scored.opportunity.keyword)
  );

  if (overlap) {
    // Same intent family: never a second door for the same search need.
    const distinct = policy.min_intent_distinctness;
    const recommendation: OpportunityRecommendation = distinct === "high" ? "MERGE" : "EXPAND";
    return {
      recommendation,
      reason: `Overlaps existing intent "${overlap.keyword}" — ${recommendation} instead of NEW (doorway/cannibalization rule)`,
      duplicate_of: overlap.search_opportunity_id,
    };
  }

  if (scored.needs_enrichment) {
    return {
      recommendation: "WATCH",
      reason: "Metrics unknown (volume/KD null) — needs vendor enrichment before it can qualify",
      duplicate_of: null,
    };
  }

  if (!qualifiesForNewPage(scored, policy)) {
    return {
      recommendation: scored.score >= policy.min_opportunity_score - 15 ? "WATCH" : "REJECT",
      reason: `Score ${scored.score} vs threshold ${policy.min_opportunity_score} (thresholds are never lowered to fill quota)`,
      duplicate_of: null,
    };
  }

  return {
    recommendation: "NEW",
    reason: `Qualifies: score ${scored.score} >= ${policy.min_opportunity_score}, metrics known, no cannibalization overlap`,
    duplicate_of: null,
  };
}
