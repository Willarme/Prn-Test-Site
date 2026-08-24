import {
  analyzeProblemFixture,
  buildJobPacketFixture,
  type AnalyzeInput,
  type AnalyzeResult,
} from "@/domain/problem/fixture-engine";
import type { EvidenceObject, ProblemRecord } from "@/domain/problem/contracts";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";
import { resolveCapability } from "@/platform/capabilities/registry";
import { emitPlatformEvent } from "@/platform/events/emit";
import { recordAgentRun, type AgentRunTrigger } from "@/platform/runs/ledger";
import { checkKillSwitch } from "@/platform/killswitch";

/**
 * A00 AI / Tool Gateway (spec §3, §9 step 5) — code asks for a CAPABILITY,
 * never a vendor. Modeled on the DataForSeoAdapter seam: typed interface,
 * swappable implementation.
 *
 * TODAY'S REAL STATE (verified against the repo: no AI SDK in package.json,
 * no model key consulted anywhere): every call routes to its deterministic
 * stand-in and the ledger logs provider "deterministic-stand-in". That is
 * the EXPECTED path, not an error state — the gateway never throws and never
 * silently no-ops because no key is set.
 *
 * MODEL WIRING IS AN OPEN OWNER DECISION (spec §10): this module deliberately
 * reads no vendor key and presupposes no vendor. When the owners wire a
 * model, only the executor table below (and the Capability Registry's
 * current_implementation/implementation_ref) changes — call sites keep the
 * same capability_call() contract.
 */

export interface CapabilityCallInput {
  agent_id: string;
  /** Capability Registry key or A00-spec alias (e.g. "classify_problem"). */
  capability: string;
  args: unknown;
  trigger?: AgentRunTrigger;
  /** Canonical IDs describing the inputs — never raw PII. */
  input_ids?: string[];
}

export type CapabilityCallResult<T = unknown> =
  | {
      ok: true;
      output: T;
      provider: string;
      run_id: string;
    }
  | {
      ok: false;
      /** "blocked" = governance said no (kill switch / not permitted); "error" = no executor / bad call. */
      kind: "blocked" | "error";
      reason: string;
      provider: string | null;
      run_id: string | null;
    };

/**
 * Executor table for capabilities the gateway can DISPATCH in Wave 0 — the
 * deterministic stand-ins behind the production contracts. Capabilities
 * registered but not listed here (e.g. external adapters with their own
 * pipelines, FUTURE_DISABLED entries) return a clean error result, never a
 * throw. Keyed by canonical capability_key.
 */
const DETERMINISTIC_EXECUTORS: Record<string, (args: unknown) => unknown> = {
  classify_home_problem: (args) => analyzeProblemFixture(args as AnalyzeInput),
  generate_job_packet: (args) => {
    const a = args as { problem: ProblemRecord; evidence: EvidenceObject; now: string };
    return buildJobPacketFixture(a.problem, a.evidence, a.now);
  },
};

const PROVIDER_DETERMINISTIC = "deterministic-stand-in";

/**
 * The one governed door every agent capability call goes through:
 * registry lookup → kill-switch check → resolve → execute → ledger + event.
 * NEVER throws — every failure path is a typed result plus an audit trail.
 */
export async function capability_call<T = unknown>(
  input: CapabilityCallInput
): Promise<CapabilityCallResult<T>> {
  const trigger = input.trigger ?? "request";
  const inputIds = input.input_ids ?? [];

  const fail = async (
    kind: "blocked" | "error",
    reason: string,
    provider: string | null
  ): Promise<CapabilityCallResult<T>> => {
    const run = await recordAgentRun({
      agent_id: /^A\d{2}$/.test(input.agent_id) ? input.agent_id : "A00",
      trigger,
      input_ids: inputIds,
      capabilities_used: [input.capability],
      tool_provider: provider ?? undefined,
      outputs_summary: null,
      errors: [`${kind}: ${reason}`],
    });
    await emitPlatformEvent({
      event_name: kind === "blocked" ? "capability.denied" : "agent.run_failed",
      agent_id: run.agent_id,
      agent_run_id: run.run_id,
      context: { capability: input.capability },
      status: kind === "blocked" ? "denied" : "error",
    });
    return { ok: false, kind, reason, provider, run_id: run.run_id };
  };

  // 1. Agent Registry lookup — unknown callers never execute.
  const agent = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === input.agent_id);
  if (!agent) return fail("blocked", `unknown agent "${input.agent_id}"`, null);

  // 2. Kill switch — synchronously BEFORE any capability work (spec §7:
  //    a call that starts before the check completes is a bug, not an edge case).
  const kill = checkKillSwitch(agent.agent_id);
  if (kill.engaged) {
    return fail("blocked", `kill switch engaged (${kill.scope}): ${kill.reason ?? "no reason recorded"}`, null);
  }

  // 3. Capability resolution (key or alias) + permission checks.
  const capability = resolveCapability(input.capability);
  if (!capability) return fail("error", `unknown capability "${input.capability}"`, null);
  if (capability.status === "FUTURE_DISABLED") {
    return fail("blocked", `capability "${capability.capability_key}" is FUTURE_DISABLED in the trial`, null);
  }
  if (
    capability.owning_agent_ids !== undefined &&
    !capability.owning_agent_ids.includes(agent.agent_id)
  ) {
    return fail("blocked", `agent ${agent.agent_id} does not own capability "${capability.capability_key}"`, null);
  }
  if (
    agent.allowed_capabilities.length > 0 &&
    !agent.allowed_capabilities.includes(input.capability) &&
    !agent.allowed_capabilities.includes(capability.capability_key)
  ) {
    return fail("blocked", `capability "${input.capability}" is not in ${agent.agent_id}'s allowed list`, null);
  }

  // 4. Route. No model key is set anywhere (verified) → the deterministic
  //    executor IS the expected path. External adapters keep their own
  //    pipelines in Wave 0; a capability with no executor is a clean error.
  const executor = DETERMINISTIC_EXECUTORS[capability.capability_key];
  if (!executor) {
    return fail(
      "error",
      `no Wave-0 executor registered for "${capability.capability_key}" (${capability.current_implementation ?? "unbound"})`,
      null
    );
  }

  const started = Date.now();
  let output: T;
  try {
    output = executor(input.args) as T;
  } catch (err) {
    return fail("error", err instanceof Error ? err.message : String(err), PROVIDER_DETERMINISTIC);
  }
  const latency = Date.now() - started;

  // 5. Ledger + event — one auditable record per call, IDs only.
  const run = await recordAgentRun({
    agent_id: agent.agent_id,
    trigger,
    input_ids: inputIds,
    capabilities_used: [capability.capability_key],
    tool_provider: PROVIDER_DETERMINISTIC,
    outputs_summary: null,
    cost_usd: 0, // deterministic path — 0 by definition; TEST-labeled real figures come with a model
    latency_ms: latency,
  });
  await emitPlatformEvent({
    event_name: "capability.invoked",
    agent_id: agent.agent_id,
    agent_run_id: run.run_id,
    context: { capability: capability.capability_key },
    versions: { capability: capability.version },
    duration_ms: latency,
    cost_usd: 0,
  });

  return { ok: true, output, provider: PROVIDER_DETERMINISTIC, run_id: run.run_id };
}

export type { AnalyzeInput, AnalyzeResult };
