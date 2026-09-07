import { z } from "zod";
import type { CurrentFact, CurrentFactState, IntakeRegistry } from "./readiness";
import type { DirectionsInput } from "@/domain/packet/types";
import { findPlaybook } from "./playbooks";

/** Directions §3 counts.facts_captured / Coverage §8.3. This definition counts
 * recorded observation topics, not sentences, evidence objects or truth claims.
 * Identity is (tenant, request, id); values/confirmation/evidence never change it.
 * Compound fields split only through the existing typed Directions projection.
 * See the versioned design receipt for the explicit split and alias rules. */
export const FACT_COUNT_DEFINITION_VERSION = "recorded-observations-1.1.0";
const LEGACY_DEFINITION_VERSION = "recorded-observations-1.0.0";
const PRINTED_DIRECT_FIELDS = new Set(["filter_nominal_dimensions", "printed_cooling_capacity"]);

const DIRECT: Readonly<Record<string, string>> = {
  user_language: "problem.report", symptom_detail: "problem.report",
  brand: "equipment.primary.brand", equipment_type: "equipment.primary.type", fixture_or_appliance: "equipment.primary.type",
  system_age: "equipment.primary.age_basis", outdoor_unit_location: "equipment.primary.outdoor_location",
  air_handler_location: "equipment.primary.indoor_location", thermostat_model: "equipment.control.identity", thermostat: "equipment.control.identity",
  vent_airflow: "equipment.vents.airflow", filter_age_weeks: "equipment.filter.replacement_age",
  filter_nominal_dimensions: "equipment.filter.nominal_dimensions", printed_cooling_capacity: "equipment.primary.printed_cooling_capacity",
  urgency: "problem.urgency_report", outcome_wanted: "problem.outcome_wanted", habitability: "problem.habitability",
  vulnerable_occupant: "problem.vulnerable_occupant", damage_accruing: "problem.damage_accruing", safety_signals: "problem.safety_signals",
  affected_scope: "problem.affected_scope", visible_damage: "problem.visible_damage", active_water: "problem.active_water",
  recent_change: "problem.recent_change", related_symptoms: "problem.related_symptoms", rain_timing: "problem.rain_timing",
  breaker_behavior: "equipment.circuit.breaker_behavior", shutoff_known: "equipment.supply.shutoff_known",
  "property.street": "property.street", "property.city_state_zip": "property.locality", "property.type": "property.type", "property.storeys": "property.storeys",
  sh_refrigerant: "history.sh_refrigerant", sh_recent_service: "history.sh_recent_service", sh_impact: "history.sh_impact", sh_room_variance: "history.sh_room_variance",
  roof_history: "history.roof_history",
  access_occupancy: "access.occupancy", access_owner_present: "access.owner_present", access_parking: "access.parking", access_pets: "access.pets",
  access_route: "access.equipment_route", access_window: "access.preferred_window", access_contact: "access.contact_preference",
};
const CHECK_ALIASES: Readonly<Record<string, string>> = {
  filter: "equipment.filter.condition", vent_airflow: "equipment.vents.airflow", fan_moving: "equipment.outdoor.fan_motion",
  ice_check: "equipment.cooling.visible_ice", ice_on_line: "equipment.cooling.visible_ice",
  safety_signals: "problem.safety_signals", safety_check: "problem.safety_signals",
};
const SPECIAL = new Set(["unit_model_serial", "symptom_timing", "onset_character", "thermostat_photo", "thermostat_reading",
  "thermostat_mode", "fan_mode", "thermostat_setpoint_f", "thermostat_setpoint", "room_temp_f", "room_temp"]);
const EXCLUDED = new Set(["normalized_class", "evidence_presence", "safety_gate", "safety_coverage", "access_offered",
  "problem_photo", "panel_photo", "gate_entry", "access_gate_or_entry_code"]);
const READING_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "equipment.control.mode": ["thermostat_mode", "thermostat_photo", "thermostat_reading"],
  "equipment.control.fan_mode": ["fan_mode", "thermostat_photo", "thermostat_reading"],
  "equipment.control.setpoint": ["thermostat_setpoint_f", "thermostat_setpoint", "thermostat_photo", "thermostat_reading"],
  "equipment.control.room_temperature": ["room_temp_f", "room_temp", "thermostat_photo", "thermostat_reading"],
};
const READING_TOPICS = {
  thermostat_mode: "equipment.control.mode", fan_mode: "equipment.control.fan_mode",
  thermostat_setpoint: "equipment.control.setpoint", room_temp: "equipment.control.room_temperature",
} as const;
type ReadingKey = keyof typeof READING_TOPICS;
const COMPONENT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "equipment.primary.model": ["unit_model_serial"], "equipment.primary.serial": ["unit_model_serial"],
  "problem.onset": ["symptom_timing", "user_language"], "problem.onset_character": ["onset_character", "symptom_timing", "user_language"],
  "problem.timing_report": ["symptom_timing"], "equipment.control.display_report": ["thermostat_photo", "thermostat_reading"],
  ...READING_FIELDS,
};

/** Typed normalized observations belong to the saved record, outside the count
 * basis. Changing the basis cannot redefine these independent source atoms. */
export const FactCountComponents = z.object({
    model: z.string().min(1).nullable(), serial: z.string().min(1).nullable(),
    onset_date: z.string().min(1).nullable(), onset_character: z.enum(["gradual", "sudden", "intermittent"]).nullable(),
    thermostat_mode: z.union([z.string().min(1), z.number()]).nullable(),
    thermostat_setpoint_f: z.union([z.string().min(1), z.number()]).nullable(),
    room_temp_f: z.union([z.string().min(1), z.number()]).nullable(),
    // Additive fields preserve earlier private 1.1.0 snapshots. Current writes
    // hold generic temperatures without guessing or converting their units.
    fan_mode: z.enum(["auto", "on", "circulate"]).nullable().optional(),
    thermostat_setpoint: z.union([z.string().min(1), z.number()]).nullable().optional(),
    room_temp: z.union([z.string().min(1), z.number()]).nullable().optional(),
    reading_evidence: z.object({ thermostat_mode: z.string().nullable(), fan_mode: z.string().nullable(),
      thermostat_setpoint: z.string().nullable(), room_temp: z.string().nullable() }).strict().optional(),
    reading_fields: z.object({ thermostat_mode: z.string().nullable(), fan_mode: z.string().nullable(),
      thermostat_setpoint: z.string().nullable(), room_temp: z.string().nullable() }).strict().optional(),
  }).strict();
export type FactCountComponents = z.infer<typeof FactCountComponents>;

export const FactCountBasis = z.object({
  definition_version: z.enum([LEGACY_DEFINITION_VERSION, FACT_COUNT_DEFINITION_VERSION]),
  unit: z.literal("recorded_observation_topic"), tenant_id: z.string().trim().min(1), request_id: z.string().min(1),
  observations: z.array(z.object({
    id: z.string().min(1), source_fields: z.array(z.string().min(1)).min(1), evidence_ids: z.array(z.string().min(1)),
  }).strict()),
}).strict().superRefine((basis, ctx) => {
  if (new Set(basis.observations.map(o => o.id)).size !== basis.observations.length) ctx.addIssue({ code: "custom", message: "Observation IDs must be unique" });
  for (const o of basis.observations) {
    if (new Set(o.source_fields).size !== o.source_fields.length || new Set(o.evidence_ids).size !== o.evidence_ids.length) {
      ctx.addIssue({ code: "custom", message: "Observation source references must be unique" });
    }
  }
});
export type FactCountBasis = z.infer<typeof FactCountBasis>;

function eligible(f: CurrentFact | undefined): f is CurrentFact & { value: string } {
  return !!f && typeof f.value === "string" && f.value.trim().length > 0 && ["CONFIRMED", "PROVIDED_UNVERIFIED"].includes(f.status)
    && f.claim_class !== "INFERRED" && f.source !== "policy"
    && (f.claim_class !== "CALCULATED" || !!f.derivation_id)
    // A media action is an evidence count, not the unobserved result of a check.
    && f.value !== "Photo captured for this check";
}
function componentValue(components: FactCountComponents, key: ReadingKey): string | number | null {
  if (components[key] !== undefined) return components[key] ?? null;
  return key === "thermostat_setpoint" ? components.thermostat_setpoint_f : key === "room_temp" ? components.room_temp_f : null;
}
function readingSource(components: FactCountComponents, state: CurrentFactState, key: ReadingKey): string | undefined {
  const source = components.reading_evidence?.[key];
  if (components.reading_fields) {
    const field = components.reading_fields[key];
    return field && READING_FIELDS[READING_TOPICS[key]].includes(field) && eligible(state.fields[field]) && (!source || state.fields[field].evidence_ids.includes(source)) ? field : undefined;
  }
  return READING_FIELDS[READING_TOPICS[key]].find(field => eligible(state.fields[field]) && (!source || state.fields[field].evidence_ids.includes(source)));
}
function directId(key: string, playbook: string): string | null {
  if (Object.hasOwn(DIRECT, key)) return DIRECT[key];
  if (key.startsWith("check:") && findPlaybook(playbook)?.diagnostic_steps.some(s => s.step_id === key.slice(6))) return CHECK_ALIASES[key.slice(6)] ?? `check.${playbook}.${key.slice(6)}`;
  return null;
}
export function factCountFieldDisposition(key: string): "direct" | "component" | "excluded" | "unmapped" {
  return Object.hasOwn(DIRECT, key) || key.startsWith("check:") ? "direct" : SPECIAL.has(key) ? "component" : EXCLUDED.has(key) ? "excluded" : "unmapped";
}

/** Independent structural trace validator: no call to the count builder and no
 * rendering/NLP. A forged count, duplicate ID, unsupported topic or borrowed
 * evidence cannot validate merely because a builder returned it. */
export function validateFactCountBasis(basis: FactCountBasis, state: CurrentFactState, playbook: string, count: number, components: FactCountComponents): string[] {
  const issues: string[] = [];
  // Persisted private 1.1.0 handoffs may carry the earlier observation catalog.
  // Read those at their saved definition; never silently migrate their count.
  const legacy = basis.definition_version === LEGACY_DEFINITION_VERSION;
  const hasPrintedProjection = components.fan_mode !== undefined && components.thermostat_setpoint !== undefined && components.room_temp !== undefined && components.reading_evidence !== undefined;
  const hasAnyPrintedProjection = components.fan_mode !== undefined || components.thermostat_setpoint !== undefined || components.room_temp !== undefined || components.reading_evidence !== undefined || components.reading_fields !== undefined;
  if ((legacy && hasAnyPrintedProjection) || (!legacy && !hasPrintedProjection)) issues.push("Fact count definition does not match the saved normalized observation projection");
  const mappedDirectId = (key: string) => legacy && PRINTED_DIRECT_FIELDS.has(key) ? null : directId(key, playbook);
  if (basis.request_id !== state.request_id) issues.push("Fact count basis belongs to another request");
  if (count !== basis.observations.length) issues.push("Fact counter must equal the serialized observation basis");
  for (const o of basis.observations) {
    const fields = o.source_fields.map(key => state.fields[key]);
    if (fields.some(f => !eligible(f))) issues.push(`Observation ${o.id} has an ineligible source`);
    if (o.source_fields.some(key => !Object.hasOwn(state.fields, key) || state.fields[key]?.field_key !== key)) issues.push(`Observation ${o.id} source map key disagrees with its field`);
    if (o.source_fields.some(key => mappedDirectId(key) !== o.id && !(Object.hasOwn(COMPONENT_FIELDS, o.id) && COMPONENT_FIELDS[o.id].includes(key)))) issues.push(`Observation ${o.id} has no authored topic mapping`);
    const sourceIds = new Set(fields.flatMap(f => f?.evidence_ids ?? []));
    if (o.evidence_ids.some(id => !sourceIds.has(id)) || [...sourceIds].some(id => !o.evidence_ids.includes(id))) issues.push(`Observation ${o.id} evidence does not equal its source evidence`);
  }
  for (const [key, id] of Object.entries(DIRECT)) if ((!legacy || !PRINTED_DIRECT_FIELDS.has(key)) && eligible(state.fields[key]) && !basis.observations.some(o => o.id === id && o.source_fields.includes(key))) {
    issues.push(`Recorded source ${key} is absent from the fact count basis`);
  }
  for (const key of Object.keys(state.fields).filter(key => key.startsWith("check:"))) {
    const id = directId(key, playbook);
    if (id && eligible(state.fields[key]) && !basis.observations.some(o => o.id === id && o.source_fields.includes(key))) issues.push(`Recorded check ${key} is absent from the fact count basis`);
  }
  // Component presence is checked separately from topic/source membership.
  const expected = new Map<string, string[]>();
  const requireComponent = (id: string, keys: readonly string[]) => {
    const held = keys.filter(key => eligible(state.fields[key]));
    if (held.length) expected.set(id, held);
  };
  const c = components;
  if (c.model !== null) requireComponent("equipment.primary.model", ["unit_model_serial"]);
  if (c.serial !== null) requireComponent("equipment.primary.serial", ["unit_model_serial"]);
  const timing = eligible(state.fields.symptom_timing) ? "symptom_timing" : "user_language";
  if (c.onset_date !== null) requireComponent("problem.onset", [timing]);
  if (c.onset_character !== null) requireComponent("problem.onset_character", eligible(state.fields.onset_character) ? ["onset_character"] : [timing]);
  if (c.onset_date === null && c.onset_character === null) requireComponent("problem.timing_report", ["symptom_timing"]);
  for (const key of Object.keys(READING_TOPICS) as ReadingKey[]) {
    if (legacy && key === "fan_mode") continue;
    const field = readingSource(c, state, key);
    const value = legacy && key === "thermostat_setpoint" ? c.thermostat_setpoint_f : legacy && key === "room_temp" ? c.room_temp_f : componentValue(c, key);
    if (value !== null && field) requireComponent(READING_TOPICS[key], [field]);
  }
  if (![...expected.keys()].some(id => Object.hasOwn(READING_FIELDS, id))) requireComponent("equipment.control.display_report", ["thermostat_photo", "thermostat_reading"]);
  for (const [id, keys] of expected) if (!basis.observations.some(o => o.id === id && keys.length === o.source_fields.length && keys.every(key => o.source_fields.includes(key)))) issues.push(`Normalized component ${id} is absent or has incorrect sources`);
  for (const o of basis.observations) if (Object.hasOwn(COMPONENT_FIELDS, o.id) && !expected.has(o.id)) issues.push(`Observation ${o.id} has no normalized component`);
  return issues;
}

/** Every registered field has a declared disposition. New registry fields
 * require an explicit catalog amendment; unrecognized prose gets no fallback
 * counter. The literal problem report still preserves that unparsed context. */
export function buildFactCountBasis(args: {
  state: CurrentFactState; registry: IntakeRegistry; input: DirectionsInput; tenant_id: string; playbook: string;
}): FactCountBasis {
  const { state, registry, input, playbook } = args;
  if (!findPlaybook(playbook)) throw new Error(`Fact count catalog lacks playbook: ${playbook}`);
  const unmapped = registry.requirements.filter(r => r.active && (factCountFieldDisposition(r.fact_type) === "unmapped" || (r.fact_type.startsWith("check:") && directId(r.fact_type, playbook) === null)));
  if (unmapped.length) throw new Error(`Fact count catalog lacks: ${unmapped.map(r => r.fact_type).join(", ")}`);
  const entries = new Map<string, Set<string>>();
  const add = (id: string, keys: readonly string[]) => {
    const held = keys.filter(key => eligible(state.fields[key]));
    if (!held.length) return;
    entries.set(id, new Set([...(entries.get(id) ?? []), ...held]));
  };
  // Current values only: old answer rows, confirmations, conflict prose and
  // display copies cannot add variants. A conflicted topic counts once as a
  // recorded report, never as confirmation of either value.
  const registered = new Set(registry.requirements.map(r => r.fact_type));
  for (const key of Object.keys(state.fields)) {
    if (!registered.has(key) && !Object.hasOwn(DIRECT, key)) continue;
    const id = directId(key, playbook);
    if (id) add(id, [key]);
  }
  if (input.equipment.model?.value) add("equipment.primary.model", ["unit_model_serial"]);
  if (input.equipment.serial?.value) add("equipment.primary.serial", ["unit_model_serial"]);
  const timingKey = eligible(state.fields.symptom_timing) ? "symptom_timing" : "user_language";
  if (input.problem.onset_date) add("problem.onset", [timingKey]);
  if (input.problem.onset_character) add("problem.onset_character", eligible(state.fields.onset_character) ? ["onset_character"] : [timingKey]);
  if (!input.problem.onset_date && !input.problem.onset_character) add("problem.timing_report", ["symptom_timing"]);
  const components = projectFactCountComponents(input);
  let readings = 0;
  for (const key of Object.keys(READING_TOPICS) as ReadingKey[]) {
    if (componentValue(components, key) === null) continue;
    const source = readingSource(components, state, key);
    if (source) { add(READING_TOPICS[key], [source]); readings += 1; }
  }
  // Partial authored reading remains one unsplit report; never manufacture
  // absent mode/temperatures or parse a final display string to increase it.
  if (!readings) add("equipment.control.display_report", ["thermostat_photo", "thermostat_reading"]);
  const basis = FactCountBasis.parse({ definition_version: FACT_COUNT_DEFINITION_VERSION, unit: "recorded_observation_topic",
    tenant_id: args.tenant_id.trim() || "prn", request_id: state.request_id,
    observations: [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([id, keys]) => ({ id,
      source_fields: [...keys].sort(), evidence_ids: [...new Set([...keys].flatMap(key => state.fields[key].evidence_ids))].sort(),
    })),
  });
  const issues = validateFactCountBasis(basis, state, playbook, basis.observations.length, projectFactCountComponents(input));
  if (issues.length) throw new Error(`Invalid fact count basis: ${issues.join("; ")}`);
  return basis;
}

/** Copy the existing typed projection once; this performs no new extraction. */
export function projectFactCountComponents(input: DirectionsInput): FactCountComponents {
  const readings = input.evidence.readings;
  const current = {
    thermostat_mode: readings?.thermostat_mode, fan_mode: readings?.fan_mode,
    thermostat_setpoint: readings?.thermostat_setpoint ?? readings?.thermostat_setpoint_f,
    room_temp: readings?.room_temp ?? readings?.room_temp_f,
  };
  const usable = (reading: (typeof current)[ReadingKey]) => !!reading && !["inference", "unknown"].includes(reading.provenance);
  const fan = usable(current.fan_mode) ? String(current.fan_mode!.value).toLowerCase() : null;
  return FactCountComponents.parse({
    model: input.equipment.model?.value ?? null, serial: input.equipment.serial?.value ?? null,
    onset_date: input.problem.onset_date ?? null, onset_character: input.problem.onset_character ?? null,
    ...Object.fromEntries(["thermostat_mode", "thermostat_setpoint_f", "room_temp_f"].map(key => {
      const reading = input.evidence.readings?.[key as "thermostat_mode" | "thermostat_setpoint_f" | "room_temp_f"];
      return [key, reading && !["inference", "unknown"].includes(reading.provenance) ? reading.value : null];
    })),
    fan_mode: fan && /^(auto|on|circulate)$/.test(fan) ? fan : null,
    thermostat_setpoint: usable(current.thermostat_setpoint) ? current.thermostat_setpoint!.value : null,
    room_temp: usable(current.room_temp) ? current.room_temp!.value : null,
    reading_evidence: Object.fromEntries((Object.keys(READING_TOPICS) as ReadingKey[]).map(key => [key, current[key]?.source_media ?? null])),
    ...(input.evidence.reading_fields ? { reading_fields: Object.fromEntries((Object.keys(READING_TOPICS) as ReadingKey[]).map(key => [key,
      input.evidence.reading_fields?.[key] ?? (key === "thermostat_setpoint" ? input.evidence.reading_fields?.thermostat_setpoint_f : key === "room_temp" ? input.evidence.reading_fields?.room_temp_f : null) ?? null])) } : {}),
  });
}
