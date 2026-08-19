import { IntakePlaybook } from "@/domain/intake/playbook";

/**
 * HVAC — "AC runs but the air isn't cold" (warm / lukewarm / not cooling /
 * not blowing cold). The owner's worked example, made canon-safe: no invented
 * prices (OD-13), no dangerous instructions, one thing per step, photos that
 * knock out two questions at once where possible.
 */
export const HVAC_COOLING_PLAYBOOK: IntakePlaybook = IntakePlaybook.parse({
  playbook_id: "pb_hvac_cooling_v1",
  schema_version: "1.0.0",
  version: 1,
  problem_family: "hvac",
  cluster_label: "AC runs but the air isn't cold",
  match_patterns: [
    "\\b(ac|a/c|air ?condition\\w*)\\b.*\\b(warm|lukewarm|hot|not (cold|cool)\\w*|won'?t cool|isn'?t cool\\w*|stopped cool\\w*|blowing (warm|hot))",
    "\\bnot cooling\\b",
    "\\bblowing warm\\b",
  ],
  intro:
    "Good news: this is one of the most common cooling complaints, and a few quick looks usually narrow it down fast. We'll grab the details a technician needs first, then — only if you want — walk through it together step by step.",
  required_fields: [
    {
      field_key: "unit_model_serial",
      label: "Model & serial number",
      why_it_matters:
        "Tells a technician the exact system, its age, and which parts fit — before they arrive.",
      how_to_find:
        "On the OUTDOOR unit, look for a metal or silver sticker on the side, usually near where the pipes go in. Indoors, the air handler/furnace has a similar label inside or beside the access panel.",
      photo_prompt: "Snap the label — make sure the MODEL and SERIAL lines are readable.",
      accepts: ["photo", "text"],
      priority: "core",
      harvest_to_property_memory: true,
      auto_detect_patterns: ["\\b(model|serial)\\s*(no\\.?|number|#)?\\s*[:#-]?\\s*([A-Z0-9][A-Z0-9-]{5,})"],
    },
    {
      field_key: "brand",
      label: "Brand",
      why_it_matters: "Narrows parts and known patterns for that brand.",
      how_to_find: "It's on the same label, or printed on the outdoor unit's grille.",
      photo_prompt: null,
      accepts: ["text"],
      priority: "helpful",
      harvest_to_property_memory: true,
      auto_detect_patterns: [
        "\\b(carrier|trane|lennox|goodman|rheem|ruud|york|bryant|american standard|amana|daikin|mitsubishi|heil|payne|ducane|tempstar|comfortmaker|frigidaire|lg|samsung)\\b",
      ],
    },
    {
      field_key: "system_age",
      label: "Roughly how old is the system?",
      why_it_matters: "Age shapes repair-vs-replace advice and likely failure points.",
      how_to_find:
        "If you don't know, the serial number usually encodes the year — just send the label photo and we'll note it for the provider.",
      photo_prompt: null,
      accepts: ["text"],
      priority: "helpful",
      harvest_to_property_memory: true,
      auto_detect_patterns: ["\\b(\\d{1,2})\\s*(years?|yrs?)\\s*old\\b", "\\binstalled (in )?(19|20)\\d{2}\\b"],
    },
    {
      field_key: "symptom_timing",
      label: "When did it start, and is it constant or on-and-off?",
      why_it_matters: "Constant vs. intermittent points at very different causes.",
      how_to_find: "Just your best memory is fine.",
      photo_prompt: null,
      accepts: ["text"],
      priority: "core",
      harvest_to_property_memory: false,
      auto_detect_patterns: ["\\b(since|started|began)\\b.{0,40}\\b(yesterday|today|last (night|week)|this (morning|week)|\\d+ days?)\\b"],
    },
    {
      field_key: "thermostat_photo",
      label: "Thermostat",
      why_it_matters: "Shows the set mode/temperature and whether the display is responding.",
      how_to_find: "Your wall thermostat, as it is right now.",
      photo_prompt: "Snap the thermostat screen as-is (don't change anything first).",
      accepts: ["photo", "text"],
      priority: "helpful",
      harvest_to_property_memory: false,
      auto_detect_patterns: [],
    },
  ],
  first_step_id: "filter",
  diagnostic_steps: [
    {
      step_id: "filter",
      title: "Check the air filter",
      instruction:
        "A dirty or clogged filter is the #1 cause of weak, warm air. Find the panel that opens on your indoor unit (or the return grille in a wall/ceiling) and pull the filter out.",
      look_for:
        "A rectangular mesh/pleated panel. Clean looks white or light gray with visible pleats; clogged looks gray-brown and fuzzy, like lint.",
      safety_note: null,
      input: { kind: "rating", min_label: "0 — pristine white", max_label: "10 — you could grow a plant on it" },
      branches: [
        { when: "rating:>=6", next_step_id: null, outcome_id: "dirty_filter" },
        { when: "rating:<6", next_step_id: "outdoor_unit", outcome_id: null },
      ],
      satisfies_fields: [],
    },
    {
      step_id: "outdoor_unit",
      title: "Look at the outdoor unit",
      instruction:
        "Go to the outdoor unit while the AC is running. Take two photos: one from the side and one looking down from the top — the top shot lets us see whether the fan is spinning, so that's two checks in one.",
      look_for:
        "Leaves, grass clippings, cottonwood fluff or dirt packed into the metal fins on the sides; and on top, a fan that should be visibly spinning while the system runs.",
      safety_note: "Look, don't touch — keep fingers and tools out of the fan grille.",
      input: { kind: "photo" },
      branches: [{ when: "any", next_step_id: "fan_moving", outcome_id: null }],
      satisfies_fields: ["unit_model_serial"],
    },
    {
      step_id: "fan_moving",
      title: "Is the outdoor fan spinning?",
      instruction:
        "With the thermostat calling for cool and the system on, is the big fan on top of the outdoor unit turning?",
      look_for: "Blades moving steadily. A humming unit with a still fan is a clue.",
      safety_note: null,
      input: { kind: "yes_no" },
      branches: [
        { when: "no", next_step_id: "power_check", outcome_id: null },
        { when: "yes", next_step_id: "fins_blocked", outcome_id: null },
      ],
      satisfies_fields: [],
    },
    {
      step_id: "fins_blocked",
      title: "Are the outdoor fins clogged?",
      instruction:
        "Looking at your side photo: are the thin metal fins caked with debris, or mostly clear?",
      look_for: "Fins should look like clean, even metal lines. Packed grass or fluff blocks airflow.",
      safety_note: null,
      input: { kind: "choice", options: ["Mostly clear", "Pretty clogged"] },
      branches: [
        { when: "pretty clogged", next_step_id: null, outcome_id: "clogged_condenser" },
        { when: "mostly clear", next_step_id: null, outcome_id: "needs_technician_cooling" },
      ],
      satisfies_fields: [],
    },
    {
      step_id: "power_check",
      title: "Check power to the outdoor unit",
      instruction:
        "Near the outdoor unit there's usually a small gray box on the wall — the disconnect. Snap a photo of it with the cover open so we can see whether it has fuses and what type.",
      look_for:
        "A gray metal box with a pull-out block or switch, sometimes with two cartridge fuses inside.",
      safety_note:
        "Opening the cover to look is fine. Do NOT touch wires or pull components. If anything looks burnt, melted or wet, stop and call a professional.",
      input: { kind: "photo" },
      branches: [{ when: "any", next_step_id: null, outcome_id: "fan_not_running" }],
      satisfies_fields: [],
    },
  ],
  outcomes: [
    {
      outcome_id: "dirty_filter",
      title: "Very likely: a clogged filter",
      likely_cause:
        "A filter that dirty starves the system of air. The coil can even freeze, which makes the air come out warm.",
      diy_possible: true,
      diy_steps: [
        "Turn the system OFF at the thermostat.",
        "Replace the filter with the same size (the size is printed on its edge).",
        "Leave the system off for a couple of hours in case the indoor coil froze, then turn it back on.",
        "If it's cooling normally by the next day, you're done. If not, come back here — we'll continue from the next step.",
      ],
      decision_frame: [
        "This is the cheapest fix in the book and worth trying before any service call.",
        "A replacement filter is a standard hardware-store item — [local price] (OD-13: sourced pricing arrives later; no invented figures).",
      ],
      provider_note:
        "Filter was rated very dirty and replaced on [date]; symptoms [resolved / persisted]. Please verify the indoor coil for ice or residual restriction.",
    },
    {
      outcome_id: "clogged_condenser",
      title: "Likely: the outdoor unit can't shed heat",
      likely_cause:
        "Debris packed into the outdoor fins stops the unit from dumping heat outside, so the air indoors never gets cold.",
      diy_possible: true,
      diy_steps: [
        "Turn the system OFF at the thermostat AND at the outdoor disconnect.",
        "Gently rinse the fins from the inside out with a garden hose — light pressure only, never a pressure washer (it bends the fins).",
        "Clear leaves and plants at least two feet around the unit.",
        "Restore power and test. If still warm after an hour, a technician should check refrigerant and the coil.",
      ],
      decision_frame: [
        "Cleaning costs nothing but an hour; many 'warm air' calls end right here.",
        "If cleaning doesn't fix it, that's the moment a diagnostic visit earns its fee — and your packet already tells the technician what's been ruled out.",
      ],
      provider_note:
        "Outdoor fan runs; condenser fins were found clogged and rinsed on [date]. Symptoms [resolved / persisted]. Please check refrigerant charge and coil condition.",
    },
    {
      outcome_id: "fan_not_running",
      title: "The outdoor fan isn't running — power or motor",
      likely_cause:
        "A still fan while the system calls for cool usually means either no power reaching the unit (tripped breaker, blown disconnect fuse) or a failed capacitor/fan motor.",
      diy_possible: false,
      diy_steps: [
        "Check your main breaker panel for a tripped AC breaker. You may reset it ONCE. If it trips again, stop — that needs a professional.",
      ],
      decision_frame: [
        "Two very different price tags hide behind the same symptom: a fuse or capacitor (small part, quick swap) versus a fan motor (a bigger repair).",
        "Telling them apart safely takes a meter. Your options: (a) a technician's diagnostic visit — you'll likely want them for a motor anyway; (b) if you're comfortable with electrical work AND own or can rent a multimeter, fuses and capacitors are testable; (c) some people replace the cheap fuses on a gamble because the downside is small — but capacitors store a dangerous charge, so that one is NOT a DIY gamble.",
        "Sourced local prices for these options arrive with the pricing registry (OD-13) — until then, ask the provider to quote the diagnostic visit up front.",
      ],
      provider_note:
        "Outdoor fan not running while calling for cool; disconnect photographed [fuses: type/rating from photo]. Suspect power/fuse, capacitor, or fan motor. Customer has NOT opened electrical compartments.",
    },
    {
      outcome_id: "needs_technician_cooling",
      title: "Airflow and power look fine — this needs a technician",
      likely_cause:
        "With a clean filter, a running fan and clear fins, the likely suspects are refrigerant charge, a frozen/dirty indoor coil, or a compressor issue — all of which need gauges and training.",
      diy_possible: false,
      diy_steps: [],
      decision_frame: [
        "You've already ruled out the cheap causes — that's exactly what makes the service visit efficient.",
        "Your packet tells the technician what's been checked, so they can start where you left off.",
      ],
      provider_note:
        "Customer verified: filter clean, outdoor fan running, condenser fins clear. Warm air persists. Please check refrigerant, indoor coil, and compressor.",
    },
  ],
  generated_by: "content-bank-v1",
  created_at: "2026-08-19T00:00:00Z",
});
