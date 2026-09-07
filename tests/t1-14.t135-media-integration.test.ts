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
import { loadJourneyContext } from "@/platform/intake/complete";
import { intakeReadiness } from "@/platform/intake/readiness";
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
let capacityOnly: boolean;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "t114-t135-media-")); calls = []; results = []; capacityOnly = false;
  vi.stubEnv("PRN_DEV_DB_PATH", join(root, "db.json")); vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("VITEST", "1"); vi.stubEnv("PRN_AI_LIVE_TESTS", "0"); vi.stubGlobal("fetch", network);
  resetRuntimeStore(); resetKillSwitchForTests(); resetAgentRunLedgerForTests();
  setAiPolicyStoreForTests(new MemoryAiPolicyStore()); setSpendLedgerForTests(new MemorySpendLedger());
  const provider: ModelProvider = { id: "synthetic-integration", async complete(input): Promise<ModelCallResult> {
    calls.push(input);
    const value = input.schemaName === "A01Classification"
      ? { service_category: "hvac", service_category_confidence: "high", intent_cluster: "AC not cooling", facts: [], reason: "Synthetic classification" }
      : { readable: capacityOnly, equipment_type: null, brand: null, model: null, serial: null, manufacture_year: null,
        capacity: capacityOnly ? { printed_label: "Cooling capacity", printed_value: "36,000", printed_unit: "BTU/h" } : null,
        confidence: { equipment_type: "low", brand: "low", model: "low", serial: "low", manufacture_year: "low", capacity: capacityOnly ? "high" : "low" }, notes: "Synthetic provider reply" };
    return { ok: true, raw: JSON.stringify(value), provider: "synthetic-integration", attempts: 1, generationId: `synthetic-${calls.length}`,
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, reported_cost_usd: 0.000001 } };
  } };
  deps = { provider: () => provider, spend: new MemorySpendLedger(), requestCalls: new FileRequestCallLedger(),
    catalogue: MODEL_CATALOGUE.map(model => ({ ...model, allows_customer_data: true })),
    policy: AiPolicy.parse({ ...DEFAULT_AI_POLICY, enabled: true, capabilities: {
      ...DEFAULT_AI_POLICY.capabilities,
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
async function start(description = "My AC is not cooling") {
  const result = await accepted(await startPost(new Request("http://localhost/api/intake", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ description, disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: { landing_path: "/start", problem_family_hint: "hvac-cooling", page_id: null, intent_cluster_id: null,
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

describe("T1-14 shared model guard joined to T1-35 accepted media", () => {
  it("carries explicit printed capacity through the governed reader into the saved intake without decoding a model", async () => {
    capacityOnly = true;
    const id = await start(); const upload = await photo(id);
    expect(calls).toHaveLength(1);
    const current = await intakeReadiness((await loadJourneyContext(id))!);
    expect(current.facts.fields.printed_cooling_capacity).toMatchObject({ value: "Cooling capacity: 36,000 BTU/h",
      claim_class: "INFERRED", confidence: "high", confirmed: false, evidence_ids: [upload.evidence_id] });
    const answers = await runtimeStore().listIntakeAnswers(id);
    expect(answers.some(answer => answer.field_key === "unit_model_serial" && answer.value_text !== null)).toBe(false);
    expect(reservations()).toHaveLength(1);
  });
  it("accepts three photos but sends only two through the actual label adapter and governed provider", async () => {
    const id = await start(); expect(calls).toHaveLength(0);
    const uploads = [await photo(id), await photo(id), await photo(id)];
    expect(new Set(uploads.map(upload => upload.evidence_id)).size).toBe(3);
    expect(calls.map(call => call.schemaName)).toEqual(["A01LabelRead_v2", "A01LabelRead_v2"]);
    expect(calls.every(call => call.maxAttempts === 1)).toBe(true);
    expect(results.at(-1)).toMatchObject({ capability: "read_equipment_label", request_id: id, tenant_id: "prn", ok: false, reason: "over_budget" });
    expect(((await readLabelReadings(id)) ?? []).map(reading => reading.extraction_status)).toEqual(["unreadable", "unreadable", "failed"]);
    expect(reservations().map(reservation => reservation.used)).toEqual([1, 2]);
    expect((await readIntakeEffort({ request_id: id, tenant_id: "prn" })).effort_spent).toBe(14);
    expect((await runtimeStore().getJourney(id))!.packet.intake_snapshot!.handoff.equipment.model).toBeNull();
  });

  it("shares classification plus one label attempt, then preserves the next upload with zero additional provider work", async () => {
    deps.policy!.capabilities.classify_home_problem.enabled = true;
    const id = await start("My AC is not cooling and the kitchen faucet leaks"); expect(calls.map(call => call.schemaName)).toEqual(["A01Classification"]);
    await photo(id); const refusedRead = await photo(id);
    expect(calls.map(call => call.schemaName)).toEqual(["A01Classification", "A01LabelRead_v2"]);
    expect(results.at(-1)).toMatchObject({ request_id: id, tenant_id: "prn", ok: false, reason: "over_budget" });
    expect(((await readLabelReadings(id)) ?? []).find(reading => reading.evidence_id === refusedRead.evidence_id)).toMatchObject({ extraction_status: "failed" });
    expect(reservations().map(reservation => reservation.capability)).toEqual(["classify_home_problem", "read_equipment_label"]);
    expect((await readIntakeEffort({ request_id: id, tenant_id: "prn" })).effort_spent).toBe(11);
  });

  it("reopens the runtime and fresh ledger adapters without granting the same journey another model attempt", async () => {
    const id = await start(); await photo(id); await photo(id);
    const before = reservations(); resetRuntimeStore(); deps.requestCalls = new FileRequestCallLedger(); deps.spend = new MemorySpendLedger();
    await photo(id);
    expect(calls).toHaveLength(2); expect(reservations()).toEqual(before);
    expect(results.at(-1)).toMatchObject({ request_id: id, tenant_id: "prn", ok: false, reason: "over_budget" });
    expect((await runtimeStore().getJourney(id))!.packet.intake_snapshot).toBeDefined();
  });
});
