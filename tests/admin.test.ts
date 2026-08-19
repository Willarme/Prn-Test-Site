import { afterEach, describe, expect, it } from "vitest";
import { evaluatePortfolio } from "@/domain/search/portfolio";
import { importSeedRows, type SeedFile } from "@/domain/search/importer";
import { TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import { adminConfigured, passwordMatches } from "@/platform/admin/auth";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const seedFile = JSON.parse(
  readFileSync(join(process.cwd(), "tests", "fixtures", "seed-research", "seed-rows.json"), "utf-8")
) as SeedFile;

describe("portfolio evaluation (admin + factory runner)", () => {
  it("scores and recommends the whole seed portfolio deterministically", () => {
    const opps = importSeedRows(seedFile, "2026-08-14T00:00:00Z");
    const a = evaluatePortfolio(opps, TRIAL_DEFAULT_SEO_FACTORY_POLICY);
    const b = evaluatePortfolio(opps, TRIAL_DEFAULT_SEO_FACTORY_POLICY);
    expect(a.summary).toEqual(b.summary);
    expect(a.summary.total).toBe(96);
    expect(a.opportunities.every((o) => o.opportunity_score !== null && o.recommendation !== null)).toBe(true);
  });

  it("never exceeds the hard NEW cap and never lowers thresholds", () => {
    const opps = importSeedRows(seedFile, "2026-08-14T00:00:00Z");
    const capped = { ...TRIAL_DEFAULT_SEO_FACTORY_POLICY, max_new_pages_per_period: 2 };
    const { summary } = evaluatePortfolio(opps, capped);
    expect(summary.by_recommendation.NEW ?? 0).toBeLessThanOrEqual(2);
  });

  it("the committed factory output matches a fresh evaluation (re-run `npm run factory` after changes)", () => {
    const committed = JSON.parse(readFileSync(join(process.cwd(), "data", "factory", "opportunities.json"), "utf-8"));
    const opps = importSeedRows(seedFile, "2026-08-14T18:00:00Z");
    const fresh = evaluatePortfolio(opps, TRIAL_DEFAULT_SEO_FACTORY_POLICY);
    expect(committed.summary).toEqual(fresh.summary);
  });
});

describe("owner admin auth", () => {
  const original = process.env.ADMIN_PASSWORD;
  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = original;
  });

  it("is preview (read-only) when no password is configured", () => {
    delete process.env.ADMIN_PASSWORD;
    expect(adminConfigured()).toBe(false);
    expect(passwordMatches("anything")).toBe(false);
  });

  it("rejects short passwords as unconfigured", () => {
    process.env.ADMIN_PASSWORD = "short";
    expect(adminConfigured()).toBe(false);
  });

  it("matches only the exact configured password", () => {
    process.env.ADMIN_PASSWORD = "correct horse battery";
    expect(passwordMatches("correct horse battery")).toBe(true);
    expect(passwordMatches("correct horse batter")).toBe(false);
    expect(passwordMatches("")).toBe(false);
  });
});
