import { ServicePlaybook } from "@/domain/growth/service-playbook";

/**
 * PLUMBING / DRAIN SHADOW PLAYBOOK — T6-01's reusability proof, trade two.
 * Full schema depth, deliberately smaller content volume than Tree: the point
 * is to prove the SAME schema carries a second trade without edits, not to
 * ship final copy.
 *
 * STAYS SHADOW (Josh's ruling R1, 2026-08-28): Tree went authoritative, this
 * did not. "shadow" is the literal, deliberate status — not "parked", not
 * "draft" — because the schema's one-authoritative-voice-per-trade rule and the
 * eligibility gate both key off exactly that word. Not a voice of record, no
 * public page use, until its own ruling and a named reviewer.
 */
export const PLUMBING_DRAIN_PLAYBOOK = ServicePlaybook.parse({
  playbook_id: "spb_plumbing_drain_v1",
  schema_version: "1.0.0",
  version: 1,
  system: "plumbing_drain",
  status: "shadow",
  trade_name: "Drains and plumbing",
  covers_node_ids: ["ppg_drain_backup_v1", "ppg_drain_slow_v1"],
  sections: [
    {
      section_id: "drain_one_or_many",
      homeowner_question: "One drain backing up or several at once — why does it matter?",
      body: [
        "It matters because the two patterns point at different plumbing. One slow or backed-up fixture is usually a local clog in that fixture's own drain — hair in a tub trap, grease in a kitchen line. Several fixtures backing up together, or a toilet that gurgles when the washing machine drains, is the signature of a main-line problem, and treating it as fixture clogs means paying for the wrong job repeatedly.",
        "The useful thing to notice before anyone arrives: which fixtures, whether they misbehave together, and whether water backs up in one place when another is used. That one observation redirects the whole diagnosis.",
      ],
      evidence_kind: "authored_copy",
      source: null,
    },
    {
      section_id: "drain_what_clearing_involves",
      homeowner_question: "What does a drain clearing visit actually involve?",
      body: [
        "A clearing visit runs a cable through the blocked line to open it. For a fixture-level clog that is usually quick. For a main line, the question after clearing is whether it will come back: roots, a sag, or a broken pipe keep re-blocking, and the honest answer to a repeat backup is to look at the pipe with a camera instead of clearing the symptom again.",
        "The camera is the difference between 'cleared it again' and 'found out why.' It costs extra, and for a first-time backup it is optional; for a recurring one it is how the job stops repeating.",
      ],
      evidence_kind: "authored_copy",
      source: null,
    },
    {
      section_id: "drain_sewage_in_home",
      homeowner_question: "Sewage water came up inside — anything special?",
      body: [
        "Water that came up through a drain is contaminated, not just wet — keep people and pets off the area entirely, and treat every surface it touched as unsafe until it has been professionally cleaned. If the backup is actively entering the space, stop using water in the house: every drain use feeds the backup. This is the emergency end of the drain family, and it is worth saying so plainly when describing it to whoever you call.",
      ],
      evidence_kind: "authored_copy",
      source: null,
    },
  ],
  distinguishing_questions: [
    {
      question_id: "dq_drain_recurring",
      question: "Has this drain been cleared before and come back?",
      answer_branches: [
        { answer_pattern: "first time", points_toward: "A straightforward clearing of the blocked line; the camera is optional on a first backup." },
        { answer_pattern: "keeps coming back", points_toward: "Camera inspection to find the structural cause — roots, sag, or break — before paying for another clearing." },
      ],
    },
  ],
  safety_notes: [
    "Water that backed up from a drain is contaminated; keep people and pets away from it and treat the area as unsafe until it has been professionally cleaned.",
    "Never mix chemical drain cleaners, or add one on top of another that is already in the line — those reactions are genuinely dangerous.",
    "If sewage is entering the living space, stop using water in the house until the line has been opened by someone qualified.",
  ],
  diy_boundary: [
    "You can safely note which fixtures misbehave together, and whether one backs up while another is running.",
    "You can safely photograph the affected fixtures and how high the water came, and say on the phone that more than one fixture is involved.",
    "You should not open, disassemble, or snake any part of the line yourself — an improper head can punch through an old pipe and turn a clearing into a repair.",
  ],
  provenance: {
    authored_by: "Claude (T6-01 build session, Josh's machine)",
    authored_at: "2026-08-27",
    reviewed_by: null,
    reviewed_at: null,
  },
});
