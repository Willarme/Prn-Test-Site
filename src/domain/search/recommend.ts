import type { SearchOpportunity } from "@/domain/search/contracts";
import type { OpportunityRecommendation } from "@/domain/search/lifecycle";
import type { SeoFactoryPolicy } from "@/domain/search/policy";
import { sameIntentFamily } from "@/domain/search/intent-family";
import { qualifiesForNewPage, type ScoredOpportunity } from "@/domain/search/scoring";
import { matchHardExclusions } from "@/domain/search/vocabulary";

/**
 * Near-duplicate / cannibalization detection (deterministic v1). Two keywords
 * are the same intent family when their token sets overlap heavily or one
 * contains the other. This is intentionally conservative: ambiguous cases
 * become MERGE/EXPAND, never a second NEW page (#23 section 0.2 doorway-abuse rule).
 *
 * THE MATCHER MOVED (coherence report issue 15, C13). `keywordTokens` and
 * `sameIntentFamily` now live in domain/search/intent-family.ts, the helper
 * A04 and A05 share. They are re-exported here so every existing import keeps
 * working unchanged — including A06's qa.ts, whose independent reimplementation
 * is A06's build to do, not A04's to do for it.
 */
export { keywordTokens, sameIntentFamily } from "@/domain/search/intent-family";

export interface RecommendationResult {
  recommendation: OpportunityRecommendation;
  reason: string;
  duplicate_of: string | null; // search_opportunity_id of the existing overlap
  /**
   * THE REASONS TRAIL (C6). `reason` is the one-line summary the admin table
   * has always rendered; `reasons` is the full ordered trail, which matters for
   * hard exclusions specifically — an owner reading a REJECT needs to know
   * WHICH rule fired and why, and two rules firing is information about the
   * rules. Additive: every existing consumer of `reason` is untouched.
   */
  reasons: string[];
  /** exclusion_ids that fired, empty when none did. */
  excluded_by: string[];
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
  /**
   * HARD EXCLUSIONS FIRST, AND THEY ALWAYS WIN (C6). Before scoring is
   * consulted, before cannibalization, before any threshold: a keyword the
   * owner has excluded resolves REJECT and no score can override it. This is
   * the mechanism for "never build a page about this", and a mechanism that
   * could be outvoted by a high score would not be one.
   *
   * The list ships EMPTY. Populating it is the owner deciding what PRN is
   * about; a build session doing it would be inventing product scope.
   */
  const hits = matchHardExclusions(scored.opportunity.keyword, policy.vocabulary);
  if (hits.length > 0) {
    const reasons = hits.map((h) => `hard exclusion ${h.exclusion_id}: ${h.reason}`);
    return {
      recommendation: "REJECT",
      reason: reasons[0],
      duplicate_of: null,
      reasons,
      excluded_by: hits.map((h) => h.exclusion_id),
    };
  }

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
    const reason = `Overlaps existing intent "${overlap.keyword}" — ${recommendation} instead of NEW (doorway/cannibalization rule)`;
    return {
      recommendation,
      reason,
      duplicate_of: overlap.search_opportunity_id,
      reasons: [reason],
      excluded_by: [],
    };
  }

  if (scored.needs_enrichment) {
    const reason =
      "Metrics unknown (volume/KD null) — needs vendor enrichment before it can qualify";
    return { recommendation: "WATCH", reason, duplicate_of: null, reasons: [reason], excluded_by: [] };
  }

  if (!qualifiesForNewPage(scored, policy)) {
    const reason = `Score ${scored.score} vs threshold ${policy.min_opportunity_score} (thresholds are never lowered to fill quota)`;
    return {
      recommendation: scored.score >= policy.min_opportunity_score - 15 ? "WATCH" : "REJECT",
      reason,
      duplicate_of: null,
      reasons: [reason],
      excluded_by: [],
    };
  }

  const reason = `Qualifies: score ${scored.score} >= ${policy.min_opportunity_score}, metrics known, no cannibalization overlap`;
  return {
    recommendation: "NEW",
    reason,
    duplicate_of: null,
    reasons: [reason],
    excluded_by: [],
  };
}
