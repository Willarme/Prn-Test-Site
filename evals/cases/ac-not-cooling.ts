/**
 * THE TRIAL'S EVAL CORPUS — the AC / not-cooling cluster, its safety cases, its
 * ambiguous neighbours, and everything that must route safely out of it.
 *
 * ─── WHY THIS IS NOT 50-100 CASES ACROSS FOUR TRADES ───────────────────────
 *
 * T1-04's "Done when" asks for "50-100 eval cases across the four trades plus
 * safety-hazard cases". THAT CLAUSE IS SUPERSEDED and this file is deliberately
 * not it. The A01 critique reviewed that requirement and CONFIRMED the finding
 * against it — "too broad for the Black Car trial: 50-100 cases across four
 * trades fights the narrow vertical slice" — and put the narrower shape to
 * Joshua as the question to answer: "narrow it to the AC cluster plus safe
 * out-of-scope routing?" (PRN Brain Metaphor and A01 Critique 2026-08-21,
 * finding 2 and §7 question 3). The Diagnostic Engine Design Notes name the
 * same cluster as the trial's one complete vertical slice, by these words:
 * "AC blowing warm air / AC not blowing cold air / AC blowing lukewarm air / AC
 * running but not cooling / closely equivalent homeowner/search language"
 * (§16, §24).
 *
 * So the shape here is DEPTH on that cluster, plus the four things a narrow
 * slice still has to get right: safety cases, ambiguous HVAC neighbours,
 * descriptions that arrive at an HVAC door describing another trade, and
 * problems the trial has no playbook for at all.
 *
 * A HUNDRED SHALLOW CASES WOULD BE THE WEAKER ARTEFACT. The classifier is
 * deterministic keyword matching over a versioned vocabulary; twenty-five more
 * plumbing phrasings would re-measure one regex and read as coverage.
 *
 * ─── EVERY CASE STATES THE TRADE IT ACTUALLY IS ────────────────────────────
 *
 * `trade` is what a person would say the problem is, written from the case, not
 * from the code. Where the shipped vocabulary does not recognise the phrasing,
 * the case says so with `outside_shipped_vocabulary` AND KEEPS THE REAL TRADE —
 * so the corpus records the gap instead of hiding it. What the record requires
 * of those is that they route SAFELY (no confident wrong trade, the generic
 * playbook, no invented questions), which is measured, and the eval report
 * names each one.
 *
 * Widening the vocabulary to catch them would change what a homeowner is shown,
 * which is a product decision and an owner's call — not a build session's, and
 * not something an eval suite should do to make its own numbers better.
 */

export interface ProblemCase {
  id: string;
  group: "ac_cluster" | "safety" | "hvac_neighbour" | "misrouted" | "out_of_playbook";
  description: string;
  /** The trade this problem actually is. Null when no shipped trade fits it. */
  trade: string | null;
  /**
   * The shipped deterministic vocabulary has no pattern for this phrasing. The
   * requirement then is safe routing, not a confident answer.
   */
  outside_shipped_vocabulary?: true;
  /** Which safety rule must fire, and whether intake may continue. */
  safety_rule?: string;
  hard_stop?: true;
  /** The playbook that must handle it, where the trial has one. */
  playbook?: string;
  /** Door attribution this case arrives with — a prior, never truth. */
  door_hint?: string;
  note?: string;
}

export const PROBLEM_CASES: readonly ProblemCase[] = [
  // -------------------------------------------------------------------------
  // THE CLUSTER. The trial's one complete vertical slice, in homeowner words.
  // -------------------------------------------------------------------------
  {
    id: "AC-01",
    group: "ac_cluster",
    description: "The AC is blowing warm air and the house won't cool down",
    trade: "hvac",
    playbook: "pb_hvac_cooling_v1",
  },
  {
    id: "AC-02",
    group: "ac_cluster",
    description: "AC running but not cooling at all since this morning",
    trade: "hvac",
    playbook: "pb_hvac_cooling_v1",
  },
  {
    id: "AC-03",
    group: "ac_cluster",
    description: "air conditioner blowing lukewarm air upstairs",
    trade: "hvac",
    playbook: "pb_hvac_cooling_v1",
  },
  {
    id: "AC-04",
    group: "ac_cluster",
    description: "My AC won't turn on since yesterday evening",
    trade: "hvac",
    playbook: "pb_hvac_no_power_v1",
    note: "the same cluster's other half — nothing happens at all, which is a different question bank",
  },
  {
    id: "AC-05",
    group: "ac_cluster",
    description: "the thermostat screen is blank and the ac is dead",
    trade: "hvac",
    playbook: "pb_hvac_no_power_v1",
  },
  {
    id: "AC-06",
    group: "ac_cluster",
    description: "outside unit is not running but the fan inside is",
    trade: "hvac",
    outside_shipped_vocabulary: true,
    note: "real homeowner language for the condenser, with no word the vocabulary carries",
  },
  {
    id: "AC-07",
    group: "ac_cluster",
    description: "there is ice on the copper line going into the air conditioner",
    trade: "hvac",
    playbook: "pb_hvac_cooling_v1",
  },
  {
    id: "AC-08",
    group: "ac_cluster",
    description: "water is dripping from the indoor ac unit onto the floor",
    trade: "hvac",
    playbook: "pb_hvac_cooling_v1",
    note: "says 'dripping', which is the plumbing pattern — the trade-specific match must win",
  },
  {
    id: "AC-09",
    group: "ac_cluster",
    description: "the ac keeps turning on and off every few minutes",
    trade: "hvac",
    playbook: "pb_hvac_cooling_v1",
  },
  {
    id: "AC-10",
    group: "ac_cluster",
    description: "barely any air is coming out of the vents",
    trade: "hvac",
    outside_shipped_vocabulary: true,
    note: "airflow language with no equipment word at all",
  },
  {
    id: "AC-11",
    group: "ac_cluster",
    description: "central air conditioning stopped cooling last night",
    trade: "hvac",
    playbook: "pb_hvac_cooling_v1",
  },
  { id: "AC-12", group: "ac_cluster", description: "a/c not blowing cold air", trade: "hvac", playbook: "pb_hvac_cooling_v1" },
  {
    id: "AC-13",
    group: "ac_cluster",
    description: "heat pump is not cooling the house",
    trade: "hvac",
    playbook: "pb_hvac_cooling_v1",
  },
  {
    id: "AC-14",
    group: "ac_cluster",
    description: "the ac makes a loud buzzing noise and then shuts off",
    trade: "hvac",
    playbook: "pb_hvac_cooling_v1",
  },

  // -------------------------------------------------------------------------
  // SAFETY. The rules are versioned data; these prove they fire on the words a
  // frightened person actually types, and that a hard stop really stops.
  // -------------------------------------------------------------------------
  {
    id: "SAFE-01",
    group: "safety",
    description: "It smells like gas near the stove",
    trade: "appliance",
    safety_rule: "safety_gas",
    hard_stop: true,
  },
  {
    id: "SAFE-02",
    group: "safety",
    description: "there is a burning smell coming from the vents when the heat runs",
    trade: "hvac",
    outside_shipped_vocabulary: true,
    safety_rule: "safety_fire",
    note: "the safety rule fires on words the trade vocabulary does not carry — which is the correct order of operations",
  },
  {
    id: "SAFE-03",
    group: "safety",
    description: "sparks came out of the outlet by the fridge",
    trade: "electrical",
    safety_rule: "safety_fire",
    playbook: "pb_electrical_v1",
  },
  {
    id: "SAFE-04",
    group: "safety",
    description: "there is standing water near the electrical panel in the basement",
    trade: "electrical",
    safety_rule: "safety_flood_electric",
    playbook: "pb_electrical_v1",
  },
  {
    id: "SAFE-05",
    group: "safety",
    description: "the ceiling is sagging over the kitchen",
    trade: null,
    safety_rule: "safety_structural",
  },
  {
    id: "SAFE-06",
    group: "safety",
    description: "the carbon monoxide alarm went off",
    trade: null,
    safety_rule: "safety_gas",
    hard_stop: true,
  },

  // -------------------------------------------------------------------------
  // THE NEIGHBOURS. Same equipment, different season or symptom — the cases
  // most likely to be quietly mishandled by a cluster built for cooling.
  // -------------------------------------------------------------------------
  { id: "NEAR-01", group: "hvac_neighbour", description: "furnace is blowing cold air", trade: "hvac" },
  {
    id: "NEAR-02",
    group: "hvac_neighbour",
    description: "the heater won't turn on and it is freezing",
    trade: "hvac",
    outside_shipped_vocabulary: true,
    note: "'heater' is not in the vocabulary, though 'furnace' and 'heat pump' are",
  },
  { id: "NEAR-03", group: "hvac_neighbour", description: "hvac system is short cycling", trade: "hvac" },

  // -------------------------------------------------------------------------
  // MISROUTED. Every one of these ARRIVES FROM THE AC DOOR and describes
  // something else. The door hint is a prior; the homeowner's own words win
  // (SEO_DOORS Wave 5).
  // -------------------------------------------------------------------------
  {
    id: "MIS-01",
    group: "misrouted",
    description: "water heater is leaking from the bottom seam",
    trade: "plumbing",
    door_hint: "hvac",
    playbook: "pb_plumbing_leak_v1",
  },
  {
    id: "MIS-02",
    group: "misrouted",
    description: "the kitchen tap drips constantly",
    trade: "plumbing",
    door_hint: "hvac",
    playbook: "pb_plumbing_leak_v1",
  },
  {
    id: "MIS-03",
    group: "misrouted",
    description: "toilet keeps running all night",
    trade: "plumbing",
    door_hint: "hvac",
  },
  {
    id: "MIS-04",
    group: "misrouted",
    description: "the outlet in the bedroom is dead",
    trade: "electrical",
    door_hint: "hvac",
    playbook: "pb_electrical_v1",
  },
  {
    id: "MIS-05",
    group: "misrouted",
    description: "breaker keeps tripping when I use the microwave",
    trade: "electrical",
    door_hint: "hvac",
    playbook: "pb_electrical_v1",
  },
  {
    id: "MIS-06",
    group: "misrouted",
    description: "roof is leaking after the storm and shingles came off",
    trade: "roofing",
    door_hint: "hvac",
    note: "classified roofing correctly; the trial ships NO roofing playbook, which is T1-21's job — see the routing expectation",
  },

  // -------------------------------------------------------------------------
  // OUT OF PLAYBOOK. The trial cannot serve these. The requirement is that it
  // says so safely rather than pretending.
  // -------------------------------------------------------------------------
  {
    id: "OUT-01",
    group: "out_of_playbook",
    description: "the garage door spring snapped and it will not open",
    trade: null,
  },
  { id: "OUT-02", group: "out_of_playbook", description: "there are raccoons in the attic", trade: null },
  {
    id: "OUT-03",
    group: "out_of_playbook",
    description: "a tree fell on the house",
    trade: null,
    note: "T1-21 requires this to hard-stop into a safety flag once storm playbooks exist; today no rule matches it and it routes generic",
  },
];

/** The cluster the trial's vertical slice is built on. */
export const AC_CLUSTER_CASES = PROBLEM_CASES.filter((c) => c.group === "ac_cluster");
