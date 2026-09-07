import { IntakePlaybook, type FieldRequirement } from "@/domain/intake/playbook";
import { HVAC_COOLING_PLAYBOOK } from "@/domain/intake/playbooks/hvac-cooling";

/**
 * Content-bank playbooks (generated-once, replayed statically). Model-written
 * playbooks land behind the same contract later and are cached in the
 * intake_playbook table; this file is the v1 generator.
 */
const COMMON_FIELDS: Record<string, FieldRequirement> = {
  symptom_timing: {
    field_key: "symptom_timing",
    label: "When did it start, and is it constant or on-and-off?",
    why_it_matters: "Constant vs. intermittent points at very different causes.",
    // Narrows the cause hypothesis the packet hands the provider.
    value_reason: "packet",
    how_to_find: "Just your best memory is fine.",
    photo_prompt: null,
    accepts: ["text"],
    priority: "core",
    harvest_to_property_memory: false,
    auto_detect_patterns: [
      "\\b(since|started|began)\\b.{0,40}\\b(yesterday|today|last (night|week)|this (morning|week)|\\d+ days?)\\b",
    ],
  },
  problem_photo: {
    field_key: "problem_photo",
    label: "A photo of the problem area",
    why_it_matters: "A picture answers a dozen questions at once and helps the provider bring the right things.",
    // "helps the provider bring the right things" — tools and parts.
    value_reason: "tools_parts",
    how_to_find: "Stand back far enough that we can see the whole area, then one close-up.",
    photo_prompt: "One wide shot and one close-up of the problem.",
    accepts: ["photo"],
    priority: "core",
    harvest_to_property_memory: false,
    auto_detect_patterns: [],
  },
};

const HVAC_NO_POWER: IntakePlaybook = IntakePlaybook.parse({
  playbook_id: "pb_hvac_no_power_v1",
  schema_version: "1.0.0",
  version: 1,
  problem_family: "hvac",
  cluster_label: "AC or furnace won't turn on at all",
  match_patterns: [
    "\\b(ac|a/c|air ?condition\\w*|furnace|heat pump|hvac)\\b.*\\b(won'?t (turn|come|start|kick)|not turning on|no power|dead|nothing happens|won'?t start)",
    "\\b(furnace|ac|a/c) (is )?not working\\b",
  ],
  intro:
    "A completely unresponsive system most often traces to power or controls — which are the easiest things to check. Details first, then a short walkthrough if you want it.",
  required_fields: [
    HVAC_COOLING_PLAYBOOK.required_fields.find((f) => f.field_key === "unit_model_serial")!,
    HVAC_COOLING_PLAYBOOK.required_fields.find((f) => f.field_key === "brand")!,
    HVAC_COOLING_PLAYBOOK.required_fields.find((f) => f.field_key === "thermostat_photo")!,
    COMMON_FIELDS.symptom_timing,
  ],
  first_step_id: "thermostat",
  diagnostic_steps: [
    {
      step_id: "thermostat",
      title: "Thermostat first",
      instruction:
        "Is the thermostat display on and set to the mode you want (COOL or HEAT), with the temperature set past the room temperature?",
      look_for: "A lit display. A blank screen on a battery thermostat often just means dead batteries.",
      safety_note: null,
      input: { kind: "choice", options: ["Display is blank", "On, and set correctly", "On, but I'm not sure it's set right"] },
      branches: [
        { when: "display is blank", next_step_id: null, outcome_id: "thermostat_power" },
        { when: "on, and set correctly", next_step_id: "breaker", outcome_id: null },
        { when: "on, but i'm not sure it's set right", next_step_id: "breaker", outcome_id: null },
      ],
      satisfies_fields: ["thermostat_photo"],
    },
    {
      step_id: "breaker",
      title: "Check the breaker panel",
      instruction:
        "Open your main electrical panel and look for a breaker labeled AC, air handler, furnace or HVAC. Is any breaker sitting in the middle or OFF position?",
      look_for: "Breakers in a row; a tripped one sits between ON and OFF, sometimes with an orange/red flag.",
      safety_note: "Flip a breaker switch only — never remove the panel cover. Reset ONCE at most; if it trips again, stop.",
      input: { kind: "choice", options: ["One was tripped — I reset it", "One was tripped — it tripped again", "None tripped"] },
      branches: [
        { when: "one was tripped — i reset it", next_step_id: null, outcome_id: "breaker_reset" },
        { when: "one was tripped — it tripped again", next_step_id: null, outcome_id: "breaker_retrips" },
        { when: "none tripped", next_step_id: "drain_pan", outcome_id: null },
      ],
      satisfies_fields: [],
    },
    {
      step_id: "drain_pan",
      title: "Look for a full drain pan",
      instruction:
        "If your indoor unit is in an attic or closet, there's often a shallow pan underneath. Is there standing water in it? Many systems shut themselves off on purpose when that pan fills.",
      look_for: "A flat metal or plastic pan under the unit; water in it means a safety float switch may have cut the power.",
      safety_note: null,
      input: { kind: "choice", options: ["Yes, water in the pan", "Dry / no pan I can see"] },
      branches: [
        { when: "yes, water in the pan", next_step_id: null, outcome_id: "float_switch" },
        { when: "dry / no pan i can see", next_step_id: null, outcome_id: "needs_technician_power" },
      ],
      satisfies_fields: [],
    },
  ],
  outcomes: [
    {
      outcome_id: "thermostat_power",
      title: "Likely: the thermostat itself has no power",
      likely_cause: "A blank thermostat usually means dead batteries or a tripped low-voltage fuse — the system never gets the call to start.",
      diy_possible: true,
      diy_steps: ["If it takes batteries, replace them.", "If it is hard-wired and still blank after the breaker check, a technician should look at the low-voltage side."],
      decision_frame: ["Batteries cost almost nothing and fix this surprisingly often."],
      provider_note: "Thermostat display blank; batteries [replaced/not applicable]. Please check 24V control circuit.",
    },
    {
      outcome_id: "breaker_reset",
      title: "Breaker was tripped and reset once",
      likely_cause: "A single trip can be a one-off. If the system runs normally now, watch it for a day.",
      diy_possible: true,
      diy_steps: ["Run the system. If it trips again, stop using it — a repeated trip is a signal for a professional, not a reset."],
      decision_frame: ["One trip: wait and see. Two trips: call."],
      provider_note: "HVAC breaker found tripped and reset once on [date]; system [runs / tripped again].",
    },
    {
      outcome_id: "breaker_retrips",
      title: "Breaker trips again — stop here",
      likely_cause: "A breaker that re-trips is protecting against a real electrical fault (often a failed capacitor, a shorted motor, or wiring).",
      diy_possible: false,
      diy_steps: ["Leave the breaker OFF and do not keep resetting it."],
      decision_frame: ["This one needs a technician; your packet tells them exactly what happened."],
      provider_note: "HVAC breaker re-trips immediately after reset. Customer has left it OFF. Suspect capacitor/motor/wiring fault.",
    },
    {
      outcome_id: "float_switch",
      title: "Likely: a safety float switch did its job",
      likely_cause: "Water in the drain pan trips a float switch that cuts power on purpose, to prevent a ceiling leak. The real problem is a clogged condensate drain.",
      diy_possible: true,
      diy_steps: ["Turn the system off.", "Carefully remove the standing water (wet vac or towels).", "The drain line usually needs clearing — many homeowners do this; many prefer a technician. Either way, do not run the system until the pan stays dry."],
      decision_frame: ["Clearing a condensate line is a common, low-risk service; the float switch saved you from a bigger repair."],
      provider_note: "Standing water in drain pan; suspect tripped float switch / clogged condensate drain.",
    },
    {
      outcome_id: "needs_technician_power",
      title: "Controls and power look fine — this needs a technician",
      likely_cause: "With thermostat, breaker and pan ruled out, the likely suspects are a failed capacitor, contactor, transformer or control board.",
      diy_possible: false,
      diy_steps: [],
      decision_frame: ["You've eliminated the easy stuff; the visit starts with the hard stuff already in view."],
      provider_note: "Customer verified: thermostat lit and set, no tripped breaker, drain pan dry. System still dead. Please check capacitor/contactor/transformer/control board.",
    },
  ],
  generated_by: "content-bank-v1",
  created_at: "2026-08-19T00:00:00Z",
} satisfies IntakePlaybook);

const PLUMBING_LEAK: IntakePlaybook = IntakePlaybook.parse({
  playbook_id: "pb_plumbing_leak_v1",
  schema_version: "1.0.0",
  version: 1,
  problem_family: "plumbing",
  cluster_label: "Water leaking, dripping or showing up where it shouldn't",
  match_patterns: ["\\b(leak\\w*|dripp?\\w*|water (coming|dripping|pooling|spot|stain))\\b"],
  intro:
    "With water, the two questions that matter most are WHERE it comes from and WHEN — and those are exactly what's hardest to see. A couple of photos and one observation narrow it fast.",
  required_fields: [
    COMMON_FIELDS.problem_photo,
    COMMON_FIELDS.symptom_timing,
    {
      field_key: "fixture_or_appliance",
      label: "Which fixture or appliance is nearby?",
      why_it_matters: "A water heater, toilet, shower, dishwasher or washing machine each leak for different reasons.",
      // A washer/dishwasher leak is an appliance-repair call, not a plumber
      // (this playbook's own appliance_leak outcome) — the answer picks the trade.
      value_reason: "provider_type",
      how_to_find: "Name whatever is closest — above or behind the wet spot.",
      photo_prompt: "If an appliance or water heater is involved, snap its label (model/serial).",
      accepts: ["photo", "text"],
      priority: "core",
      harvest_to_property_memory: true,
      auto_detect_patterns: ["\\b(water heater|toilet|shower|tub|bathtub|sink|faucet|dishwasher|washing machine|washer|fridge|refrigerator|ice ?maker)\\b"],
    },
    {
      field_key: "shutoff_known",
      label: "Do you know where your main water shutoff is?",
      why_it_matters: "If it gets worse, this is how you stop it in seconds.",
      // Stopping active water fast is damage prevention — a safety licence.
      value_reason: "safety",
      how_to_find: "Usually where the main line enters the house: basement wall, utility room, crawlspace, or near the water meter.",
      photo_prompt: null,
      accepts: ["text"],
      priority: "helpful",
      harvest_to_property_memory: true,
      auto_detect_patterns: ["\\bshut ?off\\b"],
    },
  ],
  first_step_id: "pattern",
  diagnostic_steps: [
    {
      step_id: "pattern",
      title: "Constant, or only when something runs?",
      instruction: "Does the water appear all the time, or only when a specific fixture is used (a shower, the washing machine, a toilet flush)?",
      look_for: "Constant = pressurized supply line. Only-when-used = a drain or fixture seal.",
      safety_note: "If water is anywhere near outlets, cords or your electrical panel, keep power away from the wet area and treat it as urgent.",
      input: { kind: "choice", options: ["Constant / even when nothing is running", "Only when a fixture is used", "Not sure"] },
      branches: [
        { when: "constant / even when nothing is running", next_step_id: null, outcome_id: "supply_leak" },
        { when: "only when a fixture is used", next_step_id: "which_fixture", outcome_id: null },
        { when: "not sure", next_step_id: "watch_test", outcome_id: null },
      ],
      satisfies_fields: [],
    },
    {
      step_id: "watch_test",
      title: "A two-minute test",
      instruction: "Make sure nothing is running for ten minutes, then look again. Did the wet spot grow or new drips appear?",
      look_for: "Growth with nothing running points at a supply line.",
      safety_note: null,
      input: { kind: "yes_no" },
      branches: [
        { when: "yes", next_step_id: null, outcome_id: "supply_leak" },
        { when: "no", next_step_id: "which_fixture", outcome_id: null },
      ],
      satisfies_fields: [],
    },
    {
      step_id: "which_fixture",
      title: "Which fixture triggers it?",
      instruction: "Run one fixture at a time for a minute each and watch. Which one makes it appear?",
      look_for: "Shower/tub: often a drain or tile seal. Toilet: wax ring or supply. Washer/dishwasher: hose or pump.",
      safety_note: null,
      input: { kind: "choice", options: ["Shower or tub", "Toilet", "Washing machine or dishwasher", "Sink", "Couldn't reproduce it"] },
      branches: [
        { when: "shower or tub", next_step_id: null, outcome_id: "drain_seal_leak" },
        { when: "toilet", next_step_id: null, outcome_id: "toilet_leak" },
        { when: "washing machine or dishwasher", next_step_id: null, outcome_id: "appliance_leak" },
        { when: "sink", next_step_id: null, outcome_id: "drain_seal_leak" },
        { when: "couldn't reproduce it", next_step_id: null, outcome_id: "intermittent_unknown" },
      ],
      satisfies_fields: ["fixture_or_appliance"],
    },
  ],
  outcomes: [
    {
      outcome_id: "supply_leak",
      title: "Likely: a pressurized supply line",
      likely_cause: "Water that keeps coming with nothing running is under pressure — a pipe, fitting, valve or water-heater connection.",
      diy_possible: false,
      diy_steps: ["Find your main shutoff now so you can stop it fast if it worsens.", "Put a bucket/towels down and photograph the area for the provider."],
      decision_frame: ["Supply leaks don't heal; this is a plumber call, and sooner is cheaper than later because water damage compounds."],
      provider_note: "Leak persists with all fixtures off — pressurized supply suspected. Location/photos attached.",
    },
    {
      outcome_id: "drain_seal_leak",
      title: "Likely: a drain or seal leak",
      likely_cause: "It only appears when that fixture runs, which points at the drain assembly, a seal/gasket, or grout/caulk letting water behind the surface.",
      diy_possible: true,
      diy_steps: ["Stop using that fixture until it's looked at.", "Check visible caulk/grout around it; missing caulk is a common DIY fix."],
      decision_frame: ["Seal/caulk issues are often DIY; a drain assembly is usually a plumber. The packet tells them which fixture reproduces it — that alone saves diagnostic time."],
      provider_note: "Leak reproduces only when [fixture] runs; drain/seal suspected.",
    },
    {
      outcome_id: "toilet_leak",
      title: "Likely: toilet seal or supply",
      likely_cause: "A leak on flush usually means the wax ring or a loose supply connection.",
      diy_possible: false,
      diy_steps: ["Stop flushing that toilet if water reaches the floor below."],
      decision_frame: ["A wax ring is a common, quick plumber job; tell them it leaks on flush."],
      provider_note: "Leak reproduces on toilet flush; wax ring or supply connection suspected.",
    },
    {
      outcome_id: "appliance_leak",
      title: "Likely: appliance hose, pump or door seal",
      likely_cause: "Washers and dishwashers leak from hoses, the pump area, or the door seal.",
      diy_possible: true,
      diy_steps: ["Check the hoses behind the appliance for drips or cracks (with it off).", "Photograph the appliance label so the packet has the model."],
      decision_frame: ["Hoses are a cheap DIY swap; pumps and seals are an appliance-repair call."],
      provider_note: "Leak reproduces when [appliance] runs; hoses/pump/door seal suspected. Model label attached.",
    },
    {
      outcome_id: "intermittent_unknown",
      title: "Intermittent and not reproducible yet",
      likely_cause: "Some leaks only show under specific conditions (rain, long showers, full loads). That's useful to note.",
      diy_possible: false,
      diy_steps: ["Put a paper towel under the spot; check it each morning and note when it gets wet."],
      decision_frame: ["Your observations over a few days make the plumber's visit far more effective."],
      provider_note: "Intermittent leak; not reproducible on demand. Customer logging occurrences.",
    },
  ],
  generated_by: "content-bank-v1",
  created_at: "2026-08-19T00:00:00Z",
} satisfies IntakePlaybook);

const ELECTRICAL: IntakePlaybook = IntakePlaybook.parse({
  playbook_id: "pb_electrical_v1",
  schema_version: "1.0.0",
  version: 1,
  problem_family: "electrical",
  cluster_label: "Outlets, switches, lights or breakers acting up",
  match_patterns: ["\\b(outlet|breaker|switch|lights? (flicker|dim|out)|no power to|sparks?|electrical)\\b"],
  intro:
    "Electrical is the one area where we'll ask you to observe, not test. The pattern — one outlet vs. one room vs. the whole house — tells an electrician a lot before they arrive.",
  required_fields: [
    COMMON_FIELDS.problem_photo,
    COMMON_FIELDS.symptom_timing,
    {
      field_key: "affected_scope",
      label: "How much is affected?",
      why_it_matters: "One outlet, one room, or whole-house point at completely different causes.",
      // "the scope you noted is exactly what they need" (needs_electrician
      // outcome) — the answer sharpens what the packet tells the electrician.
      value_reason: "packet",
      how_to_find: "Check a couple of nearby outlets and lights.",
      photo_prompt: null,
      accepts: ["text"],
      priority: "core",
      harvest_to_property_memory: false,
      auto_detect_patterns: ["\\b(one outlet|whole house|entire house|one room|half the house)\\b"],
    },
    {
      field_key: "panel_photo",
      label: "Breaker panel (cover closed)",
      why_it_matters: "Shows the panel type, age and labeling — without opening anything.",
      // Panel type/age/labeling is context the electrician reads off the
      // packet before arriving.
      value_reason: "packet",
      how_to_find: "Your main electrical panel, usually garage, basement or utility room.",
      photo_prompt: "Photo of the panel with the door open but the inner cover ON, so breakers and labels are visible.",
      accepts: ["photo"],
      priority: "helpful",
      harvest_to_property_memory: true,
      auto_detect_patterns: [],
    },
  ],
  first_step_id: "danger_signs",
  diagnostic_steps: [
    {
      step_id: "danger_signs",
      title: "Any warmth, smell or discoloration?",
      instruction: "At the outlet, switch or panel: is there any warmth, a burning/plastic smell, buzzing, or brown/black discoloration?",
      look_for: "Any of those is a stop sign.",
      safety_note: "If yes: stop using that circuit, switch the breaker OFF, and contact an electrician promptly. If anything is smoking or sparking, leave and call 911.",
      input: { kind: "yes_no" },
      branches: [
        { when: "yes", next_step_id: null, outcome_id: "danger" },
        { when: "no", next_step_id: "gfci", outcome_id: null },
      ],
      satisfies_fields: [],
    },
    {
      step_id: "gfci",
      title: "Look for a tripped GFCI",
      instruction: "Kitchens, bathrooms, garages and outdoor outlets are often on a GFCI — the outlet with TEST/RESET buttons. Is any RESET button popped out? Press it once.",
      look_for: "An outlet with two small rectangular buttons; a popped RESET sits proud of the face.",
      safety_note: "Pressing RESET is safe. Do not press it with wet hands, and if the outlet is warm, discolored or smells, leave it alone and stop here.",
      input: { kind: "choice", options: ["Found one and reset it — power is back", "Found one but reset didn't help", "No GFCI nearby"] },
      branches: [
        { when: "found one and reset it — power is back", next_step_id: null, outcome_id: "gfci_fixed" },
        { when: "found one but reset didn't help", next_step_id: "breaker_e", outcome_id: null },
        { when: "no gfci nearby", next_step_id: "breaker_e", outcome_id: null },
      ],
      satisfies_fields: [],
    },
    {
      step_id: "breaker_e",
      title: "Check the breaker panel",
      instruction: "Is any breaker in the middle/OFF position? You may reset it ONCE.",
      look_for: "A tripped breaker sits between ON and OFF.",
      safety_note: "Switch only — never remove the inner panel cover. If it trips again, stop.",
      input: { kind: "choice", options: ["Tripped — reset fixed it", "Tripped — it trips again", "Nothing tripped"] },
      branches: [
        { when: "tripped — reset fixed it", next_step_id: null, outcome_id: "breaker_fixed" },
        { when: "tripped — it trips again", next_step_id: null, outcome_id: "retrip" },
        { when: "nothing tripped", next_step_id: null, outcome_id: "needs_electrician" },
      ],
      satisfies_fields: ["panel_photo"],
    },
  ],
  outcomes: [
    {
      outcome_id: "danger",
      title: "Stop — treat this as urgent",
      likely_cause: "Heat, smell or discoloration at an outlet, switch or panel means a connection is overheating.",
      diy_possible: false,
      diy_steps: ["Turn that circuit's breaker OFF and leave it off.", "Contact a licensed electrician promptly."],
      decision_frame: ["This is not a wait-and-see item."],
      provider_note: "Customer reports heat/smell/discoloration at [location]; circuit switched OFF. Please prioritize.",
    },
    {
      outcome_id: "gfci_fixed",
      title: "A GFCI had tripped — power restored",
      likely_cause: "GFCIs trip on moisture or a faulty device. If it trips again, unplug devices on that circuit one at a time to find the culprit.",
      diy_possible: true,
      diy_steps: ["If it trips repeatedly with nothing plugged in, an electrician should check the circuit."],
      decision_frame: ["One trip: normal. Repeated: call."],
      provider_note: "GFCI tripped and reset on [date]; [recurring / not].",
    },
    {
      outcome_id: "breaker_fixed",
      title: "A breaker had tripped — reset once",
      likely_cause: "A one-off trip can be an overload. Watch it.",
      diy_possible: true,
      diy_steps: ["If it trips again, leave it off and call an electrician."],
      decision_frame: ["Repeated trips are the signal."],
      provider_note: "Breaker tripped and reset once on [date].",
    },
    {
      outcome_id: "retrip",
      title: "Breaker re-trips — leave it off",
      likely_cause: "A re-trip means a real fault on that circuit (short, ground fault, or failing breaker).",
      diy_possible: false,
      diy_steps: ["Leave the breaker OFF."],
      decision_frame: ["Electrician call; your packet names the circuit and what's on it."],
      provider_note: "Breaker for [circuit] re-trips after single reset; left OFF.",
    },
    {
      outcome_id: "needs_electrician",
      title: "No GFCI, no tripped breaker — needs an electrician",
      likely_cause: "Dead outlets with nothing tripped often mean a loose connection upstream in the circuit.",
      diy_possible: false,
      diy_steps: [],
      decision_frame: ["Straightforward electrician visit; the scope you noted (one outlet / one room / whole house) is exactly what they need."],
      provider_note: "Customer verified: no danger signs, no GFCI to reset, no tripped breaker. Affected scope: [scope].",
    },
  ],
  generated_by: "content-bank-v1",
  created_at: "2026-08-19T00:00:00Z",
} satisfies IntakePlaybook);

const GENERIC: IntakePlaybook = IntakePlaybook.parse({
  playbook_id: "pb_generic_home_problem_v1",
  schema_version: "1.0.0",
  version: 1,
  problem_family: "general_home_problem",
  cluster_label: "Home problem — details first",
  match_patterns: [],
  intro:
    "Let's capture the few details any provider will ask for. A couple of photos and a sentence or two on timing makes a huge difference.",
  required_fields: [COMMON_FIELDS.problem_photo, COMMON_FIELDS.symptom_timing],
  first_step_id: null,
  diagnostic_steps: [],
  outcomes: [],
  generated_by: "content-bank-v1",
  created_at: "2026-08-19T00:00:00Z",
} satisfies IntakePlaybook);

export const PLAYBOOKS: readonly IntakePlaybook[] = [
  HVAC_COOLING_PLAYBOOK,
  HVAC_NO_POWER,
  PLUMBING_LEAK,
  ELECTRICAL,
  GENERIC,
];

/** Route a description + inferred family to the best playbook. */
export function selectPlaybook(description: string, family: string | null): IntakePlaybook {
  // Typographic apostrophes are common keyboard input. Normalize only the
  // matching view so "won’t turn on" reaches the same route as "won't";
  // retain the homeowner's original text in all evidence and saved records.
  const text = description.toLowerCase().replace(/[’]/g, "'");
  const candidates = PLAYBOOKS.filter((p) => p.problem_family === family);
  for (const pb of candidates.length > 0 ? candidates : PLAYBOOKS) {
    if (pb.match_patterns.some((src) => new RegExp(src, "i").test(text))) return pb;
  }
  // Family matched but no cluster pattern: first playbook of the family.
  if (candidates.length > 0) return candidates[0];
  return GENERIC;
}

export function findPlaybook(playbookId: string): IntakePlaybook | null {
  return PLAYBOOKS.find((p) => p.playbook_id === playbookId) ?? null;
}
