import { z } from "zod";
import { Id, IsoDateTime, UsdAmount } from "@/domain/shared/primitives";

/**
 * Cost is a first-class data object (#23 §2.6). Prices live HERE as versioned
 * data, never hard-coded in domain logic — including model names/prices
 * (Owner Decision D-5).
 */
export const VendorCostRate = z.object({
  rate_id: Id,
  vendor: z.string().min(1),
  service: z.string().min(1),
  sku: z.string().nullable(),
  unit: z.string().min(1),
  unit_price_usd: UsdAmount,
  free_cap: z.number().min(0).nullable(),
  tier: z.string().nullable(),
  currency: z.literal("USD"),
  effective_from: IsoDateTime,
  effective_to: IsoDateTime.nullable(),
  source_url: z.string().nullable(),
  verified_at: IsoDateTime,
  version: z.number().int().positive(),
});
export type VendorCostRate = z.infer<typeof VendorCostRate>;

export const UsageCostEvent = z.object({
  usage_cost_event_id: Id,
  vendor: z.string().min(1),
  service: z.string().min(1),
  /** canonical object refs, e.g. { search_opportunity_id: "...", agent_run_id: "..." } */
  object_refs: z.record(z.string()),
  units: z.number().min(0),
  estimated_cost_usd: UsdAmount,
  billed_cost_usd: UsdAmount.nullable(),
  rate_version: z.string().nullable(),
  occurred_at: IsoDateTime,
});
export type UsageCostEvent = z.infer<typeof UsageCostEvent>;

export const RevenueSource = z.enum([
  "adsense",
  "sponsor",
  "affiliate",
  "b2b",
  "provider_later",
  "other",
]);

export const RevenueEvent = z.object({
  revenue_event_id: Id,
  source: RevenueSource,
  refs: z.record(z.string()),
  gross_usd: UsdAmount,
  platform_fee_usd: UsdAmount.nullable(),
  net_usd: UsdAmount,
  occurred_at: IsoDateTime,
  evidence_ref: z.string().nullable(),
});
export type RevenueEvent = z.infer<typeof RevenueEvent>;

export const BudgetPolicy = z.object({
  budget_policy_id: Id,
  scope: z.object({
    domain: z.string().nullable(),
    agent_id: z.string().nullable(),
    vendor: z.string().nullable(),
  }),
  daily_soft_usd: UsdAmount.nullable(),
  monthly_soft_usd: UsdAmount.nullable(),
  monthly_hard_usd: UsdAmount,
  override_role: z.string().nullable(),
  fallback: z.enum(["stop", "degrade", "queue"]),
  version: z.number().int().positive(),
});
export type BudgetPolicy = z.infer<typeof BudgetPolicy>;
