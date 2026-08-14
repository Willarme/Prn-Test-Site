import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SeoFactoryPolicy, TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";

/**
 * Golden trial values — a silent edit to ANY of these thresholds (code default
 * or the committed policy file) fails the gate. Changing them legitimately
 * means changing this test in the same reviewed commit (Wave 1 verification
 * finding: thresholds could previously be lowered invisibly).
 */
const GOLDEN = {
  min_opportunity_score: 70,
  max_external_seo_spend_usd_month: 25,
  max_page_ai_spend_usd_month: 25,
  publish_mode: "OWNER_APPROVAL",
  human_approval_required: true,
  autonomy_stage: "T0",
  daily_publish_cap: 10,
  max_new_pages_per_period: 40,
  min_intent_distinctness: "high",
} as const;

describe("golden trial policy values", () => {
  it("pins the code defaults", () => {
    for (const [key, value] of Object.entries(GOLDEN)) {
      expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY[key as keyof typeof GOLDEN], key).toEqual(value);
    }
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.geography_plan.national.enabled).toBe(true);
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.geography_plan.locals).toEqual([]);
  });

  it("pins the committed data/seo-factory-policy.json", () => {
    const filePolicy = SeoFactoryPolicy.parse(
      JSON.parse(readFileSync(join(process.cwd(), "data", "seo-factory-policy.json"), "utf-8"))
    );
    for (const [key, value] of Object.entries(GOLDEN)) {
      expect(filePolicy[key as keyof typeof GOLDEN], key).toEqual(value);
    }
  });
});
