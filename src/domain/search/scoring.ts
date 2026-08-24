import { z } from "zod";
import type { SearchOpportunity } from "@/domain/search/contracts";
import type { SeoFactoryPolicy } from "@/domain/search/policy";

/**
 * A04 deterministic scoring (Tier-0 in the #23 §2.1 router: code, not an LLM).
 * Versioned so later revisions never silently change historical scores.
 *
 * WHAT CHANGED IN THIS BUILD, AND WHAT DELIBERATELY DID NOT (C12 / pre-answer 4).
 *
 * The four weights below used to be a `const WEIGHTS` literal in this file. They
 * are now POLICY, editable by the owner through `npm run policy` without a
 * deploy — but their VALUES are unchanged and the arithmetic is identical, so
 * not one of the 96 committed records moves. The Loop Spec Audit is explicit
 * about why that matters: rescoring changes what the owner is looking at in
 * /admin, and "the eight weights... decide which homeowner problems get a page,
 * which is thesis and economics" — Melissa's call, parked, never decided in a
 * build session. This build moved the MECHANISM and left the VALUES alone.
 *
 * THE EIGHT CANON SIGNAL CATEGORIES are registered here as STRUCTURE. Canon
 * (Business Structure HOW Guide §3.3) names eight signal categories and
 * deliberately does NOT lock point weights; the 100-point split quoted in the
 * A04 spec (SERP weakness 25, evergreen demand 15, ...) is a research working
 * document's proposal, flagged in the spec itself as "not an approved canon
 * formula". So the eight are declared, four of them are filled by the real
 * shipping weights, and the other four ship at weight ZERO with a TEST label —
 * because three of them have no data source in the trial at all:
 *
 *   business_value   — no funnel attribution is built
 *   data_value       — no record-value measure exists
 *   local_leverage   — blocked on OD-9 (no county/city dataset)
 *
 * A zero-weighted category with an honest label is a placeholder an owner can
 * fill. A number invented to make eight categories look complete is a business
 * decision wearing a schema costume. Five real signals and four constants,
 * said out loud, is the accurate description of scoring today.
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

/**
 * Canon's eight signal categories, and which weight key carries each. This is
 * the mapping table, not a formula — it exists so the structure canon names is
 * legible in code and so a category cannot be quietly dropped.
 */
export const CANON_SIGNAL_CATEGORIES = [
  { category: "Demand", weight_key: "demand", live: true },
  { category: "Competition", weight_key: "winnability", live: true },
  { category: "Intent fit", weight_key: "intent_fit", live: true },
  { category: "Business value", weight_key: "business_value", live: false },
  { category: "Data value", weight_key: "data_value", live: false },
  { category: "Distinctness", weight_key: "distinctness", live: false },
  { category: "Maintainability", weight_key: "maintainability", live: false },
  { category: "Local leverage", weight_key: "local_leverage", live: false },
] as const;

/**
 * Weight keys with no data source in the trial. Named so a test can assert
 * they stay at zero until an owner deliberately sets them, and so the admin
 * surface can label them rather than presenting a 0 as a considered judgment.
 */
export const PLACEHOLDER_WEIGHT_KEYS = [
  "business_value",
  "data_value",
  "distinctness",
  "maintainability",
  "local_leverage",
] as const;

export const ScoringWeights = z.object({
  /** LIVE — log-scaled monthly search volume. */
  demand: z.number().min(0).max(1),
  /** LIVE — canon's "Competition" category: inverse keyword difficulty. */
  winnability: z.number().min(0).max(1),
  /** LIVE — does the search lead into the diagnostic engine. */
  intent_fit: z.number().min(0).max(1),
  /**
   * LIVE — the owner's own manual rubric score from the seed workbook. Not one
   * of canon's eight; a real fifth signal that already carries 15% of every
   * shipped score. Dropping it to force an eight-category shape would move all
   * 96 records for cosmetic reasons.
   */
  seed_prior: z.number().min(0).max(1),
  /** TEST PLACEHOLDER — no funnel attribution exists. Awaiting owner value. */
  business_value: z.number().min(0).max(1),
  /** TEST PLACEHOLDER — no record-value measure exists. Awaiting owner value. */
  data_value: z.number().min(0).max(1),
  /**
   * TEST PLACEHOLDER — distinctness is enforced today as a GATE in
   * recommend.ts (same-intent-family overlap forces MERGE/EXPAND, never a
   * second door), not as a score term. Registered so canon's category is
   * visible; giving it weight would double-count the gate.
   */
  distinctness: z.number().min(0).max(1),
  /** TEST PLACEHOLDER — no volatility/update-burden measure exists. */
  maintainability: z.number().min(0).max(1),
  /** TEST PLACEHOLDER — blocked on OD-9 (no county/city dataset). */
  local_leverage: z.number().min(0).max(1),
});
export type ScoringWeights = z.infer<typeof ScoringWeights>;

/**
 * VERSION 1 DEFAULTS — the four numbers that were hard-coded in this file
 * before the build, migrated verbatim. No value here was chosen by a build
 * session. The five placeholders are zero, which is not a chosen weight either:
 * it is the arithmetic statement "this signal does not participate yet".
 */
export const V1_SCORING_WEIGHTS: ScoringWeights = ScoringWeights.parse({
  demand: 0.3,
  winnability: 0.3,
  intent_fit: 0.25,
  seed_prior: 0.15,
  business_value: 0,
  data_value: 0,
  distinctness: 0,
  maintainability: 0,
  local_leverage: 0,
});

export const ScoringPolicy = z.object({
  /**
   * The score_version stamped onto every record this policy scores. Bumping it
   * is how a weight change discloses itself: v1 scores are retained alongside
   * (see `rescore`), never silently overwritten.
   */
  version: z.string().min(1),
  weights: ScoringWeights,
});
export type ScoringPolicy = z.infer<typeof ScoringPolicy>;

export const V1_SCORING_POLICY: ScoringPolicy = {
  version: SCORING_VERSION,
  weights: V1_SCORING_WEIGHTS,
};

/** Weights must sum to 1, or a "0-100" score is not one. */
export function weightSum(weights: ScoringWeights): number {
  return Object.values(weights).reduce((a, b) => a + b, 0);
}

export function demandScore(volumeMonthly: number | null): number {
  if (volumeMonthly === null || volumeMonthly <= 0) return 0;
  // 100 volume -> ~33, 1k -> ~50, 10k -> ~67, 100k+ -> 83+, capped at 100.
  return Math.min(100, (Math.log10(volumeMonthly) / 6) * 100);
}

export function winnabilityScore(keywordDifficulty: number | null): number {
  if (keywordDifficulty === null) return 50; // neutral, paired with needs_enrichment
  return Math.max(0, 100 - keywordDifficulty * 2); // KD 0 -> 100, KD 50+ -> 0
}

/**
 * TODO-ASK-OWNER (Melissa) — THE STEERING RULING. This function decides that a
 * calculator/converter topic scores 70 against a threshold of 70, i.e. exactly
 * on the line. 59 of the 96 seeded opportunities are tool intent, and Melissa
 * rejected tool topics live ("it needs more help", Compendium §5.6 trap 34).
 * Whether a tool topic is a home problem at all is thesis, not engineering, and
 * is NOT decided here. See policy.ts `vocabulary.allowed_intent_types` for the
 * owner-visible mechanism this build added; the values are unchanged.
 */
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
  score_version: string;
}

/**
 * Score one opportunity. `policy` is optional and its absence means the v1
 * defaults — every pre-existing caller keeps working and keeps producing
 * identical numbers.
 */
export function scoreOpportunity(
  opportunity: SearchOpportunity,
  policy?: Pick<SeoFactoryPolicy, "scoring">
): ScoredOpportunity {
  const scoring = policy?.scoring ?? V1_SCORING_POLICY;
  const weights = scoring.weights;
  const seedPrior = opportunity.score_components?.seed_manual_score ?? null;

  const signals: Record<keyof ScoringWeights, number> = {
    demand: demandScore(opportunity.volume_monthly),
    winnability: winnabilityScore(opportunity.keyword_difficulty),
    intent_fit: intentFitScore(opportunity.intent_type),
    seed_prior: seedPrior ?? 50,
    // No data source exists for these. A signal value of 0 with a weight of 0
    // contributes nothing; if an owner ever gives one weight, it must be given
    // a real signal in the same change, and the test suite says so.
    business_value: 0,
    data_value: 0,
    distinctness: 0,
    maintainability: 0,
    local_leverage: 0,
  };

  let score = 0;
  const components: Record<string, number> = {};
  for (const key of Object.keys(weights) as Array<keyof ScoringWeights>) {
    const weight = weights[key];
    // Only weighted signals are recorded as components. A zero-weight category
    // in every record's score_components would be 96 rows of noise implying a
    // measurement that was never taken.
    if (weight > 0) components[key] = signals[key];
    score += signals[key] * weight;
  }

  return {
    opportunity,
    score: Math.round(score * 10) / 10,
    // The `scoring_version_1: 1` marker predates score_version and is kept for
    // the 96 committed records that carry it; score_version is the field to
    // read going forward.
    components: { ...components, scoring_version_1: 1 },
    needs_enrichment:
      opportunity.keyword_difficulty === null || opportunity.volume_monthly === null,
    score_version: scoring.version,
  };
}

/**
 * RESCORING WITH DISCLOSURE (C12 / pre-answer 9). A new score_version never
 * silently rewrites history: the prior score is carried forward into
 * `score_components` under a version-stamped key, so the owner can see what
 * moved and A04's own outcome learning has the history it needs.
 *
 * Rescoring under the SAME version is not a restatement — it is a recompute of
 * the same formula — so nothing is archived in that case.
 */
export function rescore(
  record: SearchOpportunity,
  policy: Pick<SeoFactoryPolicy, "scoring">
): SearchOpportunity {
  const scored = scoreOpportunity(record, policy);
  const previousVersion = record.score_version ?? SCORING_VERSION;
  const versionChanged = previousVersion !== scored.score_version;
  const archived =
    versionChanged && record.opportunity_score !== null
      ? { [`score_v${previousVersion.replace(/\./g, "_")}`]: record.opportunity_score }
      : {};
  const seedPrior = record.score_components?.seed_manual_score;
  return {
    ...record,
    opportunity_score: scored.score,
    score_version: scored.score_version,
    score_components: {
      // Prior archived scores survive every subsequent rescore.
      ...Object.fromEntries(
        Object.entries(record.score_components ?? {}).filter(([k]) => k.startsWith("score_v"))
      ),
      ...archived,
      ...scored.components,
      ...(seedPrior !== undefined ? { seed_manual_score: seedPrior } : {}),
    },
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
    // when the owner keeps the catch-all category in the list — removing it
    // makes the gate strict (only classified categories pass).
    const family = scored.opportunity.problem_family_hint;
    const catchAll = "general_home_problem"; // moved to policy vocabulary in step 3
    const inCategory =
      family !== null
        ? policy.allowed_categories.includes(family)
        : policy.allowed_categories.includes(catchAll);
    if (!inCategory) return false;
  }
  return true;
}
