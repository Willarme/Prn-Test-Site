import {
  PropertyProblemGraph,
  validateGraphUniqueness,
} from "@/domain/growth/property-problem-graph";
import type { PropertyProblemGraph as PropertyProblemGraphType } from "@/domain/growth/property-problem-graph";

/**
 * GRAPH v1 DATA — the seeded nodes for the three trades this item ships with.
 *
 * Tree is authored in full (T6-01's done-when names it the proving trade);
 * Plumbing/Drain and Roofing ride along at real-but-smaller depth to prove the
 * schema generalizes beyond one trade. Every node follows the same rules:
 * homeowner words for the problem, factors never dollars for price, evidence
 * requirements stated per claim class, geographic scope stamped.
 *
 * SAFETY WORDING SCOPE: escalation conditions and safety-adjacent fields carry
 * generic, national-scope facts only ("a tree leaning further after a storm is
 * an escalation sign"). They never state law, code, or provider-specific
 * claims — that would need sourced_reference evidence the graph does not have.
 */

const GRAPH: PropertyProblemGraphType = {
  graph_id: "ppg_v1",
  schema_version: "1.0.0",
  problem_nodes: [
    {
      node_id: "ppg_tree_over_structure_v1",
      system: "tree",
      observed_problem: "A tree or large limb is hanging over the house, garage, or a neighbor's property",
      trade_label: "Structural tree risk assessment / hazard limb removal",
      aliases: [
        "tree leaning over house",
        "branch hanging over roof",
        "tree over garage",
        "limb over the house",
        "tree too close to house",
        "tree touching roof",
      ],
      urgency: "emergency_possible",
      escalation_conditions: [
        "The lean is new or visibly worsening, especially after a storm or heavy rain",
        "Roots are lifting or the ground around the trunk is heaving or cracking",
        "Large limbs have already dropped, even once",
        "The tree or limb is contacting power lines",
      ],
      constraints: [
        "Access for bucket truck or climb crew changes the method and the price",
        "Work near power lines may require the utility to clear or de-energize first",
        "Trees over a neighbor's line can involve permission questions before cutting",
        "Some municipalities require a permit for removal above a trunk size",
      ],
      geography: { scope: "national/US", note: null },
      possible_service_types: [
        "tree risk assessment",
        "hazard limb removal",
        "full tree removal",
        "cabling or bracing (preservation option)",
      ],
      evidence_needed: [
        { claim: "what the work typically involves", kind: "authored_copy", source: null },
        { claim: "permit requirements for a specific municipality", kind: "sourced_reference", source: null },
        { claim: "how often tree failures follow this pattern locally", kind: "outcome_record", source: null },
      ],
      price_drivers: [
        { driver: "tree height class", effect: "increases_price", why: "Taller trees need larger crews, bigger equipment, or climbing time." },
        { driver: "access constraint", effect: "increases_price", why: "No bucket-truck access means climbing and rigging, which takes longer." },
        { driver: "target proximity", effect: "increases_price", why: "Work over a roof or structure needs piece-by-piece rigging instead of free-felling." },
        { driver: "utility involvement", effect: "increases_price", why: "Utility coordination adds scheduling steps and sometimes a standby crew." },
        { driver: "preservation option chosen", effect: "changes_scope", why: "Cabling or pruning preserves the tree and replaces removal scope with maintenance scope." },
      ],
      provider_capability: [
        { capability: "arborist or tree-removal crew with aerial access (bucket or climb)", hardness: "hard" },
        { capability: "insurance adequate for work over structures", hardness: "hard" },
        { capability: "utility-coordination experience for line-adjacent work", hardness: "soft" },
      ],
    },
    {
      node_id: "ppg_tree_storm_damage_v1",
      system: "tree",
      observed_problem: "A storm dropped a tree or limbs on the property, or left a tree dangerously unstable",
      trade_label: "Emergency tree work / storm cleanup",
      aliases: [
        "tree fell on my house",
        "storm damage tree",
        "tree down in yard",
        "fallen limb on fence",
        "tree split in half",
        "uprooted tree",
      ],
      urgency: "emergency_possible",
      escalation_conditions: [
        "The fallen tree or limb is on a structure, vehicle, or blocking access",
        "Any line — power, phone, cable — is down or involved",
        "The tree is partially uprooted and still standing under tension",
      ],
      constraints: [
        "Downed-line situations are utility-first: nobody else touches the tree until the utility clears it",
        "Insurance documentation wants photos before cleanup moves anything",
        "Post-storm demand spikes mean availability, not just price, is the constraint",
      ],
      geography: { scope: "national/US", note: null },
      possible_service_types: ["emergency tree removal", "storm cleanup", "structural risk assessment for damaged trees"],
      evidence_needed: [
        { claim: "what emergency tree work involves", kind: "authored_copy", source: null },
        { claim: "insurance-claim interaction specifics", kind: "sourced_reference", source: null },
      ],
      price_drivers: [
        { driver: "structure involvement", effect: "increases_price", why: "Material on a roof or in a wall needs coordinated, careful removal." },
        { driver: "timing (storm surge)", effect: "increases_price", why: "Demand after a regional storm outstrips crew supply." },
        { driver: "line involvement", effect: "increases_price", why: "Utility-first sequencing adds steps before tree work can start." },
      ],
      provider_capability: [
        { capability: "emergency-response tree crew availability", hardness: "soft" },
        { capability: "documentation-quality photos for insurance records", hardness: "soft" },
      ],
    },
    {
      node_id: "ppg_tree_health_decline_v1",
      system: "tree",
      observed_problem: "A tree is declining — dead branches, thinning leaves, fungus at the base, or bark damage",
      trade_label: "Tree health assessment / plant health care",
      aliases: [
        "tree dying",
        "dead branches in tree",
        "tree has fungus",
        "bark falling off tree",
        "tree looks sick",
        "half the tree is dead",
      ],
      urgency: "urgency_possible",
      escalation_conditions: [
        "The declining tree stands within falling distance of a structure or play area",
        "Fungal conks or major cavity openings at the trunk base",
        "More than a quarter of the crown shows dead wood",
      ],
      constraints: [
        "Some causes are seasonal — a diagnosis in dormancy can be less certain",
        "Treatment versus removal is a real fork; an assessment should present both",
      ],
      geography: { scope: "national/US", note: null },
      possible_service_types: ["arborist health assessment", "pruning / deadwooding", "treatment or removal depending on finding"],
      evidence_needed: [
        { claim: "what a tree health assessment involves", kind: "authored_copy", source: null },
        { claim: "regional pest and disease identification", kind: "sourced_reference", source: null },
      ],
      price_drivers: [
        { driver: "diagnosis versus treatment scope", effect: "changes_scope", why: "Assessment, treatment program, and removal are three different sizes of work." },
        { driver: "tree size and count", effect: "increases_price", why: "Larger trees and multi-tree properties take more crew time." },
      ],
      provider_capability: [
        { capability: "arborist certification or equivalent diagnostic training", hardness: "soft" },
      ],
    },
    {
      node_id: "ppg_drain_backup_v1",
      system: "plumbing_drain",
      observed_problem: "A drain is backing up — sink, tub, shower, or a main line backing water into the home",
      trade_label: "Drain cleaning / main line clearing",
      aliases: [
        "drain backed up",
        "water coming up in tub",
        "sink won't drain",
        "sewage smell in basement",
        "multiple drains clogged",
        "toilet gurgles",
      ],
      urgency: "emergency_possible",
      escalation_conditions: [
        "Water or sewage is entering the living space",
        "Multiple fixtures back up at once — that pattern points at the main line, not one trap",
        "Backups recur after repeated clearing",
      ],
      constraints: [
        "Main-line work may need a cleanout access point or a roof vent",
        "Camera inspection changes the diagnosis from guesswork to location-and-cause",
        "Repeated backups raise the pipe-repair-versus-clear-again question",
      ],
      geography: { scope: "national/US", note: null },
      possible_service_types: ["drain cleaning", "main line clearing", "camera inspection", "pipe repair (if damage found)"],
      evidence_needed: [
        { claim: "what a drain call involves", kind: "authored_copy", source: null },
        { claim: "local code on sewer lateral responsibility", kind: "sourced_reference", source: null },
      ],
      price_drivers: [
        { driver: "fixture-level versus main-line blockage", effect: "increases_price", why: "Main line work needs bigger equipment and more time than one trap." },
        { driver: "camera inspection", effect: "increases_price", why: "Adds equipment and time but converts a repeat problem into a located diagnosis." },
        { driver: "pipe damage found", effect: "changes_scope", why: "Repair or replacement replaces clearing scope entirely." },
      ],
      provider_capability: [
        { capability: "licensed plumbing contractor", hardness: "hard" },
        { capability: "camera inspection equipment", hardness: "soft" },
      ],
    },
    {
      node_id: "ppg_drain_slow_v1",
      system: "plumbing_drain",
      observed_problem: "A single drain runs slow but nothing is backing up",
      trade_label: "Fixture drain cleaning",
      aliases: ["slow drain", "sink drains slow", "tub drains slowly", "shower standing water"],
      urgency: "routine",
      escalation_conditions: [
        "Slow drainage spreads to other fixtures",
        "Gurgling noises appear in nearby fixtures",
      ],
      constraints: ["Hair and soap clogs versus grease clogs need different approaches"],
      geography: { scope: "national/US", note: null },
      possible_service_types: ["drain cleaning"],
      evidence_needed: [{ claim: "what a fixture drain cleaning involves", kind: "authored_copy", source: null }],
      price_drivers: [
        { driver: "clog location and material", effect: "changes_scope", why: "A hair clog at the trap is a different job than grease down the run." },
      ],
      provider_capability: [{ capability: "plumbing contractor or qualified handyman per local licensing rules", hardness: "soft" }],
    },
    {
      node_id: "ppg_roof_leak_active_v1",
      system: "roofing",
      observed_problem: "Water is coming through the roof right now — staining, dripping, or a wet spot that grows",
      trade_label: "Active leak diagnosis and repair",
      aliases: [
        "roof leaking",
        "water dripping from ceiling",
        "ceiling stain growing",
        "wet spot on ceiling after rain",
        "roof leak every rain",
      ],
      urgency: "emergency_possible",
      escalation_conditions: [
        "Water is dripping onto electrical fixtures or outlets",
        "The ceiling is bulging with held water",
        "The leak appeared after storm damage with visible missing shingles",
      ],
      constraints: [
        "Water travels — entry point and visible damage point are often far apart",
        "Active weather delays the exterior diagnosis; interior mitigation comes first",
        "Repair versus replace is a fork that depends on overall roof age and condition",
      ],
      geography: { scope: "national/US", note: null },
      possible_service_types: ["leak diagnosis", "roof repair", "tarping (storm interim)", "roof replacement (if warranted)"],
      evidence_needed: [
        { claim: "how a leak diagnosis proceeds", kind: "authored_copy", source: null },
        { claim: "material-specific service-life claims", kind: "sourced_reference", source: null },
      ],
      price_drivers: [
        { driver: "diagnosis difficulty", effect: "increases_price", why: "Hidden entry points take investigative time to locate." },
        { driver: "repair versus replace fork", effect: "changes_scope", why: "Overall condition, not the single leak, decides which scope applies." },
        { driver: "steepness and height", effect: "increases_price", why: "Steep or high roofs need staging and safety equipment." },
      ],
      provider_capability: [
        { capability: "licensed roofing contractor", hardness: "hard" },
        { capability: "interior water-mitigation awareness", hardness: "soft" },
      ],
    },
    {
      node_id: "ppg_roof_aging_v1",
      system: "roofing",
      observed_problem: "The roof is aging — curling shingles, granules in gutters, or a neighbor's identical roof is being replaced",
      trade_label: "Roof condition assessment / replacement planning",
      aliases: [
        "shingles curling",
        "granules in gutter",
        "roof is 20 years old",
        "does my roof need replacing",
        "bald shingles",
      ],
      urgency: "routine",
      escalation_conditions: [
        "Any active-leak signs appear — that is the leak node, not this one",
        "Daylight visible from the attic",
        "Sagging roof deck lines",
      ],
      constraints: ["Replacement is a planned project; assessment now avoids emergency decisions later"],
      geography: { scope: "national/US", note: null },
      possible_service_types: ["roof condition assessment", "replacement planning", "targeted repair of failing sections"],
      evidence_needed: [
        { claim: "what a roof assessment covers", kind: "authored_copy", source: null },
        { claim: "material lifespan ranges", kind: "sourced_reference", source: null },
      ],
      price_drivers: [
        { driver: "roof size and pitch", effect: "increases_price", why: "Area and steepness set the labor and staging scale." },
        { driver: "material choice", effect: "changes_scope", why: "Material families differ in cost and service life — a scope decision, not an upgrade tax." },
        { driver: "deck repair found during work", effect: "increases_price", why: "Rotted decking is replaced as found; it cannot be seen from the surface." },
      ],
      provider_capability: [{ capability: "licensed roofing contractor", hardness: "hard" }],
    },
  ],
  intent_nodes: [
    {
      intent_id: "int_tree_risk_info_v1",
      searcher_goal: "understand whether an overhanging or leaning tree is dangerous and what to do",
      query_signals: ["is it dangerous", "should i be worried", "risk", "how close is too close", "fall on house"],
      node_ids: ["ppg_tree_over_structure_v1", "ppg_tree_health_decline_v1"],
      answerable_with_authored_content: true,
    },
    {
      intent_id: "int_tree_removal_cost_v1",
      searcher_goal: "understand what drives the cost of tree removal before getting quotes",
      query_signals: ["cost", "price", "how much", "expensive", "quote"],
      node_ids: ["ppg_tree_over_structure_v1", "ppg_tree_storm_damage_v1"],
      answerable_with_authored_content: true,
    },
    {
      intent_id: "int_storm_emergency_v1",
      searcher_goal: "get help for a tree that just fell or is about to",
      query_signals: ["emergency", "fell on", "just fell", "tree down", "help now", "24 hour"],
      node_ids: ["ppg_tree_storm_damage_v1"],
      answerable_with_authored_content: true,
    },
    {
      intent_id: "int_drain_backup_info_v1",
      searcher_goal: "understand why drains back up and whether it is one fixture or the main line",
      query_signals: ["why does", "keep backing up", "every drain", "main line", "sewer"],
      node_ids: ["ppg_drain_backup_v1", "ppg_drain_slow_v1"],
      answerable_with_authored_content: true,
    },
    {
      intent_id: "int_roof_leak_what_to_do_v1",
      searcher_goal: "find out what to do right now about water coming through the roof",
      query_signals: ["what should i do", "water coming through", "leaking right now", "can't find the leak"],
      node_ids: ["ppg_roof_leak_active_v1"],
      answerable_with_authored_content: true,
    },
    {
      intent_id: "int_roof_replace_timing_v1",
      searcher_goal: "work out whether the roof needs replacing now or can wait",
      query_signals: ["do i need a new roof", "how long do roofs last", "replace or repair", "end of life"],
      node_ids: ["ppg_roof_aging_v1"],
      answerable_with_authored_content: true,
    },
  ],
  edges: [
    { from_node_id: "ppg_tree_over_structure_v1", to_intent_id: "int_tree_risk_info_v1" },
    { from_node_id: "ppg_tree_health_decline_v1", to_intent_id: "int_tree_risk_info_v1" },
    { from_node_id: "ppg_tree_over_structure_v1", to_intent_id: "int_tree_removal_cost_v1" },
    { from_node_id: "ppg_tree_storm_damage_v1", to_intent_id: "int_tree_removal_cost_v1" },
    { from_node_id: "ppg_tree_storm_damage_v1", to_intent_id: "int_storm_emergency_v1" },
    { from_node_id: "ppg_drain_backup_v1", to_intent_id: "int_drain_backup_info_v1" },
    { from_node_id: "ppg_drain_slow_v1", to_intent_id: "int_drain_backup_info_v1" },
    { from_node_id: "ppg_roof_leak_active_v1", to_intent_id: "int_roof_leak_what_to_do_v1" },
    { from_node_id: "ppg_roof_aging_v1", to_intent_id: "int_roof_replace_timing_v1" },
  ],
};

const PARSED = PropertyProblemGraph.parse(GRAPH);
const UNIQUE_ERRORS = validateGraphUniqueness(PARSED);
if (UNIQUE_ERRORS.length > 0) {
  throw new Error(`graph v1 failed uniqueness validation: ${UNIQUE_ERRORS.join("; ")}`);
}

export const GRAPH_V1: PropertyProblemGraphType = PARSED;

export type { PropertyProblemGraphType as PropertyProblemGraph };

/** Problem-node ids that exist in the graph — playbooks validate their covers list against this set. */
export const GRAPH_V1_NODE_IDS: ReadonlySet<string> = new Set(
  GRAPH_V1.problem_nodes.map((n) => n.node_id),
);
