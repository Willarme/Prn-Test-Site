import { describe, expect, it } from "vitest";
import {
  BudgetPolicy,
  RevenueEvent,
  UsageCostEvent,
  VendorCostRate,
} from "@/platform/economics/contracts";

describe("cost/revenue ledger contracts (#23 §2.6)", () => {
  it("accepts a versioned vendor rate", () => {
    const r = VendorCostRate.safeParse({
      rate_id: "rate_dataforseo_labs_v1",
      vendor: "dataforseo",
      service: "labs_keyword_ideas",
      sku: null,
      unit: "item",
      unit_price_usd: 0.00012,
      free_cap: null,
      tier: "standard",
      currency: "USD",
      effective_from: "2026-08-13T00:00:00Z",
      effective_to: null,
      source_url: "https://dataforseo.com/pricing",
      verified_at: "2026-08-13T00:00:00Z",
      version: 1,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a usage cost event tied to canonical objects", () => {
    const r = UsageCostEvent.safeParse({
      usage_cost_event_id: "uce_1",
      vendor: "dataforseo",
      service: "labs_keyword_ideas",
      object_refs: { agent_run_id: "ar_1", search_opportunity_id: "so_1" },
      units: 250,
      estimated_cost_usd: 0.03,
      billed_cost_usd: null,
      rate_version: "1",
      occurred_at: "2026-08-14T12:00:00Z",
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative money amounts", () => {
    const r = RevenueEvent.safeParse({
      revenue_event_id: "re_1",
      source: "adsense",
      refs: { page_id: "page_1" },
      gross_usd: -5,
      platform_fee_usd: null,
      net_usd: 0,
      occurred_at: "2026-08-14T12:00:00Z",
      evidence_ref: null,
    });
    expect(r.success).toBe(false);
  });

  it("restricts revenue sources to the approved trial mix", () => {
    const r = RevenueEvent.safeParse({
      revenue_event_id: "re_2",
      source: "lead_sales",
      refs: {},
      gross_usd: 10,
      platform_fee_usd: null,
      net_usd: 10,
      occurred_at: "2026-08-14T12:00:00Z",
      evidence_ref: null,
    });
    expect(r.success).toBe(false);
  });

  it("requires a hard monthly budget and a defined fallback behavior", () => {
    const valid = {
      budget_policy_id: "bp_seo",
      scope: { domain: "search", agent_id: "A04", vendor: "dataforseo" },
      daily_soft_usd: 2,
      monthly_soft_usd: 20,
      monthly_hard_usd: 25,
      override_role: "owner",
      fallback: "stop",
      version: 1,
    };
    expect(BudgetPolicy.safeParse(valid).success).toBe(true);
    expect(BudgetPolicy.safeParse({ ...valid, fallback: "ignore" }).success).toBe(false);
    const missingHard: Record<string, unknown> = { ...valid };
    delete missingHard.monthly_hard_usd;
    expect(BudgetPolicy.safeParse(missingHard).success).toBe(false);
  });

  it("rejects non-finite money amounts everywhere", () => {
    const r = UsageCostEvent.safeParse({
      usage_cost_event_id: "uce_inf",
      vendor: "dataforseo",
      service: "labs",
      object_refs: {},
      units: 1,
      estimated_cost_usd: Infinity,
      billed_cost_usd: null,
      rate_version: null,
      occurred_at: "2026-08-14T12:00:00Z",
    });
    expect(r.success).toBe(false);
  });
});
