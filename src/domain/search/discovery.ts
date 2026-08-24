import { SearchOpportunity } from "@/domain/search/contracts";
import {
  expandGeographyPlan,
  type CityIndexAdapter,
  type GeographyTarget,
} from "@/domain/search/geography-plan";
import { classifyIntentPrnSide, inferProblemFamily } from "@/domain/search/intent-classifier";
import { detectDuplicateIntents } from "@/domain/search/intent-family";
import { isMergeTarget, recommend } from "@/domain/search/recommend";
import { scoreOpportunity } from "@/domain/search/scoring";
import type { SeoFactoryPolicy } from "@/domain/search/policy";
import type { Cadence } from "@/domain/shared/primitives";
import type { AgentRun } from "@/platform/agents/contracts";
import type { SeoDataAdapter } from "@/platform/adapters/seo-data";
import type { VendorCostRate } from "@/platform/economics/contracts";
import {
  chunkKeywords,
  estimateVendorCall,
  type CostEstimate,
} from "@/platform/economics/rates";
import type {
  AgentRunStore,
  CostStore,
  OpportunityStore,
  SnapshotStore,
} from "@/platform/stores/interfaces";

/**
 * A04 discovery run (Door Wave 1): discover -> normalize -> merge with the
 * existing portfolio -> score -> recommend. Deterministic (Tier-0) — no LLM
 * calls in this wave.
 *
 * HARD RULES (#23):
 *  - budget brake fires BEFORE spend and again BETWEEN vendor calls; every
 *    paid call records a UsageCostEvent (§1.3/§8.3)
 *  - quota honesty: fewer qualified than target = fewer pages; thresholds are
 *    never lowered (§1.3 CRITICAL)
 *  - idempotency: an identical completed run in the same cadence period is
 *    never paid for twice; failed or budget-stopped runs do NOT consume the
 *    slot (§2.4)
 *  - candidates MERGE with existing records BEFORE scoring, and batch
 *    processing is ordered by score so the strongest keyword in an intent
 *    family wins regardless of vendor list order (Wave 1 verification fixes)
 *  - A04 creates candidates; it CANNOT publish (#14A §12)
 */
export interface DiscoveryDeps {
  adapter: SeoDataAdapter;
  opportunities: OpportunityStore;
  runs: AgentRunStore;
  costs: CostStore;
  snapshots: SnapshotStore;
  cityIndex: CityIndexAdapter;
  /** injected clock for deterministic tests, ISO datetime */
  now: () => string;
  idSuffix: () => string;
  /**
   * Kill-switch probe, injected so the domain layer stays free of platform
   * imports. Callers pass `() => checkKillSwitch("A04")`. Absent means "no
   * switch wired" (tests and the CLI), which is the same as not engaged.
   */
  checkKill?: () => { engaged: boolean; reason?: string };
  /** Vendor price registry for the pre-flight estimate. Defaults to the shipped rates. */
  rates?: readonly VendorCostRate[];
  /** Called when the brake stops a run, so the caller can emit seo.budget_exhausted. */
  onBudgetExhausted?: (context: {
    agent_run_id: string;
    vendor: string;
    month: string;
    cap_usd: number;
    spent_usd: number;
    stage: "pre_run" | "mid_run";
  }) => Promise<void>;
}

export interface DiscoveryReport {
  agent_run_id: string;
  status: "completed" | "failed" | "skipped_idempotent" | "stopped_budget";
  discovered: number;
  scored: number;
  recommendations: Record<string, number>;
  new_candidates: string[];
  unfilled_target_slots: number;
  vendor_cost_usd: number;
  budget_limited: boolean;
  deferred_local_targets: number;
  /**
   * CANNIBALIZATION PRE-GATE (C13, coherence issue 15). How many of this
   * batch's candidates collapsed into an intent family already claimed by
   * another candidate or an existing record. Previously invisible: the run
   * reported "4 MERGE" with no way to see the collision structure behind it.
   */
  duplicate_intent_candidates: number;
  duplicate_intent_groups: number;
  /**
   * PROGRESSIVE ENRICHMENT (C17). How many top-scoring finalists received a
   * SERP snapshot this run. 0 when the stage is off, which is the default.
   */
  finalists_enriched: number;
  /** Why the brake or the kill switch stopped spending, in order. */
  brake_reasons: string[];
  halted_by_kill_switch: boolean;
  error: string | null;
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return `h${(hash >>> 0).toString(16)}`;
}

/** ISO-8601 week number (UTC) for weekly idempotency periods. */
function isoWeek(dateIso: string): string {
  const date = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Idempotency period derives from the policy cadence, not a fixed month. */
export function periodFor(cadence: Cadence, nowIso: string): string {
  const date = nowIso.slice(0, 10);
  switch (cadence) {
    case "daily":
      return date;
    case "weekly":
      return isoWeek(nowIso);
    case "monthly":
      return nowIso.slice(0, 7);
    case "quarterly": {
      const month = Number(nowIso.slice(5, 7));
      return `${nowIso.slice(0, 4)}-Q${Math.ceil(month / 3)}`;
    }
  }
}

function vendorToSource(vendor: string): SearchOpportunity["source"] {
  if (vendor === "dataforseo") return "dataforseo";
  if (vendor === "fixture") return "seed_import";
  return "manual";
}

export async function runDiscovery(
  policy: SeoFactoryPolicy,
  deps: DiscoveryDeps
): Promise<DiscoveryReport> {
  const startedAt = deps.now();
  const month = startedAt.slice(0, 7); // budgets are calendar-monthly
  const period = periodFor(policy.discovery_scan_cadence, startedAt);
  const idempotencyKey = `a04:${policy.policy_id}:v${policy.version}:${period}`;
  // The scoring POLICY, not the module constant, goes into the input hash:
  // a weight change must invalidate the idempotency slot, or the first run
  // after a retune would be skipped as "already done this period" and the
  // owner's change would silently not take.
  const inputHash = simpleHash(
    JSON.stringify([
      policy.version,
      policy.geography_plan,
      policy.allowed_categories,
      period,
      policy.scoring.version,
      policy.scoring.weights,
    ])
  );

  const empty = (status: DiscoveryReport["status"], runId: string): DiscoveryReport => ({
    agent_run_id: runId,
    status,
    discovered: 0,
    scored: 0,
    recommendations: {},
    new_candidates: [],
    unfilled_target_slots: policy.target_qualified_pages_per_period,
    vendor_cost_usd: 0,
    budget_limited: status === "stopped_budget",
    deferred_local_targets: 0,
    duplicate_intent_candidates: 0,
    duplicate_intent_groups: 0,
    finalists_enriched: 0,
    brake_reasons: [],
    halted_by_kill_switch: false,
    error: null,
  });

  const previous = await deps.runs.findByIdempotencyKey(idempotencyKey);
  if (previous) {
    return { ...empty("skipped_idempotent", previous.agent_run_id), unfilled_target_slots: 0 };
  }

  const run: AgentRun = {
    agent_run_id: `ar_a04_${period.replace(/-/g, "")}_${deps.idSuffix()}`,
    agent_id: "A04",
    job_key: "seo.discover_opportunities",
    input_hash: inputHash,
    idempotency_key: idempotencyKey,
    status: "running",
    attempts: 1,
    started_at: startedAt,
    finished_at: null,
    output_ids: [],
    cost_usd: null,
    error: null,
  };
  await deps.runs.save(run);

  // Geography plan expansion (D-10). Wave 1 executes the national target;
  // local targets are counted and deferred until vendor geo mapping lands.
  const targets = await expandGeographyPlan(policy.geography_plan, deps.cityIndex);
  const nationalTarget: GeographyTarget | undefined = targets.find((t) => t.target_kind === "national");
  const deferredLocalTargets = targets.filter((t) => t.target_kind !== "national").length;

  // Budget brake BEFORE any vendor spend (#23 §1.3 / §8.3). Budget-stopped
  // runs are saved status "skipped" so they never consume the idempotency
  // slot — raising the budget mid-period allows a fresh attempt.
  const spentThisMonth = await deps.costs.monthlySpend(deps.adapter.vendor, month);
  let remainingBudget = policy.max_external_seo_spend_usd_month - spentThisMonth;
  if (remainingBudget <= 0 || !nationalTarget) {
    const status = !nationalTarget ? "completed" : "skipped";
    await deps.runs.save({ ...run, status, finished_at: deps.now() });
    if (nationalTarget) {
      await deps.onBudgetExhausted?.({
        agent_run_id: run.agent_run_id,
        vendor: deps.adapter.vendor,
        month,
        cap_usd: policy.max_external_seo_spend_usd_month,
        spent_usd: spentThisMonth,
        stage: "pre_run",
      });
    }
    return {
      ...empty(!nationalTarget ? "completed" : "stopped_budget", run.agent_run_id),
      deferred_local_targets: deferredLocalTargets,
    };
  }

  const recordCost = async (service: string, costUsd: number, rateVersion: string | null) => {
    await deps.costs.record({
      usage_cost_event_id: `uce_${run.agent_run_id}_${service}_${deps.idSuffix()}`,
      vendor: deps.adapter.vendor,
      service,
      object_refs: { agent_run_id: run.agent_run_id },
      units: 1,
      estimated_cost_usd: costUsd,
      billed_cost_usd: null,
      rate_version: rateVersion,
      occurred_at: deps.now(),
    });
    remainingBudget -= costUsd;
  };

  /**
   * THE PRE-FLIGHT BRAKE (C8) — the gap this build closed.
   *
   * The old check was `remainingBudget > 0` before an UNBOUNDED call whose cost
   * was only recorded after it returned. With a $1 cap and a 4,000-keyword
   * list, one request was four billable tasks: the cap was blown by an
   * arbitrary amount while the run still reported `budget_limited` cleanly and
   * satisfied its own done-when. Now every call is priced BEFORE it is made,
   * against the registered rate, rounded UP, and refused if it does not fit.
   *
   * An UNESTIMABLE call is refused too. `estimateVendorCall` returns
   * `known: false` for a vendor/service with no registered rate, and an unknown
   * price is not a free one — pricing it at zero is precisely how budgets get
   * silently blown.
   *
   * THE KILL SWITCH IS CHECKED HERE, NOT ONLY AT THE TOP. A run that started
   * before the owner hit pause must stop at the next call, not finish spending.
   */
  const spendGate = (service: string, units: number): { ok: boolean; reason: string; estimate: CostEstimate } => {
    const kill = deps.checkKill?.() ?? { engaged: false };
    if (kill.engaged) {
      return {
        ok: false,
        reason: `kill switch engaged for A04${kill.reason ? ` (${kill.reason})` : ""} — no further vendor spend`,
        estimate: { estimated_usd: 0, basis: "not priced — halted", known: false, rate_version: null },
      };
    }
    const estimate = estimateVendorCall(deps.adapter.vendor, service, units, deps.rates);
    if (!estimate.known) {
      return { ok: false, reason: estimate.basis, estimate };
    }
    if (estimate.estimated_usd > remainingBudget) {
      return {
        ok: false,
        reason: `estimated $${estimate.estimated_usd} for ${service} exceeds $${Math.round(remainingBudget * 1e6) / 1e6} remaining this month`,
        estimate,
      };
    }
    return { ok: true, reason: estimate.basis, estimate };
  };

  try {
    let vendorCost = 0;
    let budgetLimited = false;
    let haltedByKillSwitch = false;
    const brakeReasons: string[] = [];
    const scope = nationalTarget.scope;
    const perCall = policy.max_keywords_per_vendor_call;

    const halt = (reason: string): void => {
      brakeReasons.push(reason);
      if (reason.startsWith("kill switch")) haltedByKillSwitch = true;
      else budgetLimited = true;
    };

    // 1. Cheap broad discovery (progressive enrichment step 1), priced first.
    const seeds = policy.allowed_categories.length > 0 ? policy.allowed_categories : ["home problems"];
    let keywords: string[] = [];
    const ideasGate = spendGate("keyword_ideas", seeds.length);
    if (!ideasGate.ok) {
      halt(ideasGate.reason);
    } else {
      const discovery = await deps.adapter.discoverIdeas(seeds, scope);
      vendorCost += discovery.vendor_cost_usd;
      await recordCost("keyword_ideas", discovery.vendor_cost_usd, ideasGate.estimate.rate_version);
      keywords = [...new Set(discovery.ideas.map((i) => i.keyword))];
    }

    // 2. Bulk metrics — CHUNKED, and every chunk priced before it is sent.
    //    This is the overshoot fix: one 4,000-keyword request was four billable
    //    tasks in a single un-estimated call.
    const metrics: Awaited<ReturnType<SeoDataAdapter["getKeywordMetrics"]>> = [];
    for (const chunk of chunkKeywords(keywords, perCall)) {
      const gate = spendGate("keyword_metrics", chunk.length);
      if (!gate.ok) {
        halt(gate.reason);
        break; // stop cleanly; partial enrichment is honest, overspend is not
      }
      const batch = await deps.adapter.getKeywordMetrics(chunk, scope);
      let metricsCost = 0;
      for (const snap of batch) {
        metricsCost += snap.vendor_cost_usd ?? 0;
        await deps.snapshots.saveMetric(snap); // provenance chain (#23 §1.2)
        metrics.push(snap);
      }
      vendorCost += metricsCost;
      await recordCost(
        "keyword_metrics",
        metricsCost,
        batch[0]?.rate_version ?? gate.estimate.rate_version
      );
    }

    // 3. Vendor intent labels — same chunking, same pre-flight pricing.
    const vendorIntents: Awaited<ReturnType<SeoDataAdapter["getSearchIntent"]>> = {
      classifications: [],
      vendor_cost_usd: 0,
    };
    for (const chunk of chunkKeywords(keywords, perCall)) {
      const gate = spendGate("search_intent", chunk.length);
      if (!gate.ok) {
        halt(gate.reason);
        break;
      }
      const batch = await deps.adapter.getSearchIntent(chunk);
      vendorIntents.classifications.push(...batch.classifications);
      vendorIntents.vendor_cost_usd += batch.vendor_cost_usd;
      vendorCost += batch.vendor_cost_usd;
      await recordCost("search_intent", batch.vendor_cost_usd, gate.estimate.rate_version);
    }

    // 4. Build MERGED records first (verification blocker fix): metrics known
    //    on the existing record are preserved; the owner's seed rubric prior
    //    survives; only then is anything scored.
    const nowIso = deps.now();
    const mergedRecords: SearchOpportunity[] = [];
    for (const keyword of keywords) {
      const already = await deps.opportunities.getByKeyword(keyword);
      const metric = metrics.find((m) => m.keyword === keyword) ?? null;
      const vendorLabel =
        vendorIntents.classifications.find((i) => i.keyword === keyword)?.intent_type ?? null;
      const intentType = classifyIntentPrnSide(
        keyword,
        vendorLabel === "unknown" ? (already?.intent_type ?? null) : vendorLabel
      );
      const seedComponents = already?.score_components?.seed_manual_score;
      mergedRecords.push(
        SearchOpportunity.parse({
          ...(already ?? {
            search_opportunity_id: `so_${simpleHash(keyword)}`,
            schema_version: "1.0.0",
            keyword,
            intent_cluster_id: null,
            cluster_label: null,
            recommendation: null,
            status: "candidate",
            serp_snapshot_ids: [],
            created_at: nowIso,
          }),
          source: already?.source ?? vendorToSource(deps.adapter.vendor),
          geography: scope,
          geography_assumed: false,
          problem_family_hint:
            already?.problem_family_hint ?? inferProblemFamily(keyword, already?.cluster_label ?? null),
          volume_monthly: metric?.volume_monthly ?? already?.volume_monthly ?? null,
          keyword_difficulty: metric?.keyword_difficulty ?? already?.keyword_difficulty ?? null,
          cpc_usd: metric?.cpc_usd ?? already?.cpc_usd ?? null,
          intent_type: intentType,
          opportunity_score: null,
          score_components: seedComponents !== undefined ? { seed_manual_score: seedComponents } : null,
          metric_snapshot_ids: [
            ...(already?.metric_snapshot_ids ?? []),
            ...(metric ? [metric.metric_snapshot_id] : []),
          ],
          provenance: already?.provenance ?? {
            source_type: `vendor:${deps.adapter.vendor}`,
            source_url: null,
            confidence_note: null,
          },
          vendor_cost_usd: metric?.vendor_cost_usd ?? already?.vendor_cost_usd ?? null,
          researched_at: nowIso,
          updated_at: nowIso,
        })
      );
    }

    // 5. Score all merged records, then process in DESCENDING score order so
    //    the strongest keyword in a family claims the page and weaker
    //    variants MERGE into it — deterministic, vendor-order-independent.
    const scoredBatch = mergedRecords
      .map((record) => scoreOpportunity(record, policy))
      .sort((a, b) => b.score - a.score);

    const portfolio = await deps.opportunities.list();
    const seen: SearchOpportunity[] = portfolio.filter(
      (p) => !keywords.includes(p.keyword) // batch keywords are re-evaluated fresh
    );
    // 5b. PROGRESSIVE ENRICHMENT (C17) — the expensive half, on FINALISTS only.
    //     Cheap broad discovery ran above over the whole candidate pool; this
    //     spends per-keyword money only on the top scorers, and only when the
    //     owner has turned it on (enrich_finalists_top_n defaults to 0, which
    //     reproduces the previous behaviour exactly). Every call goes through
    //     the same pre-flight brake as every other call.
    const serpIdsByOpportunity = new Map<string, string[]>();
    let finalistsEnriched = 0;
    for (const finalist of scoredBatch.slice(0, policy.enrich_finalists_top_n)) {
      const gate = spendGate("serp_snapshot", 1);
      if (!gate.ok) {
        halt(gate.reason);
        break;
      }
      const snapshot = await deps.adapter.getSerpSnapshot(finalist.opportunity.keyword, scope);
      await deps.snapshots.saveSerp(snapshot);
      vendorCost += snapshot.vendor_cost_usd ?? 0;
      await recordCost("serp_snapshot", snapshot.vendor_cost_usd ?? 0, gate.estimate.rate_version);
      serpIdsByOpportunity.set(finalist.opportunity.search_opportunity_id, [
        ...finalist.opportunity.serp_snapshot_ids,
        snapshot.serp_snapshot_id,
      ]);
      finalistsEnriched += 1;
    }

    // THE CANNIBALIZATION PRE-GATE (C13). Runs BEFORE the recommendation loop,
    // over the whole batch at once, so the collision structure is a reported
    // fact rather than an inference from the MERGE count. It decides nothing:
    // recommend() stays the only place a recommendation is assigned.
    const duplicates = detectDuplicateIntents(scoredBatch, seen, isMergeTarget);

    const recommendations: Record<string, number> = {};
    const newCandidates: string[] = [];

    for (const scored of scoredBatch) {
      const rec = recommend(scored, seen, policy);
      let finalRec = rec.recommendation;
      if (finalRec === "NEW" && newCandidates.length >= policy.max_new_pages_per_period) {
        finalRec = "WATCH"; // hard cap; thresholds untouched (#23 §1.3)
      }
      const seedPrior = scored.opportunity.score_components?.seed_manual_score;
      const stored: SearchOpportunity = {
        ...scored.opportunity,
        serp_snapshot_ids:
          serpIdsByOpportunity.get(scored.opportunity.search_opportunity_id) ??
          scored.opportunity.serp_snapshot_ids,
        opportunity_score: scored.score,
        score_version: scored.score_version,
        score_components: {
          ...scored.components,
          ...(seedPrior !== undefined ? { seed_manual_score: seedPrior } : {}),
        },
        recommendation: finalRec,
      };
      await deps.opportunities.upsert(stored);
      seen.push(stored);
      recommendations[finalRec] = (recommendations[finalRec] ?? 0) + 1;
      if (finalRec === "NEW") newCandidates.push(stored.search_opportunity_id);
    }

    await deps.runs.save({
      ...run,
      status: "completed",
      finished_at: deps.now(),
      output_ids: newCandidates,
      cost_usd: vendorCost,
    });

    // A run that stopped spending mid-flight says so out loud. The run itself
    // still COMPLETES — the records it did produce are real and the queue is
    // correct as far as it goes; what must never happen is a clean-looking
    // report that hides a cap being hit.
    if (budgetLimited) {
      await deps.onBudgetExhausted?.({
        agent_run_id: run.agent_run_id,
        vendor: deps.adapter.vendor,
        month,
        cap_usd: policy.max_external_seo_spend_usd_month,
        spent_usd: spentThisMonth + vendorCost,
        stage: "mid_run",
      });
    }

    return {
      agent_run_id: run.agent_run_id,
      status: "completed",
      discovered: keywords.length,
      scored: scoredBatch.length,
      recommendations,
      new_candidates: newCandidates,
      unfilled_target_slots: Math.max(
        0,
        policy.target_qualified_pages_per_period - newCandidates.length
      ),
      vendor_cost_usd: vendorCost,
      budget_limited: budgetLimited,
      deferred_local_targets: deferredLocalTargets,
      duplicate_intent_candidates: duplicates.duplicate_candidates,
      duplicate_intent_groups: duplicates.groups.length,
      finalists_enriched: finalistsEnriched,
      brake_reasons: brakeReasons,
      halted_by_kill_switch: haltedByKillSwitch,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.runs.save({ ...run, status: "failed", finished_at: deps.now(), error: message });
    return {
      ...empty("failed", run.agent_run_id),
      deferred_local_targets: deferredLocalTargets,
      error: message,
    };
  }
}
