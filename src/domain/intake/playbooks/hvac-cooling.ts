import { IntakePlaybook } from "@/domain/intake/playbook";

/**
 * HVAC — "AC runs but the air isn't cold" (warm / lukewarm / not cooling /
 * not blowing cold). The owner's worked example, made canon-safe: no invented
 * prices (OD-13), no dangerous instructions, one thing per step, photos that
 * knock out two questions at once where possible.
 *
 * `satisfies IntakePlaybook` on the parse input makes the contract a COMPILE
 * error as well as a runtime one — a question missing its `value_reason` tag
 * (or carrying an invented one) fails `npm run typecheck` before zod ever runs.
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
      // "which parts fit" — the answer changes what a technician brings.
      value_reason: "tools_parts",
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
      // "Narrows parts" — same licence as the model/serial label.
      value_reason: "tools_parts",
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
      // Repair-vs-replace is the next-step decision the answer moves.
      value_reason: "next_step",
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
      // Narrows the cause hypothesis the packet hands the provider.
      value_reason: "packet",
      how_to_find: "Just your best memory is fine.",
      photo_prompt: null,
      accepts: ["text"],
      priority: "core",
      harvest_to_property_memory: false,
      auto_detect_patterns: [
        "\\b(since|started|began)\\b.{0,40}\\b(yesterday|today|last (night|week)|this (morning|week)|\\d+ days?)\\b",
        // "since Tuesday" — checklist C1. domain/intake/extract.ts reads the
        // same shape by field key; this keeps the playbook honest on its own.
        "\\b(since|started|began)\\s+(last\\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b",
      ],
    },
    {
      field_key: "thermostat_photo",
      label: "Thermostat",
      why_it_matters: "Shows the set mode/temperature and whether the display is responding.",
      // A blank/unresponsive display is the battery-swap fix — the answer
      // decides whether this is DIY at all (see thermostat_power outcome).
      value_reason: "diy_viability",
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
        { when: "reported_clean", next_step_id: "outdoor_unit", outcome_id: null },
        { when: "rating:>=6", next_step_id: null, outcome_id: "dirty_filter" },
        { when: "rating:<6", next_step_id: "outdoor_unit", outcome_id: null },
        // The escape hatch (merged spec §8.3, Coverage Standard §7.4): "I can't
        // get to this" records the gap and moves on. Never a loop.
        { when: "cannot_reach", next_step_id: "outdoor_unit", outcome_id: null },
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
      satisfies_fields: [],
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
        { when: "cannot_reach", next_step_id: "fins_blocked", outcome_id: null },
      ],
      satisfies_fields: [],
    },
    {
      step_id: "fins_blocked",
      title: "Are the outdoor fins clogged?",
      instruction:
        "If you can see them safely, are the thin metal fins caked with debris, or mostly clear? You can also use a photo you took.",
      look_for: "Fins should look like clean, even metal lines. Packed grass or fluff blocks airflow.",
      safety_note: null,
      input: { kind: "choice", options: ["Mostly clear", "Pretty clogged"] },
      branches: [
        { when: "pretty clogged", next_step_id: null, outcome_id: "clogged_condenser" },
        { when: "mostly clear", next_step_id: null, outcome_id: "needs_technician_cooling" },
        { when: "cannot_reach", next_step_id: null, outcome_id: "needs_technician_cooling" },
      ],
      satisfies_fields: [],
    },
    {
      step_id: "power_check",
      title: "Check power to the outdoor unit",
      instruction:
        "Near the outdoor unit there is usually a small gray box on the wall, the disconnect. Photograph its closed exterior from a safe distance if you can reach it.",
      look_for:
        "A closed gray metal box on the wall near the outdoor unit. Only its exterior belongs in this check.",
      safety_note:
        "Keep the cover closed. Leave wires, switches and components alone. If anything looks burnt, melted or wet, stop and call a professional.",
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
        "Filter rated very dirty. Please verify the recorded filter condition, indoor coil and airflow; any repair and its result need separate confirmation.",
    },
    {
      outcome_id: "clogged_condenser",
      title: "Likely: the outdoor unit can't shed heat",
      likely_cause:
        "Debris packed into the outdoor fins stops the unit from dumping heat outside, so the air indoors never gets cold.",
      diy_possible: true,
      diy_steps: [
        "Turn cooling OFF at the thermostat.",
        "Keep the cabinet closed. Photograph the debris for a technician; leave coil cleaning and electrical isolation to them.",
        "Clear leaves and plants at least two feet around the unit.",
        "Restore power and test. If still warm after an hour, a technician should check refrigerant and the coil.",
      ],
      decision_frame: [
        "A technician can check the debris and explain whether cleaning is appropriate before further diagnosis.",
        "Your packet shows the debris you reported and which checks remain for the technician.",
      ],
      provider_note:
        "Condenser fins reported clogged. Review the packet for fan observations and any checks not completed. Cleaning and its effect on cooling need separate confirmation.",
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
        "Power and fan faults can look the same from outside. A licensed technician can identify which component needs attention.",
        "Keep electrical covers closed. Leave fuse, capacitor and wiring tests or replacement to a licensed technician; owning a meter does not make these homeowner checks.",
        "Ask the provider to quote the diagnostic visit before work begins. Your packet carries the external observations and any checks not completed.",
      ],
      provider_note:
        "Outdoor fan reported not running. Review any available exterior photos and checks marked not checked. A technician should verify operation while cooling is requested, power and fan components.",
    },
    {
      outcome_id: "needs_technician_cooling",
      title: "The next step is a technician's check",
      likely_cause:
        "The checks available here haven't identified a safe fix. A technician can verify airflow, power, refrigerant charge, the indoor coil and the compressor.",
      diy_possible: false,
      diy_steps: [],
      decision_frame: [
        "Your packet separates what you reported or checked from what remains unknown.",
        "Anything you couldn't reach stays marked as not checked, so the technician knows where to pick up.",
      ],
      provider_note:
        "Warm air persists. Review the packet's recorded observations and checks marked not checked before verifying airflow, power, refrigerant, the indoor coil and the compressor.",
    },
  ],
  generated_by: "content-bank-v1",
  created_at: "2026-08-19T00:00:00Z",
} satisfies IntakePlaybook);

/**
 * "WHAT THAT CHANGED" — one line per branch (checklist C6, Coverage Standard
 * §3.7: one authored payload, three surfaces). Rendered under the next step
 * the moment an answer lands, and the same words the packet's completed-checks
 * table can print.
 *
 * Keyed by step_id, then by the branch's `when` (lower-case, exactly as the
 * playbook spells it), so the `Branch` contract in domain/intake/playbook.ts
 * stays as it is. Honest and small: a tap earns a tap's worth of credit. "Can"
 * and "points at", never "is" (WORDING 25); no praise (WORDING 50).
 */
export const HVAC_COOLING_CHANGED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  filter: {
    reported_clean: "You reported a clean filter.",
    "rating:>=6": "A filter that dirty can starve your AC of air, so it moves to the top of the list.",
    "rating:<6": "You rated the filter as mostly clean.",
    cannot_reach: "The filter goes in the packet as not checked.",
  },
  outdoor_unit: {
    // This receipt is used by the text-answer route. An answer cannot prove an
    // upload; the media route acknowledges a photo only after storing it.
    any: "The outdoor photo check goes in the packet as not checked.",
  },
  fan_moving: {
    yes: "You reported that the outdoor fan is turning.",
    no: "A still fan points at power or the fan motor.",
    cannot_reach: "Whether the fan turns goes in the packet as not checked.",
  },
  fins_blocked: {
    "pretty clogged": "Packed fins can stop your outdoor unit shedding heat. That becomes the most likely cause.",
    "mostly clear": "You reported mostly clear outdoor fins.",
    cannot_reach: "The fins go in the packet as not checked.",
  },
  power_check: {
    any: "The disconnect photo check goes in the packet as not checked.",
  },
};

const NEXT_CHECK_LABELS: Readonly<Record<string, string>> = {
  filter: "the filter",
  outdoor_unit: "the outdoor unit",
  fan_moving: "whether the fan is turning",
  fins_blocked: "the fins",
  power_check: "the disconnect box",
};

/** A branch receipt plus the actual next check after replaying held answers. */
export function changedLineFor(playbookId: string, stepId: string, when: string, nextStepId?: string | null): string | null {
  if (playbookId !== HVAC_COOLING_PLAYBOOK.playbook_id) return null;
  const line = HVAC_COOLING_CHANGED[stepId]?.[when.toLowerCase()] ?? null;
  if (!line) return null;
  const next = nextStepId ? NEXT_CHECK_LABELS[nextStepId] : null;
  return next ? `${line} Next: ${next}.` : line;
}
