import { describe, expect, it } from "vitest";
import { buildFactCountBasis, FactCountBasis, factCountFieldDisposition, validateFactCountBasis as validateBasis, projectFactCountComponents } from "@/domain/intake/fact-count";
import { buildIntakeRegistry, CurrentFact, type CurrentFactState } from "@/domain/intake/readiness";
import { PLAYBOOKS } from "@/domain/intake/playbooks";
import { HVAC_COOLING_PLAYBOOK } from "@/domain/intake/playbooks/hvac-cooling";
import { thinInput } from "./loop.p1.fixtures";

const registry = buildIntakeRegistry(HVAC_COOLING_PLAYBOOK);
const playbook = HVAC_COOLING_PLAYBOOK.playbook_id;
const at = "2026-09-06T17:00:00Z";
function fact(key: string, value: string | null, patch: Partial<CurrentFact> = {}): CurrentFact {
  return CurrentFact.parse({ field_key: key, value, status: value === null ? "UNKNOWN_AFTER_REASONABLE_ATTEMPT" : "PROVIDED_UNVERIFIED",
    reason: value === null ? "Not obtained" : null, source: "answer", claim_class: "SUPPLIED", evidence_ids: [`evidence:${key}`], captured_at: at,
    confidence: null, confirmed: false, ...patch });
}
function state(values: Record<string, string | null>): CurrentFactState {
  return { request_id: "request-one", policy_version: registry.version, fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, fact(key, value)])) };
}
function basis(s: CurrentFactState, input = thinInput(), tenant_id = "prn") {
  return buildFactCountBasis({ state: s, registry, input, tenant_id, playbook });
}
function validateFactCountBasis(b: FactCountBasis, s: CurrentFactState, p: string, count: number, input = thinInput()) {
  return validateBasis(b, s, p, count, projectFactCountComponents(input));
}
const ids = (b: FactCountBasis) => b.observations.map(o => o.id);

describe("T8-39 versioned whole-record observation identities", () => {
  it("lists the fourteen independently specified fresh-audit topics", () => {
    const s = state({ user_language: "AC is not cooling", symptom_detail: "AC is not cooling", brand: "Carrier", equipment_type: "outdoor central AC",
      unit_model_serial: "Carrier 24ABC630A003; serial TEST000123", thermostat_photo: "mode cool; set 70; room 78", symptom_timing: "Tuesday",
      "property.street": "10 Synthetic Street", "property.city_state_zip": "Test City PA 00000", "property.type": "Detached", "property.storeys": "2", "check:filter": "5" });
    const input = thinInput(); input.equipment.model = { value: "24ABC630A003", provenance: "reported" }; input.equipment.serial = { value: "TEST000123", provenance: "reported" };
    input.problem.onset_date = "2026-09-01"; input.problem.onset_span_days = 5; input.problem.onset_weekday_spoken = "Tuesday";
    input.evidence.readings = { thermostat_mode: { value: "cool", provenance: "reported" }, thermostat_setpoint_f: { value: 70, provenance: "reported" }, room_temp_f: { value: 78, provenance: "reported" } };
    expect(ids(basis(s, input))).toEqual([
      "equipment.control.mode", "equipment.control.room_temperature", "equipment.control.setpoint", "equipment.filter.condition",
      "equipment.primary.brand", "equipment.primary.model", "equipment.primary.serial", "equipment.primary.type", "problem.onset", "problem.report",
      "property.locality", "property.storeys", "property.street", "property.type",
    ]);
  });

  it("counts distinct history/access topics with identical words, while aliases and display copies do not inflate", () => {
    const s = state({ user_language: "AC failed", symptom_detail: "AC failed", sh_impact: "No", sh_refrigerant: "No", access_pets: "None", access_parking: "None",
      vent_airflow: "Normal", "check:vent_airflow": "Normal", system_age: "8 years", filter_age_weeks: "3", "check:filter": "2" });
    // An extra claim using a check-shaped key acquires no authored permission.
    const input = thinInput(); input.equipment.age_years = 8; input.equipment.manufacture_year = 2018;
    input.narrative.facts.push({ text: "Another display copy of all the same information", provenance: "reported" });
    const b = buildFactCountBasis({ state: s, registry, input, tenant_id: "prn", playbook });
    expect(ids(b)).toEqual(["access.parking", "access.pets", "equipment.filter.condition", "equipment.filter.replacement_age", "equipment.primary.age_basis", "equipment.vents.airflow", "history.sh_impact", "history.sh_refrigerant", "problem.report"]);
    expect(b.observations.find(o => o.id === "equipment.vents.airflow")?.source_fields).toEqual(["vent_airflow"]);
  });

  it("keeps unresolved supplied variants, correction and confirmation at one topic", () => {
    const s = state({ brand: "Carrier" }); const before = basis(s);
    s.fields.brand.evidence_ids.push("later-conflicting-report");
    const disputed = basis(s); expect(ids(disputed)).toEqual(["equipment.primary.brand"]);
    s.fields.brand = fact("brand", "Trane", { confirmed: true, status: "CONFIRMED", evidence_ids: ["later-confirmation"], corrected_by: "explicit-answer" });
    expect(ids(basis(s))).toEqual(ids(before));
    expect(basis(s).observations[0].evidence_ids).toEqual(["later-confirmation"]);
  });

  it("does not count gaps, policy, interpreted OCR, untraceable calculation or bare check media", () => {
    const s = state({ user_language: "AC failed", brand: "Carrier", system_age: "8", safety_gate: "passed", evidence_presence: "1", "check:outdoor_unit": "Photo captured for this check", unit_model_serial: null });
    s.fields.brand = fact("brand", "Carrier", { claim_class: "INFERRED", confidence: "high", source: "evidence" });
    s.fields.system_age = fact("system_age", "8", { claim_class: "CALCULATED", source: "derived" });
    s.fields.unit_model_serial = fact("unit_model_serial", null, { status: "PHOTO_PENDING_EXTRACTION", source: "evidence", reason: "Unread photo" });
    const input = thinInput(); input.equipment.model = { value: "UNCONFIRMED", provenance: "read_from_label" };
    expect(ids(basis(s, input))).toEqual(["problem.report"]);
    s.fields.system_age.derivation_id = "reported-manufacture-year-to-age";
    expect(ids(basis(s, input))).toEqual(["equipment.primary.age_basis", "problem.report"]);
  });

  it("keeps partial compound reports unsplit and does not invent missing serial or temperatures", () => {
    const s = state({ unit_model_serial: "Serial TEST000123", thermostat_photo: "The display responds", symptom_timing: "Worse at night" });
    const input = thinInput(); input.equipment.serial = { value: "TEST000123", provenance: "reported" };
    expect(ids(basis(s, input))).toEqual(["equipment.control.display_report", "equipment.primary.serial", "problem.timing_report"]);
  });

  it("distinguishes onset occurrence and explicit character, but aliases date, duration and weekday", () => {
    const s = state({ user_language: "AC failed", symptom_timing: "Gradually since Tuesday", onset_character: "Gradually" });
    const input = thinInput(); input.problem.onset_date = "2026-09-01"; input.problem.onset_weekday_spoken = "Tuesday";
    input.problem.onset_span_days = 5; input.problem.onset_character = "gradual";
    expect(ids(basis(s, input))).toEqual(["problem.onset", "problem.onset_character", "problem.report"]);
  });

  it("defines a disposition for every requirement in every shipped playbook", () => {
    for (const p of PLAYBOOKS) for (const r of buildIntakeRegistry(p).requirements) expect(factCountFieldDisposition(r.fact_type), `${p.playbook_id}:${r.fact_type}`).not.toBe("unmapped");
    const changed = structuredClone(registry); changed.requirements.push({ ...changed.requirements[0], fact_type: "new_unreviewed_field" });
    expect(() => buildFactCountBasis({ state: state({}), registry: changed, input: thinInput(), tenant_id: "prn", playbook })).toThrow(/new_unreviewed_field/);
  });

  it("is deterministic under field/evidence reordering and keeps tuple scope explicit", () => {
    const s = state({ brand: "Carrier", user_language: "AC failed" }); s.fields.brand.evidence_ids = ["b", "a", "a"];
    const one = basis(s, thinInput(), "tenant-one");
    s.fields = Object.fromEntries(Object.entries(s.fields).reverse()); s.fields.brand.evidence_ids = ["a", "b"];
    expect(basis(s, thinInput(), "tenant-one")).toEqual(one);
    expect(basis(s, thinInput(), "tenant-two")).toEqual({ ...one, tenant_id: "tenant-two" });
    const next = { ...s, request_id: "request-two" };
    expect(basis(next, thinInput(), "tenant-one")).toEqual({ ...one, request_id: "request-two" });
  });

  it("independently rejects duplicate identity, bad count, wrong request, unsupported mapping and borrowed evidence", () => {
    const s = state({ brand: "Carrier" }); const good = basis(s);
    expect(FactCountBasis.safeParse({ ...good, observations: [good.observations[0], good.observations[0]] }).success).toBe(false);
    expect(validateFactCountBasis(good, s, playbook, 9)).toContain("Fact counter must equal the serialized observation basis");
    expect(validateFactCountBasis({ ...good, request_id: "other" }, s, playbook, 1)).toContain("Fact count basis belongs to another request");
    const forged = structuredClone(good); forged.observations[0].id = "equipment.primary.serial";
    expect(validateFactCountBasis(forged, s, playbook, 1).join(" ")).toMatch(/authored topic mapping/);
    expect(validateFactCountBasis({ ...good, observations: [] }, s, playbook, 0).join(" ")).toMatch(/absent/);
    const prototype = structuredClone(good); prototype.observations[0].id = "__proto__";
    expect(validateFactCountBasis(prototype, s, playbook, 1).join(" ")).toMatch(/authored topic mapping/);
    const borrowed = structuredClone(good); borrowed.observations[0].evidence_ids = ["someone-else"];
    expect(validateFactCountBasis(borrowed, s, playbook, 1).join(" ")).toMatch(/evidence/);
    s.fields.brand = fact("brand", null);
    expect(validateFactCountBasis(good, s, playbook, 1).join(" ")).toMatch(/ineligible source/);
  });

  it("rejects omitted checks/components and phantom model/readings from merely populated compound sources", () => {
    const s = state({ unit_model_serial: "Serial TEST000123", thermostat_photo: "The display responds", "check:filter": "5" });
    const input = thinInput(); input.equipment.serial = { value: "TEST000123", provenance: "reported" };
    const good = basis(s, input);
    for (const omitted of ["equipment.primary.serial", "equipment.filter.condition"]) {
      const changed = structuredClone(good); changed.observations = changed.observations.filter(o => o.id !== omitted);
      expect(validateFactCountBasis(changed, s, playbook, changed.observations.length, input).join(" "), omitted).toMatch(/absent/);
    }
    for (const [id, key] of [["equipment.primary.model", "unit_model_serial"], ["equipment.control.mode", "thermostat_photo"],
      ["equipment.control.setpoint", "thermostat_photo"], ["equipment.control.room_temperature", "thermostat_photo"]]) {
      const changed = structuredClone(good); changed.observations.push({ id, source_fields: [key], evidence_ids: s.fields[key].evidence_ids });
      expect(validateFactCountBasis(changed, s, playbook, changed.observations.length, input).join(" "), id).toMatch(/no normalized component/);
    }
    s.fields["check:invented"] = fact("check:invented", "yes");
    const invented = structuredClone(good); invented.observations.push({ id: `check.${playbook}.invented`, source_fields: ["check:invented"], evidence_ids: s.fields["check:invented"].evidence_ids });
    expect(validateFactCountBasis(invented, s, playbook, invented.observations.length, input).join(" ")).toMatch(/authored topic mapping/);
  });
});
