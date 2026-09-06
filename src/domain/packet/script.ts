import type { ScriptParts } from "@/domain/packet/types";

/**
 * THE CALL SCRIPT — Directions §4.6. Twelve slots in a fixed order; a slot
 * with no data is dropped and the sentences close up around the gap. Slots 1
 * and 12 are VERBATIM and print on every packet ever produced; slot 2 is the
 * problem clause and is required.
 *
 * Group A (slots 4–6) hangs off the constant lead `. It's ` — when all three
 * are absent the lead drops with them (§11.3's thin example: `"Hi — my AC is
 * running but blowing warm air. I've got photos and a Job Packet…"`).
 * Group B (slots 8–11) is one spoken sentence: the first present clause opens
 * it with a capital, the rest follow with commas, and the ice clause carries
 * its own `and` when it is not the first (the mockup's exact shape).
 *
 * `has_photos: false` drops `photos and ` from slot 12 (§11.3), because the
 * Job Packet exists even when the photos do not.
 */
export interface AssembledScript {
  /** With the model number wrapped in the mono face — what the page prints. */
  html: string;
  /** The same words with no markup — what the self-check compares. */
  text: string;
}

// Straight ASCII quotes and apostrophes: that is what the approved mockup and
// the Directions' slot table carry, and "byte for byte" means these bytes.
const SLOT_1 = '"Hi — ';
const SLOT_3 = ". It's ";
const CLOSE_WITH_PHOTOS = '. I\'ve got photos and a Job Packet I can send you before you come out."';
const CLOSE_NO_PHOTOS = '. I\'ve got a Job Packet I can send you before you come out."';

/** Text-node escaping. Quotes stay literal — the mockup prints them raw. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Attribute escaping. */
export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export function assembleScript(parts: ScriptParts, opts: { has_photos: boolean }): AssembledScript {
  const problem = (parts.problem_clause ?? "").trim();
  if (!problem) throw new Error("script: problem_clause is required (Directions §4.6 slot 2)");

  const textPieces: string[] = [SLOT_1, problem];
  const htmlPieces: string[] = [escapeHtml(SLOT_1), escapeHtml(problem)];

  // Group A — slots 3..6
  const brandType = parts.equipment_brand_type?.trim() || null;
  const age = parts.age_spoken?.trim() || null;
  const model = parts.model_number?.trim() || null;
  if (brandType || age || model) {
    const groupText: string[] = [];
    const groupHtml: string[] = [];
    if (brandType) {
      groupText.push(brandType);
      groupHtml.push(escapeHtml(brandType));
    }
    if (age) {
      groupText.push(age);
      groupHtml.push(escapeHtml(age));
    }
    if (model) {
      groupText.push(`model ${model}`);
      groupHtml.push(`model <span class="x-mono">${escapeHtml(model)}</span>`);
    }
    // Without a brand/type the sentence still needs a subject: "It's about
    // eight years old, model X" reads as speech; nothing is substituted.
    textPieces.push(SLOT_3, groupText.join(", "));
    htmlPieces.push(escapeHtml(SLOT_3), groupHtml.join(", "));
  }

  // Slot 7
  const onset = parts.onset_clause?.trim() || null;
  if (onset) {
    textPieces.push(". ", capitalise(onset));
    htmlPieces.push(". ", escapeHtml(capitalise(onset)));
  }

  // Group B — slots 8..11
  const clauses: string[] = [];
  if (typeof parts.thermostat_setpoint === "number" && typeof parts.room_temp === "number") {
    clauses.push(`the thermostat's set to ${parts.thermostat_setpoint} and the room's at ${parts.room_temp}`);
  }
  if (parts.outdoor_state_clause?.trim()) clauses.push(parts.outdoor_state_clause.trim());
  if (parts.filter_clause?.trim()) clauses.push(parts.filter_clause.trim());
  const ice = parts.ice_clause?.trim() || null;
  if (clauses.length > 0 || ice) {
    const rendered: string[] = [];
    clauses.forEach((c, i) => rendered.push(i === 0 ? capitalise(c) : c));
    if (ice) rendered.push(rendered.length === 0 ? capitalise(ice) : `and ${ice}`);
    const sentence = rendered.join(", ");
    textPieces.push(". ", sentence);
    htmlPieces.push(". ", escapeHtml(sentence));
  }

  const close = opts.has_photos ? CLOSE_WITH_PHOTOS : CLOSE_NO_PHOTOS;
  textPieces.push(close);
  htmlPieces.push(escapeHtml(close));
  return { text: textPieces.join(""), html: htmlPieces.join("") };
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Spoken numbers for ages, durations and the evidence count phrase (§10.2). */
export function spelled(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  const whole = Math.round(n);
  if (whole < 20) return ONES[whole];
  if (whole < 100) {
    const t = TENS[Math.floor(whole / 10)];
    const o = whole % 10;
    return o === 0 ? t : `${t}-${ONES[o]}`;
  }
  return String(whole);
}

/** "about eight years old", "about a year old". */
export function ageSpoken(years: number): string {
  const y = Math.round(years);
  if (y <= 0) return "less than a year old";
  if (y === 1) return "about a year old";
  return `about ${spelled(y)} years old`;
}
