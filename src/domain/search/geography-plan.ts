import { z } from "zod";
import { GeographyScope, Id } from "@/domain/shared/primitives";

/**
 * GeographyPlan — Owner Decision D-10 (admin page-creator control):
 * nationwide vs local page targets with per-type quotas.
 *  - national: on/off + how many pages per period
 *  - locals: multiple entries; each entry is a state, optionally narrowed to
 *    one county, with its own pages-per-period quota
 *  - county entries AUTOMATICALLY expand to EVERY city in that county — full
 *    local-SEO candidate coverage with zero manual city entry
 *
 * DOORWAY GUARD (canon, #23 §0.2 / #14A §15.3): expansion creates candidate
 * coverage, not pages. Every expanded city target still passes scoring,
 * distinctness, A06 QA and the owner publish gate. Coverage in, quality out.
 */
export const LocalTarget = z.object({
  local_target_id: Id,
  state: z.string().length(2),
  /** null = whole-state target; set = county target that expands to all its cities */
  county: z.string().min(1).nullable(),
  target_pages_per_period: z.number().int().min(0),
});
export type LocalTarget = z.infer<typeof LocalTarget>;

export const GeographyPlan = z
  .object({
    national: z.object({
      enabled: z.boolean(),
      target_pages_per_period: z.number().int().min(0),
    }),
    locals: z.array(LocalTarget),
  })
  .superRefine((plan, ctx) => {
    if (!plan.national.enabled && plan.locals.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "at least one geography target must be active (national or a local entry)",
        path: ["national", "enabled"],
      });
    }
    const ids = plan.locals.map((l) => l.local_target_id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "local_target_id values must be unique",
        path: ["locals"],
      });
    }
  });
export type GeographyPlan = z.infer<typeof GeographyPlan>;

/** Sum of quotas across active targets — checked against the global hard cap. */
export function plannedPagesPerPeriod(plan: GeographyPlan): number {
  const national = plan.national.enabled ? plan.national.target_pages_per_period : 0;
  return national + plan.locals.reduce((sum, l) => sum + l.target_pages_per_period, 0);
}

/**
 * County -> cities lookup. Fixture ships in Wave 1; the production
 * implementation vendors a public dataset (US Census places-by-county) at the
 * local-pages wave (OPEN_DECISIONS OD-9).
 */
export interface CityIndexAdapter {
  citiesInCounty(state: string, county: string): Promise<string[]>;
}

export class FixtureCityIndexAdapter implements CityIndexAdapter {
  private readonly index: Record<string, string[]> = {
    "IN/Allen": [
      "Fort Wayne",
      "New Haven",
      "Huntertown",
      "Leo-Cedarville",
      "Grabill",
      "Monroeville",
      "Woodburn",
      "Zanesville",
    ],
    "OH/Franklin": ["Columbus", "Dublin", "Westerville", "Grove City", "Hilliard"],
  };

  async citiesInCounty(state: string, county: string): Promise<string[]> {
    return this.index[`${state}/${county}`] ?? [];
  }
}

/** One concrete research/build target produced by expanding the plan. */
export interface GeographyTarget {
  target_kind: "national" | "state" | "city";
  scope: GeographyScope;
  /** Cities expanded from one county entry share that entry's quota pool. */
  quota_pool_id: string;
  target_pages_per_period: number;
}

export async function expandGeographyPlan(
  plan: GeographyPlan,
  cityIndex: CityIndexAdapter
): Promise<GeographyTarget[]> {
  const targets: GeographyTarget[] = [];
  if (plan.national.enabled) {
    targets.push({
      target_kind: "national",
      scope: { mode: "national", country: "US" },
      quota_pool_id: "national",
      target_pages_per_period: plan.national.target_pages_per_period,
    });
  }
  for (const local of plan.locals) {
    if (local.county === null) {
      targets.push({
        target_kind: "state",
        scope: { mode: "state", country: "US", states: [local.state] },
        quota_pool_id: local.local_target_id,
        target_pages_per_period: local.target_pages_per_period,
      });
      continue;
    }
    // County selected -> AUTOMATIC full-coverage expansion to every city.
    const cities = await cityIndex.citiesInCounty(local.state, local.county);
    for (const city of cities) {
      targets.push({
        target_kind: "city",
        scope: {
          mode: "city",
          country: "US",
          state: local.state,
          county: local.county,
          city,
        },
        quota_pool_id: local.local_target_id,
        target_pages_per_period: local.target_pages_per_period,
      });
    }
  }
  return targets;
}
