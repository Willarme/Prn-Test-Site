import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SearchOpportunity } from "@/domain/search/contracts";
import {
  detectDuplicateIntents,
  intentFamilyKey,
  keywordTokens,
  sameIntentFamily,
} from "@/domain/search/intent-family";
import { TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import {
  isMergeTarget,
  sameIntentFamily as sameIntentFamilyViaRecommend,
} from "@/domain/search/recommend";
import { scoreOpportunity } from "@/domain/search/scoring";

/**
 * A04 step 4 — the shared intent-family helper (coherence issue 15) and the
 * duplicate-intent PRE-GATE (C13).
 */

function opportunity(keyword: string, overrides: Partial<SearchOpportunity> = {}) {
  return SearchOpportunity.parse({
    search_opportunity_id: `so_${keyword.replace(/\W+/g, "_")}`,
    schema_version: "1.0.0",
    keyword,
    intent_cluster_id: null,
    cluster_label: null,
    problem_family_hint: "hvac",
    source: "seed_import",
    geography: { mode: "national", country: "US" },
    geography_assumed: false,
    volume_monthly: 5000,
    keyword_difficulty: 10,
    cpc_usd: null,
    intent_type: "problem",
    opportunity_score: null,
    score_components: null,
    recommendation: null,
    status: "candidate",
    metric_snapshot_ids: [],
    serp_snapshot_ids: [],
    provenance: { source_type: "seed_workbook", source_url: null, confidence_note: null },
    vendor_cost_usd: null,
    researched_at: null,
    created_at: "2026-08-14T18:00:00Z",
    updated_at: null,
    ...overrides,
  });
}

const scored = (keyword: string, overrides: Partial<SearchOpportunity> = {}) =>
  scoreOpportunity(opportunity(keyword, overrides), TRIAL_DEFAULT_SEO_FACTORY_POLICY);

describe("the matcher moved without changing behaviour", () => {
  it("the re-export from recommend.ts is the same function", () => {
    expect(sameIntentFamilyViaRecommend).toBe(sameIntentFamily);
  });

  it("matching is unchanged in every case the original documented", () => {
    expect(sameIntentFamily("ac won't turn on", "ac not turning on")).toBe(true);
    // Negated opposites are DIFFERENT home problems and must stay distinct.
    expect(sameIntentFamily("ac won't turn on", "ac won't turn off")).toBe(false);
    expect(sameIntentFamily("water heater leaking", "furnace making noise")).toBe(false);
    expect([...keywordTokens("why is my ac leaking")].sort()).toEqual(["ac", "leak"]);
  });

  it("the family key normalizes the way the matcher does", () => {
    expect(intentFamilyKey("ac won't turn on")).toBe(intentFamilyKey("ac not turning on"));
    expect(intentFamilyKey("ac won't turn on")).not.toBe(intentFamilyKey("ac won't turn off"));
  });
});

/**
 * THE INSPECTOR RULE (coherence issue 15, Master Todo T1-09). A06's QA module
 * must reimplement cannibalization independently — "an inspector that shares
 * its subject's logic is not an inspector". A06 does NOT do that yet; qa.ts
 * still reaches the shared matcher through recommend.ts, and rewriting it is
 * A06's build, not A04's. This test records the CURRENT state precisely so
 * A06's build has to change it deliberately, and so nobody reads the extraction
 * as having already solved the independence problem.
 */
describe("A06 independence — recorded, not yet achieved", () => {
  const qa = readFileSync(join(process.cwd(), "src", "domain", "search", "qa.ts"), "utf-8");

  it("A06's qa.ts still shares A04's matcher — the open handoff", () => {
    expect(qa).toMatch(/sameIntentFamily/);
    expect(qa).toMatch(/domain\/search\/recommend/);
  });

  it("A06 does not import the page factory — the half that IS clean", () => {
    expect(qa).not.toMatch(/domain\/search\/factory/);
  });
});

describe("the duplicate-intent pre-gate", () => {
  it("groups a batch by family and picks the highest scorer as primary", () => {
    const strong = scored("ac not turning on", { volume_monthly: 40000 });
    const weak = scored("ac won't turn on", { volume_monthly: 100 });
    expect(strong.score).toBeGreaterThan(weak.score);

    // Deliberately pass the WEAK one first — vendor list order must not decide.
    const report = detectDuplicateIntents([weak, strong], [], isMergeTarget);
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].primary_id).toBe(strong.opportunity.search_opportunity_id);
    expect(report.groups[0].duplicate_ids).toEqual([weak.opportunity.search_opportunity_id]);
    expect(report.duplicate_candidates).toBe(1);
  });

  it("distinct intents are not grouped", () => {
    const report = detectDuplicateIntents(
      [scored("water heater leaking"), scored("furnace making noise")],
      [],
      isMergeTarget
    );
    expect(report.groups).toHaveLength(0);
    expect(report.duplicate_candidates).toBe(0);
  });

  it("negated opposites stay separate — they are different home problems", () => {
    const report = detectDuplicateIntents(
      [scored("ac won't turn on"), scored("ac won't turn off")],
      [],
      isMergeTarget
    );
    expect(report.duplicate_candidates).toBe(0);
  });

  it("a collision with an EXISTING eligible record is reported", () => {
    const existing = opportunity("ac not turning on", {
      search_opportunity_id: "so_existing",
      recommendation: "NEW",
    });
    const report = detectDuplicateIntents([scored("ac won't turn on")], [existing], isMergeTarget);
    expect(report.groups[0].collides_with_existing_id).toBe("so_existing");
    expect(Object.values(report.duplicate_of)).toContain("so_existing");
  });

  it("an INELIGIBLE existing record does not block a new candidate", () => {
    // A rejected record must never starve a family of its one page — the same
    // carve-out isMergeTarget makes inside recommend().
    const rejected = opportunity("ac not turning on", {
      search_opportunity_id: "so_rejected",
      status: "rejected",
      recommendation: "REJECT",
    });
    const report = detectDuplicateIntents([scored("ac won't turn on")], [rejected], isMergeTarget);
    expect(report.groups).toHaveLength(0);
  });

  it("the same keyword twice is a re-enrichment, not a duplicate door", () => {
    const report = detectDuplicateIntents(
      [scored("water heater leaking"), scored("water heater leaking")],
      [],
      isMergeTarget
    );
    expect(report.duplicate_candidates).toBe(0);
  });

  it("detection changes no recommendation — it decides nothing", () => {
    // The pre-gate is disclosure. recommend() remains the only assigner, and
    // two mechanisms disagreeing about which candidate wins a family would be
    // worse than one.
    const batch = [scored("ac not turning on"), scored("ac won't turn on")];
    const before = batch.map((s) => s.score);
    detectDuplicateIntents(batch, [], isMergeTarget);
    expect(batch.map((s) => s.score)).toEqual(before);
  });
});
