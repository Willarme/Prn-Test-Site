import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callModel, type CallModelDeps, type CallModelInput } from "@/platform/ai/callModel";
import { FileRequestCallLedger, requestCallPolicy } from "@/platform/ai/request-calls";
import { DEFAULT_AI_POLICY, AiPolicy } from "@/platform/ai/policy";
import { MODEL_CATALOGUE } from "@/platform/ai/models";
import { MemorySpendLedger } from "@/platform/ai/spend";
import type { ModelCallInput, ModelCallResult, ModelProvider } from "@/platform/ai/provider";
import { createOpenRouterProvider } from "@/platform/ai/providers/openrouter";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";

let root: string;
const schema = z.object({ value: z.string() });
const identity = { request_id: "rq_synthetic_gateway", tenant_id: "tenant_synthetic" };
const good = (raw = '{"value":"synthetic"}'): ModelCallResult => ({
  ok: true, raw, provider: "fixture", attempts: 1, generationId: "synthetic_generation",
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, reported_cost_usd: 0.000001 },
});

function fixture(reply: (input: ModelCallInput, index: number) => ModelCallResult = () => good()) {
  const calls: ModelCallInput[] = [];
  const provider: ModelProvider = { id: "fixture", async complete(input) { calls.push(input); return reply(input, calls.length); } };
  const spend = new MemorySpendLedger();
  const deps: CallModelDeps = {
    provider: () => provider,
    requestCalls: new FileRequestCallLedger(join(root, "calls")),
    spend,
    now: () => new Date("2026-09-06T12:00:00Z"),
    catalogue: MODEL_CATALOGUE.map(model => ({ ...model, allows_customer_data: true, mode: "json_object" as const })),
    policy: AiPolicy.parse({ ...DEFAULT_AI_POLICY, enabled: true,
      capabilities: Object.fromEntries(Object.entries(DEFAULT_AI_POLICY.capabilities).map(([key, value]) => [key, { ...value, enabled: true }])),
    }),
  };
  return { calls, provider, spend, deps };
}

function input(deps: CallModelDeps, overrides: Partial<CallModelInput<z.infer<typeof schema>>> = {}): CallModelInput<z.infer<typeof schema>> {
  return { ...identity, agent_id: "A01", capability: "classify_home_problem", handles_customer_data: true,
    prompt_id: "fixture", prompt_version: "1", system: "synthetic", user: "synthetic", schema_name: "Fixture", schema,
    json_schema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] }, deps, ...overrides };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "request-call-gateway-test-"));
  vi.stubEnv("PRN_DEV_DB_PATH", join(root, "db.json"));
  vi.stubEnv("PRN_RUNTIME_STORE", "file");
  resetKillSwitchForTests(); resetAgentRunLedgerForTests();
});
afterEach(() => { resetKillSwitchForTests(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

describe("T1-14 request ceiling at the real governed model boundary", () => {
  it("combines different capabilities, caps actual provider attempts and emits zero network work past the ceiling", async () => {
    const f = fixture();
    expect((await callModel(input(f.deps))).ok).toBe(true);
    expect((await callModel(input(f.deps, { capability: "read_equipment_label" }))).ok).toBe(true);
    const third = await callModel(input(f.deps, { capability: "select_next_clarifier" }));
    expect(third).toMatchObject({ ok: false, reason: "over_budget", detail: expect.stringContaining("policy v1") });
    expect(f.calls).toHaveLength(requestCallPolicy().max_calls);
    expect(f.calls.every(call => call.maxAttempts === 1)).toBe(true);
    expect((await f.spend.read("2026-09-06")).calls).toBe(2);
  });

  it("admits exactly two concurrent model calls for a request", async () => {
    const f = fixture();
    const results = await Promise.all(Array.from({ length: 12 }, () => callModel(input(f.deps))));
    expect(results.filter(result => result.ok)).toHaveLength(2);
    expect(f.calls).toHaveLength(2);
  });

  it("a repair consumes the second attempt and blocks the next capability", async () => {
    const f = fixture((_request, index) => good(index === 1 ? "{}" : undefined));
    expect(await callModel(input(f.deps))).toMatchObject({ ok: true, repaired: true });
    expect(f.calls).toHaveLength(2);
    expect(await callModel(input(f.deps, { capability: "read_equipment_label" }))).toMatchObject({ ok: false, reason: "over_budget" });
    expect(f.calls).toHaveLength(2);
  });

  it("refuses a repair once another capability already consumed the first slot", async () => {
    const f = fixture((_request, index) => good(index === 2 ? "{}" : undefined));
    await callModel(input(f.deps, { capability: "read_equipment_label" }));
    expect(await callModel(input(f.deps))).toMatchObject({ ok: false, reason: "over_budget" });
    expect(f.calls).toHaveLength(2);
  });

  it.each([429, 503])("the real OpenRouter adapter cannot hide transport retries after HTTP %i", async status => {
    const f = fixture();
    let attempts = 0;
    f.deps.provider = () => createOpenRouterProvider("synthetic-test-key", async () => {
      attempts++; return new Response("synthetic unavailable", { status });
    });
    await callModel(input(f.deps));
    expect(attempts).toBe(1);
    await callModel(input(f.deps));
    expect(attempts).toBe(2);
    expect(await callModel(input(f.deps))).toMatchObject({ ok: false, reason: "over_budget" });
    expect(attempts).toBe(2);
  });

  it("provider exceptions and uncertain attempts retain their request allowance", async () => {
    const f = fixture(() => { throw new Error("synthetic provider uncertainty"); });
    await callModel(input(f.deps)); await callModel(input(f.deps));
    expect(await callModel(input(f.deps))).toMatchObject({ ok: false, reason: "over_budget" });
    expect(f.calls).toHaveLength(2);
  });

  it("a zero-attempt provider refusal conservatively consumes its admission", async () => {
    const f = fixture(() => ({ ok: false, reason: "not_permitted", detail: "synthetic pre-wire refusal", attempts: 0, provider: "fixture" }));
    await callModel(input(f.deps)); await callModel(input(f.deps));
    expect(await callModel(input(f.deps))).toMatchObject({ ok: false, reason: "over_budget" });
    expect(f.calls).toHaveLength(2);
    expect((await f.spend.read("2026-09-06")).calls).toBe(0);
  });

  it.each([{ request_id: undefined }, { tenant_id: undefined }, { request_id: "../invalid" }])("missing or malformed identity cannot bypass the ceiling: %j", async missing => {
    const f = fixture();
    expect(await callModel(input(f.deps, missing))).toMatchObject({ ok: false, reason: "not_permitted" });
    expect(f.calls).toHaveLength(0);
  });

  it("an unavailable ledger fails closed without leaking the storage error or consuming dollars", async () => {
    const f = fixture();
    f.deps.requestCalls = { async reserve() { throw new Error("private storage path and details"); } };
    const result = await callModel(input(f.deps));
    expect(result).toMatchObject({ ok: false, reason: "not_permitted", detail: expect.stringContaining("ledger is unavailable") });
    expect(JSON.stringify(result)).not.toContain("private storage");
    expect(f.calls).toHaveLength(0);
    expect(await f.spend.read("2026-09-06")).toMatchObject({ calls: 0, total_usd: 0 });
  });

  it("disabled, keyless and existing daily-budget refusals do not consume request admissions", async () => {
    const f = fixture();
    const provider = f.deps.provider;
    f.deps.provider = () => null;
    expect(await callModel(input(f.deps))).toMatchObject({ ok: false, reason: "no_key" });
    f.deps.provider = provider;
    f.deps.policy = { ...f.deps.policy!, enabled: false };
    expect(await callModel(input(f.deps))).toMatchObject({ ok: false, reason: "disabled" });
    f.deps.policy.enabled = true;
    f.deps.policy.global_daily_budget_usd = 0;
    expect(await callModel(input(f.deps))).toMatchObject({ ok: false, reason: "over_budget" });
    f.deps.policy.global_daily_budget_usd = 1;
    expect((await callModel(input(f.deps))).ok).toBe(true);
    expect((await callModel(input(f.deps))).ok).toBe(true);
    expect(f.calls).toHaveLength(2);
  });

  it("the default adapter is active and uses the isolated durable runtime directory", async () => {
    const f = fixture();
    delete f.deps.requestCalls;
    await callModel(input(f.deps)); await callModel(input(f.deps));
    expect(await callModel(input(f.deps))).toMatchObject({ ok: false, reason: "over_budget" });
    expect(readdirSync(join(root, "request-ai-calls")).filter(name => name.endsWith(".json"))).toHaveLength(1);
  });

  it("serverless homeowner calls stay off even with an injected local counter; SEO keeps its existing lane", async () => {
    const f = fixture();
    vi.stubEnv("VERCEL", "1");
    expect(await callModel(input(f.deps))).toMatchObject({ ok: false, reason: "disabled", detail: expect.stringContaining("shared durable") });
    expect(f.calls).toHaveLength(0);
    for (let i = 0; i < 3; i++) expect((await callModel(input(f.deps, {
      request_id: undefined, agent_id: "A06", capability: "seo.critique_page", handles_customer_data: false,
    }))).ok).toBe(true);
    expect(f.calls).toHaveLength(3);
  });

  it.each(["", "supabase"])("a %j runtime cannot silently choose local admission even without VERCEL", async mode => {
    const f = fixture();
    vi.stubEnv("PRN_RUNTIME_STORE", mode);
    expect(await callModel(input(f.deps))).toMatchObject({ ok: false, reason: "disabled", detail: expect.stringContaining("shared durable") });
    expect(f.calls).toHaveLength(0);
  });
});
