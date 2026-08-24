import { describe, expect, it } from "vitest";
import { SearchOpportunity } from "@/domain/search/contracts";
import { classifyIntentPrnSide, inferProblemFamily } from "@/domain/search/intent-classifier";
import { SeoFactoryPolicy, TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import { evaluatePortfolio } from "@/domain/search/portfolio";
import { recommend } from "@/domain/search/recommend";
import { scoreOpportunity } from "@/domain/search/scoring";
import {
  DEFAULT_PROBLEM_SIGNALS,
  DEFAULT_TOOL_HINTS,
  MarketVocabulary,
  PRN_TRIAL_VOCABULARY,
  matchHardExclusions,
} from "@/domain/search/vocabulary";
import artifact from "../data/factory/opportunities.json";

/**
 * A04 step 3 — MARKET VOCABULARY AS POLICY (C5) + HARD EXCLUSIONS (C6).
 *
 * The steering RULING is parked (TODO-ASK-OWNER, Melissa). What is tested here
 * is that the mechanism exists, that it defaults to today's behaviour exactly,
 * and that the 96 records do not move.
 */

const committed = artifact as unknown as {
  summary: { by_recommendation: Record<string, number> };
  opportunities: SearchOpportunity[];
};

function scoredFor(keyword: string, overrides: Partial<SearchOpportunity> = {}) {
  const o = SearchOpportunity.parse({
    search_opportunity_id: `so_${keyword.replace(/\W+/g, "_")}`,
    schema_version: "1.0.0",
    keyword,
    intent_cluster_id: null,
    cluster_label: null,
    problem_family_hint: "plumbing",
    source: "seed_import",
    geography: { mode: "national", country: "US" },
    geography_assumed: false,
    volume_monthly: 20000,
    keyword_difficulty: 2,
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
  return scoreOpportunity(o, TRIAL_DEFAULT_SEO_FACTORY_POLICY);
}

describe("the vocabulary moved out of code and nothing changed", () => {
  it("the shipped defaults are the exact former code constants", () => {
    expect(PRN_TRIAL_VOCABULARY.problem_signals).toEqual([...DEFAULT_PROBLEM_SIGNALS]);
    expect(PRN_TRIAL_VOCABULARY.tool_hints).toEqual([...DEFAULT_TOOL_HINTS]);
    expect(PRN_TRIAL_VOCABULARY.family_patterns.map((f) => f.family)).toEqual([
      "hvac",
      "electrical",
      "roofing",
      "appliance",
      "water_damage",
      "plumbing",
    ]);
    expect(PRN_TRIAL_VOCABULARY.catch_all_category).toBe("general_home_problem");
    // Populating this is the owner deciding what PRN is about, not a build.
    expect(PRN_TRIAL_VOCABULARY.hard_exclusions).toEqual([]);
  });

  it("classification with no vocabulary argument is unchanged", () => {
    expect(classifyIntentPrnSide("ac blowing warm air", null)).toBe("problem");
    expect(classifyIntentPrnSide("btu calculator", null)).toBe("tool");
    expect(classifyIntentPrnSide("best hvac brands", null)).toBe("unknown");
    expect(inferProblemFamily("roof leak", null)).toBe("roofing");
    expect(inferProblemFamily("dishwasher leaking", null)).toBe("appliance");
    expect(inferProblemFamily("basement water", null)).toBe("water_damage");
    // The word-boundary case the original comment calls out: "waterproofing"
    // must not classify as roofing — and in fact it matches no family at all,
    // which is the correct answer, not a near-miss.
    expect(inferProblemFamily("waterproofing basement", null)).toBeNull();
  });

  it("family pattern ORDER is preserved — specific trades before generic water words", () => {
    // "roof leak" matches both the roofing and the plumbing pattern; roofing
    // must win because it comes first in the policy array.
    expect(inferProblemFamily("roof leak", null)).toBe("roofing");
    const reordered = MarketVocabulary.parse({
      ...PRN_TRIAL_VOCABULARY,
      family_patterns: [...PRN_TRIAL_VOCABULARY.family_patterns].reverse(),
    });
    expect(inferProblemFamily("roof leak", null, reordered)).toBe("plumbing");
  });

  it("a different client's vocabulary changes the classification with no code change", () => {
    const otherVertical = MarketVocabulary.parse({
      problem_signals: ["ne fonctionne pas", "fuite"],
      tool_hints: ["calculatrice"],
      family_patterns: [{ family: "plomberie", pattern: "\\b(fuite|robinet)\\b" }],
      catch_all_category: "probleme_general",
      hard_exclusions: [],
    });
    expect(classifyIntentPrnSide("robinet fuite", null, otherVertical)).toBe("problem");
    expect(inferProblemFamily("robinet fuite", null, otherVertical)).toBe("plomberie");
    // and the PRN vocabulary is untouched by it
    expect(classifyIntentPrnSide("robinet fuite", null)).toBe("unknown");
  });

  it("the catch-all category key is policy, not a literal in the scorer", () => {
    const renamed = SeoFactoryPolicy.parse({
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      allowed_categories: ["plumbing", "unrecognised_topic"],
      vocabulary: { ...PRN_TRIAL_VOCABULARY, catch_all_category: "unrecognised_topic" },
    });
    const unknownFamily = scoredFor("some brand new thing", { problem_family_hint: null });
    expect(recommend(unknownFamily, [], renamed).recommendation).toBe("NEW");

    const strict = SeoFactoryPolicy.parse({
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      allowed_categories: ["plumbing"],
      vocabulary: { ...PRN_TRIAL_VOCABULARY, catch_all_category: "unrecognised_topic" },
    });
    expect(recommend(unknownFamily, [], strict).recommendation).not.toBe("NEW");
  });

  it("all 96 committed records still land on the same recommendations", () => {
    const records = committed.opportunities.map((o) => SearchOpportunity.parse(o));
    const { summary } = evaluatePortfolio(records, TRIAL_DEFAULT_SEO_FACTORY_POLICY);
    expect(summary.by_recommendation).toEqual(committed.summary.by_recommendation);
  });

  it("an uncompilable pattern is refused at the policy boundary", () => {
    const bad = MarketVocabulary.safeParse({
      ...PRN_TRIAL_VOCABULARY,
      family_patterns: [{ family: "broken", pattern: "([unclosed" }],
    });
    expect(bad.success).toBe(false);
  });
});

describe("hard exclusions always resolve REJECT, with a reasons trail", () => {
  const excluding = SeoFactoryPolicy.parse({
    ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
    vocabulary: {
      ...PRN_TRIAL_VOCABULARY,
      hard_exclusions: [
        {
          exclusion_id: "no_medical",
          pattern: "\\b(mold sickness|asbestos exposure)\\b",
          reason: "Health claims are outside what PRN can responsibly answer.",
        },
        {
          exclusion_id: "no_legal",
          pattern: "\\b(lawsuit|sue|attorney)\\b",
          reason: "Legal advice is not a home-service problem.",
        },
      ],
    },
  });

  it("a matching keyword is REJECT no matter how well it scores", () => {
    // Deliberately a perfect-scoring candidate: high volume, KD 2, problem
    // intent. Nothing about the score may rescue it.
    const strong = scoredFor("asbestos exposure symptoms");
    expect(strong.score).toBeGreaterThan(TRIAL_DEFAULT_SEO_FACTORY_POLICY.min_opportunity_score);
    const result = recommend(strong, [], excluding);
    expect(result.recommendation).toBe("REJECT");
    expect(result.excluded_by).toEqual(["no_medical"]);
    expect(result.reasons[0]).toContain("hard exclusion no_medical");
    expect(result.reasons[0]).toContain("responsibly answer");
  });

  it("exclusions fire BEFORE the cannibalization check, not after", () => {
    // An existing NEW record in the same intent family would normally force
    // MERGE. The exclusion must win, and the reasons trail must say exclusion,
    // not overlap.
    const existing = SearchOpportunity.parse({
      ...scoredFor("asbestos exposure risk").opportunity,
      search_opportunity_id: "so_existing",
      recommendation: "NEW",
    });
    const result = recommend(scoredFor("asbestos exposure symptoms"), [existing], excluding);
    expect(result.recommendation).toBe("REJECT");
    expect(result.duplicate_of).toBeNull();
    expect(result.reasons.join(" ")).not.toContain("cannibalization");
  });

  it("every rule that fires appears in the trail, not just the first", () => {
    const hits = matchHardExclusions("sue my attorney over asbestos exposure", excluding.vocabulary);
    expect(hits.map((h) => h.exclusion_id)).toEqual(["no_medical", "no_legal"]);
    const result = recommend(scoredFor("sue my attorney over asbestos exposure"), [], excluding);
    expect(result.excluded_by).toEqual(["no_medical", "no_legal"]);
    expect(result.reasons).toHaveLength(2);
  });

  it("with the shipped empty list, nothing is excluded and every trail is one line", () => {
    const result = recommend(scoredFor("water heater leaking"), [], TRIAL_DEFAULT_SEO_FACTORY_POLICY);
    expect(result.excluded_by).toEqual([]);
    expect(result.reasons).toEqual([result.reason]);
  });
});

describe("the steering mechanism exists and defaults to today's behaviour", () => {
  it("page eligibility defaults to problem intent only — the old CLI filter", () => {
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.page_eligible_intent_types).toEqual(["problem"]);
  });

  it("TODO-ASK-OWNER: tool intent still scores 70 against a threshold of 70", () => {
    // Pinning the observed defect rather than fixing it. Whether tool topics
    // are home problems is Melissa's ruling (Compendium §5.6 trap 34); this
    // test exists so the day someone changes it, they change it deliberately.
    const tool = scoredFor("btu calculator", { intent_type: "tool" });
    expect(tool.components.intent_fit).toBe(70);
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.min_opportunity_score).toBe(70);
  });

  it("changing page eligibility is a policy edit, not a code edit", () => {
    const widened = SeoFactoryPolicy.parse({
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      page_eligible_intent_types: ["problem", "tool"],
    });
    expect(widened.page_eligible_intent_types).toContain("tool");
  });
});
