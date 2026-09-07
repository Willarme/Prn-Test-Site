import { describe, expect, it } from "vitest";
import { buildFactCountBasis, FactCountBasis, validateFactCountBasis as validateBasis, projectFactCountComponents } from "@/domain/intake/fact-count";
import { buildIntakeRegistry, CurrentFact, type CurrentFactState } from "@/domain/intake/readiness";
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


describe("T8-39 sourced printed observations in the canonical count", () => {
  it.each(["auto", "on", "circulate"] as const)("counts explicit fan %s once beside three display readings", fan => {
    const s = state({ thermostat_photo: `Mode COOL, fan ${fan}, set 72 F, room 81 F` });
    const input = thinInput(); input.evidence.readings = {
      thermostat_mode: { value: "cool", provenance: "reported" }, fan_mode: { value: fan, provenance: "reported" },
      thermostat_setpoint: { value: "72 F", unit: "F", provenance: "reported" }, thermostat_setpoint_f: { value: 72, provenance: "reported" },
      room_temp: { value: "81 F", unit: "F", provenance: "reported" }, room_temp_f: { value: 81, provenance: "reported" },
    };
    const b = basis(s, input);
    expect(ids(b)).toEqual(["equipment.control.fan_mode", "equipment.control.mode", "equipment.control.room_temperature", "equipment.control.setpoint"]);
    expect(validateFactCountBasis(b, s, playbook, 4, input)).toEqual([]);
    const omitted = structuredClone(b); omitted.observations = omitted.observations.filter(o => o.id !== "equipment.control.fan_mode");
    expect(validateFactCountBasis(omitted, s, playbook, 3, input).join(" ")).toMatch(/fan_mode.*absent/);
  });
  it.each(["22 C", "72", "72 F"])("counts the same setpoint topic for %s without converting or adding aliases", value => {
    const s = state({ thermostat_setpoint: value }); const input = thinInput();
    input.evidence.readings = { thermostat_setpoint: { value, provenance: "reported" } };
    expect(ids(basis(s, input))).toEqual(["equipment.control.setpoint"]);
    expect(projectFactCountComponents(input).thermostat_setpoint).toBe(value);
    expect(projectFactCountComponents(input).thermostat_setpoint_f).toBeNull();
  });
  it("binds the current compound correction to its held field rather than an older split reading", () => {
    const s = state({ fan_mode: "AUTO", thermostat_photo: "fan ON" }); const input = thinInput();
    input.evidence.readings = { fan_mode: { value: "on", provenance: "reported", source_media: null } };
    input.evidence.reading_fields = { fan_mode: "thermostat_photo" };
    const b = basis(s, input);
    expect(b.observations).toEqual([{ id: "equipment.control.fan_mode", source_fields: ["thermostat_photo"], evidence_ids: ["evidence:thermostat_photo"] }]);
    const stale = structuredClone(b); stale.observations[0].source_fields = ["fan_mode"]; stale.observations[0].evidence_ids = ["evidence:fan_mode"];
    expect(validateFactCountBasis(stale, s, playbook, 1, input).join(" ")).toMatch(/incorrect sources/);
  });
  it.each(["inference", "unknown"] as const)("does not count an unconfirmed %s fan interpretation", provenance => {
    const s = state({ fan_mode: "auto" }); const input = thinInput(); input.evidence.readings = { fan_mode: { value: "auto", provenance } };
    expect(ids(basis(s, input))).toEqual([]);
    const forged = { ...basis(s, input), observations: [{ id: "equipment.control.fan_mode", source_fields: ["fan_mode"], evidence_ids: ["evidence:fan_mode"] }] };
    expect(validateFactCountBasis(forged, s, playbook, 1, input).join(" ")).toMatch(/no normalized component/);
  });
  it("counts a supplied nominal-size tuple and a printed capacity once each, excluding unconfirmed interpretation", () => {
    const s = state({ filter_nominal_dimensions: "16 x 20 x 1 in", printed_cooling_capacity: "36,000 Btu/h" });
    expect(ids(basis(s))).toEqual(["equipment.filter.nominal_dimensions", "equipment.primary.printed_cooling_capacity"]);
    for (const f of Object.values(s.fields)) f.claim_class = "INFERRED";
    expect(ids(basis(s))).toEqual([]);
  });
  it("continues validating an earlier private 1.1 projection without additive reading keys", () => {
    const s = state({ thermostat_photo: "Mode cool, set 72 F, room 81 F" }); const input = thinInput();
    input.evidence.readings = { thermostat_mode: { value: "cool", provenance: "reported" }, thermostat_setpoint_f: { value: 72, provenance: "reported" }, room_temp_f: { value: 81, provenance: "reported" } };
    const b = { ...basis(s, input), definition_version: "recorded-observations-1.0.0" as const };
    const old = { model: null, serial: null, onset_date: null, onset_character: null, thermostat_mode: "cool", thermostat_setpoint_f: 72, room_temp_f: 81 };
    expect(validateBasis(b, s, playbook, 3, old)).toEqual([]);
  });
  it("retains an older saved definition that did not count supplied printed capacity or dimensions", () => {
    const s = state({ filter_nominal_dimensions: "16 x 20 x 1 in", printed_cooling_capacity: "36,000 Btu/h", thermostat_photo: "fan AUTO, set 22 C" });
    const old = { model: null, serial: null, onset_date: null, onset_character: null, thermostat_mode: null, thermostat_setpoint_f: null, room_temp_f: null };
    const saved = FactCountBasis.parse({ definition_version: "recorded-observations-1.0.0", unit: "recorded_observation_topic", request_id: s.request_id, tenant_id: "prn",
      observations: [{ id: "equipment.control.display_report", source_fields: ["thermostat_photo"], evidence_ids: ["evidence:thermostat_photo"] }] });
    expect(validateBasis(saved, s, playbook, 1, old)).toEqual([]);
    const current = thinInput(); current.evidence.readings = { fan_mode: { value: "auto", provenance: "reported" }, thermostat_setpoint: { value: "22 C", provenance: "reported" } };
    const b = basis(s, current);
    expect(b.definition_version).toBe("recorded-observations-1.1.0");
    expect(ids(b)).toEqual(["equipment.control.fan_mode", "equipment.control.setpoint", "equipment.filter.nominal_dimensions", "equipment.primary.printed_cooling_capacity"]);
    expect(validateBasis(saved, s, playbook, 1, projectFactCountComponents(current)).join(" ")).toMatch(/definition does not match/);
  });
});
