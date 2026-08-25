import { z } from "zod";
import {
  Cadence,
  Id,
  IsoDateTime,
  SchemaVersion,
  UsdAmount,
} from "@/domain/shared/primitives";
import { GeographyPlan, plannedPagesPerPeriod } from "@/domain/search/geography-plan";
import {
  DEFAULT_LANGUAGE_MINING_POLICY,
  LanguageMiningPolicy,
} from "@/domain/search/language-mining";
import {
  DEFAULT_PAGE_FACTORY_POLICY,
  PageFactoryPolicy,
} from "@/domain/search/page-factory-policy";
import { ScoringPolicy, V1_SCORING_POLICY, weightSum } from "@/domain/search/scoring";
import { MarketVocabulary, PRN_TRIAL_VOCABULARY } from "@/domain/search/vocabulary";

export const PublishMode = z.enum(["OWNER_APPROVAL", "LOW_RISK_AUTO"]);
export const AutonomyStage = z.enum(["T0", "T1", "T2", "T3"]);
export const IntentDistinctness = z.enum(["low", "medium", "high"]);

/**
 * SeoFactoryPolicy — every A04/A05/A06 knob the owner can change in Admin
 * without a code deploy (#23 §1.3, SEO_DOORS spec Wave 1).
 *
 * HARD RULES encoded below:
 * - Quality outranks quota: target is a goal, max is a brake; the agent may
 *   never lower thresholds to hit the target (#23 §1.3 CRITICAL).
 * - Trial publishing stays owner-approved until the T2 promotion gate is
 *   passed with measured evidence (#23 §1.5).
 */
export const SeoFactoryPolicy = z
  .object({
    policy_id: Id,
    schema_version: SchemaVersion,
    version: z.number().int().positive(),
    /**
     * Owner Decisions D-3 + D-10: nationwide vs local page targets with
     * per-type quotas; local entries take state (+ optional county); county
     * entries auto-expand to every city in the county as CANDIDATES (the
     * quality gates still decide which pages exist — doorway guard).
     */
    geography_plan: GeographyPlan,
    allowed_categories: z.array(z.string()),
    /**
     * SCORING IS POLICY NOW (C12 / pre-answer 4). The four weights that used to
     * be a `const WEIGHTS` literal inside scoring.ts are here, at their exact
     * shipped values, plus canon's remaining signal categories at weight zero
     * as TEST placeholders. The owner can retune without a deploy; nothing
     * about today's numbers changed.
     *
     * `.default()` rather than required: the committed data/seo-factory-policy.json
     * predates this field, and a policy file that stops parsing is a policy
     * file that stops protecting anything.
     */
    scoring: ScoringPolicy.default(V1_SCORING_POLICY),
    /**
     * MARKET VOCABULARY (C5) — the problem/tool word lists, the family regexes,
     * the catch-all category key and the owner's hard-exclusion rules, all of
     * which were code constants. Values are the shipped PRN ones verbatim.
     * A second client swaps this block instead of forking two source files.
     *
     * `allowed_categories` deliberately STAYS above rather than moving in here:
     * it is already policy data, already on the admin form and already settable
     * through the CLI. Relocating it would break the owner's form for no
     * white-label gain — the point of the condition is to get CODE constants
     * out, and that one never was one.
     */
    vocabulary: MarketVocabulary.default(PRN_TRIAL_VOCABULARY),
    /**
     * THE STEERING MECHANISM (C6 / pre-answer 8) — TODO-ASK-OWNER (Melissa).
     *
     * ⚠ THE RULING IS PARKED AND IS NOT MADE HERE. The question — are
     * tool/calculator topics home problems at all, and do they belong in A04's
     * queue? — is thesis and homeowner experience, not engineering. It is the
     * one owner-observed defect in the one real agent: 59 of the 96 seeded
     * opportunities are tool intent, intentFitScore awards tool exactly 70
     * against a threshold of exactly 70, and Melissa rejected the tool topics
     * live ("it needs more help", Compendium §5.6 trap 34).
     *
     * WHAT THIS FIELD CHANGES: nothing, today. The value below is the filter
     * that already existed as a COMMENT-LEVEL line inside tools/run-factory.ts
     * ("Doors are PROBLEM-intent pages (D-3). Tool/calculator opportunities
     * stay in the portfolio for a later product line but never become doors
     * here"). Moving it from a CLI script into owner-visible policy is the
     * whole change: the rule is now somewhere the owner can see it and change
     * it without a code edit, and the behaviour is byte-identical.
     *
     * Note this gates PAGE ELIGIBILITY, not scoring or recommendation: tool
     * opportunities keep their scores and their recommendations so the queue
     * the owner reviews is unchanged. Whoever rules on steering can then choose
     * between "exclude from pages" (this field), "exclude from the queue"
     * (a hard exclusion), or "they are fine" — without another build.
     */
    page_eligible_intent_types: z
      .array(z.enum(["problem", "tool", "informational", "commercial", "unknown"]))
      .default(["problem"]),
    /**
     * A05's NAMESPACED SUB-BLOCK (C2/C3, coherence report seam 12). One policy
     * object, three consumers, and now a declared split: A04 owns the document,
     * A05 alone writes `page_factory.*`, and A06 will own `page_qa.*`.
     *
     * `.default()` for the same reason as `scoring` above: the committed
     * data/seo-factory-policy.json predates this field, and a policy file that
     * stops parsing is a policy file that stops protecting anything. The
     * defaults reproduce the hardcoded literals byte for byte.
     */
    page_factory: PageFactoryPolicy.default(DEFAULT_PAGE_FACTORY_POLICY),
    discovery_scan_cadence: Cadence,
    search_console_ingest_cadence: Cadence,
    target_qualified_pages_per_period: z.number().int().min(0),
    max_new_pages_per_period: z.number().int().min(0),
    min_opportunity_score: z.number().min(0).max(100),
    min_search_volume: z.number().int().min(0).nullable(),
    max_keyword_difficulty: z.number().min(0).max(100).nullable(),
    min_intent_distinctness: IntentDistinctness,
    /** Numeric threshold TBD (OPEN_DECISIONS); A06 computes PASS/FAIL either way. */
    min_user_value_score: z.number().min(0).max(100).nullable(),
    max_external_seo_spend_usd_month: UsdAmount,
    max_page_ai_spend_usd_month: UsdAmount,
    /**
     * EVERY PRN DOLLAR IS A TEST FIGURE, AND THE SCHEMA NOW SAYS SO
     * (pre-answer 11, hard canon rule 4). The two caps above shipped as bare
     * numbers with no label anywhere — `max_external_seo_spend_usd_month: 1`
     * reads like a considered budget and is in fact the DataForSEO trial
     * credit. `is_test_figure` is a LITERAL true, so a policy that drops the
     * label does not parse: an unlabelled PRN dollar cannot ship.
     *
     * This covers PRN's OWN caps only. Vendor prices are a different class of
     * number — a third party's published fact, quoted with its date — and are
     * never TEST-labelled as if invented. See platform/economics/rates.ts.
     *
     * TODO-ASK-OWNER (Joshua): the live cap is $1, the spec's TEST planning
     * band is $5–$25/month. Left at 1 until raised deliberately.
     */
    budget_figures: z
      .object({
        is_test_figure: z.literal(true),
        note: z.string().min(1),
      })
      .default({
        is_test_figure: true,
        note: "TEST figures, not commitments. max_external_seo_spend_usd_month is the DataForSEO trial credit, not a considered budget; the spec's TEST planning band is $5-$25/month. Vendor prices are SOURCED and labelled separately in platform/economics/rates.ts.",
      }),
    /**
     * THE BATCH SIZE THE BRAKE ENFORCES (C8). DataForSEO bills per task and one
     * task carries up to 1,000 keywords, so an unbounded keyword list is an
     * unbounded number of tasks in one un-estimated request. Default is the
     * vendor's own task size: batching at exactly one task per call makes every
     * call individually estimable.
     */
    max_keywords_per_vendor_call: z.number().int().min(1).max(1000).default(1000),
    /**
     * PROGRESSIVE ENRICHMENT (C17) — cheap-broad-then-expensive-on-finalists.
     *
     * THE SPEC DESCRIBED THIS AS IF IT EXISTED. It did not: `runDiscovery`
     * never called `getSerpSnapshot` or `getTrend`, `serp_snapshot_ids` was
     * never appended to, `SerpSnapshot.weakness_note` was never produced, and
     * the SERP-gap signal — the single largest weight in the research
     * formula — had no data path at all. The audit's instruction was to wire
     * it or say plainly it is not built, and never to describe unbuilt
     * behaviour as built.
     *
     * IT IS WIRED, AND IT SHIPS OFF. 0 means the stage does not run, which
     * reproduces today's behaviour exactly. Above 0, the top-N scored
     * finalists get one SERP snapshot each, every call priced against the
     * remaining budget by the same brake as every other call, and each
     * snapshot persisted with its id appended to the record's
     * serp_snapshot_ids. Turning it on is an owner's decision to spend more.
     *
     * WHAT IS STILL NOT BUILT, said plainly: nothing SCORES on SERP data.
     * Enrichment persists evidence; `local_leverage` and the SERP-gap signal
     * remain zero-weighted placeholders (see scoring.ts). Wiring the signal
     * into the formula would be choosing a weight, which is Melissa's call.
     */
    enrich_finalists_top_n: z.number().int().min(0).max(100).default(0),
    /**
     * INTERNAL-LANGUAGE MINING (C11) — ships OFF, with no mining code anywhere.
     * The RULE is what ships, enforced by test, for whenever it is turned on.
     * TODO-ASK-OWNER (Melissa): the cohort size N, and whether customer-derived
     * phrasing may ever become public page text at all. See language-mining.ts.
     */
    language_mining: LanguageMiningPolicy.default(DEFAULT_LANGUAGE_MINING_POLICY),
    serp_depth: z.number().int().min(1).max(100),
    include_trend_data: z.boolean(),
    allow_refresh_existing: z.boolean(),
    publish_mode: PublishMode,
    human_approval_required: z.boolean(),
    daily_publish_cap: z.number().int().min(0),
    autonomy_stage: AutonomyStage,
    /** page class -> freshness TTL in days (evergreen/seasonal/local/safety/volatile). */
    freshness_policy: z.record(z.number().int().positive()),
    effective_from: IsoDateTime,
  })
  .superRefine((p, ctx) => {
    if (p.max_new_pages_per_period < p.target_qualified_pages_per_period) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "hard max must be >= target (target is a goal, max is the brake)",
        path: ["max_new_pages_per_period"],
      });
    }
    if (plannedPagesPerPeriod(p.geography_plan) > p.max_new_pages_per_period) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "the geography plan's combined per-type quotas exceed the hard max pages per period",
        path: ["geography_plan"],
      });
    }
    const graduated = p.autonomy_stage === "T2" || p.autonomy_stage === "T3";
    if (p.publish_mode === "LOW_RISK_AUTO" && !graduated) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "LOW_RISK_AUTO publishing requires T2+ graduation (#23 §1.5); trial stays OWNER_APPROVAL",
        path: ["publish_mode"],
      });
    }
    if (!p.human_approval_required && !graduated) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "human publish approval is ON during the trial until T2+ graduation",
        path: ["human_approval_required"],
      });
    }
    /**
     * Scoring weights must sum to 1, or "0-100 opportunity score" is a lie and
     * SearchOpportunity.opportunity_score (max 100) starts failing to parse.
     * This is also the guard that makes the zero-weighted placeholder
     * categories safe to ship: an owner who gives `business_value` weight has
     * to take it from somewhere, deliberately, instead of quietly inflating
     * every score in the queue.
     */
    const sum = weightSum(p.scoring.weights);
    if (Math.abs(sum - 1) > 1e-9) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `scoring weights must sum to exactly 1 (they sum to ${sum}) — adding weight to one signal means taking it from another`,
        path: ["scoring", "weights"],
      });
    }
  });
export type SeoFactoryPolicy = z.infer<typeof SeoFactoryPolicy>;

/**
 * Trial defaults (#23 §1.3 example defaults + §7.2 initial targets;
 * geography per Owner Decision D-3: national first, local later).
 */
export const TRIAL_DEFAULT_SEO_FACTORY_POLICY: SeoFactoryPolicy = SeoFactoryPolicy.parse({
  policy_id: "seo_factory_policy_default",
  schema_version: "1.0.0",
  version: 1,
  geography_plan: {
    national: { enabled: true, target_pages_per_period: 25 },
    locals: [],
  },
  allowed_categories: [
    "plumbing",
    "hvac",
    "electrical",
    "roofing",
    "appliance",
    "water_damage",
    "general_home_problem",
  ],
  discovery_scan_cadence: "weekly",
  search_console_ingest_cadence: "daily",
  target_qualified_pages_per_period: 25,
  max_new_pages_per_period: 40,
  min_opportunity_score: 70,
  min_search_volume: null,
  max_keyword_difficulty: null,
  min_intent_distinctness: "high",
  min_user_value_score: null,
  max_external_seo_spend_usd_month: 25,
  max_page_ai_spend_usd_month: 25,
  serp_depth: 10,
  include_trend_data: true,
  allow_refresh_existing: false,
  publish_mode: "OWNER_APPROVAL",
  human_approval_required: true,
  daily_publish_cap: 10,
  autonomy_stage: "T0",
  freshness_policy: {
    evergreen: 180,
    seasonal: 90,
    local: 120,
    safety: 60,
    volatile: 30,
  },
  effective_from: "2026-08-14T00:00:00Z",
});
