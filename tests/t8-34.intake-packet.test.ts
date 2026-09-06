import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { HVAC_COOLING_PLAYBOOK } from "@/domain/intake/playbooks/hvac-cooling";
import { HVAC_OPTIONAL_FIELDS } from "@/domain/intake/playbooks/hvac-optional-fields";
import { clarifierCandidates } from "@/domain/problem/clarifier";
import { orderedDetailFields, optionalDetailFields, validateQuestionPlan } from "@/platform/intake/question-plan";
import { renderPacketHtml } from "@/domain/packet/render";
import { MemoryAiPolicyStore, setAiPolicyStoreForTests } from "@/platform/ai/policy-store";
import { MemorySpendLedger, setSpendLedgerForTests } from "@/platform/ai/spend";
import { signLink } from "@/platform/links/tokens";
import { resetRuntimeStore, runtimeStore } from "@/platform/stores/runtime";
import { loadPacket } from "@/platform/packet/load";
import { loadJourneyContext } from "@/platform/intake/complete";
import { __setLabelReaderForTests } from "@/platform/intake/media";
import { POST as startPost } from "@/app/api/intake/route";
import { POST as answerPost } from "@/app/api/intake/answer/route";
import { POST as mediaPost } from "@/app/api/intake/media/route";
import CompletePage from "@/app/complete/[request_id]/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  notFound: () => { throw new Error("not found"); },
  redirect: (to: string) => { throw new Error(`redirect:${to}`); },
}));

const REPORT = "2026-09-06T15:00:00Z";
const RENDER_LATER = "2026-09-15T15:00:00Z";
const network = vi.fn(() => { throw new Error("Network/model calls forbidden in T8-34 tests"); });
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "prn-t834-intake-"));
  vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "dev-db.json"));
  vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubGlobal("fetch", network);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(REPORT));
  resetRuntimeStore();
  setAiPolicyStoreForTests(new MemoryAiPolicyStore()); // all capabilities disabled
  setSpendLedgerForTests(new MemorySpendLedger());
  __setLabelReaderForTests(null);
});
afterAll(() => {
  expect(network).not.toHaveBeenCalled();
  __setLabelReaderForTests(undefined);
  setAiPolicyStoreForTests(null);
  setSpendLedgerForTests(null);
  resetRuntimeStore();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

async function start(description = "My AC is not cooling") {
  vi.setSystemTime(new Date(REPORT));
  const res = await startPost(new Request("http://localhost/api/intake", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ description, disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: { landing_path: "/start", problem_family_hint: "hvac-cooling", page_id: null,
        intent_cluster_id: null, search_opportunity_id: null, experiment_id: null, variant: null, referrer: null } }),
  }));
  expect(res.status).toBe(200);
  const id = (await res.json()).request_id as string;
  expect((await answer(id, { address: { street: "42 Example Street", city_state_zip: "Example Town, MD 00000" } })).status).toBe(200);
  return id;
}
function answer(id: string, body: object, k = signLink({ scope: "keep", request_id: id })) {
  return answerPost(new Request("http://localhost/api/intake/answer", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request_id: id, k, ...body }),
  }));
}
async function packet(id: string, now = REPORT) {
  const loaded = await loadPacket(id, { link_base: "https://example.test", now, owner: true });
  expect(loaded?.input).not.toBeNull();
  return loaded!.input!;
}

describe("T8-34 accepted-input capture and optional presentation", () => {
  it("keeps five automatic candidates while every permitted optional field reaches the real complete page", async () => {
    expect(clarifierCandidates(HVAC_COOLING_PLAYBOOK, []).map(f => f.field_key)).toEqual([
      "unit_model_serial", "symptom_timing", "brand", "system_age", "thermostat_photo",
    ]);
    const emptyPlan = { field_keys: [], engine: "deterministic" as const, run_id: null, max_questions: 0 };
    expect(orderedDetailFields(HVAC_COOLING_PLAYBOOK, [], emptyPlan)).toEqual([]);
    expect(optionalDetailFields(HVAC_COOLING_PLAYBOOK).map(f => f.field_key)).toEqual(HVAC_OPTIONAL_FIELDS.map(f => f.field_key));
    expect(validateQuestionPlan({ ...emptyPlan, field_keys: ["sh_refrigerant"], max_questions: 1 }, HVAC_COOLING_PLAYBOOK)).toBeNull();
    const id = await start();
    const html = renderToStaticMarkup(await CompletePage({ params: Promise.resolve({ request_id: id }),
      searchParams: Promise.resolve({ k: signLink({ scope: "keep", request_id: id }) }) }));
    expect(html).toContain('<div class="eyebrow">Cooling problem</div>');
    expect(html).not.toContain('<div class="eyebrow">AC runs');
    for (const field of HVAC_OPTIONAL_FIELDS) expect(html).toContain(`data-field="${field.field_key}"`);
    for (const group of ["context", "history", "access"]) {
      expect(html).toMatch(new RegExp(`<details[^>]*data-optional-group="${group}"`));
      expect(html).not.toMatch(new RegExp(`<details[^>]*open[^>]*data-optional-group="${group}"`));
    }
    expect(html).not.toMatch(/data-field="(?:access_gate|gate_or_entry_code|access_entry_code)"/);
    const input = await packet(id);
    expect(input.access).toEqual({});
    expect(input.provider.service_history).toEqual([]);
    expect(input.problem).toMatchObject({ habitability: "degraded", vulnerable_occupant: false, damage_accruing: false, safety_state: "safety_not_established" });
    expect(renderPacketHtml(input).html).toContain("Not asked");
  });

  it("persists and renders all 22 voluntary answers through the same allowlist the UI uses", async () => {
    const id = await start();
    const values: Record<string, string> = {
      equipment_type: "Split-system AC", outdoor_unit_location: "East side yard", air_handler_location: "Basement",
      thermostat_model: "Example thermostat", vent_airflow: "Weak", filter_age_weeks: "4", urgency: "Today",
      habitability: "lost", vulnerable_occupant: "Yes", damage_accruing: "Yes", safety_signals: "None of these",
      sh_refrigerant: "No", sh_recent_service: "Example Heating serviced it in 2025", sh_impact: "No", sh_room_variance: "Yes",
      access_occupancy: "Someone will be home", access_owner_present: "Yes", access_parking: "Two driveway spaces",
      access_pets: "Dog will be secured", access_route: "Side path to the outdoor unit", access_window: "Morning preferred", access_contact: "Text preferred",
    };
    expect(Object.keys(values).sort()).toEqual(HVAC_OPTIONAL_FIELDS.map(f => f.field_key).sort());
    const res = await answer(id, { fields: Object.entries(values).map(([field_key, value]) => ({ field_key, value })) });
    expect(res.status).toBe(200);
    const rows = await runtimeStore().listIntakeAnswers(id);
    const ctx = await loadJourneyContext(id);
    for (const [field_key, value] of Object.entries(values)) {
      const row = rows.find(r => r.field_key === field_key);
      expect(row).toMatchObject({ value_text: value, source: "typed", answered_at: REPORT.replace("Z", ".000Z") });
      expect(ctx?.allEvidence.find(e => e.evidence_id === row?.evidence_id)?.content).toContain(value);
    }
    const input = await packet(id);
    expect(input.equipment).toMatchObject({ type: { value: values.equipment_type, provenance: "reported" },
      outdoor_unit_location: { value: values.outdoor_unit_location }, air_handler_location: { value: values.air_handler_location },
      thermostat: { value: values.thermostat_model } });
    expect(input.problem).toMatchObject({ habitability: "lost", vulnerable_occupant: true, damage_accruing: true,
      urgency_level: "same_day", safety_state: "no_hazard_reported" });
    expect(input.provider.service_history.map(h => [h.question_id, h.answer])).toEqual([
      ["sh_refrigerant", "No"], ["sh_recent_service", values.sh_recent_service], ["sh_impact", "No"], ["sh_room_variance", "Yes"],
    ]);
    const accessMap = { occupancy: "access_occupancy", owner_present_needed: "access_owner_present", parking: "access_parking",
      pets: "access_pets", equipment_route: "access_route", preferred_window: "access_window", contact_preference: "access_contact" } as const;
    for (const [key, field] of Object.entries(accessMap)) expect(input.access?.[key as keyof typeof accessMap]?.value).toBe(values[field]);
    expect(input.narrative.facts).toContainEqual(expect.objectContaining({ text: "Air from vents is weak", provenance: "reported" }));
    const rendered = renderPacketHtml(input);
    expect(rendered.self_check).toMatchObject({ ok: true });
    for (const field of ["equipment_type", "outdoor_unit_location", "air_handler_location", "thermostat_model", "sh_recent_service", ...Object.values(accessMap)]) {
      expect(rendered.html).toContain(values[field]);
    }
    // The renderer uses filter age with an actual filter observation, never manufactures a check.
    expect(input.provider.checks.some(c => c.name === "Filter condition")).toBe(false);
    expect((await answer(id, { step: { step_id: "filter", answer: "2" } })).status).toBe(200);
    const withFilter = await packet(id);
    expect(withFilter.narrative.facts).toContainEqual(expect.objectContaining({ text: "Filter clean, rated 2/10 by the homeowner, replaced ~4 weeks ago" }));
    expect(renderPacketHtml(withFilter).self_check.ok).toBe(true);
  });

  it("rejects forged choice values and unauthorized writes, and never accepts a code field", async () => {
    const id = await start();
    expect((await answer(id, { fields: [{ field_key: "habitability", value: "excellent" }] })).status).toBe(400);
    expect((await answer(id, { fields: [{ field_key: "sh_refrigerant", value: "Yes" }] }, "forged")).status).toBe(404);
    expect((await answer(id, { fields: [{ field_key: "gate_or_entry_code", value: "CODE-SECRET-1234" }] })).status).toBe(200);
    expect((await runtimeStore().listIntakeAnswers(id)).some(a => ["gate_or_entry_code", "sh_refrigerant", "habitability"].includes(a.field_key))).toBe(false);
    expect(JSON.stringify(await packet(id))).not.toContain("CODE-SECRET-1234");
    expect((await answer(id, { fields: [{ field_key: "safety_signals", value: "Not sure" }] })).status).toBe(200);
    expect((await packet(id)).problem.safety_state).toBe("safety_not_established");
  });

  it("runs the existing hard-stop gate on a newly supplied positive safety answer", async () => {
    const id = await start();
    const res = await answer(id, { fields: [{ field_key: "safety_signals", value: "Burning smell" }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ safety: { intake_may_continue: false } });
    expect((await loadPacket(id, { link_base: "https://example.test" }))?.safety_halt).toBeTruthy();
  });
});

describe("T8-34 label provenance and truthful complaint", () => {
  it("keeps a reported absence of airflow distinct from weak or unknown airflow", async () => {
    const id = await start();
    expect((await answer(id, { fields: [{ field_key: "vent_airflow", value: "No airflow" }] })).status).toBe(200);
    const input = await packet(id);
    expect(input.narrative.facts).toContainEqual(expect.objectContaining({ text: "Homeowner reports no airflow at the vents", provenance: "reported" }));
    expect(input.provider.checks).toContainEqual(expect.objectContaining({ result: "No airflow reported" }));
    expect(JSON.stringify(input.narrative)).not.toMatch(/airflow[^.]*weak|Air comes from|Indoor fan runs/);
    expect(renderPacketHtml(input).self_check.ok).toBe(true);
  });
  it("maps all five label values with photo provenance and preserves equipment type confirmation", async () => {
    const id = await start();
    __setLabelReaderForTests(async () => ({ ok: true, readable: true, fields: { equipment_type: "Split-system AC", brand: "Carrier", model: "24ABC636A003", serial: "4021E19845", manufacture_year: 2018 },
      confidence: { equipment_type: "medium", brand: "high", model: "high", serial: "medium", manufacture_year: "high" }, run_id: "stub-label-t834" }));
    const form = new FormData();
    form.set("request_id", id); form.set("k", signLink({ scope: "keep", request_id: id })); form.set("target", "unit_model_serial");
    form.set("file", new File([new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"))], "test-label.png", { type: "image/png" }));
    expect((await mediaPost(new Request("http://localhost/api/intake/media", { method: "POST", body: form }))).status).toBe(200);
    const labelInput = await packet(id);
    expect(labelInput.equipment).toMatchObject({
      type: { value: "Split-system AC", provenance: "read_from_label" },
      brand: { value: "Carrier", provenance: "read_from_label" },
      model: { value: "24ABC636A003", provenance: "read_from_label" },
      serial: { value: "4021E19845", provenance: "read_from_label" },
      age_years: 8, manufacture_year: 2018, age_provenance: "inference",
    });
    const mapped = (await runtimeStore().listIntakeAnswers(id)).filter(a => a.source === "photo" && a.value_text);
    expect(mapped.map(a => a.field_key).sort()).toEqual(["brand", "equipment_type", "system_age", "unit_model_serial"]);
    expect(new Set(mapped.map(a => a.evidence_id)).size).toBe(1);
    expect(mapped.every(a => a.evidence_id)).toBe(true);
    expect(renderPacketHtml(labelInput).self_check.ok).toBe(true);
    expect((await loadJourneyContext(id))?.labelConfidence.equipment_type).toBe("medium");
    expect((await answer(id, { fields: [{ field_key: "equipment_type", value: "Split-system AC", confirmed: true }] })).status).toBe(200);
    expect((await packet(id)).equipment.type).toEqual({ value: "Split-system AC", provenance: "read_from_label", confirmed_by_homeowner: true });
    __setLabelReaderForTests(null);
  });

  it.each(["My AC is not cooling", "My AC will not start", "The AC hums but I do not know if air is moving"])("does not invent running or airflow for %s", async description => {
    const id = await start(description);
    const input = await packet(id);
    expect(input.problem.homeowner_words).toBe(description);
    expect(JSON.stringify([input.problem.title, input.narrative])).not.toMatch(/AC running|AC is running|Air comes from the vents|Indoor fan runs|air from vents not cold|blowing warm air/);
    expect(input.narrative.facts).toContainEqual(expect.objectContaining({ text: `Homeowner reports: “${description}”`, provenance: "reported" }));
    expect(renderPacketHtml(input).self_check.ok).toBe(true);
  });
});

describe("T8-34 onset is an event, not the render date", () => {
  it.each([["yesterday", "2026-09-05", 1], ["Tuesday", "2026-09-01", 5], ["12 days ago", "2026-08-25", 12]] as const)("anchors opening %s to intake time", async (words, date, span) => {
    const id = await start(`My AC is not cooling. It started ${words}`);
    const early = await packet(id);
    const later = await packet(id, RENDER_LATER);
    for (const input of [early, later]) {
      expect(input.problem.onset_date).toBe(date);
      expect(input.problem.onset_span_days).toBe(span);
      expect(input.narrative.timeline.find(t => t.text.includes("first notices"))?.at).toBe(date);
    }
  });
  it("anchors a later explicit timing answer to that answer's timestamp", async () => {
    const id = await start();
    vi.setSystemTime(new Date("2026-09-08T15:00:00Z"));
    expect((await answer(id, { fields: [{ field_key: "symptom_timing", value: "It started yesterday" }] })).status).toBe(200);
    expect((await packet(id, RENDER_LATER)).problem.onset_date).toBe("2026-09-07");
  });
});
