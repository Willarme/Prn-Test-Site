import { ServicePlaybook } from "@/domain/growth/service-playbook";

/**
 * TREE SERVICE PLAYBOOK — the AUTHORITATIVE trade voice, ruled by Josh on
 * 2026-08-28 (R1) and signed the same day (R3). Tree was the trade authored in
 * full, so Tree is the one that becomes the playbook of record; Plumbing/Drain
 * and Roofing stay SHADOW, in that literal word, until they get the same
 * treatment. This is the only playbook a public page may draw on today.
 *
 * The signature came AFTER the technique instructions were stripped from all
 * three playbooks, in that order and deliberately: nobody signs copy that
 * teaches a method (R3).
 *
 * CONTENT RULES: homeowner words, not trade jargon, as the primary voice.
 * Generic national-scope safety facts only — stay clear and call someone, never
 * how to do the work. No dollar figures anywhere: price DRIVERS live in the
 * graph nodes, and this playbook never contradicts them. Every section states
 * its evidence class honestly.
 */
export const TREE_PLAYBOOK = ServicePlaybook.parse({
  playbook_id: "spb_tree_v1",
  schema_version: "1.0.0",
  version: 1,
  system: "tree",
  status: "authoritative",
  trade_name: "Tree work",
  covers_node_ids: [
    "ppg_tree_over_structure_v1",
    "ppg_tree_storm_damage_v1",
    "ppg_tree_health_decline_v1",
  ],
  sections: [
    {
      section_id: "tree_how_dangerous",
      homeowner_question: "How do I tell if a tree near my house is actually dangerous?",
      body: [
        "Distance and lean tell you most of it. A tree whose trunk or major limbs reach over a roof, garage, or anywhere people park or play deserves a real assessment even if it looks healthy — healthy trees fail, and failing trees often look fine from the ground. The signs that change the picture are visible: a lean that is new or getting worse, soil heaving or cracking around the base, large dead limbs in the crown, fungus growing on the trunk, or cracks where major limbs meet the trunk.",
        "What you are really asking is who should look at it. A tree standing quietly far from anything it could hit is a lower-stakes question than one hanging over a bedroom. The honest answer for the over-the-structure case is that distance to the target, not the tree species, is what makes it worth a professional's time.",
      ],
      evidence_kind: "authored_copy",
      source: null,
    },
    {
      section_id: "tree_what_removal_involves",
      homeowner_question: "What actually happens when a tree gets removed over a house?",
      body: [
        "Free-felling is for open ground. Over a structure, the work is climbed or bucket-lifted and the tree comes down in pieces, each one rigged and lowered so nothing lands where it is not aimed. That piece-by-piece method is why access matters: a crew that can get a bucket truck close works differently from one that has to climb from the trunk.",
        "Cleanup scope varies more than people expect — wood chipped, logs hauled, stump ground or left, raking included or not. Those are legitimate scope choices, and a quote that does not say which you are getting is incomplete. The property should look like the tree was never there apart from the stump choice you made.",
      ],
      evidence_kind: "authored_copy",
      source: null,
    },
    {
      section_id: "tree_after_storm",
      homeowner_question: "A storm just dropped a tree or big limb — what do I do first?",
      body: [
        "If any line is down or involved — power, phone, cable — the utility comes first, and nobody touches the tree until the utility clears it. That is not caution theater; lines that look dead are the ones that hurt people.",
        "If the tree is on a structure, take photos before anything moves. Insurance documentation wants the scene as-it-lies, and cleanup that starts before the photos makes the claim harder. Then the removal is careful work: material on a roof comes off in reverse order of how it landed, and what is under it often needs its own trade.",
        "Partially uprooted trees still standing under tension are the most dangerous object on the property. They are a professional-only removal, and the professional should be told the tree is under tension before they arrive.",
      ],
      evidence_kind: "authored_copy",
      source: null,
    },
    {
      section_id: "tree_sick_or_dying",
      homeowner_question: "My tree looks sick — dead branches, thin leaves, fungus. Can it be saved?",
      body: [
        "Sometimes yes, and the fork matters: deadwood in an otherwise healthy crown is a pruning job, while decline through the whole tree is usually a removal conversation. Fungus on the trunk — the shelf-like growths — points at internal decay, which is a strength question, not a cosmetic one.",
        "A real assessment answers three things: what is wrong, whether treatment is a real option, and what the tree would mean structurally if it gets worse. 'Save the tree' and 'remove the tree' are both legitimate answers; the assessment is what tells you which question you are actually in.",
      ],
      evidence_kind: "authored_copy",
      source: null,
    },
  ],
  distinguishing_questions: [
    {
      question_id: "dq_tree_lean_new_or_old",
      question: "Has the lean always been there, or is it new or getting worse?",
      answer_branches: [
        { answer_pattern: "always leaned like that", points_toward: "Lower immediate concern if the tree is far from targets; a lean that has been static for years is a different risk profile than a moving one." },
        { answer_pattern: "new or worse after the storm", points_toward: "Escalates to the storm-damage / structural-risk node — new lean means root or trunk failure is in progress." },
        { answer_pattern: "not sure", points_toward: "Photo comparison against old pictures, or an assessment visit; uncertainty about a lean over a structure defaults toward getting it looked at." },
      ],
    },
    {
      question_id: "dq_tree_deadwood_extent",
      question: "Is the dead wood in one part of the crown, or spread through the whole tree?",
      answer_branches: [
        { answer_pattern: "a few dead branches, the rest of the crown still looks full", points_toward: "Deadwood pruning on the health-decline node — the tree is not the problem, the limbs above the target are." },
        { answer_pattern: "more than about a quarter of the crown is bare", points_toward: "Whole-tree decline — the visit that answers treat-or-remove, not a pruning quote." },
        { answer_pattern: "dead crown plus shelf fungus or a cavity at the trunk base", points_toward: "Structural decay rather than a health question — escalates toward the over-the-structure node if anything is within falling distance." },
        { answer_pattern: "not sure — the crown is hard to read from the ground", points_toward: "Photographs from two sides and an assessment visit; a crown nobody can read from below is exactly what the visit is for." },
      ],
    },
  ],
  safety_notes: [
    "Never touch or approach a tree or limb that is in contact with any line — call the utility and wait for their clearance.",
    "A partially fallen tree under tension can move without warning; keep people clear and do not cut it yourself.",
    "Ladder work under an overhanging limb is how DIY tree injuries happen; the assessment costs nothing compared to a fall.",
  ],
  diy_boundary: [
    "You can safely photograph the tree, note the lean, and track changes week to week.",
    "You can mark where limbs overhang structures and note what they would hit.",
    "You should not climb, top, or cut any tree part above shoulder height, and never cut anything near a line.",
  ],
  provenance: {
    authored_by: "Claude (T6-01 build session, Josh's machine)",
    authored_at: "2026-08-27",
    reviewed_by: "Joshua",
    reviewed_at: "2026-08-28",
  },
});
