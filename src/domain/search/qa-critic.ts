import type { AiCriticStageResult, QaFinding } from "@/domain/search/qa-types";

/**
 * THE AI CRITIC — AN INTERFACE, A STUB, AND NO MODEL (conditions C3 and C4).
 *
 * WHAT WAS WRONG BEFORE THIS FILE. `fixtureCritic` in qa.ts was a pure
 * heuristic — block-kind breadth plus content length — that could return PASS
 * while the result reported `critic_ran: true`. The audit is blunt: that is
 * "precisely the dishonest critic the spec forbids, already in the codebase and
 * needing to be reclassified rather than inherited", and until it is
 * reclassified "the AI-critic half of the release gate is decorative"
 * (residual 18b). The scoring function survives — it feeds `user_value_score`,
 * which `SeoFactoryPolicy.min_user_value_score` gates on — under its real name,
 * `deterministicHeuristicScore`, reported in `heuristic_score`. It no longer
 * sets any critic field.
 *
 * SO WHAT DOES `ai_critic.status` SAY TODAY? `SKIPPED_NO_MODEL`, on every real
 * page, every time. No AI SDK is in package.json and no model key is consulted
 * anywhere in this repo (A00's gateway header records the same verification).
 * That is the honest value and a test asserts it is never treated as PASS.
 *
 * THE §11 DEFINITION-OF-DONE CONTRADICTION, resolved per condition C4. §11
 * demanded the critic "demonstrably produce" four voice_claim_policy findings
 * while the same prompt bans installing a model — satisfiable only by faking a
 * critic, which is the exact harm A06 exists to prevent. The restated form is
 * what ships: with a STUBBED critic in tests each of the four patterns produces
 * a voice_claim_policy finding, and with no model configured the stage reports
 * SKIPPED_NO_MODEL.
 *
 * ONE ROUTE TO A MODEL, AND IT IS THE GATEWAY. This module defines the contract
 * and the no-model default; it reads no environment variable, imports no vendor
 * SDK and makes no network call. The only implementation that may ever reach a
 * model lives in `platform/search/page-qa-critic.ts` and goes through
 * `capability_call()` — A00's one governed door, where the kill switch, the
 * capability registry, the ledger and the cost record already are.
 */

export interface AiCriticBlock {
  block_id: string;
  kind: string;
  heading: string | null;
  body_md: string;
}

/**
 * What a critic is shown. The page's OWN copy and nothing else — a PageSpec
 * carries no customer data by contract ("doors, not brains"), and this input
 * shape makes that structural rather than a promise.
 */
export interface AiCriticInput {
  page_spec_id: string;
  tenant_id?: string;
  primary_query: string;
  title: string;
  meta_description: string;
  h1: string;
  hero_headline: string;
  hero_subheadline: string | null;
  blocks: readonly AiCriticBlock[];
}

export interface AiCriticOutput {
  /** Never `SKIPPED_NOT_MEASURABLE` — that vocabulary belongs to the deterministic stage. */
  status: AiCriticStageResult["status"];
  reason: string;
  findings: QaFinding[];
  provider: string | null;
  /** TEST-labeled internal figure. null when no model ran. */
  cost_usd: number | null;
  latency_ms: number | null;
}

export interface AICritic {
  /** Stable id for the ledger and the report. */
  readonly id: string;
  critique(input: AiCriticInput): Promise<AiCriticOutput>;
}

/**
 * The default, and today the only, critic: there is no model, so it says so.
 * It is a value rather than a null so the "no critic" path is a thing that
 * REPORTS rather than a branch that is silently absent.
 */
export const NO_MODEL_CRITIC: AICritic = {
  id: "no-model",
  async critique(): Promise<AiCriticOutput> {
    return {
      status: "SKIPPED_NO_MODEL",
      reason:
        "no model is configured anywhere in this deployment — the AI critic did not run. This is NOT a pass: nothing has judged this page's voice, claims or usefulness.",
      findings: [],
      provider: null,
      cost_usd: null,
      latency_ms: null,
    };
  },
};

export interface CriticStageOptions {
  /**
   * True when the deterministic stage already produced a blocker. The critic is
   * then NOT INVOKED AT ALL — "cheap deterministic checks FIRST; a failed
   * deterministic check never pays for an AI critic" (#23 §2.4/§8.3). A test
   * asserts `critique` is never called in this case.
   */
  deterministic_blocked: boolean;
}

/**
 * Run the critic stage. NEVER throws, and NEVER upgrades a non-PASS to a PASS:
 * a critic that errors, times out or is refused by the gateway reports
 * `NOT_RUN`, which no downstream code treats as a pass.
 */
export async function runAiCriticStage(
  input: AiCriticInput,
  critic: AICritic,
  options: CriticStageOptions
): Promise<AiCriticStageResult> {
  if (options.deterministic_blocked) {
    return {
      status: "NOT_RUN",
      reason:
        "the deterministic stage returned a blocker — the critic was not invoked, because a failed page never pays for a critic (#23 §2.4/§8.3)",
      findings: [],
      provider: null,
      cost_usd: null,
      latency_ms: null,
    };
  }

  let output: AiCriticOutput;
  try {
    output = await critic.critique(input);
  } catch (err) {
    return {
      status: "NOT_RUN",
      reason: `the critic "${critic.id}" failed: ${err instanceof Error ? err.message : String(err)} — a failed critic is NOT a pass`,
      findings: [],
      provider: null,
      cost_usd: null,
      latency_ms: null,
    };
  }

  // A critic that reports PASS while handing back a blocker is contradicting
  // itself; the blocker wins. Fail closed, always in that direction.
  const status =
    output.status === "PASS" && output.findings.some((f) => f.severity === "blocker")
      ? "FAIL"
      : output.status;

  return {
    status,
    reason:
      status === output.status
        ? output.reason
        : `${output.reason} (downgraded to FAIL: the critic returned PASS alongside a blocker finding)`,
    findings: output.findings,
    provider: output.provider,
    cost_usd: output.cost_usd,
    latency_ms: output.latency_ms,
  };
}

/**
 * A critic status is NEVER a release signal on its own. Exported as a named
 * predicate so the rule is one function every reader shares, and so the test
 * that proves SKIPPED_NO_MODEL is not a pass has something to point at.
 */
export function criticPassed(status: AiCriticStageResult["status"]): boolean {
  return status === "PASS";
}
