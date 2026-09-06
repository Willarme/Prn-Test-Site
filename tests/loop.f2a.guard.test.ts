import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { modelRequest, useLocalRequestBudgetFixtures } from "./helpers/request-budget-fixture";
import { callModel } from "@/platform/ai/callModel";
import { defaultAiProvider, resetAiProviderForTests } from "@/platform/ai/client";
import { AiPolicy, DEFAULT_AI_POLICY } from "@/platform/ai/policy";
import { MemoryAiPolicyStore } from "@/platform/ai/policy-store";
import {
  LIVE_CALLS_DISABLED_DETAIL,
  createOpenRouterProvider,
} from "@/platform/ai/providers/openrouter";
import { MemorySpendLedger } from "@/platform/ai/spend";
import { recentAgentRuns, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { resetKillSwitchForTests } from "@/platform/killswitch";

/**
 * F2a — THE TEST-RUN GUARD.
 *
 * With a model cleared for customer data, every intake the suite starts would
 * otherwise reach OpenRouter with the real key from .env.local. These cases
 * prove the provider refuses before the network under vitest, that the refusal
 * is the ordinary deterministic-fallback path (no spend, a ledger row that says
 * why), and that a stubbed fetch is still allowed through so the provider's
 * own request-shape tests keep working.
 */

useLocalRequestBudgetFixtures();
const SECRET = "sk-or-v1-TESTONLY-guard-000000";

function input() {
  return {
    modelId: "deepseek/deepseek-v4-flash-0731",
    system: "s",
    user: "u",
    schemaName: "S",
    jsonSchema: { type: "object" },
    mode: "json_schema" as const,
    maxTokens: 10,
    timeoutMs: 1_000,
    dataCollection: "deny" as const,
  };
}

const savedKey = process.env.OPENROUTER_API_KEY;
const savedLive = process.env.PRN_AI_LIVE_TESTS;

beforeEach(() => {
  resetAgentRunLedgerForTests();
  resetKillSwitchForTests();
  resetAiProviderForTests();
  delete process.env.PRN_AI_LIVE_TESTS;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;
  if (savedLive === undefined) delete process.env.PRN_AI_LIVE_TESTS;
  else process.env.PRN_AI_LIVE_TESTS = savedLive;
  resetAiProviderForTests();
  vi.restoreAllMocks();
});

describe("the vitest guard", () => {
  it("vitest is what this suite runs under", () => {
    expect(process.env.VITEST).toBeTruthy();
  });

  it("the real provider with the real fetch refuses before any network call", async () => {
    // No stub, no spy: `globalThis.fetch` is the one this module loaded with,
    // which is exactly the state every ordinary intake test runs in.
    const provider = createOpenRouterProvider(SECRET);
    const result = await provider.complete(input());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("not_permitted");
    expect(result.detail).toContain(LIVE_CALLS_DISABLED_DETAIL);
    expect(result.detail).toContain("PRN_AI_LIVE_TESTS=1");
    expect(result.attempts).toBe(0);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("a stubbed fetch is NOT the network — the provider's own wire tests still reach their stub", async () => {
    const original = globalThis.fetch;
    const stub = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    globalThis.fetch = stub as unknown as typeof fetch;
    try {
      const result = await createOpenRouterProvider(SECRET, stub as unknown as typeof fetch).complete(input());
      expect(result.ok).toBe(true);
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("through callModel with the DEFAULT provider and a key in the environment: the deterministic fallback, no spend, a ledger row that says why", async () => {
    process.env.OPENROUTER_API_KEY = SECRET;
    resetAiProviderForTests();
    expect(defaultAiProvider()).not.toBeNull();
    const policy = AiPolicy.parse({
      ...DEFAULT_AI_POLICY,
      enabled: true,
      capabilities: {
        ...DEFAULT_AI_POLICY.capabilities,
        classify_home_problem: { ...DEFAULT_AI_POLICY.capabilities.classify_home_problem, enabled: true },
      },
    });
    const spend = new MemorySpendLedger();
    const result = await callModel({
      ...modelRequest(),
      agent_id: "A01",
      capability: "classify_home_problem",
      handles_customer_data: true,
      prompt_id: "guard.test",
      prompt_version: "1.0.0",
      system: "s",
      user: "the homeowner's words would be here",
      schema_name: "S",
      schema: z.object({ ok: z.boolean() }),
      json_schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      deps: { policyStore: new MemoryAiPolicyStore(policy), policy, spend, now: () => new Date("2026-09-05T12:00:00Z") },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    // The privacy gate PASSED (the model is cleared) — the refusal is the guard's, one step later.
    expect(result.reason).toBe("not_permitted");
    expect(result.detail).toContain(LIVE_CALLS_DISABLED_DETAIL);
    expect((await spend.read("2026-09-05")).calls).toBe(0);
    const run = recentAgentRuns().at(-1)!;
    expect(run.tool_provider).toBe("openrouter");
    expect(run.cost_usd).toBe(0);
    expect(run.errors?.[0]).toContain(LIVE_CALLS_DISABLED_DETAIL);
    expect(JSON.stringify(run)).not.toContain(SECRET);
  });
});
