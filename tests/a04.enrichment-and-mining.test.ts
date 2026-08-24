import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDiscovery, type DiscoveryDeps } from "@/domain/search/discovery";
import {
  DEFAULT_LANGUAGE_MINING_POLICY,
  LanguageMiningPolicy,
  MINING_COHORT_FLOOR,
  miningGate,
} from "@/domain/search/language-mining";
import { SeoFactoryPolicy, TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import { FixtureSeoDataAdapter } from "@/platform/adapters/seo-data";
import {
  InMemoryAgentRunStore,
  InMemoryCostStore,
  InMemoryOpportunityStore,
  InMemorySnapshotStore,
} from "@/platform/stores/memory";

/**
 * A04 steps 10 and 11 — PROGRESSIVE ENRICHMENT (C17) and INTERNAL-LANGUAGE
 * MINING (C11).
 */

function deps(overrides: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
  let n = 0;
  return {
    adapter: new FixtureSeoDataAdapter(),
    opportunities: new InMemoryOpportunityStore(),
    runs: new InMemoryAgentRunStore(),
    costs: new InMemoryCostStore(),
    snapshots: new InMemorySnapshotStore(),
    cityIndex: { citiesInCounty: async () => [] },
    now: () => "2026-08-24T12:00:00Z",
    idSuffix: () => `x${n++}`,
    ...overrides,
  };
}

const policy = (overrides: Record<string, unknown> = {}) =>
  SeoFactoryPolicy.parse({ ...TRIAL_DEFAULT_SEO_FACTORY_POLICY, ...overrides });

describe("progressive enrichment (C17) — wired, and OFF by default", () => {
  it("ships at 0, which reproduces the previous behaviour exactly", async () => {
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.enrich_finalists_top_n).toBe(0);

    const d = deps();
    const report = await runDiscovery(policy(), d);
    expect(report.finalists_enriched).toBe(0);
    expect(await d.snapshots.listSerps()).toEqual([]);
    // The field nothing ever appended to stays empty.
    for (const o of await d.opportunities.list()) {
      expect(o.serp_snapshot_ids).toEqual([]);
    }
  });

  it("turned on, it enriches the TOP finalists only and records the evidence", async () => {
    const d = deps();
    const report = await runDiscovery(policy({ enrich_finalists_top_n: 3 }), d);

    expect(report.finalists_enriched).toBe(3);
    const serps = await d.snapshots.listSerps();
    expect(serps).toHaveLength(3);

    // The provenance chain is real: the snapshot id is ON the record.
    const enriched = (await d.opportunities.list()).filter((o) => o.serp_snapshot_ids.length > 0);
    expect(enriched).toHaveLength(3);
    for (const o of enriched) {
      expect(serps.map((s) => s.serp_snapshot_id)).toContain(o.serp_snapshot_ids[0]);
    }

    // And they are the TOP scorers, not an arbitrary three.
    const all = [...(await d.opportunities.list())].sort(
      (a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0)
    );
    expect(new Set(enriched.map((o) => o.search_opportunity_id))).toEqual(
      new Set(all.slice(0, 3).map((o) => o.search_opportunity_id))
    );
  });

  it("enrichment is subject to the SAME budget brake as every other call", async () => {
    /**
     * A vendor that actually CHARGES. The fixture adapter reports
     * vendor_cost_usd: 0 for everything, so with it nothing ever decrements
     * remainingBudget and the brake has nothing to bite on — the first version
     * of this test used the fixture and was therefore testing nothing. The
     * brake works by ESTIMATING before each call and DECREMENTING on recorded
     * spend, so it needs a vendor that does both.
     */
    const fixture = new FixtureSeoDataAdapter();
    const perTask = 0.06;
    const adapter: DiscoveryDeps["adapter"] = {
      vendor: "dataforseo",
      async discoverIdeas(seeds, geography) {
        const r = await fixture.discoverIdeas(seeds, geography);
        return { ...r, vendor_cost_usd: perTask };
      },
      async getKeywordMetrics(keywords, geography) {
        const snaps = await fixture.getKeywordMetrics(keywords, geography);
        return snaps.map((s) => ({ ...s, vendor_cost_usd: perTask / snaps.length }));
      },
      async getSearchIntent(keywords) {
        const r = await fixture.getSearchIntent(keywords);
        return { ...r, vendor_cost_usd: perTask };
      },
      async getSerpSnapshot(keyword, geography) {
        const s = await fixture.getSerpSnapshot(keyword, geography);
        return { ...s, vendor_cost_usd: perTask };
      },
      getTrend: (k, g) => fixture.getTrend(k, g),
    };

    const d = deps({ adapter });
    // $0.25 buys ideas + metrics + intent (0.18) and leaves $0.07 — exactly one
    // SERP task at $0.06, then the second is refused.
    const report = await runDiscovery(
      policy({ max_external_seo_spend_usd_month: 0.25, enrich_finalists_top_n: 10 }),
      d
    );
    expect(report.finalists_enriched).toBe(1);
    expect(report.budget_limited).toBe(true);
    expect(report.brake_reasons.join(" ")).toMatch(/serp_snapshot exceeds/);
    expect(report.vendor_cost_usd).toBeLessThanOrEqual(0.25);
  });

  it("NOT BUILT, and not claimed: nothing scores on SERP data", () => {
    // Enrichment persists EVIDENCE. The SERP-gap signal and local_leverage stay
    // zero-weighted placeholders; wiring one into the formula would be choosing
    // a weight, which is the owner's call.
    const scoring = readFileSync(
      join(process.cwd(), "src", "domain", "search", "scoring.ts"),
      "utf-8"
    );
    expect(scoring).not.toMatch(/serp_snapshot/);
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.scoring.weights.local_leverage).toBe(0);
  });
});

describe("internal-language mining (C11) — the rule ships, the miner does not", () => {
  it("ships OFF", () => {
    expect(DEFAULT_LANGUAGE_MINING_POLICY.enabled).toBe(false);
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.language_mining.enabled).toBe(false);
  });

  it("the gate refuses everything while it is off", () => {
    const result = miningGate(DEFAULT_LANGUAGE_MINING_POLICY, {
      phrase: "ac blowing warm air",
      distinctRecordCount: 500,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/TODO-ASK-OWNER/);
  });

  it("a cohort below the floor of 5 distinct records cannot be configured", () => {
    for (const n of [0, 1, 4]) {
      const bad = LanguageMiningPolicy.safeParse({
        ...DEFAULT_LANGUAGE_MINING_POLICY,
        min_distinct_problem_records: n,
      });
      expect(bad.success, `cohort ${n} must be refused`).toBe(false);
    }
    expect(
      LanguageMiningPolicy.safeParse({
        ...DEFAULT_LANGUAGE_MINING_POLICY,
        min_distinct_problem_records: MINING_COHORT_FLOOR,
      }).success
    ).toBe(true);
  });

  it("even switched on, a phrase below the cohort is refused", () => {
    const on = LanguageMiningPolicy.parse({
      ...DEFAULT_LANGUAGE_MINING_POLICY,
      enabled: true,
      min_distinct_problem_records: 12,
    });
    expect(miningGate(on, { phrase: "x", distinctRecordCount: 11 }).allowed).toBe(false);
    expect(miningGate(on, { phrase: "x", distinctRecordCount: 12 }).allowed).toBe(true);
  });

  it("the no-customer-text guarantee cannot be switched off by editing config", () => {
    const relaxed = LanguageMiningPolicy.safeParse({
      ...DEFAULT_LANGUAGE_MINING_POLICY,
      never_write_customer_text_to_keyword: false,
    });
    expect(relaxed.success).toBe(false);
  });

  it("NO code path reads a ProblemRecord into the search domain", () => {
    // The structural half of the guarantee: A04 cannot write customer text into
    // SearchOpportunity.keyword because it never has any. If this ever fails,
    // the mining path has been built and the parked questions need answers
    // BEFORE it ships, not after.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.ts$/.test(name)) files.push(full);
      }
    };
    walk(join(process.cwd(), "src", "domain", "search"));
    walk(join(process.cwd(), "src", "platform", "search"));
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      expect(content, file).not.toMatch(/from "@\/domain\/problem/);
      expect(content, file).not.toMatch(/\bProblemRecord\b(?![\s\S]{0,80}TODO)/);
    }
  });

  it("no miner exists — the rule shipped ahead of the machinery, deliberately", () => {
    const mining = readFileSync(
      join(process.cwd(), "src", "domain", "search", "language-mining.ts"),
      "utf-8"
    );
    // A gate and a policy, nothing that extracts n-grams from anything.
    expect(mining).not.toMatch(/ngram|n_gram|extractPhrases|minePhrases/i);
    expect(mining).toMatch(/TODO-ASK-OWNER \(Melissa\)/);
  });
});
