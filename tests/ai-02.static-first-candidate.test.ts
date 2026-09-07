import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
import { __setLabelReaderForTests, readLabelReadings } from "@/platform/intake/media";
import { readEquipmentLabel } from "@/platform/problem/ai-label";
import { readIntakeEffort } from "@/platform/intake/effort";
import { signLink } from "@/platform/links/tokens";
import { resetRuntimeStore, runtimeStore } from "@/platform/stores/runtime";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { POST as startPost } from "@/app/api/intake/route";
import { POST as mediaPost } from "@/app/api/intake/media/route";

// T1-14 dependency integration: only provider/config dependencies are injected.
// Routes, label normalization, callModel and its durable request guard are real.
// No provider credential, clearance or activation is written to product state.
const realCallModel = gateway.callModel;
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const network = vi.fn(() => { throw new Error("No network in the request/media integration tests"); });
let root: string;
let calls: ModelCallInput[];
let results: Array<{ capability: string; request_id?: string | null; tenant_id?: string; ok: boolean; reason?: string }>;
let deps: gateway.CallModelDeps;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "t114-t135-media-")); calls = []; results = [];
  vi.stubEnv("PRN_DEV_DB_PATH", join(root, "db.json")); vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("VITEST", "1"); vi.stubEnv("PRN_AI_LIVE_TESTS", "0"); vi.stubGlobal("fetch", network);
  resetRuntimeStore(); resetKillSwitchForTests(); resetAgentRunLedgerForTests();
  setAiPolicyStoreForTests(new MemoryAiPolicyStore()); setSpendLedgerForTests(new MemorySpendLedger());
  const provider: ModelProvider = { id: "synthetic-integration", async complete(input): Promise<ModelCallResult> {
    calls.push(input);
    const value = input.schemaName === "A01Classification"
      ? { service_category: "hvac", service_category_confidence: "high", intent_cluster: "AC not cooling", facts: [], reason: "Synthetic classification" }
      : { readable: calls.filter(call => call.schemaName === "A01LabelRead_v2").length >= 2, equipment_type: null, brand: null, model: calls.filter(call => call.schemaName === "A01LabelRead_v2").length >= 2 ? "SYNTHETIC-MODEL" : null, serial: null, manufacture_year: null, capacity: null,
        confidence: { equipment_type: "low", brand: "low", model: "low", serial: "low", manufacture_year: "low", capacity: "low" }, notes: "Synthetic unreadable plate" };
    return { ok: true, raw: JSON.stringify(value), provider: "synthetic-integration", attempts: 1, generationId: `synthetic-${calls.length}`,
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, reported_cost_usd: 0.000001 } };
  } };
  deps = { provider: () => provider, spend: new MemorySpendLedger(), requestCalls: new FileRequestCallLedger(),
    catalogue: MODEL_CATALOGUE.map(model => ({ ...model, allows_customer_data: true })),
    policy: AiPolicy.parse({ ...DEFAULT_AI_POLICY, enabled: true, capabilities: {
      ...DEFAULT_AI_POLICY.capabilities,
      classify_home_problem: { ...DEFAULT_AI_POLICY.capabilities.classify_home_problem, enabled: true },
      read_equipment_label: { ...DEFAULT_AI_POLICY.capabilities.read_equipment_label, enabled: true },
    } }),
  };
  vi.spyOn(gateway, "callModel").mockImplementation(async <T>(input: gateway.CallModelInput<T>) => {
    const result = await realCallModel({ ...input, deps });
    results.push({ capability: input.capability, request_id: input.request_id, tenant_id: input.tenant_id,
      ok: result.ok, ...(!result.ok ? { reason: result.reason } : {}) });
    return result;
  });
  __setLabelReaderForTests(readEquipmentLabel);
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled(); __setLabelReaderForTests(undefined); vi.restoreAllMocks();
  resetRuntimeStore(); resetKillSwitchForTests(); resetAgentRunLedgerForTests(); setAiPolicyStoreForTests(null); setSpendLedgerForTests(null);
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(root, { recursive: true, force: true });
});
async function accepted(response: Response) {
  const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200); return body;
}
async function start(description = "My AC is not cooling", hint = "hvac-cooling") {
  const result = await accepted(await startPost(new Request("http://localhost/api/intake", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ description, request_id: "rq_forged", tenant_id: "tenant_forged", disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: { landing_path: "/start", problem_family_hint: hint, page_id: null, intent_cluster_id: null,
        search_opportunity_id: null, experiment_id: null, variant: null, referrer: null } }) })));
  return result.request_id as string;
}
async function photo(id: string) {
  const form = new FormData(); form.set("request_id", id); form.set("k", signLink({ scope: "keep", request_id: id })); form.set("target", "unit_model_serial");
  form.set("file", new File([new Uint8Array(bytes)], "synthetic-label.png", { type: "image/png" }));
  return accepted(await mediaPost(new Request("http://localhost/api/intake/media", { method: "POST", body: form })));
}
function reservations() {
  const directory = join(root, "request-ai-calls");
  const files = readdirSync(directory).filter(name => name.endsWith(".json")); expect(files).toHaveLength(1);
  return JSON.parse(readFileSync(join(directory, files[0]), "utf8")).reservations as Array<{ capability: string; used: number }>;
}

describe("AI-02 static-first accepted intake candidate", () => {
  it("clear AC text on its door preserves two actual label attempts and the fixed third-call refusal", async () => {
    const description = "My Trane AC is not cooling since yesterday";
    const id = await start(description); expect(calls).toHaveLength(0);
    expect(id).not.toBe("rq_forged");
    const journey = (await runtimeStore().getJourney(id))!;
    expect(journey.problem).toMatchObject({ service_category: "hvac", service_category_confidence: "medium", tenant_id: "prn" });
    expect(journey.packet.observed_statements).toContain(description);
    expect((await runtimeStore().listDerivations(journey.problem.problem_id))[0]).toMatchObject({ method: "deterministic" });
    expect((await runtimeStore().listClaims(journey.problem.problem_id)).find(claim => claim.predicate === "likely_service_category")).toMatchObject({ claim_class: "INFERRED", confidence: "medium" });
    await photo(id); await photo(id);
    expect(calls.map(call => call.schemaName)).toEqual(["A01LabelRead_v2", "A01LabelRead_v2"]);
    expect((await readLabelReadings(id))?.map(reading => reading.extraction_status)).toEqual(["unreadable", "readable"]);
    const handoff = (await runtimeStore().getJourney(id))!.packet.intake_snapshot!.handoff;
    expect(handoff.fact_state.fields.unit_model_serial).toMatchObject({ value: "Model SYNTHETIC-MODEL", claim_class: "INFERRED", confidence: "low" });
    expect(handoff.equipment.model).toBeNull(); // A weak read still needs confirmation.
    expect(results.every(result => result.request_id === id && result.tenant_id === "prn")).toBe(true);
    expect(reservations().map(reservation => reservation.used)).toEqual([1, 2]);
    resetRuntimeStore(); deps.requestCalls = new FileRequestCallLedger();
    await photo(id); expect(calls).toHaveLength(2);
    expect(results.at(-1)).toMatchObject({ request_id: id, tenant_id: "prn", ok: false, reason: "over_budget" });
    expect((await readIntakeEffort({ request_id: id, tenant_id: "prn" })).effort_spent).toBe(14);
  });

  it("clear plumbing text wins over an AC door without spending a model call", async () => {
    const id = await start("The kitchen faucet is leaking", "hvac-cooling");
    expect(calls).toHaveLength(0);
    expect((await runtimeStore().getJourney(id))!.problem).toMatchObject({ service_category: "plumbing", service_category_confidence: "medium" });
  });

  it.each([
    "Something is making an unusual noise",
    "My AC is not cooling and the kitchen faucet leaks",
    "My thermostat is unusual",
    "My refrigerator makes a loud noise",
    "My freezer is not cooling",
    "My wine cooler is not cooling",
  ])("keeps the model alternate for unmatched or ambiguous text: %s", async description => {
    const id = await start(description);
    expect(calls.map(call => call.schemaName)).toEqual(["A01Classification"]);
    expect(results[0]).toMatchObject({ request_id: id, tenant_id: "prn", ok: true });
    expect(id).not.toBe("rq_forged");
  });

  it("a governed refusal on ambiguous text retains the deterministic fallback and trusted identity", async () => {
    deps.policy!.capabilities.classify_home_problem.enabled = false;
    const id = await start("My AC is not cooling and the kitchen faucet leaks");
    expect(calls).toHaveLength(0);
    expect(results[0]).toMatchObject({ request_id: id, tenant_id: "prn", ok: false });
    expect((await runtimeStore().getJourney(id))!.problem).toMatchObject({ service_category: "hvac", service_category_confidence: "medium" });
  });

  it("the safety hard stop still precedes every model and normal journey", async () => {
    const response = await startPost(new Request("http://localhost/api/intake", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "My AC is not cooling and I smell gas", disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
        attribution: { landing_path: "/start", problem_family_hint: "hvac-cooling", page_id: null, intent_cluster_id: null,
          search_opportunity_id: null, experiment_id: null, variant: null, referrer: null } }) }));
    expect(await response.json()).toMatchObject({ request_id: null, safety: { intake_may_continue: false } });
    expect(calls).toHaveLength(0); expect(results).toHaveLength(0); expect((await runtimeStore().totals()).journeys).toBe(0);
  });
});
