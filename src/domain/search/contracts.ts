import { z } from "zod";
import {
  GeographyScope,
  Id,
  IsoDate,
  IsoDateTime,
  SchemaVersion,
  UsdAmount,
} from "@/domain/shared/primitives";
import { OpportunityRecommendation } from "@/domain/search/lifecycle";

/** Where an opportunity was discovered. */
export const OpportunitySource = z.enum([
  "dataforseo",
  "search_console",
  "internal_records",
  "seed_import",
  "manual",
]);
export type OpportunitySource = z.infer<typeof OpportunitySource>;

export const OpportunityStatus = z.enum([
  "candidate",
  "approved",
  "watch",
  "merged",
  "rejected",
  "retired",
]);

export const IntentType = z.enum([
  "problem",
  "tool",
  "informational",
  "commercial",
  "unknown",
]);

/**
 * SearchOpportunity — the A04 unit of work (#14A §15.1, #23 §1.2, §8.1).
 * keyword_difficulty: null means UNKNOWN; 0 is a real observed value
 * (seed research has legitimate KD 0 rows — never coerce blank to 0).
 */
export const SearchOpportunity = z.object({
  search_opportunity_id: Id,
  schema_version: SchemaVersion,
  /**
   * Reserved — white-label approval condition (a), 2026-08-24, matching every
   * A00 record (runs/ledger.ts, events/envelope.ts, approvals/center.ts,
   * killswitch/index.ts). Default "prn"; NO tenant logic, routing or UI exists
   * around it. OPTIONAL so the 96 committed records in data/factory/ keep
   * parsing unchanged — adding an optional field is additive, never breaking.
   */
  tenant_id: z.string().min(1).optional(),
  keyword: z.string().min(1),
  intent_cluster_id: Id.nullable(),
  cluster_label: z.string().nullable(),
  problem_family_hint: z.string().nullable(),
  source: OpportunitySource,
  geography: GeographyScope,
  /** true when the source did not state geography and US-national was assumed (seed import). */
  geography_assumed: z.boolean(),
  volume_monthly: z.number().int().min(0).nullable(),
  keyword_difficulty: z.number().min(0).max(100).nullable(),
  cpc_usd: UsdAmount.nullable(),
  intent_type: IntentType,
  opportunity_score: z.number().min(0).max(100).nullable(),
  score_components: z.record(z.number()).nullable(),
  /** A04's OPINION. Never read as an approval — see domain/search/decision.ts. */
  recommendation: OpportunityRecommendation.nullable(),
  /** The OWNER'S DECISION. `approved` here, and only here, gates page building. */
  status: OpportunityStatus,
  /**
   * Owner-decision provenance (coherence report seam 2). Set together on
   * accept, cleared on reject/defer — a record can never carry an approval
   * stamp while sitting in a non-approved status. Optional for the same
   * additive reason as tenant_id.
   */
  approved_at: IsoDateTime.nullable().optional(),
  approved_by: z.string().min(1).nullable().optional(),
  /**
   * Which scoring version produced `opportunity_score` (C12 / pre-answer 9).
   * Absent means v1 — the 96 committed records were scored under
   * SCORING_VERSION "1.0.0" before this field existed, and rescoring under a
   * new version must DISCLOSE the version rather than silently rewrite history.
   */
  score_version: z.string().min(1).optional(),
  metric_snapshot_ids: z.array(Id),
  serp_snapshot_ids: z.array(Id),
  provenance: z.object({
    source_type: z.string().min(1),
    source_url: z.string().nullable(),
    confidence_note: z.string().nullable(),
  }),
  vendor_cost_usd: UsdAmount.nullable(),
  researched_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime.nullable(),
});
export type SearchOpportunity = z.infer<typeof SearchOpportunity>;

export const IntentCluster = z.object({
  intent_cluster_id: Id,
  schema_version: SchemaVersion,
  label: z.string().min(1),
  primary_query: z.string().min(1),
  supporting_queries: z.array(z.string()),
  problem_family: z.string().nullable(),
  geography: GeographyScope,
  distinctness_note: z.string().nullable(),
  status: z.enum(["active", "merged", "retired"]),
  created_at: IsoDateTime,
});
export type IntentCluster = z.infer<typeof IntentCluster>;

/**
 * Normalized vendor metric snapshot (#23 §1.2). Domain code never sees vendor
 * field names — the adapter normalizes into this shape, and raw payloads are
 * referenced by pointer only.
 */
export const SeoMetricSnapshot = z.object({
  metric_snapshot_id: Id,
  schema_version: SchemaVersion,
  keyword: z.string().min(1),
  vendor: z.string().min(1),
  geography: GeographyScope,
  queried_at: IsoDateTime,
  volume_monthly: z.number().int().min(0).nullable(),
  keyword_difficulty: z.number().min(0).max(100).nullable(),
  cpc_usd: UsdAmount.nullable(),
  competition: z.number().min(0).max(1).nullable(),
  trend_12mo: z.array(z.number()).nullable(),
  raw_vendor_ref: z.string().nullable(),
  vendor_cost_usd: UsdAmount.nullable(),
  rate_version: z.string().nullable(),
});
export type SeoMetricSnapshot = z.infer<typeof SeoMetricSnapshot>;

export const SerpResult = z.object({
  position: z.number().int().min(1),
  url: z.string().min(1),
  title: z.string().nullable(),
  domain: z.string().nullable(),
  page_type: z.string().nullable(),
  domain_rating: z.number().nullable(),
});

export const SerpSnapshot = z.object({
  serp_snapshot_id: Id,
  schema_version: SchemaVersion,
  keyword: z.string().min(1),
  geography: GeographyScope,
  queried_at: IsoDateTime,
  results: z.array(SerpResult),
  weakness_note: z.string().nullable(),
  vendor_cost_usd: UsdAmount.nullable(),
});
export type SerpSnapshot = z.infer<typeof SerpSnapshot>;

/** Daily per-page performance: Search Console + PRN funnel events (#23 §8.1). */
export const PagePerformanceDaily = z.object({
  page_id: Id,
  date: IsoDate,
  source: z.enum(["search_console", "internal_events"]),
  query: z.string().nullable(),
  impressions: z.number().int().min(0),
  clicks: z.number().int().min(0),
  ctr: z.number().min(0).max(1),
  avg_position: z.number().min(0).nullable(),
  intake_starts: z.number().int().min(0).nullable(),
  packet_completions: z.number().int().min(0).nullable(),
  revenue_usd: UsdAmount.nullable(),
  ingested_at: IsoDateTime,
});
export type PagePerformanceDaily = z.infer<typeof PagePerformanceDaily>;

/**
 * SeoDataProvider — the vendor registry object (#23 §8.1). Credentials are
 * referenced by ENV VAR NAME ONLY; values never enter the database or repo.
 */
export const SeoDataProvider = z.object({
  seo_data_provider_id: Id,
  provider_key: z.string().min(1),
  display_name: z.string().min(1),
  status: z.enum(["active", "disabled"]),
  credential_env_keys: z.array(z.string().min(1)),
  cost_rate_ids: z.array(Id),
  created_at: IsoDateTime,
});
export type SeoDataProvider = z.infer<typeof SeoDataProvider>;

export const RightsClass = z.enum([
  "public",
  "licensed",
  "first_party",
  "unknown_restricted",
]);

/**
 * FactBundle — reusable sourced research (#23 §2.4, §8.1). Research a stable
 * fact once with provenance + TTL; reuse across compatible pages instead of
 * paying for repeated research. Unknown rights default to restricted.
 */
export const FactBundle = z.object({
  fact_bundle_id: Id,
  schema_version: SchemaVersion,
  topic: z.string().min(1),
  geography: GeographyScope.nullable(),
  facts: z.array(
    z.object({
      fact_id: Id,
      statement: z.string().min(1),
      source_url: z.string().min(1),
      source_type: z.string().min(1),
      verified_at: IsoDateTime,
      confidence: z.enum(["high", "medium", "low"]),
    })
  ),
  rights_class: RightsClass,
  ttl_days: z.number().int().positive(),
  expires_at: IsoDateTime.nullable(),
  permitted_page_classes: z.array(z.string()),
  version: z.number().int().positive(),
  created_at: IsoDateTime,
});
export type FactBundle = z.infer<typeof FactBundle>;
