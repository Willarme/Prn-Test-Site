import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { ProblemRecordHandoff, validateHandoffTrace, buildIntakeRegistry } from "@/domain/intake/readiness";
import { HVAC_COOLING_PLAYBOOK } from "@/domain/intake/playbooks/hvac-cooling";
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

describe("T8-39 accepted fields → saved basis → HTML counter", () => {
  it("saves and renders the independently listed fourteen-topic audit pattern", async () => {
    const id = await start("My AC is not cooling. Thermostat is set to cool at 70 and room reads 78. Air from vents is warm. I changed the filter two months ago.");
    await answer(id, [{ field_key: "unit_model_serial", value: "Synthetic test equipment: Carrier 24ABC630A003; serial TEST000123; outdoor central AC." }]);
    await answer(id, [{ field_key: "symptom_timing", value: "Since Tuesday" }]);
    await accepted(await answerPost(request("/api/intake/answer", { request_id: id, k: signLink({ scope: "keep", request_id: id }),
      address: { street: "10 Synthetic Street", city_state_zip: "Test City PA 00000", property_type: "Detached", storeys: "2" }, step: { step_id: "filter", answer: "5" } })));
    const packet = await finish(id); const h = packet.intake_snapshot!.handoff;
    expect(h.schema_version).toBe("1.1.0"); if (h.schema_version !== "1.1.0") throw new Error("Missing basis");
    expect(h.fact_count_basis.observations.map(o => o.id)).toEqual([
      "equipment.control.mode", "equipment.control.room_temperature", "equipment.control.setpoint", "equipment.filter.condition",
      "equipment.primary.brand", "equipment.primary.model", "equipment.primary.serial", "equipment.primary.type", "problem.onset", "problem.report",
      "property.locality", "property.storeys", "property.street", "property.type",
    ]);
    expect(h.counts.facts).toBe(14);
    const loaded = await loadPacket(id, { owner: true, link_base: "https://example.test", now: packet.generated_at });
    expect(loaded!.input!.counts.facts_captured).toBe(14);
    expect(renderPacketHtml(loaded!.input!).html).toContain('<div class="n">14</div><div class="l">Facts captured</div>');
    const copied = structuredClone(h); copied.counts.facts = 15;
    expect(ProblemRecordHandoff.safeParse(copied).success).toBe(false);
    const duplicate = structuredClone(h); duplicate.fact_count_basis.observations.push(duplicate.fact_count_basis.observations[0]); duplicate.counts.facts += 1;
    expect(ProblemRecordHandoff.safeParse(duplicate).success).toBe(false);
    const identity = structuredClone(h); identity.normalized_observations.serial = null;
    identity.fact_count_basis.observations = identity.fact_count_basis.observations.filter(o => o.id !== "equipment.primary.serial"); identity.counts.facts -= 1;
    expect(ProblemRecordHandoff.safeParse(identity).success).toBe(false);
    expect(validateHandoffTrace(h, buildIntakeRegistry(HVAC_COOLING_PLAYBOOK), "another-tenant")).toContain("Fact count basis belongs to another tenant");
    for (const key of ["constructor", "__proto__"]) {
      const prototype = structuredClone(h); prototype.fact_count_basis.observations[0].source_fields = [key];
      expect(ProblemRecordHandoff.safeParse(prototype).success).toBe(false);
    }
  });

  it("counts multiple accepted history and access answers by authored topic instead of repeated wording", async () => {
    const id = await start("My AC is not cooling");
    await answer(id, [{ field_key: "sh_refrigerant", value: "No" }, { field_key: "sh_impact", value: "No" },
      { field_key: "access_owner_present", value: "No" }, { field_key: "access_contact", value: "Text preferred" }]);
    const packet = await finish(id); const h = packet.intake_snapshot!.handoff;
    if (h.schema_version !== "1.1.0") throw new Error("Missing basis");
    expect(h.fact_count_basis.observations.map(o => o.id)).toEqual(["access.contact_preference", "access.owner_present", "history.sh_impact", "history.sh_refrigerant", "problem.report"]);
    expect(h.counts.facts).toBe(5);
    expect(h.history.filter(row => row.answer === "No")).toHaveLength(2);
    const loaded = await loadPacket(id, { owner: true, link_base: "https://example.test" });
    expect(renderPacketHtml(loaded!.input!).html).toContain('<div class="n">5</div><div class="l">Facts captured</div>');
  });

  it("reads an explicit 1.0.0 snapshot at its original count and preserves it when a new generation is saved", async () => {
    const id = await start("My Carrier AC is 8 years old and blowing warm air since Tuesday.");
    const packet = (await runtimeStore().getJourney(id))!.packet;
    const h = packet.intake_snapshot!.handoff;
    if (h.schema_version !== "1.1.0") throw new Error("Missing current basis");
    const { fact_count_basis: omitted, normalized_observations: omittedComponents, ...legacyShape } = h; void omitted; void omittedComponents;
    // Explicit historical fixture: two display facts shared the user_language
    // source and therefore counted as one under the unchanged legacy rule.
    const legacy = ProblemRecordHandoff.parse({ ...legacyShape, schema_version: "1.0.0", counts: { ...h.counts, facts: 1 } });
    const legacyJson = JSON.stringify(legacy);
    const legacyId = `${packet.job_packet_id}-legacy-fixture`;
    await runtimeStore().savePacket({ ...packet, job_packet_id: legacyId, packet_version: packet.packet_version + 1,
      intake_snapshot: { ...packet.intake_snapshot!, packet_id: legacyId, packet_version: packet.packet_version + 1, handoff: legacy } }, id);
    const loaded = await loadPacket(id, { owner: true, link_base: "https://example.test" });
    expect(loaded!.input!.counts.facts_captured).toBe(1);
    expect(JSON.stringify(loaded!.journey.packet.intake_snapshot!.handoff)).toBe(legacyJson);
    expect(renderPacketHtml(loaded!.input!).html).toContain('<div class="n">1</div><div class="l">Facts captured</div>');
    await answer(id, [{ field_key: "unit_model_serial", value: "Serial TEST000123" }]);
    const newer = (await runtimeStore().getJourney(id))!.packet;
    expect(newer.packet_version).toBeGreaterThan(packet.packet_version + 1);
    expect(newer.intake_snapshot!.handoff.schema_version).toBe("1.1.0");
    const db = JSON.parse(readFileSync(join(dir, "dev-db.json"), "utf8"));
    expect(JSON.stringify(db.packets.find((p: { job_packet_id: string }) => p.job_packet_id === legacyId).intake_snapshot.handoff)).toBe(legacyJson);
    const inflatedLegacy = { ...legacy, counts: { ...legacy.counts, facts: 4 } };
    expect(ProblemRecordHandoff.safeParse(inflatedLegacy).success).toBe(false);
  });
});
