import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { periodFor, runDiscovery, type DiscoveryDeps } from "@/domain/search/discovery";
import { FixtureCityIndexAdapter } from "@/domain/search/geography-plan";
import { importSeedRows, type SeedFile } from "@/domain/search/importer";
import { SeoFactoryPolicy, TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import { FixtureSeoDataAdapter } from "@/platform/adapters/seo-data";
import type { SeoDataAdapter } from "@/platform/adapters/seo-data";
import {
  InMemoryAgentRunStore,
  InMemoryCostStore,
  InMemoryOpportunityStore,
  InMemorySnapshotStore,
} from "@/platform/stores/memory";

function makeDeps(adapter: SeoDataAdapter = new FixtureSeoDataAdapter()): DiscoveryDeps {
  let counter = 0;
  return {
    adapter,
    opportunities: new InMemoryOpportunityStore(),
    runs: new InMemoryAgentRunStore(),
    costs: new InMemoryCostStore(),
    snapshots: new InMemorySnapshotStore(),
    cityIndex: new FixtureCityIndexAdapter(),
    now: () => "2026-08-14T12:00:00Z",
    idSuffix: () => `t${counter++}`,
  };
}

/** Adapter spy that fails the test if ANY vendor method is invoked. */
function untouchableAdapter(): SeoDataAdapter {
  const forbid = (name: string) => async () => {
    throw new Error(`vendor method ${name} must not be called`);
  };
  return {
    vendor: "fixture",
    discoverIdeas: forbid("discoverIdeas"),
    getKeywordMetrics: forbid("getKeywordMetrics"),
    getSearchIntent: forbid("getSearchIntent"),
    getSerpSnapshot: forbid("getSerpSnapshot"),
    getTrend: forbid("getTrend"),
  };
}

const policy = TRIAL_DEFAULT_SEO_FACTORY_POLICY;

describe("idempotency periods derive from cadence", () => {
  it("maps each cadence to its own period key", () => {
    expect(periodFor("daily", "2026-08-14T12:00:00Z")).toBe("2026-08-14");
    expect(periodFor("weekly", "2026-08-14T12:00:00Z")).toBe("2026-W33");
    expect(periodFor("monthly", "2026-08-14T12:00:00Z")).toBe("2026-08");
    expect(periodFor("quarterly", "2026-08-14T12:00:00Z")).toBe("2026-Q3");
  });

  it("weekly cadence gets a fresh slot the following week", () => {
    expect(periodFor("weekly", "2026-08-14T12:00:00Z")).not.toBe(
      periodFor("weekly", "2026-08-21T12:00:00Z")
    );
  });
});

describe("A04 discovery run", () => {
  it("discovers, scores, and recommends without ever publishing anything", async () => {
    const deps = makeDeps();
    const report = await runDiscovery(policy, deps);
    expect(report.status).toBe("completed");
    expect(report.discovered).toBe(5);
    const stored = await deps.opportunities.list();
    expect(stored.length).toBe(5);
    for (const opp of stored) {
      expect(opp.status).toBe("candidate"); // A04 cannot approve or publish
      expect(opp.opportunity_score).not.toBeNull();
      expect(opp.recommendation).not.toBeNull();
    }
  });

  it("persists every vendor metric snapshot — no dangling provenance ids", async () => {
    const deps = makeDeps();
    await runDiscovery(policy, deps);
    const snapshots = await deps.snapshots.listMetrics();
    expect(snapshots.length).toBe(5);
    const snapshotIds = new Set(snapshots.map((s) => s.metric_snapshot_id));
    for (const opp of await deps.opportunities.list()) {
      for (const id of opp.metric_snapshot_ids) {
        expect(snapshotIds.has(id), `${opp.keyword} references stored snapshot`).toBe(true);
      }
    }
  });

  it("fills only qualified slots — quota honesty (#23 §1.3)", async () => {
    const deps = makeDeps();
    const report = await runDiscovery(policy, deps);
    expect(report.new_candidates.length).toBe(2);
    expect(report.unfilled_target_slots).toBe(policy.target_qualified_pages_per_period - 2);
    expect(report.recommendations.WATCH).toBeGreaterThanOrEqual(2);
  });

  it("stops BEFORE any vendor call or cost event when the budget is exhausted (#23 §8.3)", async () => {
    const deps = makeDeps(untouchableAdapter());
    await deps.costs.record({
      usage_cost_event_id: "uce_prior",
      vendor: "fixture",
      service: "keyword_metrics",
      object_refs: {},
      units: 1,
      estimated_cost_usd: policy.max_external_seo_spend_usd_month,
      billed_cost_usd: null,
      rate_version: null,
      occurred_at: "2026-08-02T00:00:00Z",
    });
    const report = await runDiscovery(policy, deps);
    expect(report.status).toBe("stopped_budget");
    expect(report.vendor_cost_usd).toBe(0);
    // The untouchable adapter proves no vendor method ran (it would throw ->
    // status "failed"), and the cost ledger gained nothing:
    expect((await deps.costs.list()).length).toBe(1); // only the seeded prior event
    expect((await deps.opportunities.list()).length).toBe(0);
  });

  it("a budget-stopped run does NOT consume the idempotency slot — raising the budget re-enables discovery", async () => {
    const deps = makeDeps();
    await deps.costs.record({
      usage_cost_event_id: "uce_prior",
      vendor: "fixture",
      service: "keyword_metrics",
      object_refs: {},
      units: 1,
      estimated_cost_usd: policy.max_external_seo_spend_usd_month,
      billed_cost_usd: null,
      rate_version: null,
      occurred_at: "2026-08-02T00:00:00Z",
    });
    expect((await runDiscovery(policy, deps)).status).toBe("stopped_budget");

    const raised = SeoFactoryPolicy.parse({
      ...policy,
      max_external_seo_spend_usd_month: 100,
    });
    const rerun = await runDiscovery(raised, deps);
    expect(rerun.status).toBe("completed"); // same period, same version — still runs
  });

  it("a vendor failure marks the run failed and retryable without corrupting the store", async () => {
    const failing: SeoDataAdapter = {
      ...untouchableAdapter(),
      discoverIdeas: async () => {
        throw new Error("vendor unavailable");
      },
    };
    const deps = makeDeps(failing);
    const failed = await runDiscovery(policy, deps);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/vendor unavailable/);
    expect((await deps.opportunities.list()).length).toBe(0);

    const retryDeps = { ...deps, adapter: new FixtureSeoDataAdapter() };
    const retried = await runDiscovery(policy, retryDeps);
    expect(retried.status).toBe("completed");
  });

  it("an identical completed run is never paid for twice (#23 §2.4 idempotency)", async () => {
    const deps = makeDeps();
    const first = await runDiscovery(policy, deps);
    expect(first.status).toBe("completed");
    const costEventsAfterFirst = (await deps.costs.list()).length;

    const second = await runDiscovery(policy, deps);
    expect(second.status).toBe("skipped_idempotent");
    expect(second.agent_run_id).toBe(first.agent_run_id);
    expect((await deps.costs.list()).length).toBe(costEventsAfterFirst);
  });

  it("changing target/cap in the policy affects the next run WITHOUT a code deploy (#23 §8.3)", async () => {
    const deps = makeDeps();
    const capped = SeoFactoryPolicy.parse({
      ...policy,
      geography_plan: { national: { enabled: true, target_pages_per_period: 1 }, locals: [] },
      target_qualified_pages_per_period: 1,
      max_new_pages_per_period: 1,
      version: 2,
    });
    const cappedReport = await runDiscovery(capped, deps);
    expect(cappedReport.new_candidates.length).toBe(1);
    expect(cappedReport.recommendations.WATCH).toBeGreaterThanOrEqual(3);

    const raised = SeoFactoryPolicy.parse({ ...policy, version: 3 });
    const deps2 = makeDeps();
    const raisedReport = await runDiscovery(raised, deps2);
    expect(raisedReport.new_candidates.length).toBe(2);
  });

  it("enriches a pre-populated seed portfolio in place: stable ids, preserved metrics, surviving seed prior", async () => {
    const deps = makeDeps();
    const seedFile = JSON.parse(
      readFileSync(join(process.cwd(), "tests", "fixtures", "seed-research", "seed-rows.json"), "utf-8")
    ) as SeedFile;
    for (const opp of importSeedRows(seedFile, "2026-08-13T00:00:00Z")) {
      await deps.opportunities.upsert(opp);
    }
    const before = await deps.opportunities.getByKeyword("ac not turning on");
    expect(before!.score_components?.seed_manual_score).toBe(84);
    const countBefore = (await deps.opportunities.list()).length;

    const report = await runDiscovery(policy, deps);
    expect(report.status).toBe("completed");

    // No duplicate records: fixture keywords that already existed were updated.
    const countAfter = (await deps.opportunities.list()).length;
    const fixtureOnlyKeywords = 1; // "water dripping from ceiling" is not in the workbook
    expect(countAfter).toBe(countBefore + fixtureOnlyKeywords);

    const after = await deps.opportunities.getByKeyword("ac not turning on");
    expect(after!.search_opportunity_id).toBe(before!.search_opportunity_id); // id stable
    expect(after!.volume_monthly).toBe(3300); // known metrics preserved
    expect(after!.keyword_difficulty).toBe(3);
    expect(after!.score_components?.seed_manual_score).toBe(84); // owner's rubric survives
    expect(after!.opportunity_score).not.toBeNull();
    expect(after!.metric_snapshot_ids.length).toBeGreaterThan(0); // fresh snapshot linked
  });

  it("brakes mid-run when a call lands on the last budget dollar — later paid calls are skipped", async () => {
    // discoverIdeas costs $2 against $1 of remaining budget: metrics and
    // intent calls must then be skipped, and the run reports budget_limited.
    const pricey: SeoDataAdapter = {
      ...untouchableAdapter(),
      discoverIdeas: async () => ({
        ideas: [{ keyword: "ac not turning on", source_seed: null }],
        vendor_cost_usd: 2,
      }),
    };
    const deps = makeDeps(pricey);
    await deps.costs.record({
      usage_cost_event_id: "uce_prior",
      vendor: "fixture",
      service: "keyword_metrics",
      object_refs: {},
      units: 1,
      estimated_cost_usd: policy.max_external_seo_spend_usd_month - 1,
      billed_cost_usd: null,
      rate_version: null,
      occurred_at: "2026-08-02T00:00:00Z",
    });
    const report = await runDiscovery(policy, deps);
    expect(report.status).toBe("completed"); // untouchable metrics/intent were NOT called
    expect(report.budget_limited).toBe(true);
    expect(report.vendor_cost_usd).toBe(2);
  });

  it("records a UsageCostEvent for EVERY paid vendor call, not just metrics", async () => {
    const deps = makeDeps();
    await runDiscovery(policy, deps);
    const services = (await deps.costs.list()).map((e) => e.service).sort();
    expect(services).toEqual(["keyword_ideas", "keyword_metrics", "search_intent"]);
  });

  it("defers local targets until vendor geo mapping lands, and reports them", async () => {
    const deps = makeDeps();
    const withLocals = SeoFactoryPolicy.parse({
      ...policy,
      geography_plan: {
        national: { enabled: true, target_pages_per_period: 20 },
        locals: [
          { local_target_id: "lt_allen", state: "IN", county: "Allen", target_pages_per_period: 10 },
        ],
      },
      version: 5,
    });
    const report = await runDiscovery(withLocals, deps);
    expect(report.status).toBe("completed");
    expect(report.deferred_local_targets).toBe(8); // all Allen County cities counted
  });
});
