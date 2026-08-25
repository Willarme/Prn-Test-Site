import type { AICritic, AiCriticInput, AiCriticOutput } from "@/domain/search/qa-critic";
import { resolveCapability } from "@/platform/capabilities/registry";
import { capability_call } from "@/platform/gateway";

/**
 * THE ONLY ROUTE FROM A06 TO A MODEL — A00's AI/Tool Gateway, and nothing else
 * (conditions C3/C4).
 *
 * WHY THE GATEWAY IS THE ONLY DOOR. `capability_call()` is where the Agent
 * Registry lookup, the kill-switch check, the capability resolution, the
 * permission check, the Agent Run Ledger row and the cost/latency record already
 * are. A critic that reached a vendor SDK directly would bypass all six at once,
 * on the one A06 stage that would actually spend money. So this module holds no
 * vendor SDK, reads no vendor key, and makes no network call of its own.
 *
 * WHAT "NO MODEL" MEANS HERE, MECHANICALLY. A critic exists when the platform
 * has REGISTERED a critic capability. None is registered — `seo.critique_page`
 * is deliberately absent from `capabilities/registry.ts`, following the exact
 * precedent A05's build set when it refused to register `generate_page_copy`:
 * "registering a model capability nothing implements would be describing unbuilt
 * behaviour as built." So `criticConfigured()` is false, and A06 reports
 * `SKIPPED_NO_MODEL` WITHOUT calling the gateway at all.
 *
 * That last part is deliberate rather than lazy. Calling the gateway for an
 * unregistered capability would return a clean typed error — but it would also
 * write an `agent.run_failed` ledger row and emit a failure event on EVERY QA
 * run, which would report a system fault where the truth is "nobody has wired a
 * critic yet". Reporting a missing critic as a failed run is its own species of
 * dishonesty.
 *
 * TURNING THE CRITIC ON IS A DELIBERATE, VISIBLE ACT — TODO-ASK-OWNER (Joshua).
 * It takes three things, in this order: an owner decision on which model and
 * what it may cost (every PRN dollar is a TEST figure); a capability entry for
 * `seo.critique_page` with a risk class and required scopes; and an executor
 * behind it. Until all three exist, the honest state is the one shipping — and
 * `release_eligible` does not depend on the critic, because a human publishes
 * every page (pre-answer 1).
 */

/**
 * The capability key a critic would be registered under. Held as a constant
 * rather than a string literal at the call site so the "is it registered yet"
 * question has exactly one answer in the codebase.
 */
export const PAGE_CRITIC_CAPABILITY = "seo.critique_page";

/** True only when a critic capability is actually registered with the platform. */
export function criticConfigured(): boolean {
  return resolveCapability(PAGE_CRITIC_CAPABILITY) !== null;
}

interface CriticCapabilityOutput {
  status?: string;
  reason?: string;
  findings?: AiCriticOutput["findings"];
  cost_usd?: number;
}

/**
 * A06's production critic adapter. Reports SKIPPED_NO_MODEL while nothing is
 * registered; routes through the gateway the moment something is. It NEVER
 * returns PASS on a failure path — a refused, errored or unparseable critic call
 * is `NOT_RUN`, which no downstream code treats as a pass.
 */
export const gatewayAiCritic: AICritic = {
  id: "gateway",
  async critique(input: AiCriticInput): Promise<AiCriticOutput> {
    if (!criticConfigured()) {
      return {
        status: "SKIPPED_NO_MODEL",
        reason: `no critic capability is registered (${PAGE_CRITIC_CAPABILITY}) and no model is wired anywhere in this deployment — the AI critic did not run. This is NOT a pass: nothing has judged this page's voice, claims or usefulness.`,
        findings: [],
        provider: null,
        cost_usd: null,
        latency_ms: null,
      };
    }

    const started = Date.now();
    const result = await capability_call<CriticCapabilityOutput>({
      agent_id: "A06",
      capability: PAGE_CRITIC_CAPABILITY,
      // IDs and the page's own copy only — a PageSpec carries no customer data.
      args: input,
      trigger: "job",
      input_ids: [input.page_spec_id],
    });
    const latency = Date.now() - started;

    if (!result.ok) {
      return {
        status: "NOT_RUN",
        reason: `the gateway ${result.kind === "blocked" ? "blocked" : "could not complete"} the critic call: ${result.reason} — a critic that did not run is NOT a pass`,
        findings: [],
        provider: result.provider,
        cost_usd: null,
        latency_ms: latency,
      };
    }

    const output = result.output ?? {};
    const status =
      output.status === "PASS" || output.status === "FAIL" ? output.status : "NOT_RUN";
    return {
      status,
      reason:
        status === "NOT_RUN"
          ? `the critic returned an unrecognised status (${String(output.status)}) — refusing to interpret it as a pass`
          : (output.reason ?? "the critic returned a verdict with no stated reason"),
      findings: output.findings ?? [],
      provider: result.provider,
      cost_usd: typeof output.cost_usd === "number" ? output.cost_usd : null,
      latency_ms: latency,
    };
  },
};
