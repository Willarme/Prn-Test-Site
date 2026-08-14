import { z } from "zod";
import {
  Cadence,
  GeographyScope,
  Id,
  IsoDateTime,
  SchemaVersion,
  UsdAmount,
} from "@/domain/shared/primitives";

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
    /** Owner Decision D-3: national | state | county admin control. */
    geography_scope: GeographyScope,
    allowed_categories: z.array(z.string()),
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
  geography_scope: { mode: "national", country: "US" },
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
