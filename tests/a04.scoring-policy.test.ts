import { describe, expect, it } from "vitest";
import { SearchOpportunity } from "@/domain/search/contracts";
import { SeoFactoryPolicy, TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import { evaluatePortfolio } from "@/domain/search/portfolio";
import {
  CANON_SIGNAL_CATEGORIES,
  PLACEHOLDER_WEIGHT_KEYS,
  SCORING_VERSION,
  ScoringWeights,
  V1_SCORING_WEIGHTS,
  rescore,
  scoreOpportunity,
  weightSum,
} from "@/domain/search/scoring";
import artifact from "../data/factory/opportunities.json";

/**
 * A04 step 2 — SCORING VIA POLICY (C12 / pre-answer 4).
 *
 * The load-bearing test is the first one: all 96 committed records rescore
 * under the policy defaults to EXACTLY the scores and recommendations they
 * already carry. The audit's whole worry about this step was that moving the
 * weights into policy would silently move the owner's queue. It does not, and
 * this proves it against the real artifact rather than a fixture.
 */

const committed = artifact as unknown as {
  summary: { by_recommendation: Record<string, number> };
  opportunities: SearchOpportunity[];
};

describe("migrating the weights moved nothing", () => {
  it("all 96 committed records rescore to their exact stored scores", () => {
    const records = committed.opportunities.map((o) => SearchOpportunity.parse(o));
    expect(records).toHaveLength(96);
    for (const record of records) {
      const scored = scoreOpportunity(record, TRIAL_DEFAULT_SEO_FACTORY_POLICY);
      expect(scored.score, record.keyword).toBe(record.opportunity_score);
    }
  });

  it("the ranked queue is unchanged: NEW 11 / WATCH 78 / MERGE 4 / REJECT 3", () => {
    const records = committed.opportunities.map((o) => SearchOpportunity.parse(o));
    const { summary } = evaluatePortfolio(records, TRIAL_DEFAULT_SEO_FACTORY_POLICY);
    expect(summary.by_recommendation).toEqual(committed.summary.by_recommendation);
    expect(summary.by_recommendation).toEqual({ NEW: 11, WATCH: 78, MERGE: 4, REJECT: 3 });
  });

  it("the v1 weights are the four numbers that were hard-coded, unchanged", () => {
    expect(V1_SCORING_WEIGHTS.demand).toBe(0.3);
    expect(V1_SCORING_WEIGHTS.winnability).toBe(0.3);
    expect(V1_SCORING_WEIGHTS.intent_fit).toBe(0.25);
    expect(V1_SCORING_WEIGHTS.seed_prior).toBe(0.15);
  });

  it("omitting the policy entirely still produces v1 scores", () => {
    const record = SearchOpportunity.parse(committed.opportunities[0]);
    expect(scoreOpportunity(record).score).toBe(
      scoreOpportunity(record, TRIAL_DEFAULT_SEO_FACTORY_POLICY).score
    );
    expect(scoreOpportunity(record).score_version).toBe(SCORING_VERSION);
  });
});

describe("the eight canon categories are structure, not invented numbers", () => {
  it("every canon signal category has a weight key", () => {
    expect(CANON_SIGNAL_CATEGORIES).toHaveLength(8);
    const keys = Object.keys(ScoringWeights.shape);
    for (const { weight_key } of CANON_SIGNAL_CATEGORIES) {
      expect(keys, weight_key).toContain(weight_key);
    }
  });

  it("every category with no data source ships at weight ZERO", () => {
    for (const key of PLACEHOLDER_WEIGHT_KEYS) {
      expect(V1_SCORING_WEIGHTS[key], key).toBe(0);
    }
  });

  it("a zero-weighted category contributes nothing to any score", () => {
    const record = SearchOpportunity.parse(committed.opportunities[0]);
    const scored = scoreOpportunity(record, TRIAL_DEFAULT_SEO_FACTORY_POLICY);
    for (const key of PLACEHOLDER_WEIGHT_KEYS) {
      expect(Object.keys(scored.components), key).not.toContain(key);
    }
  });

  it("weights must sum to exactly 1 — a placeholder cannot be given weight for free", () => {
    expect(weightSum(V1_SCORING_WEIGHTS)).toBe(1);
    const inflated = SeoFactoryPolicy.safeParse({
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      scoring: {
        version: "2.0.0",
        weights: { ...V1_SCORING_WEIGHTS, business_value: 0.2 },
      },
    });
    expect(inflated.success).toBe(false);
    if (!inflated.success) {
      expect(inflated.error.issues.some((i) => i.message.includes("sum to exactly 1"))).toBe(true);
    }
  });

  it("a rebalance that keeps the sum at 1 is accepted", () => {
    const rebalanced = SeoFactoryPolicy.safeParse({
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      scoring: {
        version: "2.0.0",
        weights: { ...V1_SCORING_WEIGHTS, demand: 0.2, business_value: 0.1 },
      },
    });
    expect(rebalanced.success).toBe(true);
  });
});

describe("rescoring discloses, never overwrites (pre-answer 9)", () => {
  const v2 = SeoFactoryPolicy.parse({
    ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
    scoring: {
      version: "2.0.0",
      weights: { ...V1_SCORING_WEIGHTS, demand: 0.2, winnability: 0.4 },
    },
  });

  it("a new score_version keeps the v1 score alongside the new one", () => {
    const original = SearchOpportunity.parse(committed.opportunities[0]);
    const v1Score = original.opportunity_score;
    const rescored = rescore(original, v2);

    expect(rescored.score_version).toBe("2.0.0");
    expect(rescored.score_components?.score_v1_0_0).toBe(v1Score);
    // and the record still parses — history is data, not a comment
    expect(() => SearchOpportunity.parse(rescored)).not.toThrow();
  });

  it("archived scores survive a second rescore", () => {
    const original = SearchOpportunity.parse(committed.opportunities[0]);
    const v1Score = original.opportunity_score;
    const once = rescore(original, v2);
    const v3 = SeoFactoryPolicy.parse({
      ...v2,
      scoring: { version: "3.0.0", weights: V1_SCORING_WEIGHTS },
    });
    const twice = rescore(once, v3);
    expect(twice.score_components?.score_v1_0_0).toBe(v1Score);
    expect(twice.score_components?.score_v2_0_0).toBe(once.opportunity_score);
  });

  it("rescoring under the SAME version archives nothing — it is a recompute, not a restatement", () => {
    const original = SearchOpportunity.parse(committed.opportunities[0]);
    const same = rescore(original, TRIAL_DEFAULT_SEO_FACTORY_POLICY);
    expect(same.score_version).toBe("1.0.0");
    expect(same.score_components?.score_v1_0_0).toBeUndefined();
    expect(same.opportunity_score).toBe(original.opportunity_score);
  });

  it("the owner's seed rubric prior survives rescoring", () => {
    const seeded = committed.opportunities
      .map((o) => SearchOpportunity.parse(o))
      .find((o) => o.score_components?.seed_manual_score !== undefined);
    expect(seeded).toBeDefined();
    const prior = seeded!.score_components!.seed_manual_score;
    expect(rescore(seeded!, v2).score_components?.seed_manual_score).toBe(prior);
  });
});
