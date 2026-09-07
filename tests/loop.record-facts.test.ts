import { describe, expect, it } from "vitest";
import type { IntakeAnswer } from "@/domain/intake/playbook";
import { HVAC_COOLING_PLAYBOOK } from "@/domain/intake/playbooks/hvac-cooling";
import { recordFacts } from "@/platform/links/views";

function answer(field_key: string, value_text: string): IntakeAnswer {
  return { request_id: "rq_fixture", field_key, value_text, source: "typed", evidence_id: null, answered_at: "2026-09-05T00:00:00Z" };
}

describe("Home Memory fact projection", () => {
  it("shows each mapped field once when packet labels and stored field identifiers differ", () => {
    const answers = [answer("brand", "Carrier"), answer("system_age", "8 years"), answer("symptom_timing", "since Tuesday"), answer("thermostat_photo", "Room 78, set 72")];
    const details = answers.map(a => ({ label: HVAC_COOLING_PLAYBOOK.required_fields.find(f => f.field_key === a.field_key)!.label, value: a.value_text!, source: a.source }));
    expect(recordFacts(details, answers, HVAC_COOLING_PLAYBOOK.playbook_id)).toEqual([
      { label: "Brand", value: "Carrier", source: "you typed it" },
      { label: "Age", value: "8 years", source: "you typed it" },
      { label: "When it started", value: "since Tuesday", source: "you typed it" },
      { label: "Thermostat", value: "Room 78, set 72", source: "you typed it" },
    ]);
  });
  it("retains a newly read field before packet regeneration and keeps its provenance", () => {
    const fresh = { ...answer("unit_model_serial", "38MURAQ24"), source: "confirmed" as const };
    expect(recordFacts([{ label: "Brand", value: "Carrier", source: "typed" }], [fresh], HVAC_COOLING_PLAYBOOK.playbook_id)).toContainEqual({ label: "Model and serial number", value: "38MURAQ24", source: "you confirmed it" });
  });
  it("does not collapse different facts merely because values match or expose an unknown raw field identifier", () => {
    const result = recordFacts([], [answer("brand", "Unknown"), answer("system_age", "Unknown"), answer("internal_fixture_field", "Observed detail")], HVAC_COOLING_PLAYBOOK.playbook_id);
    expect(result).toHaveLength(3);
    expect(result[2]).toMatchObject({ label: "Additional detail", value: "Observed detail" });
    expect(JSON.stringify(result)).not.toContain("internal_fixture_field");
  });
  it("maps printed field aliases once and uses the latest homeowner correction before packet regeneration", () => {
    const old = { ...answer("thermostat_setpoint_f", "72"), source: "photo" as const };
    const corrected = { ...answer("thermostat_setpoint", "22 C"), answered_at: "2026-09-06T00:00:00Z" };
    const reread = { ...old, value_text: "70", answered_at: "2026-09-07T00:00:00Z" };
    expect(recordFacts([{ label: "thermostat_setpoint_f", value: "72", source: "photo" }], [reread, corrected, old], HVAC_COOLING_PLAYBOOK.playbook_id)).toEqual([
      { label: "Set temperature", value: "22 C", source: "you typed it" },
    ]);
  });
  it("updates a non-thermostat field without changing an unrelated saved fact", () => {
    const old = { ...answer("brand", "Old brand"), source: "photo" as const };
    const corrected = { ...answer("brand", "Corrected brand"), answered_at: "2026-09-06T00:00:00Z" };
    expect(recordFacts([{ label: "Brand", value: "Old brand", source: "photo" }, { label: "Age", value: "8 years", source: "typed" }], [old, corrected], HVAC_COOLING_PLAYBOOK.playbook_id)).toEqual([
      { label: "Brand", value: "Corrected brand", source: "you typed it" }, { label: "Age", value: "8 years", source: "you typed it" },
    ]);
  });
  it("retains a historical packet-only reading when there is no answer history to replace it", () => {
    expect(recordFacts([{ label: "thermostat_setpoint", value: "72 F", source: "typed" }], [], HVAC_COOLING_PLAYBOOK.playbook_id, {})).toEqual([
      { label: "Set temperature", value: "72 F", source: "you typed it" },
    ]);
  });
  it("does not assign temperature units to a unitless projected display", () => {
    expect(recordFacts([], [], HVAC_COOLING_PLAYBOOK.playbook_id, { thermostat_setpoint: { value: "22", provenance: "reported" } })).toEqual([
      { label: "Set temperature", value: "22 (unit not supplied)", source: "you reported it" },
    ]);
  });
});
