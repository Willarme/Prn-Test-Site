import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDiscovery, type DiscoveryDeps } from "@/domain/search/discovery";
import { SeoFactoryPolicy, TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import { FixtureSeoDataAdapter, type SeoDataAdapter } from "@/platform/adapters/seo-data";
import {
  KEYWORDS_PER_VENDOR_TASK,
  TRIAL_VENDOR_COST_RATES,
  chunkKeywords,
  estimateVendorCall,
} from "@/platform/economics/rates";
import {
  InMemoryAgentRunStore,
  InMemoryCostStore,
  InMemoryOpportunityStore,
  InMemorySnapshotStore,
} from "@/platform/stores/memory";

/**
 * A04 step 5 — THE BUDGET BRAKE (C8).
 *
 * The defect: `remainingBudget > 0` was checked before an UNBOUNDED
 * `getKeywordMetrics(keywords, scope)` whose cost was only recorded after it
 * returned. One call could overshoot the monthly cap by an arbitrary amount
 * while the run still reported `budget_limited` cleanly — satisfying the
 * spec's own done-when with the cap already blown.
 */

const cityIndex = { citiesInCounty: async () => [] };

/** A vendor that bills real money per task, so overshoot is observable. */
function payingAdapter(keywordCount: number, perTaskUsd = 0.06): SeoDataAdapter {
  const keywords = Array.from({ length: keywordCount }, (_, i) => `paid keyword ${i}`);
  return {
    vendor: "dataforseo",
    async discoverIdeas() {
      return { ideas: keywords.map((k) => ({ keyword: k, source_seed: null })), vendor_cost_usd: perTaskUsd };
    },
    async getKeywordMetrics(batch, geography) {
      // Vendor charges per TASK; the cost lands spread across the snapshots.
      const tasks = Math.max(1, Math.ceil(batch.length / KEYWORDS_PER_VENDOR_TASK));
      const total = tasks * perTaskUsd;
      return batch.map((keyword, i) => ({
        metric_snapshot_id: `ms_${keyword.replace(/\W+/g, "_")}_${i}`,
        schema_version: "1.0.0" as const,
        keyword,
        vendor: "dataforseo",
        geography,
        queried_at: "2026-08-24T00:00:00Z",
        volume_monthly: 1000,
        keyword_difficulty: 10,
        cpc_usd: null,
        competition: null,
        trend_12mo: null,
        raw_vendor_ref: null,
        vendor_cost_usd: total / batch.length,
        rate_version: null,
      }));
    },
    async getSearchIntent(batch) {
      const tasks = Math.max(1, Math.ceil(batch.length / KEYWORDS_PER_VENDOR_TASK));
      return {
        classifications: batch.map((keyword) => ({
          keyword,
          intent_type: "problem" as const,
          confidence: "high" as const,
        })),
        vendor_cost_usd: tasks * perTaskUsd,
      };
    },
    async getSerpSnapshot(keyword, geography) {
      return {
        serp_snapshot_id: `ss_${keyword.replace(/\W+/g, "_")}`,
        schema_version: "1.0.0" as const,
        keyword,
        geography,
        queried_at: "2026-08-24T00:00:00Z",
        results: [],
        weakness_note: null,
        vendor_cost_usd: perTaskUsd,
      };
    },
    async getTrend(batch) {
      return batch.map((keyword) => ({ keyword, monthly: [] }));
    },
  };
}

function deps(adapter: SeoDataAdapter, overrides: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
  let n = 0;
  return {
    adapter,
    opportunities: new InMemoryOpportunityStore(),
    runs: new InMemoryAgentRunStore(),
    costs: new InMemoryCostStore(),
    snapshots: new InMemorySnapshotStore(),
    cityIndex,
    now: () => "2026-08-24T12:00:00Z",
    idSuffix: () => `x${n++}`,
    ...overrides,
  };
}

const policy = (overrides: Record<string, unknown> = {}) =>
  SeoFactoryPolicy.parse({ ...TRIAL_DEFAULT_SEO_FACTORY_POLICY, ...overrides });

describe("the cost estimator", () => {
  it("rounds tasks UP — a brake that rounds down lets the last call through", () => {
    expect(estimateVendorCall("dataforseo", "keyword_metrics", 1).estimated_usd).toBe(0.06);
    expect(estimateVendorCall("dataforseo", "keyword_metrics", 1000).estimated_usd).toBe(0.06);
    expect(estimateVendorCall("dataforseo", "keyword_metrics", 1001).estimated_usd).toBe(0.12);
    expect(estimateVendorCall("dataforseo", "keyword_metrics", 4000).estimated_usd).toBe(0.24);
  });

  it("an unregistered vendor/service is UNESTIMABLE, never free", () => {
    const unknown = estimateVendorCall("some_new_vendor", "keyword_metrics", 10);
    expect(unknown.known).toBe(false);
    expect(unknown.estimated_usd).toBe(Number.POSITIVE_INFINITY);
  });

  it("vendor prices are SOURCED and dated, never TEST-labelled", () => {
    const rates = TRIAL_VENDOR_COST_RATES.filter((r) => r.vendor === "dataforseo");
    expect(rates.length).toBeGreaterThan(0);
    for (const rate of rates) {
      expect(rate.verified_at).toBe("2026-08-13T00:00:00Z");
      expect(rate.currency).toBe("USD");
    }
  });

  it("chunking splits at the vendor's own task size", () => {
    expect(chunkKeywords(Array.from({ length: 2500 }, (_, i) => `k${i}`), 1000)).toHaveLength(3);
    expect(chunkKeywords([], 1000)).toHaveLength(0);
  });
});

describe("one call can no longer overshoot the cap", () => {
  it("THE REGRESSION: 4000 keywords against a $0.10 cap stops instead of spending $0.24", async () => {
    // Pre-brake behaviour: remainingBudget ($0.04 after discovery) > 0, so the
    // metrics call went out unbounded and cost $0.24 — nearly 3x the cap — and
    // the run still reported budget_limited cleanly.
    const d = deps(payingAdapter(4000));
    const report = await runDiscovery(policy({ max_external_seo_spend_usd_month: 0.1 }), d);

    expect(report.vendor_cost_usd).toBeLessThanOrEqual(0.1);
    expect(report.budget_limited).toBe(true);
    expect(report.brake_reasons.join(" ")).toMatch(/exceeds \$/);

    // And the ledger agrees with the report — no unrecorded spend.
    const recorded = (await d.costs.list()).reduce((sum, e) => sum + e.estimated_cost_usd, 0);
    expect(recorded).toBeCloseTo(report.vendor_cost_usd, 6);
    expect(recorded).toBeLessThanOrEqual(0.1);
  });

  it("a cap that fits every chunk spends the full amount and completes", async () => {
    const d = deps(payingAdapter(2000));
    const report = await runDiscovery(policy({ max_external_seo_spend_usd_month: 5 }), d);
    expect(report.status).toBe("completed");
    expect(report.budget_limited).toBe(false);
    expect(report.discovered).toBe(2000);
    // discovery 0.06 + 2 metric tasks 0.12 + 2 intent tasks 0.12
    expect(report.vendor_cost_usd).toBeCloseTo(0.3, 6);
  });

  it("the batch size is policy, and a smaller one means more, smaller calls", async () => {
    const d = deps(payingAdapter(2000));
    const report = await runDiscovery(
      policy({ max_external_seo_spend_usd_month: 5, max_keywords_per_vendor_call: 500 }),
      d
    );
    // 4 metric chunks + 4 intent chunks + 1 discovery = 9 cost events
    expect((await d.costs.list()).length).toBe(9);
    expect(report.status).toBe("completed");
  });
});

describe("simulated exhaustion", () => {
  it("a month already at the cap spends nothing and reports it", async () => {
    const costs = new InMemoryCostStore();
    await costs.record({
      usage_cost_event_id: "uce_prior",
      vendor: "dataforseo",
      service: "keyword_metrics",
      object_refs: {},
      units: 1,
      estimated_cost_usd: 1,
      billed_cost_usd: null,
      rate_version: null,
      occurred_at: "2026-08-01T00:00:00Z",
    });
    const exhausted: unknown[] = [];
    const d = deps(payingAdapter(100), {
      costs,
      onBudgetExhausted: async (ctx) => {
        exhausted.push(ctx);
      },
    });
    const report = await runDiscovery(policy({ max_external_seo_spend_usd_month: 1 }), d);

    expect(report.status).toBe("stopped_budget");
    expect(report.vendor_cost_usd).toBe(0);
    expect(exhausted).toHaveLength(1);
    expect((exhausted[0] as { stage: string }).stage).toBe("pre_run");
  });

  it("a budget-stopped run does NOT consume the idempotency slot", async () => {
    // Raising the cap mid-period must allow a fresh attempt, or an owner who
    // funds the account is locked out until the next period.
    const d = deps(payingAdapter(100));
    const first = await runDiscovery(policy({ max_external_seo_spend_usd_month: 0 }), d);
    expect(first.status).toBe("stopped_budget");
    const second = await runDiscovery(policy({ max_external_seo_spend_usd_month: 5 }), d);
    expect(second.status).toBe("completed");
  });

  it("mid-run exhaustion reports stage mid_run so the event can fire", async () => {
    const exhausted: Array<{ stage: string }> = [];
    const d = deps(payingAdapter(4000), {
      onBudgetExhausted: async (ctx) => {
        exhausted.push(ctx);
      },
    });
    await runDiscovery(policy({ max_external_seo_spend_usd_month: 0.1 }), d);
    expect(exhausted.map((e) => e.stage)).toContain("mid_run");
  });
});

describe("the kill switch blocks further spend", () => {
  it("an engaged agent:A04 switch stops every vendor call", async () => {
    const d = deps(payingAdapter(100), {
      checkKill: () => ({ engaged: true, reason: "owner paused A04" }),
    });
    const report = await runDiscovery(policy({ max_external_seo_spend_usd_month: 25 }), d);

    expect(report.vendor_cost_usd).toBe(0);
    expect(report.halted_by_kill_switch).toBe(true);
    expect(report.brake_reasons.join(" ")).toMatch(/kill switch engaged/);
    expect(report.brake_reasons.join(" ")).toMatch(/owner paused A04/);
    // Budget was never the constraint — do not mislabel a pause as a cap.
    expect(report.budget_limited).toBe(false);
    expect((await d.costs.list()).length).toBe(0);
  });

  it("a switch engaged MID-RUN stops the next call, not just the first", async () => {
    let calls = 0;
    const d = deps(payingAdapter(3000), {
      // Allows discovery + the first metrics chunk, then pauses.
      checkKill: () => ({ engaged: calls++ >= 2, reason: "paused mid-run" }),
    });
    const report = await runDiscovery(policy({ max_external_seo_spend_usd_month: 25 }), d);
    expect(report.halted_by_kill_switch).toBe(true);
    expect(report.vendor_cost_usd).toBeGreaterThan(0); // it did spend before the pause
    expect(report.vendor_cost_usd).toBeLessThan(0.3); // and stopped well short of the full run
  });

  it("no switch wired is the same as not engaged", async () => {
    const report = await runDiscovery(policy(), deps(new FixtureSeoDataAdapter()));
    expect(report.halted_by_kill_switch).toBe(false);
    expect(report.status).toBe("completed");
  });
});

describe("vendor-unavailable fallback (the FixtureSeoDataAdapter path)", () => {
  it("the fixture vendor is estimable at zero, so the brake never blocks it", async () => {
    const estimate = estimateVendorCall("fixture", "keyword_metrics", 5000);
    expect(estimate.known).toBe(true);
    expect(estimate.estimated_usd).toBe(0);

    const report = await runDiscovery(
      policy({ max_external_seo_spend_usd_month: 0.000001 }),
      deps(new FixtureSeoDataAdapter())
    );
    expect(report.status).toBe("completed");
    expect(report.vendor_cost_usd).toBe(0);
    expect(report.budget_limited).toBe(false);
    expect(report.scored).toBeGreaterThan(0);
  });

  it("an unpriced vendor is refused, not run for free", async () => {
    // A vendor nobody has registered a price for. Spreading the fixture
    // instance would drop its prototype methods, so it is wrapped explicitly.
    const fixture = new FixtureSeoDataAdapter();
    const rogue: SeoDataAdapter = {
      vendor: "unpriced_vendor",
      discoverIdeas: (s, g) => fixture.discoverIdeas(s, g),
      getKeywordMetrics: (k, g) => fixture.getKeywordMetrics(k, g),
      getSearchIntent: (k) => fixture.getSearchIntent(k),
      getSerpSnapshot: (k, g) => fixture.getSerpSnapshot(k, g),
      getTrend: (k, g) => fixture.getTrend(k, g),
    };
    const report = await runDiscovery(policy(), deps(rogue));
    expect(report.discovered).toBe(0);
    expect(report.brake_reasons.join(" ")).toMatch(/no registered rate/);
  });
});

describe("PRN dollars carry a TEST label; vendor prices do not", () => {
  it("the schema refuses a policy whose caps are unlabelled", () => {
    const unlabelled = SeoFactoryPolicy.safeParse({
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      budget_figures: { is_test_figure: false, note: "these are real commitments" },
    });
    expect(unlabelled.success).toBe(false);
  });

  it("the committed policy file labels its dollars", () => {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "data", "seo-factory-policy.json"), "utf-8")
    ) as { budget_figures?: { is_test_figure: boolean; note: string }; max_external_seo_spend_usd_month: number };
    expect(raw.budget_figures?.is_test_figure).toBe(true);
    expect(raw.budget_figures?.note).toMatch(/TEST/);
    // TODO-ASK-OWNER (Joshua): still the $1 trial credit, not a considered cap.
    expect(raw.max_external_seo_spend_usd_month).toBe(1);
    expect(raw.budget_figures?.note).toMatch(/trial credit/i);
  });
});
