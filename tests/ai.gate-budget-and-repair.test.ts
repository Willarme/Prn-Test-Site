import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callModel, type CallModelDeps } from "@/platform/ai/callModel";
import { AiPolicy, DEFAULT_AI_POLICY } from "@/platform/ai/policy";
import { MemoryAiPolicyStore } from "@/platform/ai/policy-store";
import { extractJsonObject, renderSchemaInstructions, unfence } from "@/platform/ai/prompt";
import type { ModelCallInput, ModelCallResult, ModelProvider } from "@/platform/ai/provider";
import { createOpenRouterProvider } from "@/platform/ai/providers/openrouter";
import { MemorySpendLedger } from "@/platform/ai/spend";
import {
  engageKillSwitch,
  releaseKillSwitch,
  resetKillSwitchForTests,
} from "@/platform/killswitch";
import { recentAgentRuns, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";

/**
 * AI STEP 2 — THE GATE, THE BUDGET, THE PRIVACY RULE AND THE ONE REPAIR TURN.
 *
 * The fallback contract says: disabled / keyless / killed / over-budget /
 * rate-limited / timed-out / refused / invalid-after-repair all return
 * `{ ok: false }` with a recorded reason, and NEVER throw. Every one of those is
 * exercised here, because a fallback path that is not tested is a fallback path
 * that is not there.
 */

const Reply = z.object({ ok: z.boolean(), note: z.string() });
const REPLY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { ok: { type: "boolean" }, note: { type: "string" } },
  required: ["ok", "note"],
};

function fakeProvider(
  replies: Array<ModelCallResult> | ((input: ModelCallInput, call: number) => ModelCallResult)
): { provider: ModelProvider; calls: ModelCallInput[] } {
  const calls: ModelCallInput[] = [];
  let index = 0;
  const provider: ModelProvider = {
    id: "fake",
    async complete(input) {
      calls.push(input);
      const i = index;
      index += 1;
      if (typeof replies === "function") return replies(input, i);
      return replies[Math.min(i, replies.length - 1)];
    },
  };
  return { provider, calls };
}

function okReply(raw: string, tokens = { prompt: 100, completion: 50 }): ModelCallResult {
  return {
    ok: true,
    raw,
    usage: {
      prompt_tokens: tokens.prompt,
      completion_tokens: tokens.completion,
      total_tokens: tokens.prompt + tokens.completion,
      reported_cost_usd: null,
    },
    generationId: "gen_test",
    provider: "fake",
    attempts: 1,
  };
}

/** A policy with everything ON, so the gate's LATER checks are reachable. */
function enabledPolicy(overrides: Record<string, unknown> = {}): AiPolicy {
  return AiPolicy.parse({
    ...DEFAULT_AI_POLICY,
    enabled: true,
    capabilities: {
      ...DEFAULT_AI_POLICY.capabilities,
      "seo.critique_page": {
        ...DEFAULT_AI_POLICY.capabilities["seo.critique_page"],
        enabled: true,
      },
      classify_home_problem: {
        ...DEFAULT_AI_POLICY.capabilities.classify_home_problem,
        enabled: true,
      },
    },
    ...overrides,
  });
}

function deps(
  provider: ModelProvider | null,
  policy: AiPolicy = enabledPolicy(),
  spend = new MemorySpendLedger()
): CallModelDeps {
  return {
    provider: () => provider,
    policyStore: new MemoryAiPolicyStore(policy),
    policy,
    spend,
    now: () => new Date("2026-08-25T12:00:00Z"),
  };
}

function criticCall(overrides: Record<string, unknown> = {}) {
  return {
    agent_id: "A06",
    capability: "seo.critique_page",
    handles_customer_data: false,
    prompt_id: "test.prompt",
    prompt_version: "1.0.0",
    system: "system",
    user: "user",
    schema_name: "Reply",
    schema: Reply,
    json_schema: REPLY_JSON_SCHEMA,
    input_ids: ["ps_x"],
    ...overrides,
  };
}

beforeEach(() => {
  resetAgentRunLedgerForTests();
  resetKillSwitchForTests();
});
afterEach(() => {
  resetKillSwitchForTests();
  vi.restoreAllMocks();
});

describe("spend-ledger faults remain explicit fallbacks", () => {
  it("refuses before the provider when the known spend cannot be read", async () => {
    const fake = fakeProvider([okReply('{"ok":true,"note":"fixture"}')]);
    const spend = new MemorySpendLedger();
    vi.spyOn(spend, "read").mockRejectedValue(new Error("damaged spend ledger"));
    const result = await callModel({ ...criticCall(), deps: deps(fake.provider, enabledPolicy(), spend) });
    expect(result).toMatchObject({ ok: false, reason: "disabled" });
    expect(fake.calls).toHaveLength(0);
  });

  it("withholds a valid model reply after a failed cost write and records the incurred cost", async () => {
    const fake = fakeProvider([okReply('{"ok":true,"note":"fixture"}')]);
    const spend = new MemorySpendLedger();
    vi.spyOn(spend, "settle").mockRejectedValue(Object.assign(new Error("private internal path"), { code: "ENOSPC" }));
    const result = await callModel({ ...criticCall(), deps: deps(fake.provider, enabledPolicy(), spend) });
    expect(result).toMatchObject({ ok: false, reason: "disabled", detail: expect.stringContaining("spend ledger") });
    expect(result).not.toHaveProperty("value");
    expect(fake.calls).toHaveLength(1);
    if (!result.ok) {
      expect(result.detail).toContain("ENOSPC");
      expect(result.detail).not.toContain("private internal path");
      const run = recentAgentRuns().find(row => row.run_id === result.run_id);
      expect(run?.cost_usd).toBeGreaterThan(0);
      expect(run?.errors?.join(" ")).toContain("spend ledger");
    }
  });
});

describe("the default state is OFF, and off is the first thing reported", () => {
  it("the shipped policy has the master switch and every capability disabled", () => {
    expect(DEFAULT_AI_POLICY.enabled).toBe(false);
    for (const [key, cap] of Object.entries(DEFAULT_AI_POLICY.capabilities)) {
      expect(cap.enabled, key).toBe(false);
    }
  });

  it("a disabled capability never reaches a provider", async () => {
    const { provider, calls } = fakeProvider([okReply('{"ok":true,"note":"hi"}')]);
    const result = await callModel({
      ...criticCall(),
      deps: deps(provider, DEFAULT_AI_POLICY),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("disabled");
    expect(calls).toHaveLength(0);
  });

  it("a keyless deployment with the flags ON reports no_key, not a crash", async () => {
    const result = await callModel({ ...criticCall(), deps: deps(null) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("no_key");
    expect(result.run_id).not.toBeNull();
  });

  it("with the flags OFF, a keyless deployment still says `disabled` — the FIRST thing wrong", async () => {
    const result = await callModel({ ...criticCall(), deps: deps(null, DEFAULT_AI_POLICY) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("disabled");
  });
});

describe("one atomic allowance covers calls, transport retries and repairs", () => {
  it.each([
    { total_tokens: 150 },
    { prompt_tokens: 100, total_tokens: 150 },
    { prompt_tokens: 100, completion_tokens: 50 },
    { prompt_tokens: 0, completion_tokens: 0, total_tokens: 150 },
    { prompt_tokens: 100.5, completion_tokens: 50, total_tokens: 150.5 },
    { prompt_tokens: -1, completion_tokens: 151, total_tokens: 150 },
  ])("the real adapter retains unknown billing for incomplete or inconsistent counters %#", async counters => {
    const transport = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true,"note":"fixture"}' }, finish_reason: "stop" }],
      usage: counters,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = createOpenRouterProvider("fixture-only-not-a-real-key", transport as typeof fetch);
    const ledger = new MemorySpendLedger();
    const settle = vi.spyOn(ledger, "settle");
    const result = await callModel({ ...criticCall(), deps: deps(provider, enabledPolicy(), ledger) });
    expect(result).toMatchObject({ ok: false, reason: "http_error", detail: expect.stringContaining("trustworthy usage or cost") });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(settle.mock.calls[0][1]).toBe(0);
    expect(settle.mock.calls[0][2]).toBeGreaterThan(0);
    expect(await ledger.reserve({ day: "2026-08-26", capability: "seo.critique_page", usd: 0.5, global_cap_usd: 1, capability_cap_usd: 0.5 })).toBeNull();
  });

  it.each([0, 0.002])("explicit finite reported cost %s remains authoritative when token counters are absent", async cost => {
    const transport = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true,"note":"fixture"}' } }], usage: { total_tokens: 150, cost },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = createOpenRouterProvider("fixture-only-not-a-real-key", transport as typeof fetch);
    const ledger = new MemorySpendLedger();
    const settle = vi.spyOn(ledger, "settle");
    const result = await callModel({ ...criticCall(), deps: deps(provider, enabledPolicy(), ledger) });
    expect(result).toMatchObject({ ok: true, cost_usd: cost, usage: { prompt_tokens: null, completion_tokens: null, total_tokens: 150 } });
    expect(settle.mock.calls[0][1]).toBe(cost);
    expect(settle.mock.calls[0][2]).toBe(0);
  });

  it("repair aggregation preserves unknown token counts instead of inventing zeros", async () => {
    const policy = enabledPolicy(); policy.capabilities["seo.critique_page"].model_id = "stealth/ox-alpha";
    let index = 0;
    const transport = vi.fn(async () => {
      index += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content: index === 1 ? '{"wrong":"shape"}' : '{"ok":true,"note":"fixture"}' } }],
        usage: index === 1 ? { total_tokens: 100, cost: 0.001 } : { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.002 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const provider = createOpenRouterProvider("fixture-only-not-a-real-key", transport as typeof fetch);
    const result = await callModel({ ...criticCall(), deps: deps(provider, policy) });
    expect(result).toMatchObject({ ok: true, repaired: true, cost_usd: 0.003,
      usage: { prompt_tokens: null, completion_tokens: null, total_tokens: 250, reported_cost_usd: 0.003 } });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("only three overlapping calls reach the provider when three allowances remain globally", async () => {
    const policy = enabledPolicy();
    policy.capabilities["seo.critique_page"].max_cost_per_call_usd = 0.02;
    const spend = new MemorySpendLedger();
    await spend.record("2026-08-25", "other", 0.94);
    let entered = 0;
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const paused = new Promise<void>(resolve => { release = resolve; });
    const provider: ModelProvider = {
      id: "fixture",
      async complete(input) {
        expect(input.maxAttempts).toBeGreaterThan(0);
        entered += 1;
        if (entered === 3) markStarted();
        await paused;
        const reply = okReply('{"ok":true,"note":"fixture"}');
        if (reply.ok) reply.usage.reported_cost_usd = 0.001;
        return reply;
      },
    };
    const calls = Array.from({ length: 6 }, () => callModel({ ...criticCall(), deps: deps(provider, policy, spend) }));
    await started;
    // Give all refusals time to finish; the admitted calls still hold their
    // allowances because the simulated upstream has not returned.
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(entered).toBe(3);
    release();
    const results = await Promise.all(calls);
    expect(results.filter(r => r.ok)).toHaveLength(3);
    expect(results.filter(r => !r.ok && r.reason === "over_budget")).toHaveLength(3);
    expect(await spend.read("2026-08-25")).toMatchObject({ calls: 4, total_usd: 0.943 });
  });

  it("an accounting-only custom ledger cannot silently bypass admission", async () => {
    const fake = fakeProvider([okReply('{"ok":true,"note":"fixture"}')]);
    const ledger = new MemorySpendLedger();
    const custom = { read: ledger.read.bind(ledger), record: ledger.record.bind(ledger) };
    const result = await callModel({ ...criticCall(), deps: { ...deps(fake.provider), spend: custom } });
    expect(result).toMatchObject({ ok: false, reason: "disabled", detail: expect.stringContaining("atomic budget reservations") });
    expect(fake.calls).toHaveLength(0);
  });

  it("reservation-write failure refuses before any provider call", async () => {
    const fake = fakeProvider([okReply('{"ok":true,"note":"fixture"}')]);
    const ledger = new MemorySpendLedger();
    vi.spyOn(ledger, "reserve").mockRejectedValue(new Error("private ledger path"));
    const result = await callModel({ ...criticCall(), deps: deps(fake.provider, enabledPolicy(), ledger) });
    expect(result).toMatchObject({ ok: false, reason: "disabled" });
    expect(JSON.stringify(result)).not.toContain("private ledger path");
    expect(fake.calls).toHaveLength(0);
  });

  it("a repair cannot acquire a second allowance when the first response used the full per-call cap", async () => {
    const policy = enabledPolicy();
    policy.capabilities["seo.critique_page"].max_cost_per_call_usd = 0.02;
    policy.capabilities["seo.critique_page"].model_id = "stealth/ox-alpha";
    const invalid = okReply('{"wrong":"shape"}');
    if (invalid.ok) invalid.usage.reported_cost_usd = 0.02;
    const fake = fakeProvider([invalid, okReply('{"ok":true,"note":"fixture"}')]);
    const ledger = new MemorySpendLedger();
    const result = await callModel({ ...criticCall(), deps: deps(fake.provider, policy, ledger) });
    expect(result).toMatchObject({ ok: false, reason: "over_budget" });
    expect(fake.calls).toHaveLength(1);
    expect(await ledger.read("2026-08-25")).toMatchObject({ calls: 1, total_usd: 0.02 });
  });

  it("a zero-attempt refusal releases the allowance and is never counted as billed", async () => {
    const fake = fakeProvider([{ ok: false, reason: "not_permitted", detail: "fixture denied before network", provider: "fixture", attempts: 0 }]);
    const ledger = new MemorySpendLedger();
    const settle = vi.spyOn(ledger, "settle");
    expect(await callModel({ ...criticCall(), deps: deps(fake.provider, enabledPolicy(), ledger) })).toMatchObject({ ok: false, reason: "not_permitted" });
    expect(settle).toHaveBeenCalledWith(expect.any(Object), 0, 0, false);
    expect(await ledger.read("2026-08-25")).toMatchObject({ calls: 0, total_usd: 0 });
  });

  it("timeouts keep an uncertain amount held rather than becoming zero-cost retries", async () => {
    const fake = fakeProvider([{ ok: false, reason: "timeout", detail: "fixture timeout", provider: "fixture", attempts: 1 }]);
    const ledger = new MemorySpendLedger();
    const settle = vi.spyOn(ledger, "settle");
    expect(await callModel({ ...criticCall(), deps: deps(fake.provider, enabledPolicy(), ledger) })).toMatchObject({ ok: false, reason: "timeout" });
    const held = settle.mock.calls[0][2];
    expect(held).toBeGreaterThan(0);
    expect(await ledger.reserve({ day: "2026-08-26", capability: "seo.critique_page", usd: 0.5, global_cap_usd: 1, capability_cap_usd: 0.5 })).toBeNull();
  });

  it("a success after an internal retry keeps the earlier attempt's unknown charge held", async () => {
    const reply = okReply('{"ok":true,"note":"fixture"}');
    if (reply.ok) reply.attempts = 2;
    const fake = fakeProvider([reply]);
    const ledger = new MemorySpendLedger();
    const settle = vi.spyOn(ledger, "settle");
    const result = await callModel({ ...criticCall(), deps: deps(fake.provider, enabledPolicy(), ledger) });
    expect(result.ok).toBe(true);
    expect(settle.mock.calls[0][1]).toBeGreaterThan(0);
    expect(settle.mock.calls[0][2]).toBeGreaterThan(0);
    if (result.ok) expect(result.cost_basis).toContain("remains reserved");
  });

  it("a call crossing midnight settles on its admission day, never a freshly reset budget", async () => {
    const ledger = new MemorySpendLedger();
    let instant = new Date("2026-08-25T23:59:59Z");
    const fake = fakeProvider(() => { instant = new Date("2026-08-26T00:00:01Z"); return okReply('{"ok":true,"note":"fixture"}'); });
    const result = await callModel({ ...criticCall(), deps: { ...deps(fake.provider, enabledPolicy(), ledger), now: () => instant } });
    expect(result.ok).toBe(true);
    expect(await ledger.read("2026-08-25")).toMatchObject({ calls: 1 });
    expect(await ledger.read("2026-08-26")).toMatchObject({ calls: 0, total_usd: 0 });
  });
});

describe("the governance ladder is the gateway's, in the gateway's order", () => {
  it("an unknown agent never executes", async () => {
    const { provider, calls } = fakeProvider([okReply("{}")]);
    const result = await callModel({
      ...criticCall({ agent_id: "A99" }),
      deps: deps(provider),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("not_permitted");
    expect(result.detail).toMatch(/unknown agent/);
    expect(calls).toHaveLength(0);
  });

  it("a kill switch on the agent stops the call before any network I/O", async () => {
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A06", by: "test", reason: "pause" });
    const { provider, calls } = fakeProvider([okReply("{}")]);
    const result = await callModel({ ...criticCall(), deps: deps(provider) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("kill_switch");
    expect(calls).toHaveLength(0);
    await releaseKillSwitch({ scope: "AGENT", scope_ref: "A06", by: "test" });
  });

  it("the GLOBAL switch stops every capability at once", async () => {
    await engageKillSwitch({ scope: "GLOBAL", by: "test", reason: "all stop" });
    const { provider, calls } = fakeProvider([okReply("{}")]);
    const result = await callModel({ ...criticCall(), deps: deps(provider) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("kill_switch");
    expect(calls).toHaveLength(0);
    await releaseKillSwitch({ scope: "GLOBAL", by: "test" });
  });

  it("an agent calling a capability it does not own is refused", async () => {
    const { provider, calls } = fakeProvider([okReply("{}")]);
    const result = await callModel({
      ...criticCall({ agent_id: "A05" }),
      deps: deps(provider),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("not_permitted");
    expect(calls).toHaveLength(0);
  });

  it("an unknown capability is refused before anything else happens", async () => {
    const { provider } = fakeProvider([okReply("{}")]);
    const result = await callModel({
      ...criticCall({ capability: "seo.no_such_capability" }),
      deps: deps(provider),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("not_permitted");
  });
});

describe("the privacy rule — enforced on CONFIG, before the wire", () => {
  it("a customer-data capability on an uncleared model is refused with no network call", async () => {
    const { provider, calls } = fakeProvider([okReply('{"ok":true,"note":"x"}')]);
    /**
     * 2026-09-05: the shipped default (deepseek-v4-flash-0731) carries a
     * TEST-environment clearance, so the uncleared model here is named
     * explicitly — the free stealth model, uncleared on the evidence alone.
     * The rule under test is unchanged: config decides, before the wire.
     */
    const uncleared = enabledPolicy({
      capabilities: {
        ...enabledPolicy().capabilities,
        classify_home_problem: {
          ...enabledPolicy().capabilities.classify_home_problem,
          model_id: "stealth/ox-alpha",
        },
      },
    });
    const result = await callModel({
      ...criticCall({
        agent_id: "A01",
        // A01 holds the A00-spec ALIAS in its allowed list, which is the shipped
        // convention the gateway's own tests use. callModel resolves the alias
        // and keys policy off the CANONICAL key, so the policy entry is
        // `classify_home_problem` either way.
        capability: "classify_problem",
        handles_customer_data: true,
      }),
      deps: deps(provider, uncleared),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("privacy_refused");
    expect(result.detail).toMatch(/allows_customer_data: false/);
    expect(calls).toHaveLength(0);
  });

  it("the SAME capability runs once a model is cleared — the rule is the config, not the capability", async () => {
    /**
     * The clearing happens in the test's own catalogue view, not in models.ts:
     * clearing a real model is an owner decision. What this proves is that the
     * refusal above is the PRIVACY rule firing and not the capability being
     * broken.
     */
    const { provider, calls } = fakeProvider([okReply('{"ok":true,"note":"classified"}')]);
    const policy = enabledPolicy();
    const result = await callModel({
      ...criticCall({
        agent_id: "A01",
        capability: "classify_problem",
        handles_customer_data: false, // same call, no customer text in it
      }),
      deps: deps(provider, policy),
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("every call sends data_collection: deny — the second belt", async () => {
    const { provider, calls } = fakeProvider([okReply('{"ok":true,"note":"x"}')]);
    await callModel({ ...criticCall(), deps: deps(provider) });
    expect(calls[0].dataCollection).toBe("deny");
  });
});

describe("the budget is checked before the call and re-checked after it", () => {
  it("a per-call estimate over the cap refuses without calling", async () => {
    const policy = enabledPolicy();
    const tight = AiPolicy.parse({
      ...policy,
      capabilities: {
        ...policy.capabilities,
        "seo.critique_page": {
          ...policy.capabilities["seo.critique_page"],
          model_id: "deepseek/deepseek-v4-flash-0731",
          max_cost_per_call_usd: 0.0000001,
          daily_cap_usd: 0.5,
        },
      },
    });
    const { provider, calls } = fakeProvider([okReply("{}")]);
    const result = await callModel({ ...criticCall(), deps: deps(provider, tight) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("over_budget");
    expect(result.detail).toMatch(/max_cost_per_call_usd/);
    expect(calls).toHaveLength(0);
  });

  it("a model the catalogue does not price is refused — unknown is not free", async () => {
    const policy = enabledPolicy();
    const unpriced = AiPolicy.parse({
      ...policy,
      capabilities: {
        ...policy.capabilities,
        "seo.critique_page": {
          ...policy.capabilities["seo.critique_page"],
          model_id: "someone/unlisted-model",
        },
      },
    });
    const { provider, calls } = fakeProvider([okReply("{}")]);
    const result = await callModel({ ...criticCall(), deps: deps(provider, unpriced) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("unknown_model");
    expect(calls).toHaveLength(0);
  });

  it("the day's spend blocks the next call once a capability cap is reached", async () => {
    const spend = new MemorySpendLedger();
    await spend.record("2026-08-25", "seo.critique_page", 0.4995);
    const policy = enabledPolicy();
    const capped = AiPolicy.parse({
      ...policy,
      capabilities: {
        ...policy.capabilities,
        "seo.critique_page": {
          ...policy.capabilities["seo.critique_page"],
          model_id: "deepseek/deepseek-v4-flash-0731",
          max_cost_per_call_usd: 0.03,
          daily_cap_usd: 0.5,
        },
      },
    });
    const { provider, calls } = fakeProvider([okReply("{}")]);
    const result = await callModel({
      ...criticCall({ system: "x".repeat(50_000) }),
      deps: deps(provider, capped, spend),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("over_budget");
    expect(result.detail).toMatch(/daily cap/);
    expect(calls).toHaveLength(0);
  });

  /**
   * THE EXHAUSTION BOUNDARY, ON THE MODEL THE POLICY ACTUALLY NAMES.
   *
   * Every budget test above swaps in a PRICED model to make the sum cross the
   * cap. That is what hid this (NEVER-A04-3): when the shipped policy named
   * stealth/ox-alpha — priced $0/$0 — the additive test `spent + 0 > cap`
   * answered "no" for ever once the ledger sat exactly on the cap. The
   * expected-outcome harness exhausted a real ledger against the shipped cap
   * and watched the next call sail through to the provider factory.
   *
   * Since 2026-08-27 the default model is `deepseek/deepseek-v4-flash-0731`,
   * which is PAID — so this test now guards the boundary on a priced model,
   * and its `spent == cap` refusal must hold for the same reason it must hold
   * if the owner ever swaps back to a free one: exhaustion means SPENT.
   *
   * A04 §7: spend caps are HARD and exhaustion stops enrichment CLEANLY.
   */
  it("a capability whose cap is exactly exhausted is refused, whatever the model prices", async () => {
    const spend = new MemorySpendLedger();
    const policy = enabledPolicy();
    const cap = policy.capabilities["seo.critique_page"].daily_cap_usd;
    await spend.record("2026-08-25", "seo.critique_page", cap);
    let providerConstructions = 0;
    const result = await callModel({
      ...criticCall(),
      deps: {
        policy,
        policyStore: new MemoryAiPolicyStore(policy),
        spend,
        now: () => new Date("2026-08-25T12:00:00Z"),
        provider: () => {
          providerConstructions += 1;
          return null;
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("over_budget");
    expect(result.detail).toMatch(/daily cap/);
    // The brake is BEFORE the network: the provider factory is never reached,
    // so the refusal cannot be mistaken for "there was no key anyway".
    expect(providerConstructions).toBe(0);
    // …and the shipped model really is the owner's chosen default, or this
    // proves nothing about the shipped configuration.
    expect(policy.capabilities["seo.critique_page"].model_id).toBe("deepseek/deepseek-v4-flash-0731");
  });

  it("an exhausted GLOBAL budget refuses a capability that has spent nothing itself", async () => {
    const spend = new MemorySpendLedger();
    const policy = enabledPolicy();
    await spend.record("2026-08-25", "generate_page_copy", policy.global_daily_budget_usd);
    const { provider, calls } = fakeProvider([okReply('{"ok":true,"note":"x"}')]);
    const result = await callModel({ ...criticCall(), deps: deps(provider, policy, spend) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("over_budget");
    expect(result.detail).toMatch(/global daily budget/);
    expect(calls).toHaveLength(0);
  });

  it("one cent under the cap still runs — the brake is exhaustion, not caution", async () => {
    const spend = new MemorySpendLedger();
    const policy = enabledPolicy();
    const cap = policy.capabilities["seo.critique_page"].daily_cap_usd;
    await spend.record("2026-08-25", "seo.critique_page", cap - 0.01);
    const { provider, calls } = fakeProvider([okReply('{"ok":true,"note":"x"}')]);
    const result = await callModel({ ...criticCall(), deps: deps(provider, policy, spend) });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("the GLOBAL budget stops a capability that is still inside its own cap", async () => {
    const spend = new MemorySpendLedger();
    await spend.record("2026-08-25", "generate_page_copy", 0.999999);
    const policy = enabledPolicy();
    const capped = AiPolicy.parse({
      ...policy,
      global_daily_budget_usd: 1,
      capabilities: {
        ...policy.capabilities,
        "seo.critique_page": {
          ...policy.capabilities["seo.critique_page"],
          model_id: "deepseek/deepseek-v4-flash-0731",
          max_cost_per_call_usd: 0.03,
          daily_cap_usd: 0.5,
        },
      },
    });
    const { provider } = fakeProvider([okReply("{}")]);
    const result = await callModel({
      ...criticCall({ system: "x".repeat(20_000) }),
      deps: deps(provider, capped, spend),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("over_budget");
    expect(result.detail).toMatch(/global daily budget/);
  });

  it("a call that FAILED validation still spends, and still counts against the day", async () => {
    const spend = new MemorySpendLedger();
    const policy = enabledPolicy();
    const paid = AiPolicy.parse({
      ...policy,
      capabilities: {
        ...policy.capabilities,
        "seo.critique_page": {
          ...policy.capabilities["seo.critique_page"],
          model_id: "deepseek/deepseek-v4-flash-0731",
          max_cost_per_call_usd: 0.03,
          daily_cap_usd: 0.5,
        },
      },
    });
    const { provider } = fakeProvider([okReply("not json at all", { prompt: 5_000, completion: 500 })]);
    const result = await callModel({ ...criticCall(), deps: deps(provider, paid, spend) });
    expect(result.ok).toBe(false);
    const today = await spend.read("2026-08-25");
    expect(today.calls).toBe(1);
    expect(today.total_usd).toBeGreaterThan(0);
    expect(today.figure_label).toBe("TEST");
  });

  it("a spend record survives a fresh ledger read — the counter is not in the call", async () => {
    const spend = new MemorySpendLedger();
    const { provider } = fakeProvider([okReply('{"ok":true,"note":"x"}')]);
    await callModel({ ...criticCall(), deps: deps(provider, enabledPolicy(), spend) });
    const reread = await spend.read("2026-08-25");
    expect(reread.calls).toBe(1);
    expect(reread.by_capability["seo.critique_page"]).toBeDefined();
  });
});

describe("json_object mode: schema in the prompt, one repair, then fall back", () => {
  /**
   * These tests exercise json_object-MODE BEHAVIOUR (schema rendered into the
   * prompt, one repair turn), so they pin `stealth/ox-alpha` explicitly. They
   * cannot lean on the default policy any more: since 2026-08-27 the owner's
   * default model is `deepseek/deepseek-v4-flash-0731`, a json_schema model the
   * API enforces server-side — the separate test below proves it is NOT repaired.
   */
  const jsonObjectPolicy = () =>
    AiPolicy.parse({
      ...enabledPolicy(),
      capabilities: {
        ...enabledPolicy().capabilities,
        "seo.critique_page": {
          ...enabledPolicy().capabilities["seo.critique_page"],
          model_id: "stealth/ox-alpha",
        },
      },
    });

  it("renders the schema into the system prompt for a json_object model", async () => {
    const { provider, calls } = fakeProvider([okReply('{"ok":true,"note":"x"}')]);
    await callModel({ ...criticCall(), deps: deps(provider, jsonObjectPolicy()) });
    expect(calls[0].mode).toBe("json_object");
    expect(calls[0].system).toContain("OUTPUT CONTRACT");
    expect(calls[0].system).toContain('"note"');
  });

  it("a fenced reply is still accepted — the fence is a formatting habit, not a failure", async () => {
    const { provider } = fakeProvider([okReply('```json\n{"ok":true,"note":"fenced"}\n```')]);
    const result = await callModel({ ...criticCall(), deps: deps(provider) });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.note).toBe("fenced");
    expect(result.repaired).toBe(false);
  });

  it("a schema-violating reply gets exactly ONE repair turn, carrying the validation error", async () => {
    const { provider, calls } = fakeProvider([
      okReply('{"ok":"yes"}'),
      okReply('{"ok":true,"note":"fixed"}'),
    ]);
    const result = await callModel({ ...criticCall(), deps: deps(provider, jsonObjectPolicy()) });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.repaired).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].user).toMatch(/WHY IT WAS REJECTED/);
    expect(calls[1].user).toMatch(/note/);
    // The original task travels with the repair — a correction to a question the
    // model can no longer see is a well-formed answer to nothing.
    expect(calls[1].user).toContain("user");
  });

  it("a reply that is still invalid after the repair is `invalid_after_repair`, never a guess", async () => {
    const { provider, calls } = fakeProvider([okReply('{"nope":1}'), okReply("still wrong")]);
    const result = await callModel({ ...criticCall(), deps: deps(provider, jsonObjectPolicy()) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("invalid_after_repair");
    expect(calls).toHaveLength(2);
  });

  it("max_repair_retries: 0 means no repair at all", async () => {
    const policy = AiPolicy.parse({ ...enabledPolicy(), max_repair_retries: 0 });
    const { provider, calls } = fakeProvider([okReply('{"nope":1}'), okReply('{"ok":true,"note":"x"}')]);
    const result = await callModel({ ...criticCall(), deps: deps(provider, policy) });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("a json_schema model is NOT repaired — the API already enforced the shape", async () => {
    const policy = enabledPolicy();
    const strict = AiPolicy.parse({
      ...policy,
      capabilities: {
        ...policy.capabilities,
        "seo.critique_page": {
          ...policy.capabilities["seo.critique_page"],
          model_id: "z-ai/glm-5.2:free",
        },
      },
    });
    const { provider, calls } = fakeProvider([okReply('{"nope":1}'), okReply('{"ok":true,"note":"x"}')]);
    const result = await callModel({ ...criticCall(), deps: deps(provider, strict) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("invalid_after_repair");
    expect(calls).toHaveLength(1);
    expect(calls[0].mode).toBe("json_schema");
    // No schema block in the system prompt: the API carries it.
    expect(calls[0].system).not.toContain("OUTPUT CONTRACT");
  });
});

describe("every provider failure becomes a typed reason, and none of them throws", () => {
  const cases: Array<[ModelCallResult["ok"] extends true ? never : string, string]> = [
    ["rate_limited", "rate_limited"],
    ["timeout", "timeout"],
    ["refused", "refused"],
    ["http_error", "http_error"],
  ];

  for (const [providerReason, expected] of cases) {
    it(`provider "${providerReason}" -> callModel "${expected}"`, async () => {
      const { provider } = fakeProvider([
        {
          ok: false,
          reason: providerReason as never,
          detail: "simulated",
          provider: "fake",
          attempts: 3,
        },
      ]);
      const result = await callModel({ ...criticCall(), deps: deps(provider) });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe(expected);
      expect(result.run_id).not.toBeNull();
    });
  }

  it("a provider that THROWS anyway does not take the caller down", async () => {
    const exploding: ModelProvider = {
      id: "boom",
      complete: async () => {
        throw new Error("unexpected");
      },
    };
    await expect(
      callModel({ ...criticCall(), deps: deps(exploding) })
    ).resolves.toMatchObject({ ok: false, reason: "http_error", detail: expect.stringContaining("confirmed billing outcome") });
    // Unknown billing remains reserved even when an adapter violates its
    // non-throwing contract; the caller can still use its fallback.
  });
});

describe("one ledger row per call, carrying what an owner needs", () => {
  it("a successful call writes exactly one row with provider, model, prompt and cost", async () => {
    const { provider } = fakeProvider([okReply('{"ok":true,"note":"x"}')]);
    const result = await callModel({ ...criticCall(), deps: deps(provider) });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const runs = recentAgentRuns().filter((r) => r.run_id === result.run_id);
    expect(runs).toHaveLength(1);
    const row = runs[0];
    expect(row.agent_id).toBe("A06");
    expect(row.tool_provider).toBe("fake");
    expect(row.tool_model_version).toBe("deepseek/deepseek-v4-flash-0731");
    expect(row.capabilities_used).toEqual(["seo.critique_page"]);
    expect(row.latency_ms).toBeGreaterThanOrEqual(0);
    const summary = row.outputs_summary as Record<string, unknown>;
    expect(summary.prompt_version).toBe("1.0.0");
    expect(summary.prompt_id).toBe("test.prompt");
    expect(summary.generation_id).toBe("gen_test");
    expect(summary.cost_figure_label).toBe("TEST");
  });

  it("a refusal writes a row too — a call that did not happen is still a fact", async () => {
    await callModel({ ...criticCall(), deps: deps(null, DEFAULT_AI_POLICY) });
    const runs = recentAgentRuns();
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[runs.length - 1].errors?.[0]).toMatch(/^disabled:/);
  });

  it("no ledger row, event context or result carries the prompt text or a key", async () => {
    const { provider } = fakeProvider([okReply('{"ok":true,"note":"x"}')]);
    const secret = "sk-or-v1-NEVER-LOG-THIS";
    const result = await callModel({
      ...criticCall({ system: `rules ${secret}`, user: "homeowner said something private" }),
      deps: deps(provider),
    });
    const serialized = JSON.stringify([result, recentAgentRuns()]);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("homeowner said something private");
  });
});

describe("the prompt helpers do the narrow thing they claim", () => {
  it("unfence strips a json fence and leaves plain JSON alone", () => {
    expect(unfence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(unfence('{"a":1}')).toBe('{"a":1}');
  });

  it("extractJsonObject finds a balanced object inside prose, braces in strings and all", () => {
    expect(extractJsonObject('Here you go: {"a":"}{"} — done')).toBe('{"a":"}{"}');
    expect(extractJsonObject("no object here")).toBeNull();
  });

  it("the rendered instructions carry the schema and no domain vocabulary", () => {
    const rendered = renderSchemaInstructions("Reply", REPLY_JSON_SCHEMA);
    expect(rendered).toContain('"note"');
    expect(rendered).toMatch(/No markdown code fence/);
  });
});

describe("the port and the gate carry no client vocabulary", () => {
  it("nothing under src/platform/ai names a market, brand or trade", () => {
    const files = [
      "provider.ts",
      "client.ts",
      "models.ts",
      "policy.ts",
      "policy-store.ts",
      "prompt.ts",
      "spend.ts",
      "callModel.ts",
      "providers/openrouter.ts",
    ];
    const FORBIDDEN = [
      /\bhvac\b/i,
      /\bplumb/i,
      /\belectrician\b/i,
      /\broofing\b/i,
      /\bhomeowner'?s? (name|address|phone)\b/i,
      /\bAllen County\b/i,
      /\bBlack Car\b/i,
      /\bJob Packet\b/i,
      /\bTrust Network\b/i,
    ];
    for (const file of files) {
      const content = readFileSync(join(process.cwd(), "src/platform/ai", file), "utf-8");
      for (const pattern of FORBIDDEN) {
        expect(content, `${file} names ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
