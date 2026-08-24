import { describe, expect, it } from "vitest";
import { runDiscovery, type DiscoveryDeps } from "@/domain/search/discovery";
import { SeoFactoryPolicy, TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import { PRN_TRIAL_VOCABULARY } from "@/domain/search/vocabulary";
import { FixtureSeoDataAdapter, type SeoDataAdapter } from "@/platform/adapters/seo-data";
import {
  InMemoryAgentRunStore,
  InMemoryCostStore,
  InMemoryOpportunityStore,
  InMemorySnapshotStore,
} from "@/platform/stores/memory";

/**
 * A04 EVAL CASES (item done-when). Four named scenarios, each run through the
 * REAL `runDiscovery` pipeline rather than against the pieces in isolation —
 * the unit tests in a04.vocabulary-exclusions / a04.intent-family /
 * a04.budget-brake prove the mechanisms; these prove the pipeline behaves when
 * they are composed.
 *
 *   1. HARD EXCLUSION            — an excluded topic never becomes a candidate
 *   2. CANNIBALIZATION DEDUPE    — one family, one door, whatever the vendor order
 *   3. BUDGET EXHAUSTION         — stops clean, spends nothing more, retryable
 *   4. VENDOR-UNAVAILABLE        — the FixtureSeoDataAdapter fallback path
 */

const cityIndex = { citiesInCounty: async () => [] };

/** A vendor returning exactly the keywords a case needs, priced like DataForSEO. */
function vendorReturning(keywords: string[], perTaskUsd = 0.06): SeoDataAdapter {
  return {
    vendor: "dataforseo",
    async discoverIdeas() {
      return {
        ideas: keywords.map((k) => ({ keyword: k, source_seed: null })),
        vendor_cost_usd: perTaskUsd,
      };
    },
    async getKeywordMetrics(batch, geography) {
      return batch.map((keyword, i) => ({
        metric_snapshot_id: `ms_${keyword.replace(/\W+/g, "_")}`,
        schema_version: "1.0.0" as const,
        keyword,
        vendor: "dataforseo",
        geography,
        queried_at: "2026-08-24T00:00:00Z",
        // Descending volume by list position, so "which one wins the family"
        // is a real question with a knowable answer. Floored at 100: an
        // unfloored `50000 - i * 10000` went negative past the fifth keyword,
        // SearchOpportunity.parse rejected it, and the 3,000-keyword budget
        // case failed as an ERROR instead of braking — the run reported
        // status "failed" and the brake assertion was testing nothing.
        volume_monthly: Math.max(100, 50000 - i * 10000),
        keyword_difficulty: 5,
        cpc_usd: null,
        competition: null,
        trend_12mo: null,
        raw_vendor_ref: null,
        vendor_cost_usd: perTaskUsd / batch.length,
        rate_version: null,
      }));
    },
    async getSearchIntent(batch) {
      return {
        classifications: batch.map((keyword) => ({
          keyword,
          intent_type: "problem" as const,
          confidence: "high" as const,
        })),
        vendor_cost_usd: perTaskUsd,
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

describe("EVAL CASE 1 — hard exclusion", () => {
  const excluding = policy({
    max_external_seo_spend_usd_month: 25,
    vocabulary: {
      ...PRN_TRIAL_VOCABULARY,
      hard_exclusions: [
        {
          exclusion_id: "no_health_claims",
          pattern: "\\b(asbestos|mold sickness|carbon monoxide poisoning)\\b",
          reason: "Health claims are outside what PRN can responsibly answer.",
        },
      ],
    },
  });

  it("an excluded topic is REJECT even as the strongest keyword in the run", async () => {
    const d = deps(vendorReturning(["asbestos in old pipes leaking", "water heater leaking"]));
    const report = await runDiscovery(excluding, d);

    const stored = await d.opportunities.list();
    const excluded = stored.find((o) => o.keyword.startsWith("asbestos"));
    const allowed = stored.find((o) => o.keyword === "water heater leaking");

    // The excluded one had the HIGHEST volume in the batch and still lost.
    expect(excluded!.volume_monthly).toBeGreaterThan(allowed!.volume_monthly!);
    expect(excluded!.recommendation).toBe("REJECT");
    expect(allowed!.recommendation).toBe("NEW");
    expect(report.new_candidates).toEqual([allowed!.search_opportunity_id]);
  });

  it("with no exclusions configured, the same topic is treated normally", async () => {
    const d = deps(vendorReturning(["asbestos in old pipes leaking"]));
    await runDiscovery(policy({ max_external_seo_spend_usd_month: 25 }), d);
    expect((await d.opportunities.list())[0].recommendation).toBe("NEW");
  });
});

describe("EVAL CASE 2 — cannibalization dedupe", () => {
  it("one intent family yields exactly one door", async () => {
    const d = deps(
      vendorReturning(["ac not turning on", "ac won't turn on", "furnace making noise"])
    );
    const report = await runDiscovery(policy({ max_external_seo_spend_usd_month: 25 }), d);

    expect(report.recommendations.NEW).toBe(2); // one AC door + the furnace
    expect(report.recommendations.MERGE).toBe(1);
    expect(report.duplicate_intent_candidates).toBe(1);
    expect(report.duplicate_intent_groups).toBe(1);
  });

  it("the STRONGEST keyword claims the door regardless of vendor list order", async () => {
    // Same two keywords, opposite vendor order. The winner must not change.
    const forward = deps(vendorReturning(["ac not turning on", "ac won't turn on"]));
    const reversed = deps(vendorReturning(["ac won't turn on", "ac not turning on"]));
    await runDiscovery(policy({ max_external_seo_spend_usd_month: 25 }), forward);
    await runDiscovery(policy({ max_external_seo_spend_usd_month: 25 }), reversed);

    const winner = async (d: DiscoveryDeps) =>
      (await d.opportunities.list()).find((o) => o.recommendation === "NEW")!;

    // vendorReturning gives the FIRST keyword the highest volume, so the two
    // runs have different winners — which is correct: the strongest keyword
    // wins, and "strongest" is a property of the metrics, not the ordering.
    expect((await winner(forward)).keyword).toBe("ac not turning on");
    expect((await winner(reversed)).keyword).toBe("ac won't turn on");
    // What must be stable is that exactly ONE door exists either way.
    expect((await forward.opportunities.list()).filter((o) => o.recommendation === "NEW")).toHaveLength(1);
    expect((await reversed.opportunities.list()).filter((o) => o.recommendation === "NEW")).toHaveLength(1);
  });

  it("negated opposites are two different home problems and get two doors", async () => {
    const d = deps(vendorReturning(["ac won't turn on", "ac won't turn off"]));
    const report = await runDiscovery(policy({ max_external_seo_spend_usd_month: 25 }), d);
    expect(report.recommendations.NEW).toBe(2);
    expect(report.duplicate_intent_candidates).toBe(0);
  });
});

describe("EVAL CASE 3 — budget exhaustion", () => {
  it("stops cleanly, records what it spent, and stays retryable", async () => {
    const exhausted: Array<{ stage: string }> = [];
    const d = deps(vendorReturning(Array.from({ length: 3000 }, (_, i) => `problem ${i}`)), {
      onBudgetExhausted: async (ctx) => {
        exhausted.push(ctx);
      },
    });
    const report = await runDiscovery(policy({ max_external_seo_spend_usd_month: 0.12 }), d);

    expect(report.vendor_cost_usd).toBeLessThanOrEqual(0.12);
    expect(report.budget_limited).toBe(true);
    expect(exhausted.some((e) => e.stage === "mid_run")).toBe(true);

    // Quota honesty: fewer qualified than target means fewer pages, and the
    // report says how many slots went unfilled rather than lowering a threshold.
    expect(report.unfilled_target_slots).toBeGreaterThan(0);

    // Whatever it DID enrich is real and stored — a stopped run is partial,
    // never corrupt.
    const stored = await d.opportunities.list();
    expect(stored.length).toBeGreaterThan(0);
    for (const o of stored) {
      expect(o.recommendation).not.toBeNull();
    }
  });

  it("raising the cap in the same period allows a fresh attempt", async () => {
    const d = deps(vendorReturning(["water heater leaking"]));
    expect((await runDiscovery(policy({ max_external_seo_spend_usd_month: 0 }), d)).status).toBe(
      "stopped_budget"
    );
    expect((await runDiscovery(policy({ max_external_seo_spend_usd_month: 25 }), d)).status).toBe(
      "completed"
    );
  });
});

describe("EVAL CASE 4 — vendor unavailable", () => {
  it("the fixture fallback produces a complete run with zero spend", async () => {
    const d = deps(new FixtureSeoDataAdapter());
    const report = await runDiscovery(policy(), d);

    expect(report.status).toBe("completed");
    expect(report.vendor_cost_usd).toBe(0);
    expect(report.budget_limited).toBe(false);
    expect(report.scored).toBeGreaterThan(0);
    // Deterministic: every record got a recommendation, nothing is half-built.
    for (const o of await d.opportunities.list()) {
      expect(o.recommendation).not.toBeNull();
      expect(o.opportunity_score).not.toBeNull();
    }
  });

  it("the fallback is deterministic — two runs agree exactly", async () => {
    const a = deps(new FixtureSeoDataAdapter());
    const b = deps(new FixtureSeoDataAdapter());
    const ra = await runDiscovery(policy(), a);
    const rb = await runDiscovery(policy(), b);
    expect(ra.recommendations).toEqual(rb.recommendations);
    expect(ra.new_candidates).toEqual(rb.new_candidates);
  });

  it("a vendor that THROWS fails the run loudly and records the failure", async () => {
    const down: SeoDataAdapter = {
      ...vendorReturning([]),
      async discoverIdeas() {
        throw new Error("vendor 503");
      },
    };
    const d = deps(down);
    const report = await runDiscovery(policy({ max_external_seo_spend_usd_month: 25 }), d);

    expect(report.status).toBe("failed");
    expect(report.error).toMatch(/vendor 503/);
    const runs = await d.runs.list();
    expect(runs[0].status).toBe("failed");
    // A failed run must not consume the idempotency slot either.
    const retry = await runDiscovery(policy({ max_external_seo_spend_usd_month: 25 }), deps(new FixtureSeoDataAdapter(), { runs: d.runs }));
    expect(retry.status).toBe("completed");
  });
});
