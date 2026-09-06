import type { z } from "zod";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";
import { defaultAiProvider, type AiProviderFactory } from "@/platform/ai/client";
import {
  actualModelCost,
  estimateModelCall,
  findModel,
  IMAGE_TOKEN_ALLOWANCE,
  MODEL_CATALOGUE,
  TEST_FIGURE_LABEL,
  type ModelConfig,
} from "@/platform/ai/models";
import { capabilityPolicy, type AiPolicy } from "@/platform/ai/policy";
import { aiPolicyStore, type AiPolicyStore } from "@/platform/ai/policy-store";
import {
  extractJsonObject,
  renderRepairPrompt,
  renderSchemaInstructions,
} from "@/platform/ai/prompt";
import { MAX_MODEL_HTTP_ATTEMPTS, type ModelCallInput, type ModelCallResult, type ModelImage, type ModelUsage } from "@/platform/ai/provider";
import { spendLedger, utcDay, type SpendLedger, type SpendReservation } from "@/platform/ai/spend";
import { FileRequestCallLedger, requestCallPolicy, requestCallsRequireSharedStore, validRequestCallIdentity, type RequestCallLedger } from "@/platform/ai/request-calls";
import { resolveCapability } from "@/platform/capabilities/registry";
import { validateAndEmit } from "@/platform/events/steward";
import { checkKillSwitch } from "@/platform/killswitch";
import { recordAgentRun, type AgentRunTrigger } from "@/platform/runs/ledger";

/**
 * `callModel` — THE ONE DOOR EVERY MODEL CALL GOES THROUGH.
 *
 * ─── WHY IT IS NOT NESTED INSIDE capability_call() ──────────────────────────
 *
 * A00's gateway is the governed door for CAPABILITIES, and this does not go
 * around it — it repeats its ladder and then adds to it. Two concrete reasons it
 * is a sibling rather than a child:
 *
 *   ONE LEDGER ROW PER CALL. `capability_call` writes a row and hardcodes
 *   `cost_usd: 0`, which was correct while every executor was deterministic.
 *   Nesting would write two rows for one call, one of them claiming the model was
 *   free. The spec's requirement is one row carrying provider, model, prompt
 *   version, tokens, cost, latency and generation id — so the row is written
 *   here, where those facts exist.
 *
 *   THE EXECUTOR TABLE IS SYNCHRONOUS. `DETERMINISTIC_EXECUTORS` maps a key to
 *   `(args) => unknown`. A model call is async, retried, budgeted and validated;
 *   forcing it into that shape would have meant rewriting the gateway for the one
 *   caller that needed something else.
 *
 * WHAT IT INHERITS ANYWAY, in the gateway's own order, using the gateway's own
 * primitives — a test asserts the ladder is at least as strict:
 *   1. Agent Registry lookup — an unknown caller never executes.
 *   2. Kill switch, SYNCHRONOUSLY, before any work.
 *   3. Capability resolution by key or alias; FUTURE_DISABLED refused.
 *   4. owning_agent_ids + the agent's own allowed_capabilities.
 * and then adds the four this build exists for:
 *   5. Enablement — global master switch AND the per-capability flag, both off.
 *   6. PRIVACY — a customer-data capability may only run on a model whose config
 *      says so, and must send data_collection: deny. Refused BEFORE any network
 *      I/O; the check cannot be reached from the wire.
 *   7. BUDGET — priced before the call, re-checked against reported usage after,
 *      against a spend record that survives a restart.
 *   8. VALIDATION — zod on the reply, one repair turn in json_object mode,
 *      deterministic fallback if it still does not conform.
 *
 * ─── IT NEVER THROWS ────────────────────────────────────────────────────────
 *
 * Every path returns `{ ok: false, reason }`. The whole point of this function is
 * that its caller can fall back deterministically, and a caller cannot fall back
 * from inside a rejected promise it did not expect. Same contract as
 * `emitPlatformEvent`, `recordAgentRun` and `capability_call`.
 *
 * ─── EVERY DOLLAR IT PRODUCES IS TEST ───────────────────────────────────────
 *
 * Estimates, recorded call costs and day totals are PRN figures derived from a
 * vendor's price. `TEST_FIGURE_LABEL` travels with each one onto the ledger row.
 * The vendor's per-token price itself is a sourced fact and lives in models.ts.
 */

export type CallModelFailureReason =
  /** The global master switch or this capability's flag is off. The default state. */
  | "disabled"
  /** No credential is configured — this deployment has no model. */
  | "no_key"
  /** Kill switch engaged, GLOBAL or AGENT scope. */
  | "kill_switch"
  /** Unknown agent, unknown/FUTURE_DISABLED capability, or the agent may not call it. */
  | "not_permitted"
  /** A customer-data capability was pointed at a model not cleared for customer data. */
  | "privacy_refused"
  /** The policy names a model that is not in the catalogue — unpriced, so unrunnable. */
  | "unknown_model"
  /** Per-call cap, per-capability daily cap, or the global daily budget. */
  | "over_budget"
  /** 429 survived the provider's retries. */
  | "rate_limited"
  | "timeout"
  /** The model refused or was content-filtered. */
  | "refused"
  /** Not JSON, or JSON that failed the schema even after the repair turn. */
  | "invalid_after_repair"
  | "http_error";

export interface CallModelSuccess<T> {
  ok: true;
  value: T;
  model_id: string;
  provider: string;
  usage: ModelUsage;
  /** TEST — PRN-derived from the vendor's per-token price, or the vendor's own reported figure. */
  cost_usd: number;
  cost_basis: string;
  figure_label: string;
  latency_ms: number;
  generation_id: string | null;
  run_id: string;
  /** True when the reply only validated after the one repair turn. */
  repaired: boolean;
}

export interface CallModelFailure {
  ok: false;
  reason: CallModelFailureReason;
  /** Safe to log and to surface to an owner. Never carries a key or a prompt. */
  detail: string;
  /** Null only when the failure happened before a run could be recorded. */
  run_id: string | null;
}

export type CallModelResult<T> = CallModelSuccess<T> | CallModelFailure;

export interface CallModelDeps {
  provider?: AiProviderFactory;
  /**
   * The model catalogue to price and configure against. Injectable for the same
   * reason `estimateVendorCall` takes a rates list: a test must be able to
   * exercise a model configuration that does not exist in the shipped
   * catalogue — notably one CLEARED for customer data, which no real model is,
   * because clearing one is an owner decision this build does not make.
   */
  catalogue?: readonly ModelConfig[];
  policyStore?: AiPolicyStore;
  /** Supply a policy directly and the store is not consulted. */
  policy?: AiPolicy;
  spend?: SpendLedger;
  requestCalls?: RequestCallLedger;
  now?: () => Date;
}

export interface CallModelInput<T> {
  agent_id: string;
  /** Trusted server-issued journey id. Required with tenant_id for A01 models. */
  request_id?: string | null;
  /** Capability Registry key or alias. Resolved, permission-checked, and used as the policy key. */
  capability: string;
  /**
   * DOES THIS CALL CARRY A HOMEOWNER'S OWN WORDS?
   *
   * TRUE for anything reading raw customer text. It forces two things: the model
   * must be configured `allows_customer_data: true`, and the request must carry
   * `data_collection: "deny"`. Neither is optional and neither can be waived by a
   * caller — a `true` here is a promise about the INPUT, and the enforcement is
   * this function's.
   */
  handles_customer_data: boolean;
  prompt_id: string;
  prompt_version: string;
  system: string;
  user: string;
  schema_name: string;
  /** Validates the reply. The caller owns it; nothing below this line decides what "valid" means. */
  schema: z.ZodType<T>;
  /** The same contract as data, sent to the API. A test asserts the two agree. */
  json_schema: Record<string, unknown>;
  /** Canonical IDs describing the inputs — never raw PII. */
  input_ids?: string[];
  /**
   * Images attached to the user turn (the rating-plate reader is the one
   * caller). The model must be configured `accepts_images` or the gate refuses
   * before the network; each image adds IMAGE_TOKEN_ALLOWANCE to the pre-call
   * estimate. A caller sending a homeowner's photo sets `handles_customer_data`
   * and strips the file's metadata first — neither happens here.
   */
  images?: ModelImage[];
  tenant_id?: string;
  trigger?: AgentRunTrigger;
  deps?: CallModelDeps;
}

interface Gate {
  policy: AiPolicy;
  model: ModelConfig;
  capabilityKey: string;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRepairRetries: number;
  estimateUsd: number;
  estimateBasis: string;
}

/**
 * Record the run and the event for a refusal. IDs and labels only — never the
 * prompt, never the reply, never a credential.
 */
async function recordRefusal(
  input: CallModelInput<unknown>,
  reason: CallModelFailureReason,
  detail: string,
  extraContext: Record<string, string> = {}
): Promise<CallModelFailure> {
  const agentId = /^A\d{2}$/.test(input.agent_id) ? input.agent_id : "A00";
  const run = await recordAgentRun({
    agent_id: agentId,
    tenant_id: input.tenant_id,
    trigger: input.trigger ?? "request",
    input_ids: input.input_ids ?? [],
    capabilities_used: [input.capability],
    tool_provider: "none",
    outputs_summary: null,
    cost_usd: 0,
    errors: [`${reason}: ${detail}`],
  });
  /**
   * GOVERNANCE REFUSALS ARE `capability.denied`; everything else is
   * `agent.run_failed`. Both names are already in the shipped dictionary — this
   * build registers no event name of its own, following the rule A00 set for
   * itself and A01's condition 1 restated: an agent does not mint names.
   */
  const denied =
    reason === "disabled" ||
    reason === "kill_switch" ||
    reason === "not_permitted" ||
    reason === "privacy_refused" ||
    reason === "over_budget";
  await validateAndEmit({
    event_name: denied ? "capability.denied" : "agent.run_failed",
    agent_id: agentId,
    agent_run_id: run.run_id,
    tenant_id: input.tenant_id,
    context: {
      capability: input.capability,
      ai_refusal_reason: reason,
      prompt_id: input.prompt_id,
      ...extraContext,
    },
    versions: { prompt: input.prompt_version },
    status: denied ? "denied" : "error",
    cost_usd: 0,
  });
  return { ok: false, reason, detail, run_id: run.run_id };
}

/**
 * EVERY PRE-NETWORK CHECK, in order. Returns a `Gate` when the call may proceed
 * and a recorded refusal when it may not. Nothing in here touches the network:
 * an owner reading this function can see exactly what has to be true before a
 * single byte leaves the building.
 */
async function gate<T>(
  input: CallModelInput<T>,
  deps: Required<Pick<CallModelDeps, "policyStore" | "spend" | "now">> & {
    policy?: AiPolicy;
    catalogue?: readonly ModelConfig[];
  }
): Promise<{ ok: true; gate: Gate } | { ok: false; failure: CallModelFailure }> {
  const fail = async (
    reason: CallModelFailureReason,
    detail: string,
    context: Record<string, string> = {}
  ) => ({
    ok: false as const,
    failure: await recordRefusal(input as CallModelInput<unknown>, reason, detail, context),
  });

  // 1. Agent Registry — an unknown caller never executes.
  const agent = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === input.agent_id);
  if (!agent) return fail("not_permitted", `unknown agent "${input.agent_id}"`);

  // 2. Kill switch, synchronously, BEFORE any work (A00 §7: a call that starts
  //    before the check completes is a bug, not an edge case).
  const kill = checkKillSwitch(agent.agent_id);
  if (kill.engaged) {
    return fail(
      "kill_switch",
      `kill switch engaged (${kill.scope}): ${kill.reason ?? "no reason recorded"}`
    );
  }

  // 3. Capability resolution + permission, the gateway's own rules.
  const capability = resolveCapability(input.capability);
  if (!capability) return fail("not_permitted", `unknown capability "${input.capability}"`);
  if (capability.status === "FUTURE_DISABLED") {
    return fail("not_permitted", `capability "${capability.capability_key}" is FUTURE_DISABLED`);
  }
  if (
    capability.owning_agent_ids !== undefined &&
    !capability.owning_agent_ids.includes(agent.agent_id)
  ) {
    return fail(
      "not_permitted",
      `agent ${agent.agent_id} does not own capability "${capability.capability_key}"`
    );
  }
  if (
    agent.allowed_capabilities.length > 0 &&
    !agent.allowed_capabilities.includes(input.capability) &&
    !agent.allowed_capabilities.includes(capability.capability_key)
  ) {
    return fail(
      "not_permitted",
      `capability "${input.capability}" is not in ${agent.agent_id}'s allowed list`
    );
  }

  const capabilityKey = capability.capability_key;
  const policy = deps.policy ?? (await deps.policyStore.getActive());

  // 4. Enablement — the master switch and the capability flag, both off by default.
  const capPolicy = capabilityPolicy(policy, capabilityKey);
  if (!capPolicy) {
    return fail("disabled", `no AI policy entry for capability "${capabilityKey}"`);
  }
  if (!policy.enabled) {
    return fail("disabled", "the global AI master switch is off (ai policy `enabled`)");
  }
  if (!capPolicy.enabled) {
    return fail("disabled", `"${capabilityKey}" is disabled in the AI policy`);
  }

  // 5. The model must be in the catalogue, or it is unpriced and therefore unrunnable.
  const model = findModel(capPolicy.model_id, deps.catalogue ?? MODEL_CATALOGUE);
  if (!model) {
    return fail(
      "unknown_model",
      `policy names model "${capPolicy.model_id}", which is not in MODEL_CATALOGUE — an unpriced model is refused, never priced at zero`,
      { model_id: capPolicy.model_id }
    );
  }

  /**
   * 6. THE PRIVACY RULE — and it fires BEFORE the network, deliberately.
   *
   * Free and stealth models are generally free BECAUSE prompts may be retained.
   * A homeowner describing a problem in their own words has not agreed to that,
   * and no header sent alongside the prompt can un-retain it. So the check is on
   * the CONFIGURATION, not on the request: a capability that handles customer
   * data may only run on a model the owners have cleared, and every seeded model
   * ships uncleared.
   *
   * `data_collection: "deny"` is sent as well — the second belt — but it is not
   * what makes this safe.
   */
  if (input.handles_customer_data && !model.allows_customer_data) {
    return fail(
      "privacy_refused",
      `"${capabilityKey}" handles homeowner text, and model "${model.id}" is not cleared for customer data (allows_customer_data: false). Refused before any network call. Clearing a model is an owner decision — see models.ts.`,
      { model_id: model.id }
    );
  }

  // 6b. An image may only go to a model configured to take one. Checked on the
  //     CONFIG, before the network, for the same reason as the privacy rule: a
  //     text-only endpoint given a photo is a billed call that answers nothing.
  const imageCount = input.images?.length ?? 0;
  if (imageCount > 0 && !model.accepts_images) {
    return fail(
      "not_permitted",
      `"${capabilityKey}" attached ${imageCount} image(s), and model "${model.id}" is not configured accepts_images — refused before any network call`,
      { model_id: model.id }
    );
  }

  // 7. Budget — priced BEFORE the call, against a spend record that survives a restart.
  //    Each attached image is priced at IMAGE_TOKEN_ALLOWANCE prompt tokens (~4 chars each).
  const estimate = estimateModelCall(
    model.id,
    input.system.length + input.user.length + imageCount * IMAGE_TOKEN_ALLOWANCE * 4,
    capPolicy.max_output_tokens,
    deps.catalogue ?? MODEL_CATALOGUE
  );
  if (!estimate.known) {
    return fail("over_budget", estimate.basis, { model_id: model.id });
  }
  if (estimate.estimated_usd > capPolicy.max_cost_per_call_usd) {
    return fail(
      "over_budget",
      `worst-case ${TEST_FIGURE_LABEL} $${estimate.estimated_usd} exceeds max_cost_per_call_usd $${capPolicy.max_cost_per_call_usd} — ${estimate.basis}`,
      { model_id: model.id }
    );
  }
  const day = utcDay(deps.now());
  const today = await deps.spend.read(day);
  const capabilitySoFar = today.by_capability[capabilityKey] ?? 0;
  /**
   * EXHAUSTION IS ITS OWN REFUSAL, CHECKED BEFORE THE ADDITIVE ONE.
   *
   * The additive test below asks "would this call push us past the cap". That is
   * the right question for a priced model and the WRONG one at the boundary,
   * because it answers "no" for a call estimated at $0 — and every model this
   * policy currently names is priced $0/$0 (stealth/ox-alpha, models.ts). So a
   * capability whose ledger says the day's cap is already spent could keep
   * calling for ever, each call adding zero and leaving the total exactly at the
   * cap. A cap that only ever compares a sum can be stepped over in increments
   * of nothing.
   *
   * A04 §7 says spend caps are HARD and that exhaustion stops enrichment
   * CLEANLY. Exhausted means spent, not overspent. So once the ledger reaches
   * the cap the next call is refused whatever it is estimated to cost:
   *
   *   - $0 is a PRICE, not a licence. models.ts says in its own header that
   *     these prices are a third party's, read on a date, and change without
   *     notice; treating today's zero as permission to call without limit is
   *     exactly the fail-open spend.ts argues against ("a cap that fails open is
   *     worse than no cap, because it reports a number the owner believes").
   *   - and the post-call re-check bounds an overshoot to ONE call only if the
   *     call AFTER the overshoot is refused. `>` at equality is the hole that
   *     lets a second one through.
   *
   * The eval harness found this: it exhausted a real ledger against the shipped
   * cap and the next call still reached the provider factory (NEVER-A04-3).
   */
  if (capabilitySoFar >= capPolicy.daily_cap_usd) {
    return fail(
      "over_budget",
      `"${capabilityKey}" has spent ${TEST_FIGURE_LABEL} $${capabilitySoFar} today, which exhausts its daily cap of $${capPolicy.daily_cap_usd} — refused before the network whatever this call is estimated to cost`,
      { model_id: model.id, day }
    );
  }
  if (today.total_usd >= policy.global_daily_budget_usd) {
    return fail(
      "over_budget",
      `all capabilities have spent ${TEST_FIGURE_LABEL} $${today.total_usd} today, which exhausts the global daily budget of $${policy.global_daily_budget_usd} — refused before the network whatever this call is estimated to cost`,
      { model_id: model.id, day }
    );
  }
  if (capabilitySoFar + estimate.estimated_usd > capPolicy.daily_cap_usd) {
    return fail(
      "over_budget",
      `"${capabilityKey}" has spent ${TEST_FIGURE_LABEL} $${capabilitySoFar} today; one more call at $${estimate.estimated_usd} would pass its daily cap of $${capPolicy.daily_cap_usd}`,
      { model_id: model.id, day }
    );
  }
  if (today.total_usd + estimate.estimated_usd > policy.global_daily_budget_usd) {
    return fail(
      "over_budget",
      `all capabilities have spent ${TEST_FIGURE_LABEL} $${today.total_usd} today; one more call at $${estimate.estimated_usd} would pass the global daily budget of $${policy.global_daily_budget_usd}`,
      { model_id: model.id, day }
    );
  }

  return {
    ok: true,
    gate: {
      policy,
      model,
      capabilityKey,
      maxOutputTokens: capPolicy.max_output_tokens,
      timeoutMs: policy.request_timeout_ms,
      maxRepairRetries: policy.max_repair_retries,
      estimateUsd: estimate.estimated_usd,
      estimateBasis: estimate.basis,
    },
  };
}

function parseAgainst<T>(
  raw: string,
  schema: z.ZodType<T>
): { ok: true; value: T } | { ok: false; error: string } {
  const body = extractJsonObject(raw);
  if (body === null) {
    return { ok: false, error: "the reply contained no JSON object at all" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    return {
      ok: false,
      error: `the reply was not parseable JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const result = schema.safeParse(parsed);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; "),
  };
}

export async function callModel<T>(input: CallModelInput<T>): Promise<CallModelResult<T>> {
  const deps = input.deps ?? {};
  const providerFactory = deps.provider ?? defaultAiProvider;
  const resolved = {
    policyStore: deps.policyStore ?? aiPolicyStore(),
    spend: deps.spend ?? spendLedger(),
    now: deps.now ?? (() => new Date()),
    policy: deps.policy,
    catalogue: deps.catalogue,
  };

  let gated: Awaited<ReturnType<typeof gate<T>>>;
  try {
    gated = await gate(input, resolved);
  } catch (err) {
    // The gate reads a policy file and a spend file. Neither may take the caller
    // down: an unreadable gate is a refusal, which falls back deterministically.
    return {
      ok: false,
      reason: "disabled",
      detail: `the AI gate could not be evaluated (${err instanceof Error ? err.message : String(err)}) — refusing, which falls back deterministically`,
      run_id: null,
    };
  }
  if (!gated.ok) return gated.failure;
  const { model, capabilityKey, maxOutputTokens, timeoutMs, maxRepairRetries, estimateUsd } =
    gated.gate;

  // A01's three model capabilities share the request allowance. Keeping this
  // at the gateway prevents a missing adapter field or false privacy flag from
  // silently bypassing it. SEO/admin model work retains its existing budget.
  const requestScoped = input.agent_id === "A01" || input.request_id !== undefined;
  const identity = { request_id: input.request_id ?? undefined, tenant_id: input.tenant_id };
  if (requestScoped && !validRequestCallIdentity(identity)) {
    return recordRefusal(input as CallModelInput<unknown>, "not_permitted", "homeowner model work requires a trusted request and tenant identity");
  }
  if (requestScoped && requestCallsRequireSharedStore()) {
    return recordRefusal(input as CallModelInput<unknown>, "disabled", "homeowner model work requires a shared durable request-call store in this runtime; none is installed");
  }
  const requestCalls = deps.requestCalls ?? new FileRequestCallLedger();
  let requestPolicy: ReturnType<typeof requestCallPolicy> | null = null;
  try { if (requestScoped) requestPolicy = requestCallPolicy(); }
  catch { return recordRefusal(input as CallModelInput<unknown>, "disabled", "the versioned request-call policy is unavailable"); }

  // 8. The credential. Checked AFTER governance so a keyless deployment still
  //    reports "disabled" rather than "no_key" when the flags are off — the
  //    reason an owner reads should be the FIRST thing that was wrong.
  let provider: ReturnType<AiProviderFactory>;
  try { provider = providerFactory(); }
  catch { return recordRefusal(input as CallModelInput<unknown>, "no_key", "the model provider could not be initialized", { model_id: model.id }); }
  if (!provider) {
    return recordRefusal(
      input as CallModelInput<unknown>,
      "no_key",
      "no model credential is configured in this deployment",
      { model_id: model.id }
    );
  }

  const baseSystem =
    model.mode === "json_object"
      ? `${input.system}\n${renderSchemaInstructions(input.schema_name, input.json_schema)}`
      : input.system;

  const call = (system: string, user: string): ModelCallInput => ({
    modelId: model.id,
    system,
    user,
    schemaName: input.schema_name,
    jsonSchema: input.json_schema,
    mode: model.mode,
    maxTokens: maxOutputTokens,
    reasoningEnabled: model.reasoning_enabled,
    timeoutMs,
    // Deny is unconditional for customer data and the safe default otherwise:
    // there is no reason PRN would prefer its page copy retained either.
    dataCollection: "deny",
    ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
  });

  // Reserve the existing per-call allowance once (or the remaining daily
  // allowance when smaller). The first completion,
  // transport retries and every repair share it; none gets a second allowance.
  // An accounting-only injected ledger cannot bypass atomic admission.
  if (!resolved.spend.reserve || !resolved.spend.settle) {
    return recordRefusal(input as CallModelInput<unknown>, "disabled", "the spend ledger does not support atomic budget reservations", { model_id: model.id });
  }
  const capPolicy = capabilityPolicy(gated.gate.policy, capabilityKey)!;
  const day = utcDay(resolved.now());
  let reservation: SpendReservation | null;
  try {
    reservation = await resolved.spend.reserve({
      day, capability: capabilityKey, usd: capPolicy.max_cost_per_call_usd,
      global_cap_usd: gated.gate.policy.global_daily_budget_usd,
      capability_cap_usd: capPolicy.daily_cap_usd,
      allow_partial: true,
    });
  } catch {
    return recordRefusal(input as CallModelInput<unknown>, "disabled", "the spend ledger could not reserve the call allowance; no model request was sent", { model_id: model.id });
  }
  if (!reservation) {
    return recordRefusal(input as CallModelInput<unknown>, "over_budget", "recorded spend and pending reservations leave insufficient daily budget for this call allowance", { model_id: model.id, day });
  }
  const activeReservation = reservation;

  let actualSpentUsd = 0;
  let uncertainUsd = 0;
  let attemptedProviderCalls = 0;
  let uncertaintyDetail: string | null = null;
  const roundUp = (usd: number) => Math.max(0, Math.ceil(usd * 1e6 - 1e-9) / 1e6);
  /** Each request gets an explicit HTTP-attempt ceiling backed by the remaining
   * reservation. UTF-8 bytes provide a conservative text-token allowance;
   * include the rendered schema, repair text and image token allowance too. */
  const completeReserved = async (request: ModelCallInput): Promise<ModelCallResult> => {
    const bytes = Buffer.byteLength(request.system, "utf8") + Buffer.byteLength(request.user, "utf8") +
      Buffer.byteLength(JSON.stringify(request.jsonSchema), "utf8") + 256;
    const upper = estimateModelCall(model.id,
      bytes * 4 + (request.images?.length ?? 0) * IMAGE_TOKEN_ALLOWANCE * 4,
      maxOutputTokens, resolved.catalogue ?? MODEL_CATALOGUE);
    const remaining = Math.max(0, activeReservation.usd - actualSpentUsd - uncertainUsd);
    let attemptsAllowed = remaining <= 0 ? 0 : upper.known && upper.estimated_usd === 0 ? MAX_MODEL_HTTP_ATTEMPTS :
      upper.known ? Math.min(MAX_MODEL_HTTP_ATTEMPTS, Math.floor((remaining + 1e-10) / upper.estimated_usd)) : 0;
    if (attemptsAllowed < 1) {
      return { ok: false, reason: "over_budget", detail: "the call or repair would exceed its reserved per-call allowance", provider: provider.id, attempts: 0 };
    }
    if (requestPolicy && validRequestCallIdentity(identity)) {
      // Reserve ONE HTTP attempt, including a repair. Transport retries cannot
      // run invisibly inside the provider: maxAttempts below is one. Admissions
      // are never refunded after provider uncertainty or a process crash.
      try {
        const admitted = await requestCalls.reserve(identity, requestPolicy, capabilityKey);
        if (!admitted) return { ok: false, reason: "over_budget", detail: `request model-call ceiling reached (${requestPolicy.max_calls}, policy v${requestPolicy.version}); use the deterministic result`, provider: provider.id, attempts: 0 };
      } catch {
        return { ok: false, reason: "not_permitted", detail: "the request model-call ledger is unavailable; no model request was sent", provider: provider.id, attempts: 0 };
      }
      attemptsAllowed = 1;
    }
    const exposure = roundUp(upper.estimated_usd * attemptsAllowed);
    let result: ModelCallResult;
    try { result = await provider.complete({ ...request, maxAttempts: attemptsAllowed }); }
    catch {
      result = { ok: false, reason: "http_error", detail: "the model provider failed without a confirmed billing outcome", provider: provider.id, attempts: attemptsAllowed };
    }
    const validAttempts = Number.isInteger(result.attempts) && result.attempts >= 0 && result.attempts <= attemptsAllowed && (!result.ok || result.attempts > 0);
    if (result.attempts > 0 || !validAttempts) attemptedProviderCalls += 1;
    if (!validAttempts) {
      uncertainUsd = roundUp(uncertainUsd + exposure);
      uncertaintyDetail = "the provider did not honor the reserved attempt contract; its allowance remains held";
      return { ok: false, reason: "http_error", detail: uncertaintyDetail, provider: provider.id, attempts: attemptsAllowed };
    }
    if (!result.ok) {
      // Even a timeout/HTTP error may have generated billed tokens. Only an
      // explicit zero-attempt refusal proves this provider call incurred none.
      uncertainUsd = roundUp(uncertainUsd + upper.estimated_usd * result.attempts);
      return result;
    }
    const u = result.usage;
    const usageValid = [u.prompt_tokens, u.completion_tokens, u.total_tokens].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0) &&
      u.prompt_tokens !== null && u.completion_tokens !== null && u.total_tokens !== null &&
      u.total_tokens > 0 && u.prompt_tokens + u.completion_tokens === u.total_tokens;
    const reported = u.reported_cost_usd;
    const derived = usageValid ? actualModelCost(model.id, u.prompt_tokens!, u.completion_tokens!, resolved.catalogue ?? MODEL_CATALOGUE) : null;
    const known = reported !== null ? Number.isFinite(reported) && reported >= 0 : usageValid && derived?.known;
    if (!known) {
      uncertainUsd = roundUp(uncertainUsd + upper.estimated_usd * result.attempts);
      uncertaintyDetail = "the model replied without trustworthy usage or cost; its allowance remains held pending reconciliation";
      return { ok: false, reason: "http_error", detail: uncertaintyDetail, provider: provider.id, attempts: result.attempts };
    }
    actualSpentUsd += reported ?? derived!.estimated_usd;
    // The successful response reports THIS attempt, never earlier transport
    // failures. Keep those amounts held rather than treating the retries as free.
    uncertainUsd = roundUp(uncertainUsd + upper.estimated_usd * Math.max(0, result.attempts - 1));
    return result;
  };

  const started = Date.now();
  let attempt = await completeReserved(call(baseSystem, input.user));
  let usage: ModelUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, reported_cost_usd: null };
  let generationId: string | null = null;
  let repaired = false;
  let value: T | null = null;
  let lastValidationError = "";

  if (attempt.ok) {
    usage = attempt.usage;
    generationId = attempt.generationId;
    const parsed = parseAgainst(attempt.raw, input.schema);
    if (parsed.ok) {
      value = parsed.value;
    } else {
      lastValidationError = parsed.error;
      /**
       * THE ONE REPAIR TURN, and only where it can help. In json_schema mode the
       * API already enforced the shape, so a reply that failed zod means the
       * schema and the validator disagree — a bug in this repo, not a model
       * having a bad day, and re-asking would spend money to prove it twice.
       */
      const repairable = model.mode === "json_object" && maxRepairRetries > 0;
      if (repairable) {
        let previousReply = attempt.raw;
        for (let i = 0; i < maxRepairRetries && value === null; i += 1) {
          /**
           * The repair turn keeps the ORIGINAL TASK and appends the correction.
           * Sending only the error would ask the model to fix a reply to a
           * question it can no longer see — which produces a well-formed answer
           * to nothing.
           */
          const retry = await completeReserved(
            call(
              baseSystem,
              `${input.user}\n\n---\n\n${renderRepairPrompt(previousReply, lastValidationError)}`
            )
          );
          if (!retry.ok) {
            attempt = retry;
            break;
          }
          repaired = true;
          usage = {
            prompt_tokens: addKnownCounter(usage.prompt_tokens, retry.usage.prompt_tokens),
            completion_tokens: addKnownCounter(usage.completion_tokens, retry.usage.completion_tokens),
            total_tokens: addKnownCounter(usage.total_tokens, retry.usage.total_tokens),
            reported_cost_usd:
              usage.reported_cost_usd === null || retry.usage.reported_cost_usd === null
                ? null
                : (usage.reported_cost_usd ?? 0) + (retry.usage.reported_cost_usd ?? 0),
          };
          generationId = retry.generationId ?? generationId;
          previousReply = retry.raw;
          const second = parseAgainst(retry.raw, input.schema);
          if (second.ok) value = second.value;
          else lastValidationError = second.error;
          attempt = retry;
        }
      }
    }
  }

  const latency = Date.now() - started;

  /**
   * COST IS RECORDED WHATEVER HAPPENED. A call that returned tokens and then
   * failed validation still cost money; a budget that only counts successes is a
   * budget an unlucky day walks straight through.
   *
   * The figure is the vendor's own when it reported one, otherwise our estimate
   * from the tokens actually used. Either way the label is TEST, because it is a
   * PRN figure derived from a vendor fact.
   */
  const spentUsd = actualSpentUsd;
  const costBasis = `completed attempts use provider-reported cost or registered token rates (${TEST_FIGURE_LABEL}); ` +
    (uncertainUsd > 0 ? `$${uncertainUsd} remains reserved for attempts with an unknown charge` : "unused allowance released");

  let dayTotal = 0;
  let spendRecordFailure: string | null = null;
  {
    try {
      const after = await resolved.spend.settle(reservation, spentUsd, Math.min(reservation.usd, uncertainUsd), attemptedProviderCalls > 0);
      dayTotal = after.total_usd;
    } catch (error) {
      // The provider already ran. Keep its charge in the run receipt, but do not
      // present an unaccounted model result as successful or crash the intake.
      const code = (error as NodeJS.ErrnoException)?.code;
      const fault = typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : "";
      spendRecordFailure = `the model call completed, but the spend ledger could not record its cost${fault}; the AI result is withheld and the caller must use its deterministic fallback`;
    }
  }

  const agentId = /^A\d{2}$/.test(input.agent_id) ? input.agent_id : "A00";

  if (spendRecordFailure || !attempt.ok || value === null) {
    const reason: CallModelFailureReason = spendRecordFailure ? "disabled" : !attempt.ok
      ? attempt.reason === "no_key"
        ? "no_key"
        : attempt.reason === "rate_limited"
          ? "rate_limited"
          : attempt.reason === "timeout"
            ? "timeout"
            : attempt.reason === "refused"
              ? "refused"
              : attempt.reason === "invalid_json"
                ? "invalid_after_repair"
                : attempt.reason === "over_budget"
                  ? "over_budget"
                  : attempt.reason === "not_permitted"
                  ? // The provider refused before the wire (the vitest guard in
                    // providers/openrouter.ts). Same class as a governance refusal.
                    "not_permitted"
                  : "http_error"
      : "invalid_after_repair";
    const detail = spendRecordFailure ?? (!attempt.ok
      ? attempt.detail
      : `the reply did not satisfy ${input.schema_name}${repaired ? " even after one repair turn" : ""}: ${lastValidationError}`);

    const run = await recordAgentRun({
      agent_id: agentId,
      tenant_id: input.tenant_id,
      trigger: input.trigger ?? "request",
      input_ids: input.input_ids ?? [],
      capabilities_used: [capabilityKey],
      tool_provider: provider.id,
      tool_model_version: model.id,
      outputs_summary: null,
      cost_usd: spentUsd,
      latency_ms: latency,
      errors: [`${reason}: ${detail}`],
    });
    await validateAndEmit({
      event_name: "agent.run_failed",
      agent_id: agentId,
      agent_run_id: run.run_id,
      tenant_id: input.tenant_id,
      context: {
        capability: capabilityKey,
        ai_refusal_reason: reason,
        model_id: model.id,
        prompt_id: input.prompt_id,
        cost_figure_label: TEST_FIGURE_LABEL,
        budget_reservation_id: reservation.id,
        budget_uncertain_usd: String(uncertainUsd),
        ...(generationId ? { generation_id: generationId } : {}),
      },
      versions: { prompt: input.prompt_version, model: model.id },
      status: "error",
      duration_ms: latency,
      cost_usd: spentUsd,
    });
    return { ok: false, reason, detail, run_id: run.run_id };
  }

  /**
   * THE POST-CALL RE-CHECK. The pre-call gate priced the worst case; this is what
   * it actually cost. A call that lands over a cap is NOT un-made — it already
   * happened — but it is recorded at its real cost. Concurrent callers reserve
   * their allowances atomically; provider billing beyond an allowance is still
   * recorded honestly, never hidden by truncating the charge to our estimate.
   */
  const overshot = spentUsd > estimateUsd;

  const run = await recordAgentRun({
    agent_id: agentId,
    tenant_id: input.tenant_id,
    trigger: input.trigger ?? "request",
    input_ids: input.input_ids ?? [],
    capabilities_used: [capabilityKey],
    tool_provider: provider.id,
    tool_model_version: model.id,
    outputs_summary: {
      prompt_id: input.prompt_id,
      prompt_version: input.prompt_version,
      schema: input.schema_name,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      generation_id: generationId,
      repaired,
      cost_basis: costBasis,
      cost_figure_label: TEST_FIGURE_LABEL,
      day_total_usd_after: dayTotal,
      estimate_overshot: overshot,
      budget_reservation_id: reservation.id,
      budget_uncertain_usd: uncertainUsd,
    },
    cost_usd: spentUsd,
    latency_ms: latency,
  });

  await validateAndEmit({
    event_name: "capability.invoked",
    agent_id: agentId,
    agent_run_id: run.run_id,
    tenant_id: input.tenant_id,
    context: {
      capability: capabilityKey,
      model_id: model.id,
      prompt_id: input.prompt_id,
      cost_figure_label: TEST_FIGURE_LABEL,
      ...(generationId ? { generation_id: generationId } : {}),
      ...(repaired ? { repaired: "true" } : {}),
    },
    versions: { prompt: input.prompt_version, model: model.id },
    duration_ms: latency,
    cost_usd: spentUsd,
  });

  return {
    ok: true,
    value,
    model_id: model.id,
    provider: provider.id,
    usage,
    cost_usd: spentUsd,
    cost_basis: costBasis,
    figure_label: TEST_FIGURE_LABEL,
    latency_ms: latency,
    generation_id: generationId,
    run_id: run.run_id,
    repaired,
  };
}

function addKnownCounter(left: number | null, right: number | null): number | null {
  return left !== null && right !== null && Number.isSafeInteger(left + right) ? left + right : null;
}
