import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { AiPolicy, DEFAULT_AI_POLICY } from "@/platform/ai/policy";
import { MODEL_CATALOGUE } from "@/platform/ai/models";
import * as gateway from "@/platform/ai/callModel";
import { FileRequestCallLedger } from "@/platform/ai/request-calls";
import type { ModelCallInput, ModelCallResult, ModelProvider } from "@/platform/ai/provider";
import { MemoryAiPolicyStore, setAiPolicyStoreForTests } from "@/platform/ai/policy-store";
import { MemorySpendLedger, setSpendLedgerForTests } from "@/platform/ai/spend";
import { resetRuntimeStore, runtimeStore } from "@/platform/stores/runtime";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { POST as startPost } from "@/app/api/intake/route";

// Independent semantic counterexamples. Production routes, classifier and
// request ledger run unchanged; only provider/config dependencies are injected.
const realCallModel = gateway.callModel;
const network = vi.fn(() => { throw new Error("Independent review forbids network"); });
let root: string, calls: ModelCallInput[], category: "appliance" | "plumbing" | "hvac" | null;
let gatewayResults: Array<{ request_id?: string | null; tenant_id?: string; ok: boolean }>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "static-first-counterexample-")); calls = []; gatewayResults = []; category = null;
  vi.stubEnv("PRN_RUNTIME_STORE", "file"); vi.stubEnv("PRN_DEV_DB_PATH", join(root, "db.json"));
  vi.stubEnv("VITEST", "1"); vi.stubEnv("PRN_AI_LIVE_TESTS", "0"); vi.stubGlobal("fetch", network);
  resetRuntimeStore(); resetKillSwitchForTests(); resetAgentRunLedgerForTests();
  setAiPolicyStoreForTests(new MemoryAiPolicyStore()); setSpendLedgerForTests(new MemorySpendLedger());
  const provider: ModelProvider = { id: "independent-synthetic", async complete(input): Promise<ModelCallResult> {
    calls.push(input);
    return { ok: true, raw: JSON.stringify({ service_category: category, service_category_confidence: "high",
      intent_cluster: "Independent synthetic alternative", facts: [], reason: "Synthetic dependency; no actual model was called" }),
      provider: "independent-synthetic", attempts: 1, generationId: "independent-fixture",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, reported_cost_usd: 0.000001 } };
  } };
  const deps: gateway.CallModelDeps = { provider: () => provider, spend: new MemorySpendLedger(), requestCalls: new FileRequestCallLedger(),
    catalogue: MODEL_CATALOGUE.map(m => ({ ...m, allows_customer_data: true })),
    policy: AiPolicy.parse({ ...DEFAULT_AI_POLICY, enabled: true, capabilities: { ...DEFAULT_AI_POLICY.capabilities,
      classify_home_problem: { ...DEFAULT_AI_POLICY.capabilities.classify_home_problem, enabled: true } } }) };
  vi.spyOn(gateway, "callModel").mockImplementation(async <T>(input: gateway.CallModelInput<T>) => {
    const result = await realCallModel({ ...input, deps });
    gatewayResults.push({ request_id: input.request_id, tenant_id: input.tenant_id, ok: result.ok }); return result;
  });
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled(); vi.restoreAllMocks(); resetRuntimeStore(); resetKillSwitchForTests(); resetAgentRunLedgerForTests();
  setAiPolicyStoreForTests(null); setSpendLedgerForTests(null); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});
async function start(description: string, hint: string | null = "hvac-cooling") {
  const response = await startPost(new Request("http://localhost/api/intake", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ description, request_id: "rq_untrusted", tenant_id: "tenant_untrusted", disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: { landing_path: "/start", problem_family_hint: hint, page_id: null, intent_cluster_id: null,
        search_opportunity_id: null, experiment_id: null, variant: null, referrer: null } }) }));
  const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200);
  const journey = (await runtimeStore().getJourney(body.request_id))!;
  const derivations = await runtimeStore().listDerivations(journey.problem.problem_id);
  if (process.env.REVIEW_OBSERVATIONS_PATH) appendFileSync(process.env.REVIEW_OBSERVATIONS_PATH, JSON.stringify({ description, hint,
    model_calls: calls.length, gateway_calls: gatewayResults.length, stored_category: journey.problem.service_category, playbook_id: journey.session.playbook_id,
    confidence: journey.problem.service_category_confidence, derivation_methods: derivations.map(d => d.method),
    trusted_identity: gatewayResults.every(r => r.request_id === body.request_id && r.tenant_id === "prn"),
    observed_verbatim: journey.packet.observed_statements.includes(description) }) + "\n");
  return { id: body.request_id as string, journey, derivations };
}

describe("independent static-first ambiguity and current-complaint boundary", () => {
  it.each([
    ["healthy AC mentioned beside failing freezer", "My AC is working normally. My freezer is not cooling.", "appliance"],
    ["negated AC complaint beside failing freezer", "This is not an AC cooling problem. My freezer is warm.", "appliance"],
    ["repaired historical AC complaint", "Last summer my AC was not cooling, but it was repaired. Today my freezer is warm.", "appliance"],
    ["mixed AC and unlisted cooler equipment", "My AC and my wine cooler are both not cooling.", "appliance"],
    ["quoted example rather than current equipment", "I saw an AC ad about not cooling. I cannot tell what is making this noise.", null],
    ["hypothetical AC cause", "If the AC stops cooling, would that explain why my freezer is warm?", "appliance"],
    ["negated plumbing problem with unlisted current problem", "The faucet is not leaking. My garage door will not close.", null],
    ["repaired historical electrical problem", "The outlet was dead last week, but it is fixed. My garage door will not open today.", null],
    ["healthy AC and negated cooling symptom", "The AC is not blowing warm air. It is working normally.", null],
    ["two configured families", "My AC is not cooling and the kitchen faucet leaks.", null],
    ["door-only cooling hint", "The air is not cooling properly.", "hvac"],
  ] as const)("retains guarded alternate for %s", async (_label, description, expectedCategory) => {
    category = expectedCategory;
    const { id, journey } = await start(description);
    expect(calls.map(c => c.schemaName)).toEqual(["A01Classification"]);
    expect(gatewayResults).toEqual([{ request_id: id, tenant_id: "prn", ok: true }]);
    expect(journey.problem.service_category).toBe(expectedCategory);
    expect(calls[0].maxAttempts).toBe(1);
  });

  it.each(["roofing", null])("clear current AC text stays governed, medium and verbatim despite door %s", async hint => {
    const description = "My AC stopped cooling this morning";
    const { journey, derivations } = await start(description, hint);
    expect(calls).toHaveLength(0);
    expect(journey.problem).toMatchObject({ service_category: "hvac", service_category_confidence: "medium", tenant_id: "prn" });
    expect(derivations[0].method).toBe("deterministic");
    expect(journey.packet.observed_statements).toContain(description);
    expect((await runtimeStore().listClaims(journey.problem.problem_id)).find(c => c.predicate === "likely_service_category"))
      .toMatchObject({ claim_class: "INFERRED", confidence: "medium" });
  });
});


describe("repaired rule independent adversarial and direct-positive boundaries", () => {
  it.each([
    ["tail correction", "My AC is not cooling, actually it is working fine."],
    ["tail negation", "My AC is not cooling — not!"],
    ["tail cured history", "My AC stopped cooling yesterday but it works now."],
    ["tail qualified history", "My AC is not cooling was last year's complaint."],
    ["tail resolved next sentence", "My AC stopped cooling. That was fixed last week."],
    ["tail joke", "My AC is not cooling. Just kidding."],
    ["past-tense complaint", "My AC was not cooling yesterday."],
    ["explicit last-year past", "My AC stopped cooling last year."],
    ["old complaint prefix", "Previously my AC stopped cooling this morning."],
    ["direct question", "My AC is not cooling?"],
    ["cause question", "My AC is not cooling because the thermostat is off?"],
    ["quoted current words", "The manual says 'AC is not cooling'."],
    ["enclosed quote", "\"My AC is not cooling\""],
    ["conditional prefix", "If my AC is not cooling, should I call?"],
    ["future condition", "My AC will not cool if I switch it off."],
    ["unrecognized brand", "My MysteryBrand AC is not cooling."],
    ["extra healthy equipment sentence", "My AC is not cooling. My refrigerator works fine."],
    ["extra same-family complaint", "My AC is not cooling. My furnace will not start."],
    ["extra unlisted-family complaint", "My AC is not cooling. My garage door is jammed."],
    ["new-line historical correction", "My AC is not cooling.\nThat was last year."],
    ["mixed known families tail", "My AC is not cooling and the faucet leaks."],
    ["mixed unlisted appliance tail", "My AC is not cooling and the freezer is warm."],
    ["plumbing negation tail", "The kitchen faucet is leaking, except it isn't."],
    ["no-power historical correction", "My furnace won't turn on. That problem was fixed."],
    ["timing then history", "My AC is not cooling since yesterday, according to an old email."],
    ["brand in another clause", "I have a Carrier. My MysteryBrand AC is not cooling."],
    ["open-ended timing", "My AC stopped cooling since forever."],
  ])("retains guarded alternate for %s", async (_label, description) => {
    category = null;
    const { id, journey } = await start(description);
    expect(calls.map(c => c.schemaName)).toEqual(["A01Classification"]);
    expect(gatewayResults).toEqual([{ request_id: id, tenant_id: "prn", ok: true }]);
    expect(journey.problem.service_category).toBeNull();
    expect(journey.packet.observed_statements).toContain(description);
    expect(calls[0].maxAttempts).toBe(1);
  });

  it.each([
    ["known brand", "My Carrier AC is not cooling.", "hvac", "pb_hvac_cooling_v1"],
    ["multiword known brand", "Our American Standard air conditioner is not cooling today!", "hvac", "pb_hvac_cooling_v1"],
    ["uppercase", "MY TRANE AC IS NOT COOLING SINCE YESTERDAY", "hvac", "pb_hvac_cooling_v1"],
    ["straight apostrophe cooling", "My AC isn't cooling properly now.", "hvac", "pb_hvac_cooling_v1"],
    ["curly apostrophe cooling", "My Carrier AC isn’t cooling since yesterday.", "hvac", "pb_hvac_cooling_v1"],
    ["straight apostrophe no power", "My furnace won't turn on since last night.", "hvac", "pb_hvac_no_power_v1"],
    ["curly apostrophe no power", "My furnace won’t turn on since last night.", "hvac", "pb_hvac_no_power_v1"],
    ["curly apostrophe AC no power", "My AC won’t start today.", "hvac", "pb_hvac_no_power_v1"],
    ["hours duration", "AC stopped cooling for two hours.", "hvac", "pb_hvac_cooling_v1"],
    ["numeric duration", "The air conditioner is blowing hot air for 12 hours.", "hvac", "pb_hvac_cooling_v1"],
    ["weekday", "This AC is not cooling since Monday.", "hvac", "pb_hvac_cooling_v1"],
    ["start time", "My AC stopped cooling starting this morning.", "hvac", "pb_hvac_cooling_v1"],
    ["no-power working", "The furnace is not working anymore.", "hvac", "pb_hvac_no_power_v1"],
    ["plumbing current", "The kitchen faucet is leaking today.", "plumbing", "pb_plumbing_leak_v1"],
    ["plumbing terse", "Bathroom toilet drips.", "plumbing", "pb_plumbing_leak_v1"],
    ["leading trailing whitespace", "  My AC stopped cooling this morning.  ", "hvac", "pb_hvac_cooling_v1"],
  ])("keeps %s static, governed, verbatim and on its authored playbook", async (_label, description, expectedCategory, expectedPlaybook) => {
    const { journey, derivations } = await start(description, "roofing");
    expect(calls).toHaveLength(0);
    expect(journey.problem).toMatchObject({ service_category: expectedCategory, service_category_confidence: "medium", tenant_id: "prn" });
    expect(derivations[0].method).toBe("deterministic");
    expect(journey.packet.observed_statements).toContain(description);
    expect((await runtimeStore().listClaims(journey.problem.problem_id)).find(c => c.predicate === "likely_service_category"))
      .toMatchObject({ claim_class: "INFERRED", confidence: "medium" });
    expect(journey.session.playbook_id).toBe(expectedPlaybook);
  });
});
