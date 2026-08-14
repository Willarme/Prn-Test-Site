import { describe, expect, it } from "vitest";
import {
  expandGeographyPlan,
  FixtureCityIndexAdapter,
  GeographyPlan,
  plannedPagesPerPeriod,
} from "@/domain/search/geography-plan";
import { SeoFactoryPolicy, TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";

const cityIndex = new FixtureCityIndexAdapter();

describe("GeographyPlan (Owner Decision D-10: nationwide vs local page targets)", () => {
  it("accepts national-only, local-only, and mixed plans with per-type quotas", () => {
    expect(
      GeographyPlan.safeParse({
        national: { enabled: true, target_pages_per_period: 20 },
        locals: [
          { local_target_id: "lt_allen", state: "IN", county: "Allen", target_pages_per_period: 10 },
          { local_target_id: "lt_ohio", state: "OH", county: null, target_pages_per_period: 5 },
        ],
      }).success
    ).toBe(true);
    expect(
      GeographyPlan.safeParse({
        national: { enabled: false, target_pages_per_period: 0 },
        locals: [{ local_target_id: "lt_1", state: "IN", county: "Allen", target_pages_per_period: 5 }],
      }).success
    ).toBe(true);
  });

  it("rejects a plan with nothing active", () => {
    expect(
      GeographyPlan.safeParse({
        national: { enabled: false, target_pages_per_period: 0 },
        locals: [],
      }).success
    ).toBe(false);
  });

  it("rejects duplicate local target ids", () => {
    expect(
      GeographyPlan.safeParse({
        national: { enabled: true, target_pages_per_period: 5 },
        locals: [
          { local_target_id: "lt_x", state: "IN", county: "Allen", target_pages_per_period: 5 },
          { local_target_id: "lt_x", state: "OH", county: null, target_pages_per_period: 5 },
        ],
      }).success
    ).toBe(false);
  });

  it("county selection AUTOMATICALLY expands to every city in the county", async () => {
    const targets = await expandGeographyPlan(
      {
        national: { enabled: false, target_pages_per_period: 0 },
        locals: [{ local_target_id: "lt_allen", state: "IN", county: "Allen", target_pages_per_period: 10 }],
      },
      cityIndex
    );
    expect(targets.length).toBe(8); // all Allen County fixture cities
    expect(targets.every((t) => t.target_kind === "city")).toBe(true);
    expect(targets.every((t) => t.quota_pool_id === "lt_allen")).toBe(true); // shared pool
    const cities = targets.map((t) => (t.scope.mode === "city" ? t.scope.city : ""));
    expect(cities).toContain("Fort Wayne");
    expect(cities).toContain("Leo-Cedarville");
  });

  it("state-only local entries stay one statewide target (no city expansion)", async () => {
    const targets = await expandGeographyPlan(
      {
        national: { enabled: true, target_pages_per_period: 20 },
        locals: [{ local_target_id: "lt_ohio", state: "OH", county: null, target_pages_per_period: 5 }],
      },
      cityIndex
    );
    expect(targets.map((t) => t.target_kind)).toEqual(["national", "state"]);
  });

  it("sums per-type quotas for the hard-cap check", () => {
    expect(
      plannedPagesPerPeriod({
        national: { enabled: true, target_pages_per_period: 20 },
        locals: [
          { local_target_id: "a", state: "IN", county: "Allen", target_pages_per_period: 10 },
          { local_target_id: "b", state: "OH", county: null, target_pages_per_period: 5 },
        ],
      })
    ).toBe(35);
  });

  it("the policy rejects a plan whose quotas exceed the hard max", () => {
    const r = SeoFactoryPolicy.safeParse({
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      geography_plan: {
        national: { enabled: true, target_pages_per_period: 30 },
        locals: [{ local_target_id: "lt_1", state: "IN", county: "Allen", target_pages_per_period: 20 }],
      },
      // 50 planned > max_new_pages_per_period 40
    });
    expect(r.success).toBe(false);
  });
});
