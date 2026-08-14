import { describe, expect, it } from "vitest";
import { GeographyScope } from "@/domain/shared/primitives";
import {
  SeoFactoryPolicy,
  TRIAL_DEFAULT_SEO_FACTORY_POLICY,
} from "@/domain/search/policy";

describe("GeographyScope (Owner Decision D-3)", () => {
  it("accepts national mode without any selection list", () => {
    expect(GeographyScope.safeParse({ mode: "national", country: "US" }).success).toBe(true);
  });

  it("requires a non-empty state list in state mode", () => {
    expect(GeographyScope.safeParse({ mode: "state", country: "US" }).success).toBe(false);
    expect(
      GeographyScope.safeParse({ mode: "state", country: "US", states: [] }).success
    ).toBe(false);
    expect(
      GeographyScope.safeParse({ mode: "state", country: "US", states: ["IN", "OH"] }).success
    ).toBe(true);
  });

  it("requires a non-empty county list in county mode", () => {
    expect(GeographyScope.safeParse({ mode: "county", country: "US" }).success).toBe(false);
    expect(
      GeographyScope.safeParse({
        mode: "county",
        country: "US",
        counties: [{ state: "IN", county: "Allen" }],
      }).success
    ).toBe(true);
  });
});

describe("SeoFactoryPolicy trial defaults", () => {
  it("defaults to national geography (D-3)", () => {
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.geography_scope.mode).toBe("national");
  });

  it("keeps the owner publish gate ON at trial autonomy stages", () => {
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.publish_mode).toBe("OWNER_APPROVAL");
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.human_approval_required).toBe(true);
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.autonomy_stage).toBe("T0");
  });

  it("rejects LOW_RISK_AUTO publishing before T2 graduation (#23 §1.5)", () => {
    const r = SeoFactoryPolicy.safeParse({
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      publish_mode: "LOW_RISK_AUTO",
    });
    expect(r.success).toBe(false);
  });

  it("rejects turning human approval off before T2 graduation", () => {
    const r = SeoFactoryPolicy.safeParse({
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      human_approval_required: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects LOW_RISK_AUTO at T1 too — T1 is not graduated", () => {
    const r = SeoFactoryPolicy.safeParse({
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      autonomy_stage: "T1",
      publish_mode: "LOW_RISK_AUTO",
    });
    expect(r.success).toBe(false);
  });

  it("allows LOW_RISK_AUTO only after graduation", () => {
    const r = SeoFactoryPolicy.safeParse({
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      autonomy_stage: "T2",
      publish_mode: "LOW_RISK_AUTO",
    });
    expect(r.success).toBe(true);
  });

  it("keeps the hard max at or above the target (target = goal, max = brake)", () => {
    const r = SeoFactoryPolicy.safeParse({
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      target_qualified_pages_per_period: 50,
      max_new_pages_per_period: 40,
    });
    expect(r.success).toBe(false);
  });

  it("supports state/county admin selection (D-3 control)", () => {
    const r = SeoFactoryPolicy.safeParse({
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      geography_scope: { mode: "state", country: "US", states: ["IN"] },
    });
    expect(r.success).toBe(true);
  });
});
