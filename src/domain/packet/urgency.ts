import type { HazardFlag, SafetyState, UrgencyLevel } from "@/domain/packet/types";
import { affirmedSafetyPatterns } from "@/domain/problem/safety-match";

/**
 * THE URGENCY TAG (Directions §6) AND THE HARD-STOP FLAGS (Directions §9.1).
 *
 * Melissa's ruling, 2026-09-04, verbatim in §6.1: the tag is written from the
 * homeowner's felt urgency, never from scheduling convenience, and no tag may
 * imply a wait. The two ladders below are her words; the trigger logic is the
 * Directions' "first match wins, read top down", and the defaulting rule is
 * "go UP the ladder, never down" — an ambiguous record is `asap`, not `soon`.
 *
 * Safety is a separate half. `no_hazard_reported` is EARNED by asking the
 * safety questions and getting negatives; when they were not asked the honest
 * state is `safety_not_established`, and that is the default.
 */

/** §6.3 — the urgency half, VERBATIM. */
export const URGENCY_HALF: Record<UrgencyLevel, string> = {
  emergency: "Emergency",
  same_day: "Today",
  asap: "As soon as possible",
  soon: "Soon",
  planned: "Planned work",
};

/** §6.4 — the safety half, VERBATIM. */
export const SAFETY_HALF: Record<SafetyState, string> = {
  hazard: "safety hazard",
  possible_hazard: "possible safety hazard — verify",
  no_hazard_reported: "not a safety hazard",
  safety_not_established: "safety not established",
};

/** §6.5 — a tag containing any of these is rejected and recomputed. */
export const BANNED_TAG_TOKENS: readonly RegExp[] = [
  /this week/i,
  /next week/i,
  /within \d+ days?/i,
  /when we can fit you in/i,
  /non-urgent/i,
  /low priority/i,
  /\broutine\b/i,
  /can wait/i,
  /no rush/i,
  /standard scheduling/i,
  /\bqueued\b/i,
  /\bbacklog\b/i,
  /business days/i,
  /24[–-]48 hours/i,
  /\$\s?\d/,
  /\b\d{1,2}[:.]\d{2}\b/,
  /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*day\b/i,
];

const URGENCY_ORDER: UrgencyLevel[] = ["planned", "soon", "asap", "same_day", "emergency"];

export function urgencyTag(level: UrgencyLevel, safety: SafetyState): string {
  const tag = `${URGENCY_HALF[level]} · ${SAFETY_HALF[safety]}`;
  for (const banned of BANNED_TAG_TOKENS) {
    if (banned.test(tag)) {
      throw new Error(`urgency tag "${tag}" contains a banned token (${banned.source})`);
    }
  }
  return tag;
}

/** Never move a homeowner DOWN a rung. */
export function maxUrgency(a: UrgencyLevel, b: UrgencyLevel): UrgencyLevel {
  return URGENCY_ORDER.indexOf(a) >= URGENCY_ORDER.indexOf(b) ? a : b;
}

/**
 * §9.1 — the hard-stop triggers, scanned over the homeowner's own words even
 * when no flag was set. Conservative on purpose: a false halt costs a
 * homeowner one screen; a missed one is the failure this table exists for.
 */
const HAZARD_PATTERNS: readonly { flag: HazardFlag; pattern: RegExp }[] = [
  { flag: "gas_smell", pattern: /\b(gas (smell|leak|odou?r)|smell(s|ed|ing)?\s+(like\s+|of\s+)?(natural\s+)?gas\b|rotten egg|propane\b.*\b(smell|leak))/i },
  { flag: "co_alarm", pattern: /\b(carbon monoxide|co (alarm|detector)|co2? alarm)\b/i },
  { flag: "burning_or_smoke", pattern: /\b(smoke\b|\bfire\b|flames?\b|spark(s|ing)?\b(?!\s*plug)|burn(ing|t)? (smell|odou?r)|smell(s|ed|ing)?\s+(like\s+)?(it'?s\s+|it\s+is\s+|something\s+)?burn|something (is\s+)?burning|arcing|melt(ed|ing)? (outlet|panel|plug|wire))/i },
  { flag: "electrical_water", pattern: /\b(water .{0,40}(outlet|panel|breaker|electric)|(outlet|panel|breaker|electric).{0,40}(wet|water|flood))/i },
  { flag: "active_flooding", pattern: /\b(flooding|water (is )?(pouring|gushing|spreading|everywhere)|actively leaking|won'?t stop (leaking|running))/i },
  { flag: "sewage_indoors", pattern: /\b(sewage|sewer (water|backing)|raw waste)\b.{0,40}\b(in|into|inside|through)\b/i },
  { flag: "structural", pattern: /\b(ceiling (is )?(sagging|collapsing|caving)|wall .{0,20}(bulging|collapsing)|structural|collaps(ed|ing))\b/i },
];

/**
 * The repo's deterministic safety gate (domain/problem/safety.ts) names rules,
 * not flags; this is the one mapping between the two vocabularies. A rule the
 * gate let continue (`intake_may_continue: true`) is a POSSIBLE hazard here,
 * never a hard stop — the gate already made that call before any analysis.
 */
export const SAFETY_RULE_TO_FLAG: Record<string, HazardFlag> = {
  safety_gas: "gas_smell",
  safety_fire: "burning_or_smoke",
  safety_flood_electric: "electrical_water",
  safety_structural: "structural",
};

export function detectHazardFlags(words: string, explicit: readonly HazardFlag[] = []): HazardFlag[] {
  const out = new Set<HazardFlag>(explicit);
  const matches = affirmedSafetyPatterns(words, HAZARD_PATTERNS.map(({ pattern }) => pattern));
  for (const { flag, pattern } of HAZARD_PATTERNS) {
    if (matches.has(pattern)) out.add(flag);
  }
  return [...out];
}

export interface UrgencySignals {
  homeowner_words: string;
  /** The Directions' explicit flags, when the caller already has them. */
  hazard_flags?: readonly HazardFlag[];
  /** The repo gate's own result for this record. */
  safety_rule_id?: string | null;
  safety_rule_halts?: boolean;
  /** Whether the safety questions were asked, and what they said. */
  safety_questions_asked?: boolean;
  safety_questions_negative?: boolean;
  habitability?: "lost" | "degraded" | "intact";
  vulnerable_occupant?: boolean;
  damage_accruing?: boolean;
  /** The homeowner's own urgency, when they stated one (a tap or their words). */
  stated_urgency?: UrgencyLevel | null;
}

export interface UrgencyDecision {
  urgency_level: UrgencyLevel;
  safety_state: SafetyState;
  hazard_flags: HazardFlag[];
  /** §9.2 — normal generation halts. */
  hazard_halt: boolean;
  tag: string;
}

const VULNERABLE = /\b(infant|newborn|baby|toddler|elderly|grandm|grandf|oxygen|medical (equipment|need|condition)|disabled|dialysis|pregnan|\d{2} years? old (mother|father|mom|dad|parent)|(mother|father|mom|dad|parent) is \d{2}(?: years? old)?)\b/i;
const DAMAGE_ACCRUING = /\b(water (is )?(spreading|coming through|dripping through|pooling)|ceiling (is )?(staining|stained|dripping|bulging)|still leaking|keeps leaking|getting worse by the (hour|minute))\b/i;
const HABITABILITY_LOST = /\b(no heat\b.{0,60}\b(freez|below zero|\d{1,2} ?°?f outside)|no water at all|no running water|only (bathroom|toilet).{0,40}(not|won'?t) (work|flush)|no power (to|in) (the )?(house|living|bedroom))\b/i;
const CAN_LIVE_WITH = /\b(no hurry|no rush|not urgent|can wait|whenever (you|is)|not an emergency|live with it|when (it'?s|you'?re) convenient)\b/i;
const PLANNED = /\b(quote|estimate|second opinion|upgrade|replace(ment)? (before|next)|maintenance visit|tune-?up|annual service)\b/i;
const STILL_FAILING = /\b(not (cold|cool|working|cooling|heating)|won'?t|stopped|broke|dead|blowing (warm|hot)|no (ac|air|heat|hot water))\b/i;
const HOMEOWNER_URGENT = /\b(urgent|asap|as soon as possible|right away|today|tonight|emergency|can'?t wait)\b/i;

/**
 * The ladder, applied top down. `stated_urgency` is the homeowner's own
 * choice and is honoured as a FLOOR (their felt urgency is the input); the
 * technical picture can raise it and can never lower it.
 */
export function decideUrgency(s: UrgencySignals): UrgencyDecision {
  const words = s.homeowner_words ?? "";
  const flags = detectHazardFlags(words, s.hazard_flags ?? []);
  if (s.safety_rule_id && s.safety_rule_halts && SAFETY_RULE_TO_FLAG[s.safety_rule_id]) {
    const mapped = SAFETY_RULE_TO_FLAG[s.safety_rule_id];
    if (!flags.includes(mapped)) flags.push(mapped);
  }

  if (flags.length > 0) {
    return {
      urgency_level: "emergency",
      safety_state: "hazard",
      hazard_flags: flags,
      hazard_halt: true,
      tag: urgencyTag("emergency", "hazard"),
    };
  }

  // Safety half.
  let safety: SafetyState;
  const repoPossible = Boolean(s.safety_rule_id) && !s.safety_rule_halts;
  if (repoPossible || (s.safety_questions_asked && s.safety_questions_negative === false)) {
    safety = "possible_hazard";
  } else if (s.safety_questions_asked && s.safety_questions_negative) {
    safety = "no_hazard_reported";
  } else {
    safety = "safety_not_established";
  }

  // Urgency half, top down.
  let level: UrgencyLevel;
  const vulnerable = s.vulnerable_occupant || VULNERABLE.test(words);
  const accruing = s.damage_accruing || DAMAGE_ACCRUING.test(words);
  const lost = s.habitability === "lost" || HABITABILITY_LOST.test(words);
  if (lost || accruing || vulnerable) level = "same_day";
  else if (PLANNED.test(words) && !STILL_FAILING.test(words)) level = "planned";
  else if (CAN_LIVE_WITH.test(words) && !HOMEOWNER_URGENT.test(words)) level = "soon";
  else level = "asap";
  if (s.stated_urgency) level = maxUrgency(level, s.stated_urgency);
  if (HOMEOWNER_URGENT.test(words)) level = maxUrgency(level, "asap");

  return {
    urgency_level: level,
    safety_state: safety,
    hazard_flags: [],
    hazard_halt: false,
    tag: urgencyTag(level, safety),
  };
}

/** §9.2 — which safety-block body a set of flags selects. */
export function safetyBodyFor(flags: readonly HazardFlag[]): "gas_or_co" | "electrical_or_smoke" | "water_sewage_structural" {
  if (flags.includes("gas_smell") || flags.includes("co_alarm")) return "gas_or_co";
  if (flags.includes("burning_or_smoke") || flags.includes("electrical_water")) return "electrical_or_smoke";
  return "water_sewage_structural";
}
