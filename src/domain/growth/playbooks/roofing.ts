import { ServicePlaybook } from "@/domain/growth/service-playbook";

/**
 * ROOFING SHADOW PLAYBOOK — T6-01's reusability proof, trade three. Same
 * schema, no edits to the schema, third trade.
 *
 * STAYS SHADOW (Josh's ruling R1, 2026-08-28): Tree went authoritative, this
 * did not. "shadow" is the literal, deliberate status — not "parked", not
 * "draft" — because the schema's one-authoritative-voice-per-trade rule and the
 * eligibility gate both key off exactly that word. Not a voice of record, no
 * public page use, until its own ruling and a named reviewer.
 *
 * Its technique instructions were stripped anyway (R3): the no-technique rule
 * is a CONTENT rule, and copy left sitting in a shadow playbook is copy that
 * goes live later by accident. This is the file that forced the rule.
 */
export const ROOFING_PLAYBOOK = ServicePlaybook.parse({
  playbook_id: "spb_roofing_v1",
  schema_version: "1.0.0",
  version: 1,
  system: "roofing",
  status: "shadow",
  trade_name: "Roofing",
  covers_node_ids: ["ppg_roof_leak_active_v1", "ppg_roof_aging_v1"],
  sections: [
    {
      section_id: "roof_leak_right_now",
      homeowner_question: "Water is coming through the ceiling right now — what do I do?",
      body: [
        "Treat it as a hazard, not a mess to manage. A ceiling holding water can let go without warning, and water finding a light fixture or an outlet is the one genuinely dangerous version of this problem. Move people and anything valuable out from under the sagging area, stay clear of it, and get a roofer or a restoration crew on the way. Relieving a loaded ceiling is not a homeowner job — it is where the injuries in this problem happen.",
        "Second, know that the drip and the hole are usually not in the same place. Water enters the roof high and travels down and sideways along framing before it shows in the ceiling. That is why a leak call is a diagnosis job, not just a shingle job, and why the roofer may want to look in the attic, not just the street side.",
      ],
      evidence_kind: "authored_copy",
      source: null,
    },
    {
      section_id: "roof_repair_or_replace",
      homeowner_question: "Can this be repaired, or is this a replacement conversation?",
      body: [
        "The honest fork runs on the whole roof, not the leak: a sound roof with one failed penetration is a repair, while a roof at end of life with the first leak is the start of a pattern. Age matters less than condition — shingle surfaces that are curling, bald of granules, or letting nails loose tell on themselves. An assessment that walks the roof answers the fork with evidence instead of habit.",
        "The middle option is real too: a failing section on an otherwise sound roof can sometimes be re-flashed or re-decked rather than either patched forever or replaced entirely.",
      ],
      evidence_kind: "authored_copy",
      source: null,
    },
    {
      section_id: "roof_aging_signs",
      homeowner_question: "How do I know if my roof is just old or actually failing?",
      body: [
        "From the ground: shingle edges curling or cupping, dark bald patches where granules have washed off, and gutters full of granules after rain. From inside: daylight in the attic or water staining on the underside of the deck. Any one of these is an assessment signal; daylight plus staining is past assessment into planning.",
        "The neighbor angle is real but weaker than it feels — identical houses can age differently under different trees and sun exposure. It is a prompt to look, not a verdict.",
      ],
      evidence_kind: "authored_copy",
      source: null,
    },
  ],
  distinguishing_questions: [
    {
      question_id: "dq_roof_leak_after_storm",
      question: "Did the leak start after a specific storm, or has it grown slowly?",
      answer_branches: [
        { answer_pattern: "right after a storm", points_toward: "Storm-damage pattern — missing or lifted material; check whether insurance documentation matters before cleanup." },
        { answer_pattern: "slowly over weeks or months", points_toward: "Wear pattern — a penetration or flashing failure that a diagnosis visit can trace; replacement-fork question matters more." },
      ],
    },
  ],
  safety_notes: [
    "Do not walk a wet or steep roof — that is the single most common serious roofing injury a homeowner takes on.",
    "If water is near light fixtures or outlets, treat the whole fixture area as unsafe until an electrician or the roofing crew has checked it.",
    "A ceiling bulging with water can fail without warning; keep people and pets out from under it and leave relieving it to the crew you call.",
  ],
  diy_boundary: [
    "You can safely photograph the ceiling stain from a distance, note when it grows, and look for daylight from the attic floor.",
    "You should not try to relieve a loaded ceiling or work underneath one — that is the injury case, and it is exactly what the crew is for.",
    "You should not go up on the roof yourself — both for the fall risk and because walked-on shingles age faster where you step.",
  ],
  provenance: {
    authored_by: "Claude (T6-01 build session, Josh's machine)",
    authored_at: "2026-08-27",
    reviewed_by: null,
    reviewed_at: null,
  },
});
