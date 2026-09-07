import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { JobPacket } from "@/domain/problem/contracts";
import { READINESS_POLICY_VERSION, validateHandoffTrace } from "@/domain/intake/readiness";
import { CANNOT_REACH_FIELD_VALUE } from "@/domain/intake/extract";
import { MemoryAiPolicyStore, setAiPolicyStoreForTests } from "@/platform/ai/policy-store";
import { MemorySpendLedger, setSpendLedgerForTests } from "@/platform/ai/spend";
import { signLink } from "@/platform/links/tokens";
import { loadJourneyContext } from "@/platform/intake/complete";
import { intakeReadiness } from "@/platform/intake/readiness";
import { readIntakeEffort } from "@/platform/intake/effort";
import { __setLabelReaderForTests, readLabelConfidence, readLabelReadings, type LabelReadResult } from "@/platform/intake/media";
import { resetRuntimeStore, runtimeStore } from "@/platform/stores/runtime";
import { readDevDb } from "@/platform/stores/dev-db";
import { loadPacket } from "@/platform/packet/load";
import { renderPacketHtml } from "@/domain/packet/render";
import { POST as startPost } from "@/app/api/intake/route";
import { POST as answerPost } from "@/app/api/intake/answer/route";
import { POST as mediaPost } from "@/app/api/intake/media/route";
import { POST as finishPost } from "@/app/api/intake/finish/route";
import { GET as packetGet } from "@/app/packet/[request_id]/route";
import { GET as walkthroughGet } from "@/app/api/intake/walkthrough/route";
import CompletePage from "@/app/complete/[request_id]/page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  notFound: () => { throw new Error("not found"); }, redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

const label: LabelReadResult = { ok: true, readable: true, fields: { equipment_type: "Split-system AC", brand: "Carrier",
  model: "24ABC636A003", serial: "4021E19845", manufacture_year: 2018 },
  confidence: { equipment_type: "high", brand: "high", model: "high", serial: "high", manufacture_year: "high" }, run_id: "synthetic-label-reader" };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const address = { street: "42 Example Street", city_state_zip: "Example Town, IN 00000", property_type: "single-family", storeys: "2" };
const network = vi.fn(() => { throw new Error("External services forbidden in accepted-flow tests"); });
let dir: string;
let clock: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prn-t135-flow-"));
  vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "dev-db.json")); vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("VITEST", "1"); vi.stubEnv("PRN_AI_LIVE_TESTS", "0"); vi.stubGlobal("fetch", network);
  vi.useFakeTimers({ toFake: ["Date"] }); clock = Date.parse("2026-09-06T16:00:00Z"); vi.setSystemTime(clock);
  resetRuntimeStore(); setAiPolicyStoreForTests(new MemoryAiPolicyStore()); setSpendLedgerForTests(new MemorySpendLedger()); __setLabelReaderForTests(null);
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled(); __setLabelReaderForTests(undefined);
  resetRuntimeStore(); setAiPolicyStoreForTests(null); setSpendLedgerForTests(null);
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true });
});
function advance() { clock += 1_000; vi.setSystemTime(clock); }
async function start(description = "My AC is not cooling") {
  advance();
  const response = await startPost(new Request("http://localhost/api/intake", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ description, disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: { landing_path: "/start", problem_family_hint: "hvac-cooling", page_id: null,
        intent_cluster_id: null, search_opportunity_id: null, experiment_id: null, variant: null, referrer: null } }) }));
  const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200);
  return body.request_id as string;
}
function key(id: string) { return signLink({ scope: "keep", request_id: id }); }
async function answer(id: string, input: object, ownerKey = key(id)) {
  advance();
  return answerPost(new Request("http://localhost/api/intake/answer", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ request_id: id, k: ownerKey, ...input }) }));
}
async function finish(id: string, ownerKey = key(id)) {
  advance();
  return finishPost(new Request("http://localhost/api/intake/finish", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ request_id: id, k: ownerKey }) }));
}
async function photo(id: string, target = "unit_model_serial", ownerKey = key(id)) {
  advance(); const form = new FormData(); form.set("request_id", id); form.set("k", ownerKey); form.set("target", target);
  form.set("file", new File([new Uint8Array(png)], "synthetic-label.png", { type: "image/png" }));
  return mediaPost(new Request("http://localhost/api/intake/media", { method: "POST", body: form }));
}
async function accepted(response: Response) { const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200); return body; }
async function state(id: string) { const ctx = await loadJourneyContext(id); expect(ctx).not.toBeNull(); return intakeReadiness(ctx!); }
async function page(id: string) { return renderToStaticMarkup(await CompletePage({ params: Promise.resolve({ request_id: id }), searchParams: Promise.resolve({ k: key(id) }) })); }
function activeScreen(html: string) {
  const section = /<section\b[^>]*data-active-intake-screen[^>]*>([\s\S]*?)<\/section>/.exec(html);
  expect(section, "Actual selected intake screen must be identifiable").not.toBeNull();
  return section![1];
}
function collapsedSavedReview(html: string) {
  const review = /(<details\b[^>]*data-shared-facts[^>]*>)([\s\S]*?)<\/details>/.exec(html);
  expect(review, "Saved facts must remain reviewable").not.toBeNull();
  expect(review![1]).not.toMatch(/\sopen(?:[\s=>])/);
  return review![2];
}
async function savedPacket(id: string) {
  const journey = await runtimeStore().getJourney(id); expect(journey).not.toBeNull();
  const packet = JobPacket.parse(journey!.packet); expect(packet.intake_snapshot).toBeDefined(); return packet;
}

describe("T1-35 ordinary accepted intake paths", () => {
  it("an accepted check keeps the approved graph current across detail-screen history and reloads", async () => {
    const id = await start();
    await page(id);
    expect((await state(id)).screen.questions.every(question => question.source_kind === "field")).toBe(true);
    const before = await readIntakeEffort({ request_id: id, tenant_id: "prn" });
    expect((await answer(id, { step: { step_id: "fins_blocked", answer: "Pretty clogged" } })).status).toBe(409);
    expect(await readIntakeEffort({ request_id: id, tenant_id: "prn" })).toEqual(before);

    for (const [step, next] of [["filter", "outdoor_unit"], ["outdoor_unit", "fan_moving"], ["fan_moving", "fins_blocked"]]) {
      const result = await accepted(await answer(id, { step: { step_id: step, answer: "cannot_reach" } }));
      expect(result.view.step?.step_id).toBe(next); expect(result.view.outcome).toBeNull();
      resetRuntimeStore();
      const current = await state(id);
      expect(current.screen.questions.map(question => question.question_id)).toEqual([`check:${next}`]);
      const active = activeScreen(await page(id));
      expect(active).not.toMatch(/data-field=|data-address/);
      const resume = await walkthroughGet(new Request(`http://localhost/api/intake/walkthrough?request_id=${id}&k=${encodeURIComponent(key(id))}`));
      expect(resume.status).toBe(200);
      const resumed = await resume.json();
      expect(resumed.view.step?.step_id).toBe(next);
      expect(JSON.stringify(resumed)).not.toMatch(/diagnostic_steps|branches|first_step_id/);
    }
    const completed = await accepted(await answer(id, { step: { step_id: "fins_blocked", answer: "cannot_reach" } }));
    expect(completed.view).toMatchObject({ step: null, outcome: { outcome_id: "needs_technician_cooling" } });
    const done = await state(id);
    expect(done.ledger.effort_spent).toBe(9);
    expect(done.screen.questions.some(question => question.source_kind === "check")).toBe(false);
    expect(done.screen.questions.some(question => question.source_kind === "field")).toBe(true);
  }, 25_000);

  it("opening observations do not activate checks, but actual step media does and finish stops it", async () => {
    const id = await start("My AC is blowing warm air. The filter is clean.");
    const opening = await state(id);
    expect(opening.position.currentStepId).toBe("outdoor_unit");
    expect(opening.diagnosis.some(answer => answer.step_id === "filter")).toBe(true);
    expect(opening.screen.questions.every(question => question.source_kind === "field")).toBe(true);
    await page(id);
    const result = await accepted(await photo(id, "step:outdoor_unit"));
    expect(result.view.step?.step_id).toBe("fan_moving");
    const active = await state(id);
    expect(active.screen.questions.map(question => question.question_id)).toEqual(["check:fan_moving"]);
    expect(active.ledger.attempts).toContainEqual(expect.objectContaining({ accepted: true, charged_units: 3,
      operation: expect.objectContaining({ kind: "media", question_id: "step:outdoor_unit" }) }));
    await accepted(await finish(id));
    expect((await state(id)).screen.questions).toEqual([]);
    const resume = await walkthroughGet(new Request(`http://localhost/api/intake/walkthrough?request_id=${id}&k=${encodeURIComponent(key(id))}`));
    expect(await resume.json()).toEqual({ view: { step: null, outcome: null } });
  }, 20_000);

  it("keeps the emitted screen's remaining roles stable across individual skips and a fresh process", async () => {
    const id = await start();
    const first = await state(id);
    const roles = first.screen.questions.map(question => question.source_key);
    expect(new Set(roles)).toEqual(new Set(["unit_model_serial", "symptom_timing", "thermostat_photo"]));
    await page(id); // The actual complete-page render durably records its emitted group.
    expect((await readIntakeEffort({ request_id: id, tenant_id: "prn" })).attempts.at(-1)?.operation.kind).toBe("selection");
    const skipped = new Set<string>();
    for (const field of ["unit_model_serial", "symptom_timing"]) {
      await accepted(await answer(id, { fields: [{ field_key: field, value: CANNOT_REACH_FIELD_VALUE }] }));
      skipped.add(field);
      resetRuntimeStore();
      const current = await state(id);
      expect(current.screen.questions.map(question => question.source_key)).toEqual(roles.filter(role => !skipped.has(role)));
      const html = activeScreen(await page(id));
      expect(html).not.toContain('data-field="brand"'); expect(html).not.toContain('data-field="system_age"');
      expect(html).toContain('data-field="thermostat_photo"');
    }
    const child = execFileSync(process.execPath, ["--import", "tsx", "-e", `
      globalThis.fetch = () => { throw new Error("External services forbidden"); };
      const { loadJourneyContext } = require("./src/platform/intake/complete.ts");
      const { intakeReadiness } = require("./src/platform/intake/readiness.ts");
      (async () => {
        const state = await intakeReadiness(await loadJourneyContext(process.argv[1]));
        process.stdout.write(JSON.stringify({ roles: state.screen.questions.map(q => q.source_key), spent: state.ledger.effort_spent }));
      })().catch(error => { process.stderr.write(error.message); process.exitCode = 1; });
    `, id], { cwd: process.cwd(), env: process.env, encoding: "utf8", windowsHide: true, timeout: 15_000 });
    expect(JSON.parse(child)).toEqual({ roles: ["thermostat_photo"], spent: 7 });
    await accepted(await answer(id, { fields: [{ field_key: "thermostat_photo", value: CANNOT_REACH_FIELD_VALUE }] }));
    const next = await state(id);
    expect(next.screen.questions.length).toBeGreaterThan(0);
    expect(next.screen.questions.every(question => !roles.includes(question.source_key))).toBe(true);
    await page(id);
    const ledger = await readIntakeEffort({ request_id: id, tenant_id: "prn" });
    expect(ledger.effort_spent).toBe(8);
    expect(ledger.attempts.filter(attempt => attempt.operation.kind === "selection").every(attempt => attempt.charged_units === 0)).toBe(true);
    expect(ledger.attempts.at(-1)?.operation.selection_decisions).toEqual(next.screen.decisions);
  }, 25_000);

  it("opening facts suppress repeat questions and an unchanged page view does not spend effort", async () => {
    const description = "My Carrier AC is 8 years old and blowing warm air since Tuesday.";
    const id = await start(description); const first = await state(id);
    expect(first.ledger.effort_spent).toBe(5);
    for (const name of ["brand", "system_age", "symptom_timing"]) {
      expect(first.facts.fields[name]?.value).toBeTruthy();
      expect(first.screen.questions.some(q => q.fills_fields.includes(name))).toBe(false);
    }
    const html = await page(id); expect(html).toContain("data-acknowledgement"); expect(html).toContain("Carrier");
    const active = activeScreen(html); const review = collapsedSavedReview(html);
    for (const name of ["brand", "system_age", "symptom_timing"]) {
      expect(active).not.toContain(`data-field="${name}"`);
      expect(review).toContain(`data-field="${name}"`);
    }
    expect(review).toContain("Carrier"); expect(review).toContain("8 years"); expect(review).toContain("Tuesday");
    const ledger = await readIntakeEffort({ request_id: id, tenant_id: "prn" }); await page(id);
    expect(await readIntakeEffort({ request_id: id, tenant_id: "prn" })).toEqual(ledger);
    const decision = ledger.attempts.find(a => a.operation.kind === "selection");
    expect(decision?.operation.selection_decisions).toEqual(first.screen.decisions);
    expect(decision?.charged_units).toBe(0);
  });

  it("six accepted actions total fourteen units and produce an honest versioned handoff", async () => {
    // This proves actual charged actions, not six rendered screens or elapsed effort.
    const description = "My AC is not cooling. It started Tuesday.";
    const id = await start(description); await accepted(await answer(id, { address }));
    const reader = vi.fn(async () => label); __setLabelReaderForTests(reader);
    await accepted(await photo(id));
    await accepted(await answer(id, { fields: [{ field_key: "vulnerable_occupant", value: "No" }] }));
    await accepted(await answer(id, { fields: [{ field_key: "safety_signals", value: "None of these" }] }));
    await accepted(await finish(id));
    expect(reader).toHaveBeenCalledTimes(1);
    const ledger = await readIntakeEffort({ request_id: id, tenant_id: "prn" });
    expect(ledger.attempts.filter(a => a.operation.kind !== "selection").map(a => a.charged_units)).toEqual([5, 4, 3, 1, 1, 0]);
    expect(ledger.effort_spent).toBe(14);
    const packet = await savedPacket(id); const snapshot = packet.intake_snapshot!;
    expect(snapshot).toMatchObject({ packet_id: packet.job_packet_id, packet_version: packet.packet_version,
      policy_version: READINESS_POLICY_VERSION, effort_spent: 14 });
    expect(snapshot.handoff.equipment).toMatchObject({ brand: "Carrier", model: "24ABC636A003", serial: "4021E19845", manufacture_year: 2018 });
    expect(snapshot.handoff.property).toMatchObject({ street: address.street, city_state_zip: address.city_state_zip,
      type: address.property_type, storeys: address.storeys, source: "typed" });
    expect(snapshot.handoff.user_language).toBe(description);
    expect(createHash("sha256").update(snapshot.handoff.facts.find(f => f.claim_class === "SUPPLIED" && f.text === description)!.text).digest("hex"))
      .toBe(createHash("sha256").update(description).digest("hex"));
    expect(snapshot.readiness.dimensions.map(d => d.dimension)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
    expect(validateHandoffTrace(snapshot.handoff, (await state(id)).registry)).toEqual([]);
    const rendered = await loadPacket(id, { owner: true, link_base: "https://example.test" });
    expect(rendered?.input?.problem.homeowner_words).toBe(description);
    expect(rendered?.input?.equipment.model?.value).toBe("24ABC636A003");
  }, 20_000);

  it("a label populates several fields and neither selector nor DOM re-asks those facts", async () => {
    const id = await start(); __setLabelReaderForTests(async () => label); await accepted(await photo(id));
    const current = await state(id);
    for (const field of ["brand", "system_age", "unit_model_serial", "equipment_type"]) {
      expect(current.facts.fields[field]?.value).toBeTruthy();
      expect(current.screen.questions.some(q => q.fills_fields.includes(field))).toBe(false);
    }
    const html = await page(id);
    const active = activeScreen(html); const review = collapsedSavedReview(html);
    for (const field of ["brand", "system_age", "unit_model_serial", "equipment_type"]) {
      expect(active).not.toContain(`data-field="${field}"`);
      expect(review).toContain(`data-field="${field}"`);
    }
    expect(review).toContain("24ABC636A003"); expect(review).toContain("Carrier"); expect(review).toContain("Split-system AC");
    expect((await readIntakeEffort({ request_id: id, tenant_id: "prn" })).effort_spent).toBe(8);
  }, 15_000);

  it("a prior typed value is retained when a later label disagrees", async () => {
    const id = await start(); await accepted(await answer(id, { fields: [{ field_key: "brand", value: "Trane" }] }));
    __setLabelReaderForTests(async () => label); await accepted(await photo(id));
    const current = await state(id);
    expect(current.facts.fields.brand).toMatchObject({ value: "Trane", claim_class: "SUPPLIED" });
    expect(current.screen.questions.some(q => q.fills_fields.includes("brand"))).toBe(false);
    expect((await savedPacket(id)).intake_snapshot?.handoff.equipment.brand).toBe("Trane");
  }, 15_000);

  it("uncertain label characters request confirmation and that separate tap costs one", async () => {
    const id = await start();
    await page(id);
    if (!label.ok) throw new Error("Expected readable synthetic label");
    __setLabelReaderForTests(async () => ({ ...label, confidence: { ...label.confidence, model: "low", serial: "low" } }));
    await accepted(await photo(id));
    const before = await state(id);
    expect(before.facts.fields.unit_model_serial).toMatchObject({ claim_class: "INFERRED", confidence: "low", confirmed: false });
    expect(before.screen.questions).toContainEqual(expect.objectContaining({ source_key: "unit_model_serial", input_type: "confirm", effort_units: 1 }));
    expect(before.screen.questions.map(question => question.source_key)).toEqual(["unit_model_serial", "thermostat_photo", "symptom_timing"]);
    await accepted(await answer(id, { fields: [{ field_key: "unit_model_serial", value: before.facts.fields.unit_model_serial.value!, confirmed: true }] }));
    const after = await state(id);
    expect(after.ledger.effort_spent).toBe(9);
    expect(after.facts.fields.unit_model_serial).toMatchObject({ status: "CONFIRMED", claim_class: "SUPPLIED", confirmed: true });
    expect(after.screen.questions.some(q => q.fills_fields.includes("unit_model_serial"))).toBe(false);
    expect(after.screen.questions.map(question => question.source_key)).toEqual(["thermostat_photo", "symptom_timing"]);
  }, 15_000);

  it("cannot-reach escapes become explicit gaps and still reach a finished packet", async () => {
    const id = await start("my ac isn't working");
    await accepted(await answer(id, { fields: ["unit_model_serial", "thermostat_photo"].map(field_key => ({ field_key, value: CANNOT_REACH_FIELD_VALUE })) }));
    const current = await state(id);
    for (const field of ["unit_model_serial", "thermostat_photo"]) {
      expect(current.facts.fields[field]).toMatchObject({ value: null, status: "INACCESSIBLE" });
      expect(current.screen.questions.some(q => q.fills_fields.includes(field))).toBe(false);
    }
    await accepted(await finish(id));
    const packet = await savedPacket(id);
    for (const field of ["unit_model_serial", "thermostat_photo"]) expect(packet.intake_snapshot?.handoff.unknowns)
      .toContainEqual(expect.objectContaining({ fact: field, status: "INACCESSIBLE", reason: expect.stringMatching(/could not reach/i) }));
    expect((await state(id)).screen.questions).toEqual([]);
    expect(await page(id)).toContain("data-intake-finished");
    const loaded = await loadPacket(id, { owner: true, link_base: "https://example.test" });
    expect(loaded?.input?.property).toMatchObject({ street: "", city_state_zip: "", unknown_reason: expect.any(String) });
    const rendered = renderPacketHtml(loaded!.input!);
    expect(rendered.self_check).toMatchObject({ ok: true, failures: [] });
    expect(rendered.html).toContain("Job address still unknown.");
    const actual = await packetGet(new Request(`https://example.test/packet/${id}?k=${encodeURIComponent(key(id))}`), { params: Promise.resolve({ request_id: id }) });
    expect(actual.status).toBe(200); expect(actual.headers.get("x-packet-self-check")).toBe("ok");
    const actualHtml = await actual.text();
    expect(actualHtml).toContain("Job address still unknown.");
    expect(actualHtml).toContain("Page 3 — for the provider");
    expect(actualHtml).not.toContain("Where is the job?");
  }, 15_000);

  it("cap refusal changes neither captured facts nor private media and finishing costs nothing", async () => {
    const id = await start(); await page(id); await accepted(await answer(id, { address }));
    await accepted(await answer(id, { fields: [{ field_key: "outdoor_unit_location", value: "Side yard" }, { field_key: "air_handler_location", value: "Basement" }] }));
    await accepted(await answer(id, { fields: [{ field_key: "vulnerable_occupant", value: "No" }, { field_key: "damage_accruing", value: "No" }, { field_key: "safety_signals", value: "None of these" }] }));
    const before = await loadJourneyContext(id); const beforeAnswers = await runtimeStore().listIntakeAnswers(id);
    expect((await readIntakeEffort({ request_id: id, tenant_id: "prn" })).effort_spent).toBe(20);
    expect((await state(id)).screen.questions).toEqual([]);
    expect((await answer(id, { fields: [{ field_key: "thermostat_model", value: "Never accepted" }] })).status).toBe(409);
    const reader = vi.fn(async () => label); __setLabelReaderForTests(reader);
    expect((await photo(id)).status).toBe(409); expect(reader).not.toHaveBeenCalled();
    const after = await loadJourneyContext(id);
    expect(after?.allEvidence).toEqual(before?.allEvidence); expect(await runtimeStore().listIntakeAnswers(id)).toEqual(beforeAnswers);
    expect(after?.journey.packet).toEqual(before?.journey.packet);
    await accepted(await finish(id));
    expect((await savedPacket(id)).intake_snapshot?.effort_spent).toBe(20);
    expect((await loadPacket(id, { owner: true, link_base: "https://example.test" }))?.input).toBeTruthy();
  }, 20_000);

  it("foreign capability keys cannot charge, answer, upload or finish another request", async () => {
    const id = await start(); const other = await start(); const wrong = key(other);
    const before = await readIntakeEffort({ request_id: id, tenant_id: "prn" });
    expect((await answer(id, { fields: [{ field_key: "brand", value: "Trane" }] }, wrong)).status).toBe(404);
    expect((await photo(id, "unit_model_serial", wrong)).status).toBe(404);
    expect((await finish(id, wrong)).status).toBe(404);
    expect(await readIntakeEffort({ request_id: id, tenant_id: "prn" })).toEqual(before);
    expect(await runtimeStore().listIntakeAnswers(id)).toEqual([]);
  });

  it("the exhausted effort budget cannot suppress a newly reported safety hazard", async () => {
    const id = await start();
    await accepted(await answer(id, { fields: [
      { field_key: "outdoor_unit_location", value: "Side yard" }, { field_key: "air_handler_location", value: "Basement" },
      { field_key: "access_parking", value: "Driveway" }, { field_key: "vulnerable_occupant", value: "No" },
      { field_key: "damage_accruing", value: "No" }, { field_key: "safety_signals", value: "None of these" },
    ] }));
    expect((await readIntakeEffort({ request_id: id, tenant_id: "prn" })).effort_spent).toBe(20);
    const hazard = await accepted(await answer(id, { fields: [{ field_key: "safety_signals", value: "Burning smell" }] }));
    expect(hazard).toMatchObject({ safety: { intake_may_continue: false } });
    expect((await loadPacket(id, { owner: true, link_base: "https://example.test" }))?.safety_halt).toBeTruthy();
    expect((await readIntakeEffort({ request_id: id, tenant_id: "prn" })).effort_spent).toBe(20);
  }, 15_000);

  it("regeneration keeps every earlier snapshot bound to its own immutable packet version", async () => {
    const id = await start("My Carrier AC is not cooling since Tuesday."); await accepted(await answer(id, { address }));
    const earlier = await savedPacket(id); const oldSnapshot = JSON.stringify(earlier.intake_snapshot);
    advance(); await accepted(await answer(id, { fields: [{ field_key: "vent_airflow", value: "No airflow" }] }));
    const later = await savedPacket(id);
    expect(later.packet_version).toBe(earlier.packet_version + 1);
    expect(later.intake_snapshot?.packet_id).toBe(later.job_packet_id);
    expect(later.intake_snapshot?.packet_version).toBe(later.packet_version);
    expect(later.intake_snapshot?.handoff.fact_state.fields.vent_airflow?.value).toBe("No airflow");
    const storedEarlier = readDevDb().packets.find(p => p.job_packet_id === earlier.job_packet_id)!;
    expect(JSON.stringify(storedEarlier.intake_snapshot)).toBe(oldSnapshot);
    expect(storedEarlier.superseded_by).toBe(later.job_packet_id);
    const earlierOnset = earlier.intake_snapshot!.handoff.timeline.filter(t => !t.is_final);
    const laterOnset = later.intake_snapshot!.handoff.timeline.filter(t => !t.is_final);
    expect(laterOnset).toEqual(earlierOnset);
    expect(later.intake_snapshot?.handoff.timeline.at(-1)?.label).not.toBe(earlier.intake_snapshot?.handoff.timeline.at(-1)?.label);
  }, 15_000);

  it("unreadable label attempts stay honest and each real retry consumes three units", async () => {
    const id = await start();
    const reader = vi.fn(async (): Promise<LabelReadResult> => ({ ok: true, readable: false, fields: {}, confidence: {}, run_id: "synthetic-unreadable" }));
    __setLabelReaderForTests(reader);
    const first = await accepted(await photo(id)); const second = await accepted(await photo(id));
    expect(reader).toHaveBeenCalledTimes(2);
    expect((await readLabelReadings(id))).toEqual([
      expect.objectContaining({ evidence_id: first.evidence_id, extraction_status: "unreadable", confidence: {}, reason: expect.stringMatching(/did not yield a readable/i) }),
      expect.objectContaining({ evidence_id: second.evidence_id, extraction_status: "unreadable", confidence: {}, reason: expect.stringMatching(/did not yield a readable/i) }),
    ]);
    expect((await readLabelConfidence(id))).toBeNull();
    expect((await readIntakeEffort({ request_id: id, tenant_id: "prn" })).effort_spent).toBe(11);
    const current = await state(id);
    expect(current.facts.fields.unit_model_serial?.value).toBeNull();
    expect(current.facts.fields.unit_model_serial?.status).toBe("UNREADABLE");
    expect(current.facts.fields.unit_model_serial?.evidence_ids).toEqual([second.evidence_id]);
    expect((await runtimeStore().listIntakeAnswers(id)).every(a => a.value_text === null)).toBe(true);
    await accepted(await finish(id));
    expect((await savedPacket(id)).intake_snapshot?.handoff.equipment.model).toBeNull();
  }, 15_000);

  it("a readable retry resolves only its evidence gap and keeps actual typed values", async () => {
    const id = await start("My Trane AC is not cooling");
    const reader = vi.fn<() => Promise<LabelReadResult>>()
      .mockResolvedValueOnce({ ok: true, readable: false, fields: {}, confidence: {}, run_id: "synthetic-unreadable" })
      .mockResolvedValueOnce(label);
    __setLabelReaderForTests(reader);
    const first = await accepted(await photo(id));
    expect((await state(id)).facts.fields.unit_model_serial).toMatchObject({ value: null, status: "UNREADABLE", evidence_ids: [first.evidence_id] });
    const second = await accepted(await photo(id));
    expect(reader).toHaveBeenCalledTimes(2);
    const current = await state(id);
    expect(current.facts.fields.unit_model_serial).toMatchObject({ value: "Model 24ABC636A003, Serial 4021E19845", evidence_ids: [second.evidence_id] });
    expect(current.facts.fields.unit_model_serial.status).not.toBe("UNREADABLE");
    expect(current.facts.fields.brand.value).toMatch(/trane/i);
    expect(current.screen.questions.some(q => q.fills_fields.includes("unit_model_serial"))).toBe(false);
    expect((await readLabelReadings(id))?.map(record => record.extraction_status)).toEqual(["unreadable", "readable"]);
    expect((await readLabelConfidence(id))?.map(record => record.evidence_id)).toEqual([second.evidence_id]);
    const ledger = await readIntakeEffort({ request_id: id, tenant_id: "prn" });
    expect(ledger.effort_spent).toBe(11);
    expect(ledger.attempts.filter(attempt => attempt.operation.kind === "media").map(attempt => attempt.charged_units)).toEqual([3, 3]);
    const snapshot = (await savedPacket(id)).intake_snapshot!;
    expect(snapshot.handoff.equipment.model).toBe("24ABC636A003");
    expect(snapshot.handoff.fact_state.fields.unit_model_serial.evidence_ids).toEqual([second.evidence_id]);
    expect(JSON.stringify(snapshot)).not.toContain("__unreadable__");
    const printed = (await loadPacket(id, { owner: true, link_base: "https://example.test" }))!.input!;
    expect(printed.evidence.media.find(item => item.id === first.evidence_id)?.provenance).toBe("seen_in_photo_or_video");
    expect(printed.evidence.media.find(item => item.id === second.evidence_id)?.provenance).toBe("read_from_label");
  }, 15_000);

  it("a later unreadable upload cannot erase an already held readable model", async () => {
    const id = await start();
    const reader = vi.fn<() => Promise<LabelReadResult>>().mockResolvedValueOnce(label)
      .mockResolvedValueOnce({ ok: true, readable: false, fields: {}, confidence: {}, run_id: "synthetic-unreadable-retry" });
    __setLabelReaderForTests(reader);
    const readable = await accepted(await photo(id)); const unreadable = await accepted(await photo(id));
    const current = await state(id);
    expect(current.facts.fields.unit_model_serial).toMatchObject({ value: "Model 24ABC636A003, Serial 4021E19845", evidence_ids: [readable.evidence_id] });
    expect((await savedPacket(id)).intake_snapshot?.handoff.equipment.model).toBe("24ABC636A003");
    expect((await readLabelReadings(id))?.find(record => record.evidence_id === unreadable.evidence_id)?.extraction_status).toBe("unreadable");
    expect((await readLabelConfidence(id))?.map(record => record.evidence_id)).toEqual([readable.evidence_id]);
    expect(reader).toHaveBeenCalledTimes(2); expect(current.ledger.effort_spent).toBe(11);
  }, 15_000);

  it.each(["refused", "throws", "governed_refusal"] as const)("a %s reader records a completed failure, without fabricated unreadability or answer text", async mode => {
    const id = await start();
    __setLabelReaderForTests(async () => {
      if (mode === "throws") throw new Error("synthetic reader failure");
      if (mode === "governed_refusal") return { ok: true, readable: false, fields: {}, confidence: {}, run_id: "synthetic-governor-refusal", extraction_status: "failed" };
      return { ok: false, reason: "synthetic refusal" };
    });
    const result = await accepted(await photo(id));
    expect((await readLabelReadings(id))).toEqual([expect.objectContaining({ evidence_id: result.evidence_id, extraction_status: "failed", confidence: {}, reason: expect.any(String) })]);
    expect((await readLabelConfidence(id))).toBeNull();
    expect((await state(id)).facts.fields.unit_model_serial).toMatchObject({ value: null, status: "UNKNOWN_AFTER_REASONABLE_ATTEMPT", evidence_ids: [result.evidence_id] });
    expect((await runtimeStore().listIntakeAnswers(id)).every(a => a.value_text === null)).toBe(true);
    expect((await readIntakeEffort({ request_id: id, tenant_id: "prn" })).effort_spent).toBe(8);
  }, 15_000);

  it("a step upload spending the final three units emits no unaffordable next check", async () => {
    const id = await start();
    await accepted(await answer(id, { step: { step_id: "filter", answer: "2" } }));
    await accepted(await answer(id, { fields: [{ field_key: "outdoor_unit_location", value: "Side yard" }, { field_key: "air_handler_location", value: "Basement" }] }));
    await accepted(await answer(id, { fields: [{ field_key: "vulnerable_occupant", value: "No" }, { field_key: "damage_accruing", value: "No" }, { field_key: "safety_signals", value: "None of these" }] }));
    expect((await state(id)).ledger.effort_spent).toBe(17);
    const result = await accepted(await photo(id, "step:outdoor_unit"));
    expect(result.view).toEqual({ step: null, outcome: null });
    const current = await state(id);
    expect(current.ledger.effort_spent).toBe(20);
    expect(current.position.currentStepId).toBe("fan_moving");
    expect(current.screen.questions).toEqual([]);
    expect(current.ledger.attempts.filter(attempt => attempt.operation.kind === "media")).toContainEqual(expect.objectContaining({ charged_units: 3, accepted: true }));
  }, 20_000);
});
