import type { DirectionsInput } from "@/domain/packet/types";

/**
 * The Directions' §3.2 reference input — the HVAC record that produced the
 * approved mockup — as data. Every test that pins a mockup string renders from
 * this. Copied field for field; nothing shortened.
 */
export function referenceInput(): DirectionsInput {
  return {
    config: {
      link_base: "https://golive.com",
      keep_path: "/keep/",
      ask_path: "/ask/",
      locale: "en-GB-oxendict-us-units",
      date_style: "D MMM YYYY",
      time_style: "HH:mm",
    },
    packet: {
      id: "4821-A",
      version: "v3",
      generated_at: "2026-09-03T11:42:00-04:00",
      trade: "hvac",
      playbook: "hvac.cooling.no_cold_air.v1",
    },
    property: {
      street: "1114 Oakhurst Dr",
      city_state_zip: "Fort Wayne, IN 46815",
      type: "single-family",
      storeys: "2 storey",
    },
    problem: {
      title: "AC running but blowing warm air",
      homeowner_words: "The air conditioner is on and I can feel air but it's just not cold anymore.",
      onset_date: "2026-08-31",
      onset_weekday_spoken: "Tuesday",
      onset_character: "gradual",
      onset_span_days: 2,
      urgency_level: "asap",
      safety_state: "no_hazard_reported",
      hazard_flags: [],
      habitability: "degraded",
      vulnerable_occupant: false,
      damage_accruing: false,
    },
    equipment: {
      labels_set: "hvac_split_ac",
      type: { value: "Split system A/C", provenance: "read_from_label" },
      brand: { value: "Carrier", provenance: "read_from_label" },
      model: { value: "24ABC636A003", provenance: "read_from_label", confirmed_by_homeowner: true },
      serial: { value: "4021E19845", provenance: "read_from_label", confirmed_by_homeowner: true },
      age_years: 8,
      manufacture_year: 2018,
      age_provenance: "inference",
      outdoor_unit_location: { value: "North side, ground", provenance: "seen_in_photo_or_video" },
      air_handler_location: { value: "Basement, NE corner", provenance: "reported" },
      thermostat: { value: "Honeywell T6 Pro", provenance: "seen_in_photo_or_video" },
    },
    evidence: {
      media: [
        { id: "m1", kind: "photo", subject: "Equipment label", location: "outdoor", captured_at: "2026-09-03T11:18:00-04:00", provenance: "read_from_label" },
        { id: "m2", kind: "photo", subject: "Thermostat display", location: null, captured_at: "2026-09-02T19:40:00-04:00", provenance: "seen_in_photo_or_video" },
        { id: "m3", kind: "photo", subject: "Filter", location: "in situ", captured_at: "2026-09-02T19:35:00-04:00", provenance: "seen_in_photo_or_video" },
        { id: "m4", kind: "photo", subject: "Outdoor unit", location: "wide", captured_at: "2026-09-03T11:20:00-04:00", provenance: "seen_in_photo_or_video" },
        { id: "m5", kind: "video", subject: "unit running", location: null, duration_seconds: 12, captured_at: "2026-09-03T11:21:00-04:00", provenance: "seen_in_photo_or_video" },
      ],
      readings: {
        thermostat_mode: { value: "cool", provenance: "seen_in_photo_or_video", source_media: "m2" },
        thermostat_setpoint_f: { value: 70, provenance: "seen_in_photo_or_video", source_media: "m2" },
        room_temp_f: { value: 78, provenance: "seen_in_photo_or_video", source_media: "m2" },
        filter_age_weeks: { value: 3, approximate: true, provenance: "reported" },
        filter_condition: { value: "clean", provenance: "seen_in_photo_or_video", source_media: "m3" },
      },
    },
    narrative: {
      facts: [
        { text: "Outdoor fan is turning, unit is audibly running", emphasis_word: "is", provenance: "seen_in_photo_or_video", inline_tag: "seen in video" },
        { text: "Thermostat: cool, set 70°F, room 78°F", provenance: "seen_in_photo_or_video", inline_tag: "seen in photo" },
        { text: "Air from vents is moving at normal strength", provenance: "reported" },
        { text: "No visible ice on accessible refrigerant line", provenance: "confirmed_by_homeowner" },
        { text: "Filter clean, replaced ~3 weeks ago", provenance: "seen_in_photo_or_video", inline_tag: "seen in photo" },
        { text: "Onset gradual over ~2 days, not sudden", provenance: "reported" },
        { text: "No breaker trips, no burning smell, no water", provenance: "confirmed_by_homeowner" },
      ],
      summary_observations: [
        "Indoor fan runs and air moves from the vents, but the air is not cold.",
        "Started Tuesday, gradually rather than suddenly.",
        "Thermostat is calling for cool at 70°F with the room sitting at 78°F.",
        "The outdoor unit is running and the fan is turning.",
        "No ice visible on the accessible line.",
        "Filter was replaced 3 weeks ago and photographs as clean.",
      ],
      timeline: [
        { label: "Sun 31 Aug", text: "Homeowner notes the house feeling warmer in the afternoon. Assumed it was the weather.", provenance: "reported" },
        { label: "Tue 2 Sep", text: "Clearly not cooling. Thermostat lowered to 68°F, no change after two hours.", provenance: "reported" },
        { label: "Tue 2 Sep, evening", text: "Checked filter — replaced 3 weeks ago, looks clean. Photographed.", provenance: "seen_in_photo_or_video" },
        { label: "Wed 3 Sep, 11:20", text: "Walked outside. Outdoor unit running, fan turning. Video taken.", provenance: "seen_in_photo_or_video" },
      ],
      script_parts: {
        problem_clause: "my AC is running but blowing warm air",
        equipment_brand_type: "a Carrier split system",
        age_spoken: "about eight years old",
        model_number: "24ABC636A003",
        onset_clause: "Started gradually on Tuesday",
        thermostat_setpoint: 70,
        room_temp: 78,
        outdoor_state_clause: "the outdoor unit is running and the fan's turning",
        filter_clause: "the filter's clean and three weeks old",
        ice_clause: "there's no ice I can see",
      },
    },
    provider: {
      checks: [
        { name: "Thermostat mode and setpoint", result: "Cool, 70°F, room 78°F", changed: "Confirms a real call for cooling — rules out a control-setting cause", result_provenance: "seen_in_photo_or_video", changed_provenance: "inference", certainty: "rules_out", certainty_scope: "control_setting" },
        { name: "Filter condition", result: "Clean, ~3 weeks old", changed: "Makes airflow restriction at the filter unlikely", result_provenance: "seen_in_photo_or_video", changed_provenance: "inference", certainty: "unlikely" },
        { name: "Outdoor unit running?", result: "Yes — fan turning, compressor audible", changed: "Rules out a dead contactor or total power loss to the condenser", result_provenance: "seen_in_photo_or_video", changed_provenance: "inference", certainty: "rules_out", certainty_scope: "power_level" },
        { name: "Ice on accessible line?", result: "None visible", changed: "Makes a severe freeze-up less likely, though not excluded at the coil", result_provenance: "confirmed_by_homeowner", changed_provenance: "inference", certainty: "less_likely" },
      ],
      unknowns: [
        { item: "Refrigerant charge", reason: "requires gauges" },
        { item: "Capacitor condition", reason: "requires meter, not homeowner-safe" },
        { item: "Coil condition inside air handler", reason: "requires panel removal" },
        { item: "Line-set temperature split", reason: "requires instrument" },
      ],
      technician_only: [
        "Capacitor test under load",
        "Refrigerant pressures, both sides",
        "Supply/return temperature split",
        "Contactor and condenser fan draw",
        "Evaporator coil inspection",
      ],
      branches: [
        { name: "Low refrigerant charge / leak", confidence: "Most consistent", for: "gradual onset over days, unit running normally, airflow normal, no ice at the accessible section.", against: "no oil staining reported at the accessible line-set." },
        { name: "Failing capacitor / compressor not staging", confidence: "Possible", for: "fan turning does not confirm the compressor is doing work.", against: "homeowner reports compressor audible, though untrained assessment." },
        { name: "Airflow restriction downstream of the filter", confidence: "Less likely", for: "cannot be excluded without inspecting the coil.", against: "filter clean and vent airflow reported normal." },
      ],
      service_history: [
        { question_id: "sh_refrigerant", answer: "Not that the owner is aware of", provenance: "reported" },
        { question_id: "sh_recent_service", answer: "None — no maintenance since purchase in 2021", provenance: "reported" },
        { question_id: "sh_impact", answer: "No", provenance: "confirmed_by_homeowner" },
        { question_id: "sh_room_variance", answer: "Worse upstairs, but that was true before the fault", provenance: "reported" },
      ],
      scope_factors: [
        "Unit is ~8 years old — repair-vs-replace conversation may be in scope",
        "If a leak is confirmed, locating it may need a separate diagnostic step",
        "Basement air handler — access is straightforward, no attic or roof work",
        "No permit or utility involvement indicated",
      ],
    },
    access: {
      occupancy: { value: "Owner works 8–5; prefers not to take time off", provenance: "reported" },
      owner_present_needed: { value: "No — happy for work to proceed while out", provenance: "reported" },
      parking: { value: "Driveway, two spaces, no permit needed", provenance: "reported" },
      pets: { value: "One dog, crated during visits", provenance: "reported" },
      equipment_route: { value: "Basement via internal stairs; outdoor unit accessible from side gate", provenance: "reported" },
      preferred_window: { value: "Any weekday; Thursday preferred", provenance: "reported" },
      gate_or_entry_code: { value: null, provenance: "unknown" },
      contact_preference: { value: "Text preferred over phone", provenance: "reported" },
    },
    counts: { facts_captured: 18, made_less_likely: 3 },
  };
}

/** The same record, thinned (Directions §11.3): complaint, address, urgency, nothing else. */
export function thinInput(): DirectionsInput {
  const r = referenceInput();
  return {
    ...r,
    packet: { ...r.packet, version: "v1" },
    problem: {
      ...r.problem,
      onset_date: null,
      onset_weekday_spoken: null,
      onset_character: null,
      onset_span_days: null,
      safety_state: "safety_not_established",
    },
    equipment: { labels_set: "hvac_split_ac" },
    evidence: { media: [], readings: {} },
    narrative: {
      facts: [{ text: "AC running, air from vents not cold", provenance: "reported" }],
      summary_observations: ["Air comes from the vents but the air is not cold."],
      timeline: [],
      script_parts: { problem_clause: "my AC is running but blowing warm air" },
    },
    provider: {
      checks: [],
      unknowns: [
        { item: "Refrigerant charge", reason: "requires gauges" },
        { item: "Capacitor condition", reason: "requires meter, not homeowner-safe" },
        { item: "Coil condition inside air handler", reason: "requires panel removal" },
        { item: "Line-set temperature split", reason: "requires instrument" },
        { item: "Model and serial", reason: "not photographed or typed at intake" },
        { item: "Filter condition", reason: "not asked" },
      ],
      technician_only: r.provider.technician_only,
      branches: [],
      service_history: [],
      scope_factors: [],
    },
    access: {},
    counts: { facts_captured: 1, made_less_likely: null },
  };
}
