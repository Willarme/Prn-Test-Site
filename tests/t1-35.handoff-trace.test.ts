import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { validateHandoffTrace } from "@/domain/intake/readiness";
import { renderPacketHtml } from "@/domain/packet/render";
import { MemoryAiPolicyStore, setAiPolicyStoreForTests } from "@/platform/ai/policy-store";
import { MemorySpendLedger, setSpendLedgerForTests } from "@/platform/ai/spend";
import { loadJourneyContext } from "@/platform/intake/complete";
import { intakeReadiness } from "@/platform/intake/readiness";
import { __setLabelReaderForTests } from "@/platform/intake/media";
import { signLink } from "@/platform/links/tokens";
import { loadPacket } from "@/platform/packet/load";
import { resetRuntimeStore, runtimeStore } from "@/platform/stores/runtime";
import { POST as startPost } from "@/app/api/intake/route";
import { POST as answerPost } from "@/app/api/intake/answer/route";
import { POST as finishPost } from "@/app/api/intake/finish/route";
import { POST as mediaPost } from "@/app/api/intake/media/route";

// These tests compare the new private handoff to the actual accepted route and
// Directions renderer. They do not claim the full A02 field/device acceptance.
let dir: string;
let clock: number;
const network = vi.fn(() => { throw new Error("No network in handoff trace tests"); });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prn-handoff-trace-"));
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
function printedHeadlines(html: string) {
  const list = /<ul class="facts">([\s\S]*?)<\/ul>/.exec(html); expect(list).not.toBeNull();
  return [...list![1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]
    .replace(/<span\b[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim());
}

describe("T1-35 handoff slots trace to the generated packet", () => {
  it("records an uncollected approved outcome as an explicit handoff gap", async () => {
    const id = await start("My AC is not cooling"); const packet = await finish(id);
    const state = await intakeReadiness((await loadJourneyContext(id))!);
    expect(state.registry.requirements.some(r => r.fact_type === "outcome_wanted" && r.active)).toBe(true);
    expect(packet.intake_snapshot!.handoff.unknowns).toContainEqual(expect.objectContaining({ fact: "outcome_wanted", reason: expect.any(String) }));
  });

  it("ranks the same genuine headline observations the Directions renderer prints", async () => {
    const description = "My Carrier AC is 8 years old and not cooling. Thermostat is set to cool at 70 and room reads 78. The outdoor fan is running. There is no ice. The filter is clean.";
    const id = await start(description);
    await answer(id, [{ field_key: "symptom_timing", value: "It gradually started Tuesday." },
      { field_key: "vent_airflow", value: "Normal" }, { field_key: "safety_signals", value: "None of these" }]);
    const packet = await finish(id); const handoff = packet.intake_snapshot!.handoff;
    const loaded = await loadPacket(id, { owner: true, link_base: "https://example.test", now: packet.generated_at });
    expect(loaded?.input).not.toBeNull();
    const printed = printedHeadlines(renderPacketHtml(loaded!.input!).html);
    expect(printed).toHaveLength(7);
    expect(printed).toContain("No breaker trips, no burning smell, no water");
    expect(handoff.facts.filter(f => f.headline_rank !== null).sort((a, b) => a.headline_rank! - b.headline_rank!).map(f => f.text)).toEqual(printed);
    expect(handoff.facts).toContainEqual(expect.objectContaining({ text: description, claim_class: "SUPPLIED" }));
  });

  it("binds the fact counter to the actual packet counter instead of a second definition", async () => {
    const id = await start("My Carrier AC is 8 years old and blowing warm air since Tuesday."); const packet = await finish(id);
    const loaded = await loadPacket(id, { owner: true, link_base: "https://example.test", now: packet.generated_at });
    expect(packet.intake_snapshot!.handoff.counts.facts).toBe(loaded!.input!.counts.facts_captured);
    expect(packet.intake_snapshot!.handoff.counts.facts).toBe(1);
    expect(packet.intake_snapshot!.handoff.facts.filter(f => f.source_fields?.includes("user_language"))).toHaveLength(2);
  });

  it("keeps a typed thermostat observation tied to its text instead of an unrelated label photo", async () => {
    const id = await start("My AC is not cooling. Thermostat is set to cool at 70 and room reads 78.");
    const original = (await loadJourneyContext(id))!.textEvidence;
    __setLabelReaderForTests(async () => ({ ok: true, readable: true, fields: { brand: "Carrier", model: "24ABC636A003", serial: "4021E19845" },
      confidence: { brand: "high", model: "high", serial: "high" }, run_id: "synthetic-trace-label" }));
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const form = new FormData(); form.set("request_id", id); form.set("k", signLink({ scope: "keep", request_id: id })); form.set("target", "unit_model_serial");
    form.set("file", new File([new Uint8Array(bytes)], "synthetic-label.png", { type: "image/png" }));
    clock += 1_000; vi.setSystemTime(clock);
    const media = await accepted(await mediaPost(new Request("http://localhost/api/intake/media", { method: "POST", body: form })));
    const packet = await finish(id);
    const reading = packet.intake_snapshot!.handoff.facts.find(f => f.text.startsWith("Thermostat:"));
    expect(reading).toMatchObject({ source_fields: ["thermostat_photo"], evidence_ids: [original.evidence_id],
      evidence_modality: "text", claim_class: "SUPPLIED", verification_status: "unverified", captured_at: original.captured_at });
    expect(reading!.evidence_ids).not.toContain(media.evidence_id);
  });

  it("keeps generated time bound to the saved version when the packet is opened later", async () => {
    const id = await start("My AC is not cooling"); const packet = await finish(id);
    clock += 7 * 24 * 60 * 60 * 1_000; vi.setSystemTime(clock);
    const loaded = await loadPacket(id, { owner: true, link_base: "https://example.test" });
    expect(loaded!.journey.packet.packet_version).toBe(packet.packet_version);
    expect(loaded!.input!.packet.generated_at).toBe(packet.generated_at);
    expect(loaded!.input!.packet.generated_at).toBe(packet.intake_snapshot!.handoff.timeline.at(-1)!.label);
  });

  it("rejects removing a known required equipment slot from an otherwise valid handoff", async () => {
    const id = await start("My Carrier AC is not cooling"); const packet = await finish(id);
    const state = await intakeReadiness((await loadJourneyContext(id))!);
    const damaged = structuredClone(packet.intake_snapshot!.handoff); expect(damaged.fact_state.fields.brand.value).toBe("Carrier");
    damaged.equipment.brand = null;
    expect(validateHandoffTrace(damaged, state.registry).join(" ")).toMatch(/brand/);
  });

  it("keeps an accepted legacy photo skip as a reasoned gap, never an observed fact", async () => {
    const id = await start("My AC is not cooling");
    for (const step of [{ step_id: "filter", answer: "3" }, { step_id: "outdoor_unit", answer: "skipped photo" }]) {
      await accepted(await answerPost(request("/api/intake/answer", { request_id: id, k: signLink({ scope: "keep", request_id: id }), step })));
    }
    const packet = await finish(id);
    expect(packet.intake_snapshot!.handoff.fact_state.fields["check:outdoor_unit"]).toMatchObject({ value: null,
      status: "UNKNOWN_AFTER_REASONABLE_ATTEMPT", reason: "Homeowner skipped this observation" });
    expect(packet.intake_snapshot!.handoff.facts.some(f => f.text.includes("skipped photo"))).toBe(false);
  });
});
