import { describe, expect, it } from "vitest";
import type { SearchOpportunity } from "@/domain/search/contracts";
import { TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import { recommend, sameIntentFamily } from "@/domain/search/recommend";
import {
  demandScore,
  qualifiesForNewPage,
  scoreOpportunity,
  winnabilityScore,
} from "@/domain/search/scoring";

function opportunity(overrides: Partial<SearchOpportunity>): SearchOpportunity {
  return {
    search_opportunity_id: `so_test_${overrides.keyword?.replace(/\s+/g, "_") ?? "x"}`,
    schema_version: "1.0.0",
    keyword: "test keyword",
    intent_cluster_id: null,
    cluster_label: null,
    problem_family_hint: "hvac",
    source: "manual",
    geography: { mode: "national", country: "US" },
    geography_assumed: false,
    volume_monthly: 1000,
    keyword_difficulty: 10,
    cpc_usd: null,
    intent_type: "problem",
    opportunity_score: null,
    score_components: null,
    recommendation: null,
    status: "candidate",
    metric_snapshot_ids: [],
    serp_snapshot_ids: [],
    provenance: { source_type: "test", source_url: null, confidence_note: null },
    vendor_cost_usd: null,
    researched_at: null,
    created_at: "2026-08-14T00:00:00Z",
    updated_at: null,
    ...overrides,
  };
}

const policy = TRIAL_DEFAULT_SEO_FACTORY_POLICY;

describe("deterministic scoring", () => {
  it("demand grows with volume and difficulty shrinks winnability", () => {
    expect(demandScore(100)).toBeLessThan(demandScore(10000));
    expect(demandScore(null)).toBe(0);
    expect(winnabilityScore(0)).toBe(100);
    expect(winnabilityScore(50)).toBe(0);
  });

  it("unknown metrics flag needs_enrichment and can NEVER qualify for a new page", () => {
    const unknownKd = scoreOpportunity(opportunity({ keyword: "mystery leak", keyword_difficulty: null }));
    expect(unknownKd.needs_enrichment).toBe(true);
    expect(qualifiesForNewPage(unknownKd, policy)).toBe(false);
  });

  it("a strong problem-intent keyword qualifies", () => {
    const scored = scoreOpportunity(
      opportunity({ keyword: "ac not turning on", volume_monthly: 3300, keyword_difficulty: 3 })
    );
    expect(scored.score).toBeGreaterThanOrEqual(policy.min_opportunity_score);
    expect(qualifiesForNewPage(scored, policy)).toBe(true);
  });

  it("policy thresholds gate qualification (quality outranks quota)", () => {
    const scored = scoreOpportunity(
      opportunity({ keyword: "electrical burning smell", volume_monthly: 6800, keyword_difficulty: 42, problem_family_hint: "electrical" })
    );
    expect(qualifiesForNewPage(scored, policy)).toBe(scored.score >= policy.min_opportunity_score);
  });
});

describe("intent-family overlap (anti-doorway/cannibalization)", () => {
  it("detects near-duplicate intents", () => {
    expect(sameIntentFamily("ac not turning on", "why is my ac not turning on")).toBe(true);
    expect(sameIntentFamily("ac not turning on", "ac won't turn on")).toBe(true);
  });

  it("keeps genuinely distinct intents separate", () => {
    expect(sameIntentFamily("ac not turning on", "ac blowing warm air")).toBe(false);
    expect(sameIntentFamily("water heater leaking", "concrete slab calculator")).toBe(false);
  });

  it("keeps opposite problems distinct — negations are meaningful (verification fix)", () => {
    expect(sameIntentFamily("furnace won't turn on", "furnace won't turn off")).toBe(false);
  });

  it("recommends MERGE, never NEW, for a near-duplicate of an existing PAGE-WORTHY opportunity (#23 §8.3)", () => {
    const existing = [
      opportunity({
        keyword: "ac not turning on",
        volume_monthly: 3300,
        keyword_difficulty: 3,
        recommendation: "NEW",
      }),
    ];
    const dup = scoreOpportunity(
      opportunity({ keyword: "why is my ac not turning on", volume_monthly: 900, keyword_difficulty: 4 })
    );
    const rec = recommend(dup, existing, policy);
    expect(rec.recommendation).toBe("MERGE");
    expect(rec.duplicate_of).toBe(existing[0].search_opportunity_id);
  });

  it("a WATCH/REJECT record never blocks a stronger keyword in its family (order-independence fix)", () => {
    const existing = [
      opportunity({
        keyword: "water heater leaking basement",
        volume_monthly: null,
        keyword_difficulty: null,
        recommendation: "WATCH",
      }),
    ];
    const headTerm = scoreOpportunity(
      opportunity({ keyword: "water heater leaking", volume_monthly: 9900, keyword_difficulty: 2, problem_family_hint: "plumbing" })
    );
    expect(recommend(headTerm, existing, policy).recommendation).toBe("NEW");
  });

  it("re-enriching the SAME keyword is an update, not a duplicate", () => {
    const existing = [opportunity({ keyword: "ac not turning on", search_opportunity_id: "so_seed_ac" })];
    const rerun = scoreOpportunity(
      opportunity({ keyword: "ac not turning on", search_opportunity_id: "so_fresh_ac", volume_monthly: 3300, keyword_difficulty: 3 })
    );
    const rec = recommend(rerun, existing, policy);
    expect(rec.recommendation).toBe("NEW");
  });

  it("unknown-metric candidates go to WATCH for enrichment", () => {
    const watch = scoreOpportunity(opportunity({ keyword: "furnace making noise", volume_monthly: null, keyword_difficulty: null }));
    expect(recommend(watch, [], policy).recommendation).toBe("WATCH");
  });

  it("weak candidates are rejected outright", () => {
    const weak = scoreOpportunity(
      opportunity({ keyword: "obscure gadget query", volume_monthly: 10, keyword_difficulty: 90, intent_type: "commercial", problem_family_hint: null })
    );
    expect(recommend(weak, [], policy).recommendation).toBe("REJECT");
  });
});
