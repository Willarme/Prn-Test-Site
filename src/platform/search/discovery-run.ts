import { runDiscovery, type DiscoveryDeps, type DiscoveryReport } from "@/domain/search/discovery";
import type { SeoFactoryPolicy } from "@/domain/search/policy";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { emitBudgetExhausted } from "@/platform/search/events";
import { checkKillSwitch } from "@/platform/killswitch";
import { recordAgentRun } from "@/platform/runs/ledger";

/**
 * THE PLATFORM COMPOSITION FOR AN A04 DISCOVERY RUN.
 *
 * `runDiscovery` is pure domain: it takes a kill-switch probe and a
 * budget-exhausted callback as dependencies rather than importing the platform,
 * so the domain layer stays free of platform imports and the brake stays
 * testable without a database. This is the one place those dependencies are
 * supplied for real.
 *
 * WHY IT EXISTS AT ALL. Before this build, `runDiscovery` had NO production
 * caller — it was reachable only from tests — which meant the kill switch was
 * never checked on the one path in the whole repo that spends money, and
 * `seo.budget_exhausted` was a registered name with no emitter. Both are now
 * wired here.
 *
 * NO SCHEDULER, DELIBERATELY (pre-answer 2). There is no vercel.json, no cron
 * entry and no scheduled route in this repo, and none is added: adding one
 * would convert a manually-triggered pipeline capped at a trial credit into an
 * unattended spender. This is an on-demand entry point.
 *
 * KILL SWITCH REF: the platform convention `agent:<agent_id>` from
 * registry.ts, resolved by checkKillSwitch("A04").
 */
const A04 = "A04";

export type PlatformDiscoveryDeps = Omit<
  DiscoveryDeps,
  "checkKill" | "onBudgetExhausted"
>;

export async function runDiscoveryOnPlatform(
  policy: SeoFactoryPolicy,
  deps: PlatformDiscoveryDeps,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<DiscoveryReport> {
  const report = await runDiscovery(policy, {
    ...deps,
    checkKill: () => {
      const check = checkKillSwitch(A04, clientProvider);
      return { engaged: check.engaged, reason: check.reason };
    },
    onBudgetExhausted: async (context) => {
      // Context is IDs, labels and numbers — never customer data.
      await emitBudgetExhausted(
        {
          agent_run_id: context.agent_run_id,
          vendor: context.vendor,
          month: context.month,
          cap_usd: String(context.cap_usd),
          spent_usd: String(context.spent_usd),
          stage: context.stage,
        },
        clientProvider
      );
    },
  });

  // One ledger row per RUN (A00 semantics), with the brake's own verdict on it
  // so a run that stopped short is auditable as such rather than looking clean.
  try {
    await recordAgentRun(
      {
        agent_id: A04,
        trigger: "job",
        input_ids: [policy.policy_id],
        capabilities_used: ["get_search_metrics"],
        tool_provider: deps.adapter.vendor,
        outputs_summary: {
          status: report.status,
          discovered: report.discovered,
          scored: report.scored,
          new_candidates: report.new_candidates.length,
          duplicate_intent_candidates: report.duplicate_intent_candidates,
          budget_limited: report.budget_limited,
          halted_by_kill_switch: report.halted_by_kill_switch,
        },
        decisions: report.brake_reasons,
        cost_usd: report.vendor_cost_usd,
        errors: report.error ? [report.error] : undefined,
      },
      clientProvider
    );
  } catch {
    /* the ledger is provenance, never the gate on a run that already happened */
  }

  return report;
}
