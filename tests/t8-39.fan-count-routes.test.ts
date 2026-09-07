import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { ProblemRecordHandoff } from "@/domain/intake/readiness";
import { renderPacketHtml } from "@/domain/packet/render";
import { MemoryAiPolicyStore, setAiPolicyStoreForTests } from "@/platform/ai/policy-store";
import { MemorySpendLedger, setSpendLedgerForTests } from "@/platform/ai/spend";
import { __setLabelReaderForTests } from "@/platform/intake/media";
import { signLink } from "@/platform/links/tokens";
import { loadPacket } from "@/platform/packet/load";
import { resetRuntimeStore, runtimeStore } from "@/platform/stores/runtime";
import { POST as startPost } from "@/app/api/intake/route";
import { POST as answerPost } from "@/app/api/intake/answer/route";
import { POST as finishPost } from "@/app/api/intake/finish/route";

// These tests compare the new private handoff to the actual accepted route and
// Directions renderer. They do not claim the full A02 field/device acceptance.
let dir: string;
let clock: number;
const network = vi.fn(() => { throw new Error("No network in handoff trace tests"); });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prn-fact-count-routes-"));
  vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "dev-db.json")); vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("VITEST", "1"); vi.stubEnv("PRN_AI_LIVE_TESTS", "0"); vi.stubGlobal("fetch", network);
  vi.useFakeTimers({ toFake: ["Date"] }); clock = Date.parse("2026-09-06T17:00:00Z"); vi.setSystemTime(clock);
  resetRuntimeStore(); setAiPolicyStoreForTests(new MemoryAiPolicyStore()); setSpendLedgerForTests(new MemorySpendLedger());
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled(); __setLabelReaderForTests(undefined); resetRuntimeStore(); setAiPolicyStoreForTests(null); setSpendLedgerForTests(null);
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true });
});
async function accepted(response: Response) {
  const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200); return body;
}
function request(path: string, body: object) {
  clock += 1_000; vi.setSystemTime(clock);
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function start(description: string) {
  const body = await accepted(await startPost(request("/api/intake", { description, disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
    attribution: { landing_path: "/start", problem_family_hint: "hvac-cooling", page_id: null,
      intent_cluster_id: null, search_opportunity_id: null, experiment_id: null, variant: null, referrer: null } })));
  return body.request_id as string;
}
async function answer(id: string, fields: Array<{ field_key: string; value: string }>) {
  await accepted(await answerPost(request("/api/intake/answer", { request_id: id, k: signLink({ scope: "keep", request_id: id }), fields })));
}
async function finish(id: string) {
  await accepted(await finishPost(request("/api/intake/finish", { request_id: id, k: signLink({ scope: "keep", request_id: id }) })));
  const journey = await runtimeStore().getJourney(id); expect(journey?.packet.intake_snapshot).toBeDefined(); return journey!.packet;
}


describe("T8-39 accepted fan display → saved record → rendered packet", () => {
  it.each(["AUTO", "ON"])("preserves the independently specified fifteen topics with fan %s", async fan => {
    const id = await start("My Carrier AC is not cooling since yesterday.");
    await answer(id, [{ field_key: "unit_model_serial", value: "Model 24ABC630A003; serial TEST000123; outdoor central AC" }]);
    await answer(id, [{ field_key: "thermostat_photo", value: `Thermostat mode COOL, setpoint 72 F, room temperature 81 F, fan ${fan}.` }]);
    await accepted(await answerPost(request("/api/intake/answer", { request_id: id, k: signLink({ scope: "keep", request_id: id }),
      address: { street: "123 Example Lane", city_state_zip: "Exampleville, NY 00000", property_type: "House", storeys: "2" }, step: { step_id: "filter", answer: "5" } })));
    const packet = await finish(id); const h = packet.intake_snapshot!.handoff;
    if (h.schema_version !== "1.1.0") throw new Error("Missing basis");
    expect(h.fact_count_basis.observations.map(o => o.id)).toEqual([
      "equipment.control.fan_mode", "equipment.control.mode", "equipment.control.room_temperature", "equipment.control.setpoint", "equipment.filter.condition",
      "equipment.primary.brand", "equipment.primary.model", "equipment.primary.serial", "equipment.primary.type", "problem.onset", "problem.report",
      "property.locality", "property.storeys", "property.street", "property.type",
    ]);
    expect(h.counts.facts).toBe(15);
    expect(h.normalized_observations.fan_mode).toBe(fan.toLowerCase());
    const fanBasis = h.fact_count_basis.observations.find(o => o.id === "equipment.control.fan_mode")!;
    expect(fanBasis.source_fields).toEqual(["thermostat_photo"]);
    expect(h.fact_state.fields.thermostat_photo.value).toContain(`fan ${fan}`);
    const loaded = await loadPacket(id, { owner: true, link_base: "https://example.test", now: packet.generated_at });
    const html = renderPacketHtml(loaded!.input!).html;
    expect(html.toLowerCase()).toContain(`fan ${fan.toLowerCase()}`);
    expect(html).toContain('<div class="n">15</div><div class="l">Facts captured</div>');
    const omitted = structuredClone(h); omitted.fact_count_basis.observations = omitted.fact_count_basis.observations.filter(o => o.id !== "equipment.control.fan_mode"); omitted.counts.facts -= 1;
    expect(ProblemRecordHandoff.safeParse(omitted).success).toBe(false);
  });
  it("a later uncertain authored display report does not retain its earlier saved AUTO observation", async () => {
    const id = await start("My AC is not cooling.");
    await answer(id, [{ field_key: "thermostat_photo", value: "Mode COOL; fan AUTO" }]);
    const before = (await runtimeStore().getJourney(id))!.packet.intake_snapshot!.handoff;
    if (before.schema_version !== "1.1.0") throw new Error("Missing baseline basis");
    expect(before.normalized_observations.fan_mode).toBe("auto");
    expect(before.fact_state.fields.thermostat_photo.value).toBe("Mode COOL; fan AUTO");
    expect(before.fact_count_basis.observations.find(o => o.id === "equipment.control.fan_mode")?.source_fields).toEqual(["thermostat_photo"]);
    await answer(id, [{ field_key: "thermostat_photo", value: "Mode COOL; fan not ON" }]);
    const packet = await finish(id); const h = packet.intake_snapshot!.handoff;
    if (h.schema_version !== "1.1.0") throw new Error("Missing basis");
    expect(h.normalized_observations.fan_mode).toBeNull();
    expect(h.fact_count_basis.observations.some(o => o.id === "equipment.control.fan_mode")).toBe(false);
    const loaded = await loadPacket(id, { owner: true, link_base: "https://example.test" });
    expect(loaded!.input!.evidence.readings?.fan_mode).toBeUndefined();
  });
});
