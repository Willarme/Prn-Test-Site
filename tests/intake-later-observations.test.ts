import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { detectDiagnosis } from "@/domain/intake/extract";
import { HVAC_COOLING_PLAYBOOK } from "@/domain/intake/playbooks/hvac-cooling";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { checkSafety } from "@/domain/problem/safety";
import { signLink } from "@/platform/links/tokens";
import { runtimeStore } from "@/platform/stores/runtime";
import { readDevDb, updateDevDb } from "@/platform/stores/dev-db";
import { POST as startPost } from "@/app/api/intake/route";
import { POST as answerPost } from "@/app/api/intake/answer/route";
import { GET as walkthroughGet } from "@/app/api/intake/walkthrough/route";
import { GET as packetGet } from "@/app/packet/[request_id]/route";
import { GET as pdfGet } from "@/app/packet/[request_id]/pdf/route";
import CompletePage from "@/app/complete/[request_id]/page";
import ResultsPage from "@/app/results/[request_id]/page";
import SendPacketPage from "@/app/results/[request_id]/send/page";
import EmailPacketPage from "@/app/results/[request_id]/email/page";
import { makeShareLink } from "@/app/results/[request_id]/send/actions";
import { POST as emailPost } from "@/app/api/results/email/route";
import { buildShareMessage } from "@/platform/results/share";
import { readLinkLedger } from "@/platform/links/ledger";
import { loadPacket } from "@/platform/packet/load";
import { loadJourneyContext, regeneratePacket } from "@/platform/intake/complete";
import { attachMedia } from "@/platform/intake/media";

const network = vi.fn(() => { throw new Error("No model/network calls in later-answer tests"); });
beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-later-answer-"));
  vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "dev-db.json"));
  vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubGlobal("fetch", network);
});
afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function start(description = "My AC is blowing warm air") {
  const res = await startPost(new Request("http://localhost/api/intake", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ description, disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: { landing_path: "/start", problem_family_hint: "hvac-cooling", page_id: null,
        intent_cluster_id: null, search_opportunity_id: null, experiment_id: null, variant: null, referrer: null } }),
  }));
  expect(res.status).toBe(200);
  return (await res.json()).request_id as string;
}
function answer(request_id: string, body: object, k = signLink({ scope: "keep", request_id })) {
  return answerPost(new Request("http://localhost/api/intake/answer", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request_id, k, ...body }),
  }));
}
const diagnosis = (text: string) => Object.fromEntries(detectDiagnosis(text, HVAC_COOLING_PLAYBOOK).map(a => [a.step_id, a.answer]));

describe("literal current observations", () => {
  it.each([
    ["I see no ice.", "no"], ["There is no visible ice on the line.", "no"],
    ["I can see ice on the copper pipe.", "yes"], ["The refrigerant line has ice.", "yes"],
  ])("holds %s without a model", (text, expected) => expect(diagnosis(text).ice_check).toBe(expected));
  it.each([
    "Do I see no ice?", "I can't see ice from here.", "I don't know if there is no ice.",
    "If I see no ice, should I keep going?", "Yesterday I could see ice.", "I saw ice last week.",
    "I think I see no ice.", "There is no ice now but there was ice yesterday.",
    "I see ice. I see no ice.", "I see no ice cream in the freezer.",
    "It's not true that I see no ice.", "The example says there is no ice.", "I remember there is ice on the pipe.",
  ])("keeps uncertainty, history and contradictions unknown: %s", text => expect(diagnosis(text).ice_check).toBeUndefined());
  it.each([
    "Is the outdoor fan running?", "If the outdoor fan runs, is it okay?", "Maybe the outdoor fan is running.",
    "Yesterday the outdoor fan was running.", "I don't know whether the filter is clean.",
    "Is the filter clean?", "The filter is not clean.", "The filter was clean last week.",
    "Don't say the filter is clean.",
  ])("does not falsely skip a fan/filter check: %s", text => expect(diagnosis(text)).toEqual({}));
  it("holds independent current statements with literal no ice", () => {
    expect(diagnosis("The filter is clean. The outdoor fan runs. I see no ice.")).toEqual({ filter: "reported_clean", fan_moving: "yes", ice_check: "no" });
    expect(diagnosis("The outdoor fan isn't running.").fan_moving).toBe("no");
  });
});

describe("later fields feed the shared evidence map", () => {
  it("captures missing fields and observations from another field while preserving confirmed facts", async () => {
    const id = await start();
    await answer(id, { fields: [{ field_key: "brand", value: "Carrier", confirmed: true }] });
    const beforeCalls = network.mock.calls.length;
    const res = await answer(id, { fields: [{ field_key: "symptom_timing", value: "My Trane AC is 8 years old, started Tuesday. The outdoor fan runs. I see no ice." }] });
    expect(res.status).toBe(200);
    const rows = await runtimeStore().listIntakeAnswers(id);
    expect(rows.filter(a => a.field_key === "brand")).toHaveLength(1);
    expect(rows.find(a => a.field_key === "brand")).toMatchObject({ value_text: "Carrier", source: "confirmed" });
    expect(rows.find(a => a.field_key === "system_age")).toMatchObject({ value_text: "8 years", source: "auto_detected" });
    const observations = await runtimeStore().listDiagnosisAnswers(id);
    expect(observations.find(a => a.step_id === "ice_check")).toMatchObject({ answer: "no" });
    const ctx = await loadJourneyContext(id);
    expect(ctx!.allEvidence.find(e => e.evidence_id === observations.find(a => a.step_id === "ice_check")?.evidence_id)?.content).toContain("I see no ice");
    expect(network.mock.calls.length).toBe(beforeCalls);
    await runtimeStore().saveJobAddress(id, { street: "1 Test Lane", city_state_zip: "Fort Wayne, IN 46802", property_type: null, storeys: null });
    const packet = await loadPacket(id, { link_base: "http://localhost", owner: true });
    const printable = JSON.stringify(packet!.input);
    expect(printable).toContain("Homeowner reports no visible ice");
    expect(printable).not.toContain("No visible ice on accessible refrigerant line");
  });
  it("does not infer other fields from a hypothetical or question", async () => {
    const id = await start();
    await answer(id, { fields: [{ field_key: "symptom_timing", value: "Could it be a Carrier that's 8 years old? I am not sure." }] });
    const rows = await runtimeStore().listIntakeAnswers(id);
    expect(rows.some(a => a.field_key === "brand" || a.field_key === "system_age")).toBe(false);
  });
  it("does not turn a negated brand or an old unit into a new held fact", async () => {
    const id = await start();
    await answer(id, { fields: [{ field_key: "symptom_timing", value: "It is not a Carrier. My previous unit was a Trane, 8 years old." }] });
    const rows = await runtimeStore().listIntakeAnswers(id);
    expect(rows.some(a => a.field_key === "brand" || a.field_key === "system_age")).toBe(false);
  });
  it("future-step and wrong-owner requests leave no partial field or evidence writes", async () => {
    const id = await start();
    const ctx = await loadJourneyContext(id);
    const count = ctx!.allEvidence.length;
    expect((await answer(id, { fields: [{ field_key: "brand", value: "Carrier" }], step: { step_id: "power_check", answer: "I smell gas" } })).status).toBe(409);
    expect((await answer(id, { fields: [{ field_key: "brand", value: "I smell gas" }] }, signLink({ scope: "packet", request_id: id }))).status).toBe(404);
    expect((await loadJourneyContext(id))!.allEvidence).toHaveLength(count);
    expect((await runtimeStore().getJourney(id))!.problem.safety_state).toBe("normal");
  });
});

describe("hazards first reported after entry", () => {
  it.each(["I smell gas near the unit", "The outlet is sparking", "Standing water by the electrical panel"])("halts %s before advancement and preserves the stop on reload", async hazard => {
    const id = await start();
    const original = await runtimeStore().getJourney(id);
    const beforeCalls = network.mock.calls.length;
    const res = await answer(id, { fields: [{ field_key: "symptom_timing", value: hazard }], step: { step_id: "filter", answer: "2" } });
    expect(res.status).toBe(200);
    const rule = checkSafety(hazard)!;
    const data = await res.json();
    expect(data.safety).toMatchObject({ message: rule.approved_response, intake_may_continue: false });
    expect(data.next).toBe(`/safety/${rule.safety_rule_id}`);
    expect(data).not.toHaveProperty("view");
    expect(await runtimeStore().listDiagnosisAnswers(id)).toEqual([]);
    const reloaded = (await runtimeStore().getJourney(id))!;
    expect(reloaded.problem.safety_rule_id).toBe(rule.safety_rule_id);
    expect(reloaded.problem.safety_state).toBe("urgent");
    expect(reloaded.packet.safe_prep_notes).toEqual([rule.approved_response]);
    expect(reloaded.packet.diagnosis).toBeNull();
    const retry = await answer(id, { step: { step_id: "filter", answer: "2" } });
    expect((await retry.json()).next).toBe(data.next);
    await regeneratePacket(id);
    expect((await runtimeStore().getJourney(id))!.packet.packet_version).toBe(original!.packet.packet_version);
    const k = signLink({ scope: "keep", request_id: id });
    await expect(CompletePage({ params: Promise.resolve({ request_id: id }), searchParams: Promise.resolve({ k }) })).rejects.toThrow("NEXT_REDIRECT");
    await expect(ResultsPage({ params: Promise.resolve({ request_id: id }), searchParams: Promise.resolve({ k }) })).rejects.toThrow("NEXT_REDIRECT");
    for (const page of [SendPacketPage, EmailPacketPage]) {
      await expect(page({ params: Promise.resolve({ request_id: id }), searchParams: Promise.resolve({ k }) })).rejects.toThrow("NEXT_REDIRECT");
    }
    const linkCount = readLinkLedger(id).links.length;
    expect(await buildShareMessage({ request_id: id, origin: "http://localhost", contact: "fixture@example.com" })).toBeNull();
    const shareForm = new FormData();
    shareForm.set("request_id", id); shareForm.set("k", k);
    await expect(makeShareLink({ status: "idle" }, shareForm)).rejects.toThrow("NEXT_REDIRECT");
    expect(readLinkLedger(id).links).toHaveLength(linkCount);
    const outboxCount = readDevDb().email_outbox.length;
    const emailForm = new FormData();
    emailForm.set("request_id", id); emailForm.set("k", k); emailForm.set("email", "fixture@example.com");
    const mailed = await emailPost(new Request("http://localhost/api/results/email", { method: "POST", body: emailForm }));
    expect(mailed.status).toBe(303);
    expect(mailed.headers.get("location")).toBe(`http://localhost${data.next}`);
    expect(readDevDb().email_outbox).toHaveLength(outboxCount);
    const reset = await walkthroughGet(new Request(`http://localhost/api/intake/walkthrough?request_id=${id}&k=${encodeURIComponent(k)}`));
    expect(reset.status).toBe(409);
    expect(await reset.json()).not.toHaveProperty("view");
    for (const get of [packetGet, pdfGet]) {
      const response = await get(new Request(`http://localhost/packet/${id}?k=${encodeURIComponent(k)}`), { params: Promise.resolve({ request_id: id }) });
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`http://localhost${data.next}`);
      expect(await response.text()).not.toContain("Your Job Packet is ready");
    }
    const media = await attachMedia({ request_id: id, target: "step:outdoor_unit", file: new File([new Uint8Array([1])], "test.jpg", { type: "image/jpeg" }), source: "walkthrough" });
    expect(media).toMatchObject({ ok: false, status: 409, error: rule.approved_response });
    expect(network.mock.calls.length).toBe(beforeCalls);
  });
  it("scans a current step's free text too", async () => {
    const id = await start();
    const res = await answer(id, { step: { step_id: "filter", answer: "I smell gas" } });
    expect((await res.json()).safety.rule_id).toBe("safety_gas");
    expect(await runtimeStore().listDiagnosisAnswers(id)).toEqual([]);
  });
  it("refuses to reconstruct a safe journey if linked evidence disappears", async () => {
    const id = await start();
    await answer(id, { fields: [{ field_key: "symptom_timing", value: "I smell gas" }] });
    const journey = (await runtimeStore().getJourney(id))!;
    const last = journey.problem.evidence_ids.at(-1)!;
    updateDevDb(db => { db.evidence = db.evidence.filter(e => e.evidence_id !== last); });
    await expect(runtimeStore().getJourney(id)).rejects.toThrow("evidence is unavailable");
    // The original record is still on disk; missing evidence never means a fresh request.
    expect(readDevDb().problems.some(p => p.problem_id === journey.problem.problem_id)).toBe(true);
  });
  it("refuses a recorded safety rule absent from the active package instead of opening a normal packet", async () => {
    const id = await start();
    const original = (await runtimeStore().getJourney(id))!;
    updateDevDb(db => {
      const problem = db.problems.find(p => p.problem_id === original.problem.problem_id)!;
      problem.safety_state = "urgent";
      problem.safety_rule_id = "safety_retired_fixture";
    });
    await expect(runtimeStore().getJourney(id)).rejects.toThrow("Recorded safety rule is unavailable");
    await expect(loadPacket(id, { link_base: "http://localhost", owner: true })).rejects.toThrow("Recorded safety rule is unavailable");
    await expect(regeneratePacket(id)).rejects.toThrow("Recorded safety rule is unavailable");
    const k = signLink({ scope: "keep", request_id: id });
    await expect(ResultsPage({ params: Promise.resolve({ request_id: id }), searchParams: Promise.resolve({ k }) })).rejects.toThrow("Recorded safety rule is unavailable");
    expect(readDevDb().packets.filter(p => p.problem_id === original.problem.problem_id)).toHaveLength(1);
  });
});
