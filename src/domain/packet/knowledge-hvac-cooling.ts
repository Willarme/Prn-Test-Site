import type {
  Branch,
  Check,
  Fact,
  OnsetCharacter,
  Provenance,
  ScriptParts,
  Unknown,
} from "@/domain/packet/types";
import { spelled } from "@/domain/packet/script";

/**
 * PACKET KNOWLEDGE FOR THE AC-COOLING PLAYBOOK (pb_hvac_cooling_v1) —
 * campaign track P1, 2026-09-05.
 *
 * This is the "authored payload attached to each playbook branch" the Intake
 * Coverage Standard §3.7 asks for, and the per-cluster obtainability table of
 * §3.8, written once for the one cluster with a playbook and keyed by that
 * playbook's OWN step ids and field keys (domain/intake/playbooks/hvac-cooling.ts):
 * `filter`, `outdoor_unit`, `fan_moving`, `fins_blocked`, `power_check`,
 * `unit_model_serial`, `brand`, `system_age`, `symptom_timing`,
 * `thermostat_photo`. Steps another track may add (`ice_check`,
 * `compressor_audible`, `vent_airflow`, `thermostat_reading`, `safety_signals`)
 * are read when present and silent when not.
 *
 * The shapes — what a fact row says, what a check "changed", the four unknown
 * reasons, the five technician-only tests, the three branches with For and
 * Against, the four scope factors — are MOCKUP-1's approved content
 * (Directions §3.2), generalised so that a different journey produces
 * different text and never the mockup's fixed numbers. Everything here is
 * conditional on a recorded answer; nothing prints for a step that was not
 * reached. The certainty verbs are from the closed ladder in Directions §10.3
 * and `rules out` appears only for a control-setting or power-level cause.
 *
 * Numbers in provider copy are digits with units (§10.2); the call script
 * clauses spell ages and durations and keep instrument readings as digits.
 */

export interface HvacCoolingView {
  /** Step `filter`: the 0–10 rating, when answered. */
  filter_rating: number | null;
  /** Initial-description observation; never invent a numeric rating for it. */
  filter_reported_clean?: boolean;
  /** Reported filter age in weeks, when a field carries it. */
  filter_age_weeks: number | null;
  /** Whether a photo of the filter exists. */
  filter_photo: boolean;
  /** Step `outdoor_unit`: a photo exists. */
  outdoor_photo: boolean;
  /** Step `fan_moving`. */
  fan_moving: "yes" | "no" | null;
  fan_provenance?: Provenance;
  /** Step `fins_blocked`. */
  fins: "mostly clear" | "pretty clogged" | null;
  /** Step `power_check`: the disconnect was photographed. */
  power_photo: boolean;
  /** Optional steps another track may add. */
  ice: "yes" | "no" | null;
  ice_photo: boolean;
  /** A literal statement is reported evidence, not an inspected line or photo. */
  ice_reported?: boolean;
  compressor_audible: "yes" | "no" | null;
  vent_airflow: "normal" | "weak" | null;
  thermostat_setpoint_f: number | null;
  room_temp_f: number | null;
  thermostat_mode?: string | null;
  thermostat_reading_provenance: Provenance | null;
  /** The safety questions: asked and all negative → true; asked with a positive → false; not asked → null. */
  safety_negative: boolean | null;
  onset_character: OnsetCharacter | null;
  onset_weekday: string | null;
  onset_span_days: number | null;
  brand: string | null;
  equipment_type: string | null;
  model: string | null;
  age_years: number | null;
  air_handler_location: string | null;
  /** Fields or steps the homeowner marked as unreachable (track P4's marker). */
  cannot_reach: ReadonlySet<string>;
  /** The walkthrough was started at all. */
  walkthrough_started: boolean;
}

export const HVAC_COOLING_TITLE = "AC running but blowing warm air";
export const HVAC_COOLING_PROBLEM_CLAUSE = "my AC is running but blowing warm air";
export const HVAC_LABELS_SET = "hvac";

/** Intake Coverage Standard §6.1 — technician-only, in the order a technician works. */
export const HVAC_COOLING_TECHNICIAN_ONLY: readonly string[] = [
  "Capacitor test under load",
  "Refrigerant pressures, both sides",
  "Supply/return temperature split",
  "Contactor and condenser fan draw",
  "Evaporator coil inspection",
];

/** Coverage Standard §3.8 — the always-unobtainable rows, most decision-changing first. */
const TECH_ONLY_UNKNOWNS: readonly Unknown[] = [
  { item: "Refrigerant charge", reason: "requires gauges" },
  { item: "Capacitor condition", reason: "requires meter, not homeowner-safe" },
  { item: "Coil condition inside air handler", reason: "requires panel removal" },
  { item: "Line-set temperature split", reason: "requires instrument" },
];

function filterWord(rating: number): "clean" | "lightly dusty" | "dirty" {
  if (rating <= 2) return "clean";
  if (rating <= 5) return "lightly dusty";
  return "dirty";
}

function spokenType(type: string | null): string | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (/mini/.test(t)) return "mini-split";
  if (/heat ?pump/.test(t)) return "heat pump";
  if (/split/.test(t)) return "split system";
  if (/package/.test(t)) return "package unit";
  return t.replace(/\s*a\/c\s*$/i, "").trim() || null;
}

const ONSET_ADVERB: Record<OnsetCharacter, string> = {
  gradual: "gradually",
  sudden: "suddenly",
  intermittent: "on and off",
};

// ---------------------------------------------------------------------------
// The seven-fact candidates (Directions §4.11 kinds), from what was recorded.
// ---------------------------------------------------------------------------

export function hvacCoolingFacts(v: HvacCoolingView): Fact[] {
  const facts: Fact[] = [];
  // The complaint this cluster matched on — the symptom, never a cause.
  facts.push({ text: "AC running, air from vents not cold", provenance: "reported", kind: "other" });

  if (v.fan_moving === "yes") {
    facts.push({
      text: v.compressor_audible === "yes" ? "Outdoor fan is turning, unit is audibly running" : "Outdoor fan is turning",
      emphasis_word: "is",
      provenance: v.fan_provenance ?? "confirmed_by_homeowner",
      kind: "machine_state",
    });
  } else if (v.fan_moving === "no") {
    facts.push({
      text: "Outdoor fan is not turning while calling for cool",
      emphasis_word: "not",
      provenance: v.fan_provenance ?? "confirmed_by_homeowner",
      kind: "machine_state",
    });
  }

  if (v.thermostat_setpoint_f !== null && v.room_temp_f !== null) {
    facts.push({
      text: `Thermostat: ${v.thermostat_mode ? `${v.thermostat_mode}, ` : ""}set ${v.thermostat_setpoint_f}°F, room ${v.room_temp_f}°F`,
      provenance: v.thermostat_reading_provenance ?? "reported",
      kind: "reading",
    });
  }

  if (v.vent_airflow === "normal") {
    facts.push({ text: "Air from vents is moving at normal strength", provenance: "reported", kind: "other" });
  } else if (v.vent_airflow === "weak") {
    facts.push({ text: "Air from vents is weak", provenance: "reported", kind: "other" });
  }

  if (v.ice === "no") {
    facts.push({
      text: v.ice_reported ? "Homeowner reports no visible ice" : "No visible ice on accessible refrigerant line",
      provenance: v.ice_reported ? "reported" : v.ice_photo ? "seen_in_photo_or_video" : "confirmed_by_homeowner",
      kind: "check_result",
    });
  } else if (v.ice === "yes") {
    facts.push({
      text: v.ice_reported ? "Homeowner reports visible ice" : "Ice visible on accessible refrigerant line",
      provenance: v.ice_reported ? "reported" : v.ice_photo ? "seen_in_photo_or_video" : "confirmed_by_homeowner",
      kind: "check_result",
    });
  }

  if (v.filter_rating !== null) {
    const age = v.filter_age_weeks !== null ? `, replaced ~${v.filter_age_weeks} weeks ago` : "";
    facts.push({
      text: `Filter ${filterWord(v.filter_rating)}, rated ${v.filter_rating}/10 by the homeowner${age}`,
      provenance: v.filter_photo ? "seen_in_photo_or_video" : "reported",
      kind: "maintenance",
    });
  } else if (v.filter_reported_clean) {
    facts.push({ text: "Homeowner reports the filter is clean", provenance: "reported", kind: "maintenance" });
  }

  if (v.fins) {
    facts.push({
      text: v.fins === "mostly clear" ? "Outdoor fins mostly clear" : "Outdoor fins packed with debris",
      provenance: v.outdoor_photo ? "seen_in_photo_or_video" : "confirmed_by_homeowner",
      kind: "check_result",
    });
  }

  if (v.onset_character) {
    const span = v.onset_span_days !== null && v.onset_span_days > 0 ? ` over ~${v.onset_span_days} days` : "";
    const tail = v.onset_character === "gradual" ? ", not sudden" : "";
    facts.push({ text: `Onset ${v.onset_character}${span}${tail}`, provenance: "reported", kind: "onset" });
  }

  if (v.safety_negative === true) {
    facts.push({
      text: "No breaker trips, no burning smell, no water",
      provenance: "confirmed_by_homeowner",
      kind: "safety",
    });
  }

  if (v.power_photo) {
    facts.push({
      text: "Outdoor disconnect photographed",
      provenance: "seen_in_photo_or_video",
      kind: "other",
    });
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Summary observations — third person, symptom → onset → readings → outdoor →
// negatives → maintenance (Directions §4.10). Same data as the facts.
// ---------------------------------------------------------------------------

export function hvacCoolingSummary(v: HvacCoolingView): string[] {
  const out: string[] = [];
  out.push(
    v.vent_airflow === "normal"
      ? "Indoor fan runs and air moves from the vents, but the air is not cold."
      : "Air comes from the vents but the air is not cold."
  );
  if (v.onset_character || v.onset_weekday || v.onset_span_days !== null) {
    const when = v.onset_weekday
      ? `Started ${v.onset_weekday}`
      : v.onset_span_days !== null && v.onset_span_days > 0
        ? `Started ~${v.onset_span_days} days ago`
        : "Started";
    const how =
      v.onset_character === "gradual"
        ? ", gradually rather than suddenly."
        : v.onset_character === "sudden"
          ? ", suddenly."
          : v.onset_character === "intermittent"
            ? ", and comes and goes."
            : ".";
    if (when !== "Started" || how !== ".") out.push(`${when}${how}`);
  }
  if (v.thermostat_setpoint_f !== null && v.room_temp_f !== null) {
    out.push(`Thermostat is set${v.thermostat_mode ? ` to ${v.thermostat_mode}` : ""} at ${v.thermostat_setpoint_f}°F with the room sitting at ${v.room_temp_f}°F.`);
  }
  if (v.fan_moving === "yes") {
    out.push(
      v.compressor_audible === "yes"
        ? "The outdoor unit is running, the fan is turning and the compressor can be heard."
        : "The outdoor unit is running and the fan is turning."
    );
  } else if (v.fan_moving === "no") {
    out.push("The outdoor fan is not turning while the thermostat calls for cool.");
  }
  if (v.fins === "mostly clear") out.push("The outdoor fins are mostly clear.");
  else if (v.fins === "pretty clogged") out.push("The outdoor fins are packed with debris.");
  if (v.ice === "no") out.push(v.ice_reported ? "The homeowner reports no visible ice." : "No ice visible on the accessible line.");
  else if (v.ice === "yes") out.push(v.ice_reported ? "The homeowner reports visible ice." : "Ice is visible on the accessible line.");
  if (v.safety_negative === true) out.push("No breaker trips, burning smell or water reported.");
  if (v.filter_rating !== null) {
    const age = v.filter_age_weeks !== null ? ` and was replaced ${v.filter_age_weeks} weeks ago` : "";
    out.push(`Filter was rated ${v.filter_rating} out of 10 by the homeowner, ${filterWord(v.filter_rating)}${age}.`);
  } else if (v.filter_reported_clean) {
    out.push("The homeowner reports that the filter is clean.");
  }
  return out.slice(0, 7);
}

// ---------------------------------------------------------------------------
// Script clauses (Directions §4.6 voice rules).
// ---------------------------------------------------------------------------

export function hvacCoolingScriptParts(v: HvacCoolingView): ScriptParts {
  const type = spokenType(v.equipment_type);
  let equipment: string | null = null;
  if (v.brand && type) equipment = `a ${v.brand} ${type}`;
  else if (v.brand) equipment = `a ${v.brand}`;
  else if (type) equipment = `a ${type}`;

  let onset: string | null = null;
  if (v.onset_character && v.onset_weekday) onset = `started ${ONSET_ADVERB[v.onset_character]} on ${v.onset_weekday}`;
  else if (v.onset_weekday) onset = `started on ${v.onset_weekday}`;
  else if (v.onset_character && v.onset_span_days !== null && v.onset_span_days > 0)
    onset = `started ${ONSET_ADVERB[v.onset_character]} about ${spelled(v.onset_span_days)} day${v.onset_span_days === 1 ? "" : "s"} ago`;
  else if (v.onset_character) onset = `started ${ONSET_ADVERB[v.onset_character]}`;
  else if (v.onset_span_days !== null && v.onset_span_days > 0)
    onset = `started about ${spelled(v.onset_span_days)} day${v.onset_span_days === 1 ? "" : "s"} ago`;

  let filter: string | null = null;
  if (v.filter_rating !== null) {
    const word = filterWord(v.filter_rating);
    filter = word === "clean" ? "the filter's clean" : word === "dirty" ? "the filter's dirty" : "the filter's a bit dusty";
    if (v.filter_age_weeks !== null) filter += ` and ${spelled(v.filter_age_weeks)} week${v.filter_age_weeks === 1 ? "" : "s"} old`;
  } else if (v.filter_reported_clean) {
    filter = "the filter looks clean to me";
  }

  return {
    problem_clause: HVAC_COOLING_PROBLEM_CLAUSE,
    equipment_brand_type: equipment,
    age_spoken: null, // filled by the builder from the equipment block, so the table and the script agree
    model_number: v.model,
    onset_clause: onset,
    thermostat_setpoint: v.thermostat_setpoint_f,
    room_temp: v.room_temp_f,
    outdoor_state_clause:
      v.fan_moving === "yes"
        ? "the outdoor unit is running and the fan's turning"
        : v.fan_moving === "no"
          ? "the outdoor fan isn't turning"
          : null,
    filter_clause: filter,
    ice_clause: v.ice === "no" ? "there's no ice I can see" : v.ice === "yes" ? (v.ice_reported ? "there's ice I can see" : "there's ice on the line") : null,
  };
}

// ---------------------------------------------------------------------------
// Completed checks, and what each one changed (Directions §4.19).
// ---------------------------------------------------------------------------

export function hvacCoolingChecks(v: HvacCoolingView): Check[] {
  const checks: Check[] = [];
  if (v.thermostat_mode === "cool" && v.thermostat_setpoint_f !== null && v.room_temp_f !== null && v.room_temp_f > v.thermostat_setpoint_f) {
    checks.push({
      name: "Thermostat mode and setpoint",
      result: `Cool, ${v.thermostat_setpoint_f}°F, room ${v.room_temp_f}°F`,
      changed: "Confirms a real call for cooling — rules out a control-setting cause",
      result_provenance: v.thermostat_reading_provenance ?? "reported",
      changed_provenance: "inference",
      certainty: "rules_out",
      certainty_scope: "control_setting",
    });
  }
  if (v.filter_rating !== null) {
    const age = v.filter_age_weeks !== null ? `, ~${v.filter_age_weeks} weeks old` : "";
    const word = filterWord(v.filter_rating);
    checks.push({
      name: "Filter condition",
      result: `${word[0].toUpperCase()}${word.slice(1)}, rated ${v.filter_rating}/10${age}`,
      changed:
        word === "dirty"
          ? "Confirms a restricted filter at the return"
          : "Makes airflow restriction at the filter unlikely",
      result_provenance: v.filter_photo ? "seen_in_photo_or_video" : "reported",
      changed_provenance: "inference",
      certainty: word === "dirty" ? "confirms" : "unlikely",
    });
  }
  if (v.fan_moving === "yes") {
    checks.push({
      name: "Outdoor unit running?",
      result: v.compressor_audible === "yes" ? "Yes — fan turning, compressor audible" : "Yes — fan turning",
      changed:
        v.compressor_audible === "yes"
          ? "Rules out a dead contactor or total power loss to the condenser"
          : "Rules out total power loss to the condenser",
      result_provenance: v.fan_provenance ?? "confirmed_by_homeowner",
      changed_provenance: "inference",
      certainty: "rules_out",
      certainty_scope: "power_level",
    });
  } else if (v.fan_moving === "no") {
    checks.push({
      name: "Outdoor unit running?",
      result: "No — fan still while calling for cool",
      changed: "Confirms the condenser is not running on a call for cool",
      result_provenance: v.fan_provenance ?? "confirmed_by_homeowner",
      changed_provenance: "inference",
      certainty: "confirms",
    });
  }
  if (v.vent_airflow === "normal") {
    checks.push({
      name: "Air at the vents",
      result: "Normal strength",
      changed: "Makes a blower or duct restriction unlikely",
      result_provenance: "reported",
      changed_provenance: "inference",
      certainty: "unlikely",
    });
  } else if (v.vent_airflow === "weak") {
    checks.push({
      name: "Air at the vents",
      result: "Weak",
      changed: "Confirms reduced airflow at the vents",
      result_provenance: "reported",
      changed_provenance: "inference",
      certainty: "confirms",
    });
  }
  if (v.fins) {
    checks.push({
      name: "Outdoor fins clogged?",
      result: v.fins === "mostly clear" ? "Mostly clear" : "Pretty clogged",
      changed:
        v.fins === "mostly clear"
          ? "Makes a blocked condenser coil unlikely"
          : "Confirms restricted airflow across the condenser",
      result_provenance: v.outdoor_photo ? "seen_in_photo_or_video" : "confirmed_by_homeowner",
      changed_provenance: "inference",
      certainty: v.fins === "mostly clear" ? "unlikely" : "confirms",
    });
  }
  if (v.ice !== null) {
    checks.push({
      name: v.ice_reported ? "Visible ice reported?" : "Ice on accessible line?",
      result: v.ice === "no" ? "None visible" : "Ice visible",
      changed: v.ice_reported ? "Records the homeowner's visible-ice observation" :
        v.ice === "no"
          ? "Makes a severe freeze-up less likely, though not excluded at the coil"
          : "Confirms ice at the accessible section",
      result_provenance: v.ice_reported ? "reported" : v.ice_photo ? "seen_in_photo_or_video" : "confirmed_by_homeowner",
      changed_provenance: v.ice_reported ? "reported" : "inference",
      certainty: v.ice_reported ? "noted" : v.ice === "no" ? "less_likely" : "confirms",
    });
  }
  if (v.power_photo) {
    checks.push({
      name: "Disconnect photographed?",
      result: "Yes — exterior photographed",
      changed: "Confirms the disconnect type is on record for the technician",
      result_provenance: "seen_in_photo_or_video",
      changed_provenance: "inference",
      certainty: "confirms",
    });
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Still unknown — and why (Directions §4.13). Longer on a thin record.
// ---------------------------------------------------------------------------

export function hvacCoolingUnknowns(v: HvacCoolingView): Unknown[] {
  const out: Unknown[] = [...TECH_ONLY_UNKNOWNS];
  const reach = (key: string, what: string) =>
    v.cannot_reach.has(key) ? `homeowner could not reach the ${what}` : null;

  if (!v.model) {
    out.push({
      item: "Model and serial",
      reason: reach("unit_model_serial", "label") ?? reach("outdoor_unit", "outdoor unit") ?? "not photographed or typed at intake",
    });
  }
  if (v.thermostat_setpoint_f === null || v.room_temp_f === null) {
    out.push({
      item: "Thermostat setpoint and room temperature",
      reason: reach("thermostat_photo", "thermostat") ?? "not asked",
    });
  }
  if (v.filter_rating === null && !v.filter_reported_clean) {
    out.push({
      item: "Filter condition",
      reason: reach("filter", "filter") ?? (v.walkthrough_started ? "not answered at intake" : "not asked"),
    });
  }
  if (v.fan_moving === null) {
    out.push({
      item: "Outdoor fan turning?",
      reason: reach("outdoor_unit", "outdoor unit") ?? reach("fan_moving", "outdoor unit") ?? "not asked",
    });
  }
  if (v.fins === null) {
    out.push({
      item: "Outdoor fins condition",
      reason: reach("outdoor_unit", "outdoor unit") ?? reach("fins_blocked", "outdoor unit") ?? "not asked",
    });
  }
  if (v.ice === null) {
    out.push({ item: "Ice on the accessible line", reason: reach("ice_check", "line-set") ?? "not asked" });
  }
  if (v.safety_negative === null) {
    out.push({ item: "Breaker trips, burning smell, water", reason: "not asked" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Where the evidence points (Directions §7).
// ---------------------------------------------------------------------------

interface Candidate {
  name: string;
  for: string[];
  against: string[];
  /** How much recorded evidence the branch accounts for. */
  weight: number;
}

export function hvacCoolingBranches(v: HvacCoolingView): { branches: Branch[]; top: string | null } {
  const filterClean = v.filter_rating !== null && v.filter_rating <= 5;
  const filterDirty = v.filter_rating !== null && v.filter_rating >= 6;
  const candidates: Candidate[] = [];

  // Low refrigerant charge / leak
  {
    const f: string[] = [];
    if (v.onset_character === "gradual") f.push("gradual onset over days");
    if (v.fan_moving === "yes") f.push("unit running normally");
    if (v.vent_airflow === "normal") f.push("airflow normal");
    if (filterClean) f.push("filter clean");
    if (v.ice === "no") f.push(v.ice_reported ? "homeowner reports no visible ice" : "no ice at the accessible section");
    const a: string[] = [];
    if (v.ice === "yes") a.push(v.ice_reported ? "homeowner reports visible ice, which fits a freeze-up" : "ice at the accessible section fits a freeze-up first");
    if (v.onset_character === "sudden") a.push("a sudden stop fits a part failure better than a slow leak");
    if (a.length === 0) a.push("the line-set was not inspected for oil staining at intake");
    candidates.push({ name: "Low refrigerant charge / leak", for: f, against: a, weight: f.length });
  }

  // Failing capacitor / compressor not staging
  {
    const f: string[] = [];
    const a: string[] = [];
    let weight = 0;
    if (v.fan_moving === "yes" && v.compressor_audible !== "yes") {
      f.push("fan turning does not confirm the compressor is doing work");
      weight = 1;
      a.push("outdoor fan turning shows the contactor is passing power");
    } else if (v.fan_moving === "yes" && v.compressor_audible === "yes") {
      f.push("fan turning does not confirm the compressor is doing work");
      weight = 1;
      a.push("homeowner reports compressor audible, though untrained assessment");
    } else if (v.fan_moving === "no") {
      f.push("outdoor fan not turning while the thermostat calls for cool");
      weight = 2;
      a.push("a tripped breaker or a blown disconnect fuse would look the same from outside");
    }
    if (f.length > 0) candidates.push({ name: "Failing capacitor / compressor not staging", for: f, against: a, weight });
  }

  // Airflow restriction downstream of the filter
  {
    const f: string[] = [];
    let weight = 0.5;
    if (filterDirty) {
      f.push(`filter rated ${v.filter_rating}/10 by the homeowner`);
      weight = 2;
    }
    if (v.vent_airflow === "weak") {
      f.push("air at the vents reported weak");
      weight += 1;
    }
    f.push("cannot be excluded without inspecting the coil");
    const a: string[] = [];
    if (filterClean && v.vent_airflow === "normal") a.push("filter clean and vent airflow reported normal");
    else if (filterClean) a.push("filter clean");
    else if (v.vent_airflow === "normal") a.push("vent airflow reported normal");
    else a.push("nothing recorded at intake points at the ducts or the blower");
    candidates.push({ name: "Airflow restriction downstream of the filter", for: f, against: a, weight });
  }

  // Blocked condenser coil — only when the fins were seen clogged
  if (v.fins === "pretty clogged") {
    candidates.push({
      name: "Blocked condenser coil",
      for: ["outdoor fins packed with debris"],
      against: v.fan_moving === "yes" ? ["the unit is still running with the fan turning"] : ["the fins were judged from a photo, not cleared and retested"],
      weight: 2,
    });
  }

  // No power to the condenser — only when the fan was seen still
  if (v.fan_moving === "no") {
    candidates.push({
      name: "No power to the condenser / blown disconnect fuse",
      for: v.power_photo ? ["outdoor fan not turning, disconnect photographed"] : ["outdoor fan not turning"],
      against: ["the disconnect's fuses were not tested at intake"],
      weight: v.power_photo ? 2.5 : 2,
    });
  }

  // A branch prints only with both a For and an Against (§7.4). A For that is
  // an untested gap ("cannot be excluded without inspecting the coil") is
  // permitted, so on a thin record the airflow branch can be the lone
  // survivor — and one branch is fewer than two, so §7.5 prints instead.
  const usable = candidates
    .filter((c) => c.for.length > 0 && c.against.length > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);

  if (usable.length < 2) return { branches: [], top: null };

  const branches: Branch[] = usable.map((c, i) => {
    let confidence: Branch["confidence"];
    if (i === 0) confidence = c.weight > usable[1].weight && c.weight >= 1 ? "Most consistent" : "Possible";
    else confidence = c.weight >= 1 ? "Possible" : "Less likely";
    return {
      name: c.name,
      confidence,
      for: `${c.for.join(", ")}.`,
      against: `${c.against.join(", ")}.`,
    };
  });
  // Confidence words must descend (§7.2): a "Possible" after a "Less likely" is corrected downward.
  const rank = { "Most consistent": 0, Possible: 1, "Less likely": 2 } as const;
  for (let i = 1; i < branches.length; i++) {
    if (rank[branches[i].confidence] < rank[branches[i - 1].confidence]) branches[i].confidence = branches[i - 1].confidence;
  }
  return { branches, top: branches[0].name };
}

// ---------------------------------------------------------------------------
// Scope factors (Directions §4.23) — cost-shape first, then access, then permits.
// ---------------------------------------------------------------------------

export function hvacCoolingScopeFactors(v: HvacCoolingView, topBranch: string | null): string[] {
  const out: string[] = [];
  if (v.age_years !== null && v.age_years >= 8) {
    out.push(`Unit is ~${v.age_years} years old — repair-vs-replace conversation may be in scope`);
  }
  if (topBranch === "Low refrigerant charge / leak") {
    out.push("If a leak is confirmed, locating it may need a separate diagnostic step");
  }
  if (v.fins === "pretty clogged") {
    out.push("If clearing the condenser fins restores cooling, the visit may end there");
  }
  if (v.air_handler_location) {
    const loc = v.air_handler_location;
    if (/attic|roof|crawl/i.test(loc)) out.push(`${loc} air handler — access may add time to the visit`);
    else out.push(`${loc} air handler — access is straightforward, no attic or roof work`);
  }
  out.push("No permit or utility involvement indicated");
  return out;
}

/** Directions §4.20 — the HVAC question ids, in print order. */
export const HVAC_SERVICE_HISTORY_IDS = ["sh_refrigerant", "sh_recent_service", "sh_impact", "sh_room_variance"] as const;
