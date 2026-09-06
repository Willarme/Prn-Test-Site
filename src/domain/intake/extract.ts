import type { FieldRequirement, IntakePlaybook } from "@/domain/intake/playbook";
import type { ProblemRecord } from "@/domain/problem/contracts";

/**
 * Deterministic extraction of required fields from the customer's own words
 * (Tier-0, no AI). If they already told us the brand, the model number, or
 * when it started, that field gets its green check automatically and we never
 * ask for it again — the owner's "don't ask for what you already have" rule,
 * now the never-ask-twice contract (Coverage Standard §9, merged spec §10).
 *
 * Campaign track P4 (2026-09-05): the three facts Melissa's C1 sentence
 * carries — "My Carrier AC is 8 years old and blowing warm air since Tuesday"
 * — are extracted HERE, by field key, regardless of which playbook the request
 * landed on. The playbook's own `auto_detect_patterns` still run afterwards
 * for everything else (model numbers, fixtures, scope words).
 */
export interface DetectedField {
  field_key: string;
  value_text: string;
}

/**
 * The two markers the escape hatch writes and the packet (track P1) reads
 * back as "Still unknown — homeowner could not reach it". Both are literal
 * strings on purpose: they travel through the store, the API body and the
 * packet builder, and a shared constant that each side imports is the way
 * three files agree on one word.
 */
export const CANNOT_REACH_STEP_ANSWER = "cannot_reach";
export const CANNOT_REACH_FIELD_VALUE = "__cannot_reach__";

/**
 * Brand names, from the HVAC playbook's own taxonomy plus the makes a rating
 * plate in Indiana actually carries. Canonical spelling on the right so the
 * acknowledgement says "Carrier", never "carrier" or "CARRIER".
 */
const BRANDS: ReadonlyArray<[pattern: string, canonical: string]> = [
  ["american standard", "American Standard"],
  ["carrier", "Carrier"],
  ["trane", "Trane"],
  ["lennox", "Lennox"],
  ["goodman", "Goodman"],
  ["rheem", "Rheem"],
  ["ruud", "Ruud"],
  ["york", "York"],
  ["bryant", "Bryant"],
  ["amana", "Amana"],
  ["daikin", "Daikin"],
  ["mitsubishi", "Mitsubishi"],
  ["heil", "Heil"],
  ["payne", "Payne"],
  ["ducane", "Ducane"],
  ["tempstar", "Tempstar"],
  ["comfortmaker", "Comfortmaker"],
  ["frigidaire", "Frigidaire"],
  ["fujitsu", "Fujitsu"],
  ["bosch", "Bosch"],
  ["coleman", "Coleman"],
  ["armstrong", "Armstrong"],
  ["luxaire", "Luxaire"],
  ["nordyne", "Nordyne"],
  ["lg", "LG"],
  ["samsung", "Samsung"],
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  "twenty-five": 25,
  thirty: 30,
};

const WEEKDAY =
  "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)";
const RELATIVE_DAY =
  "(?:yesterday|today|this morning|this afternoon|last night|last week|this week|the weekend|last weekend|a few days ago|\\d+ days? ago)";
const MONTH =
  "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.? \\d{1,2}(?:st|nd|rd|th)?";
const NUMERIC_DATE = "\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?";
const ONSET_RE = new RegExp(
  `\\b(since|starting|started|began|beginning|from)\\s+(?:last\\s+|on\\s+|this\\s+past\\s+)?(${WEEKDAY}|${RELATIVE_DAY}|${MONTH}|${NUMERIC_DATE})\\b`,
  "i"
);

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "8 years old" / "eight yrs old" -> "8 years"; "installed in 2018" -> as written. */
function detectAge(text: string): string | null {
  const m = /\b(\d{1,2}|[a-z-]+)\s*(?:-|\s)?(years?|yrs?)[\s-]*old\b/i.exec(text);
  if (m) {
    const raw = m[1].toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
    if (Number.isFinite(n) && n !== undefined) return `${n} years`;
  }
  const installed = /\binstalled (?:in )?((?:19|20)\d{2})\b/i.exec(text);
  if (installed) return `installed in ${installed[1]}`;
  return null;
}

function detectBrand(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [pattern, canonical] of BRANDS) {
    if (new RegExp(`\\b${pattern}\\b`, "i").test(lower)) return canonical;
  }
  return null;
}

/** "since Tuesday" / "started yesterday" / "since June 3" — the words as typed, tidied. */
function detectOnset(text: string): string | null {
  const m = ONSET_RE.exec(text);
  if (!m) return null;
  const verb = m[1].toLowerCase() === "from" ? "since" : m[1].toLowerCase();
  const when = m[2].replace(/\s+/g, " ");
  const isDay = new RegExp(`^${WEEKDAY}$`, "i").test(when);
  return `${verb} ${isDay ? capitalize(when.toLowerCase()) : when}`;
}

/** Field-key extractors that run BEFORE the playbook's regexes, by name. */
const BUILT_IN: Record<string, (text: string) => string | null> = {
  brand: detectBrand,
  system_age: detectAge,
  symptom_timing: detectOnset,
  // Keep the resident's actual reading, not a generated paraphrase or photo claim.
  thermostat_photo: text => {
    const sentence = text.split(/(?<=[.!?])\s+/).find(s => /\bthermostat\b/i.test(s) && /\b\d{2,3}\b/.test(s));
    return sentence?.trim() ?? null;
  },
};

/** Only current, literal statements can skip a check. A question, possibility,
 * condition or historical report remains evidence, not today's checked fact. */
function observationSentences(description: string): string[] {
  return (description.match(/[^.!?\n]+[.!?]?/g) ?? [])
    .map(s => s.trim().replace(/[’]/g, "'"))
    .filter(s => !s.endsWith("?") &&
      !/\b(if|unless|when|whether|maybe|perhaps|possibly|probably|might|may|could|would|should|seems?|think|guess|unsure|uncertain|not sure|don't know|do not know|can't tell|cannot tell|can't see|cannot see|can't check|cannot check|remember|recall|told|said|says|example|suppose|assuming|used to|was|were|had|yesterday|previously|earlier|before|last (?:night|week|month|year))\b/i.test(s));
}

/** Cross-field facts and conflicts use the same literal-observation boundary. */
export function literalFieldText(description: string): string {
  return observationSentences(description)
    .filter(s => !/\b(not|isn't|don't|do not|never|no longer|previous|old unit|replacement)\b/i.test(s))
    .join(". ");
}

/** Exact observations only. No numeric rating is invented from "clean" and
 * a saved fact only advances a step when the normal playbook reaches it.
 * ice_check is an existing packet fact slot, not a newly invented graph step. */
export function detectDiagnosis(description: string, playbook: IntakePlaybook): Array<{ step_id: string; answer: string }> {
  if (playbook.playbook_id !== "pb_hvac_cooling_v1") return [];
  const out: Array<{ step_id: string; answer: string }> = [];
  const sentences = observationSentences(description);
  const clean = sentences.some(s => /\b(?:the |my |air )?filter (?:is |looks )?(?:clean|new)\b/i.test(s) &&
    !/\b(?:not|isn't|is not|don't|do not|never|no longer)\b/i.test(s));
  const dirty = /\bfilter\b[^.!?]{0,25}\b(?:dirty|clogged|not clean|isn't clean|not new)\b/i.test(description);
  if (clean && !dirty) {
    out.push({ step_id: "filter", answer: "reported_clean" });
  }
  const fan = sentences.some(s => /\boutdoor fan (?:is )?(?:runs|running|spins|spinning)\b/i.test(s) &&
    !/\b(?:not|isn't|is not|don't|do not|never|no longer)\b/i.test(s));
  const stopped = sentences.some(s => /\boutdoor fan (?:(?:is |does )?not (?:running|spinning|run|spin)|(?:isn't|doesn't) (?:running|spinning|run|spin)|(?:is )?(?:stopped|still))\b/i.test(s));
  if (fan !== stopped) out.push({ step_id: "fan_moving", answer: fan ? "yes" : "no" });
  const iceSentences = sentences.filter(s => !/\b(ice cream|ice maker|freezer|refrigerator|fridge)\b/i.test(s));
  const iceNo = iceSentences.some(s => /\b(?:(?:i|we) (?:see|can see|notice) no (?:visible )?ice|there is no (?:visible )?ice|no (?:visible )?ice (?:is visible|on (?:the |my )?(?:accessible |refrigerant |copper |ac )?(?:line|pipe|coil|unit)))\b/i.test(s) &&
    !/\b(?:not|isn't|is not|don't|do not|never|no longer)\b/i.test(s));
  const iceYes = iceSentences.some(s => /\b(?:(?:i|we) (?:see|can see|notice) (?:some |visible )?ice|there is (?:some |visible )?ice|(?:the |my )?(?:accessible |refrigerant |copper |ac )?(?:line|pipe|coil|unit) (?:has|is covered in) ice)\b/i.test(s) &&
    !/\b(?:not|isn't|is not|don't|do not|never|no longer)\b/i.test(s));
  if (iceYes !== iceNo) out.push({ step_id: "ice_check", answer: iceYes ? "yes" : "no" });
  return out;
}

export function detectFields(description: string, fields: FieldRequirement[]): DetectedField[] {
  const out: DetectedField[] = [];
  for (const field of fields) {
    const builtIn = BUILT_IN[field.field_key]?.(description) ?? null;
    if (builtIn) {
      out.push({ field_key: field.field_key, value_text: builtIn });
      continue;
    }
    for (const src of field.auto_detect_patterns) {
      let re: RegExp;
      try {
        re = new RegExp(src, "i");
      } catch {
        continue;
      }
      const m = re.exec(description);
      if (m) {
        // Use the whole match as the human-readable value (e.g. "8 years old",
        // "since yesterday") except when a pattern isolates a code-like token
        // such as a model number — then the last group is the value.
        const groups = m.slice(1).filter((g) => typeof g === "string" && g.trim().length > 0);
        const lastGroup = groups.length > 0 ? groups[groups.length - 1].trim() : "";
        const looksLikeCode = /^[A-Z0-9][A-Z0-9-]{5,}$/.test(lastGroup);
        const value = (looksLikeCode ? lastGroup : m[0]).trim();
        out.push({ field_key: field.field_key, value_text: value });
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The acknowledgement line (Coverage Standard §9.3, merged spec §10.3 — BINDING)
// ---------------------------------------------------------------------------

/**
 * "Got it — Carrier, about 8 years old, started Tuesday."
 *
 * Fact form only. The approved shape (merged spec §10.3) is copied as
 * written, em dash included; the two banned phrasings are praise ("Great
 * job") and the negative half ("You don't need to tell us that again"). The
 * line is the only visible evidence the homeowner has that a skipped question
 * was comprehension and not an oversight, so it renders whenever at least one
 * fact was picked up, and renders nothing (null) otherwise — an empty "Got
 * it" with no fact behind it would be exactly the praise-without-count that
 * WORDING rule 23 forbids.
 */
export interface HeldFact {
  field_key: string;
  value_text: string;
}

const ACK_ORDER = ["brand", "unit_model_serial", "system_age", "symptom_timing", "fixture_or_appliance", "affected_scope"];

function ackPhrase(fact: HeldFact): string | null {
  const v = fact.value_text.trim();
  if (!v || v === CANNOT_REACH_FIELD_VALUE) return null;
  switch (fact.field_key) {
    case "brand":
      return v;
    case "unit_model_serial":
      return `model ${v}`;
    case "system_age": {
      const years = /^(\d+)\s*years?$/i.exec(v);
      if (years) return `about ${years[1]} years old`;
      const old = /^(\d+)\s*years?\s*old$/i.exec(v);
      if (old) return `about ${old[1]} years old`;
      return v;
    }
    case "symptom_timing": {
      const since = /^since\s+(.+)$/i.exec(v);
      if (since) return `started ${since[1]}`;
      return v;
    }
    default:
      return v;
  }
}

export function acknowledgementLine(facts: readonly HeldFact[]): string | null {
  const byKey = new Map<string, HeldFact>();
  for (const f of facts) if (!byKey.has(f.field_key)) byKey.set(f.field_key, f);
  const phrases: string[] = [];
  for (const key of ACK_ORDER) {
    const f = byKey.get(key);
    if (!f) continue;
    const p = ackPhrase(f);
    if (p) phrases.push(p);
  }
  if (phrases.length === 0) return null;
  return `Got it — ${phrases.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// Trial scope (merged spec §17.3 — route-out is an approved terminal state)
// ---------------------------------------------------------------------------

/**
 * The trial is one trade in one county: an AC that runs but blows warm air,
 * Allen County, Indiana. Everything else gets the honest route-out instead of
 * a thermostat question (checklist F6).
 *
 * In scope when A01 named the HVAC family from the homeowner's own words. A
 * category that came only from the door's hint (low confidence, and the
 * playbook resolver could find nothing better than GENERIC) is not a
 * classification — it is the door guessing, and a garage door typed into the
 * AC door must not be treated as an AC.
 */
export interface TrialScope {
  in_scope: boolean;
  /** A search term she can try, when we can name one. */
  search_term: string | null;
}

const OUT_OF_TRADE_TERMS: ReadonlyArray<[RegExp, string]> = [
  [/\bgarage door\b/i, "garage door repair near me"],
  [/\bwater\b.{0,40}\b(ceiling|wall|floor)\b|\b(ceiling|wall)\b.{0,40}\bwater\b/i, "plumber near me"],
  [/\b(roof|shingle|gutter)\w*\b/i, "roofer near me"],
  [/\b(water heater|no hot water)\b/i, "plumber near me"],
  [/\b(sewer|septic|drain)\w*\b/i, "plumber near me"],
  [/\b(fridge|refrigerator|freezer|dishwasher|washer|dryer|oven|stove|range)\b/i, "appliance repair near me"],
  [/\b(foundation|crack)\w*\b/i, "foundation repair near me"],
  [/\b(tree|branch)\w*\b/i, "tree service near me"],
  [/\b(mice|mouse|rat|raccoon|squirrel|bees|wasp|termite|pest)\w*\b/i, "pest control near me"],
  [/\b(furnace|heat|heating|no heat)\b/i, "furnace repair near me"],
];

const FAMILY_TERMS: Record<string, string> = {
  plumbing: "plumber near me",
  electrical: "electrician near me",
  roofing: "roofer near me",
  appliance: "appliance repair near me",
  water_damage: "water damage restoration near me",
};

export function trialScope(
  problem: Pick<ProblemRecord, "service_category" | "service_category_confidence" | "problem_summary">,
  playbook: Pick<IntakePlaybook, "problem_family">
): TrialScope {
  const category = problem.service_category;
  const text = problem.problem_summary ?? "";
  const hvac = typeof category === "string" && category.toLowerCase().startsWith("hvac");
  const guessedFromDoorOnly =
    hvac && problem.service_category_confidence === "low" && playbook.problem_family !== "hvac";
  // Her own words name the AC: a thin sentence ("my ac isn't working") is
  // still an AC request even when the classifier could only lean on the door.
  const namesTheAc =
    /\b(ac|a\/c|air ?con\w*|cooling|cools?|cold|warm|lukewarm|hot air|thermostat|hvac|heat pump|condenser|compressor|vents?)\b/i.test(
      text
    );
  const inScope = hvac && (!guessedFromDoorOnly || namesTheAc);
  if (inScope) return { in_scope: true, search_term: null };

  let term: string | null = category ? (FAMILY_TERMS[category] ?? null) : null;
  for (const [re, t] of OUT_OF_TRADE_TERMS) {
    if (re.test(text)) {
      term = t;
      break;
    }
  }
  return { in_scope: false, search_term: term };
}
