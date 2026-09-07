/**
 * Exclude only a bounded, explicit negative-report grammar from existing hazard
 * matches. This never adds a trigger, changes copy, or establishes safety. Any
 * unrecognised syntax retains its original match for the existing safety gate.
 */
interface Occurrence { pattern: RegExp; start: number; end: number }
interface Clause { start: number; end: number; question: boolean }

const BREAK = /[.!?;\r\n\u2014]|(?:,\s*)?\b(?:but|however|though|although|yet)\b/gi;
const SEPARATOR = /,|\b(?:and|or|nor)\b/gi;
const LIST_PREFIX = /^(?:(?:no|any|a|an|the|visible|obvious|noticeable|apparent|unusual|active|signs?|evidence|of|and|or|nor)\s*)*$/i;
// Grammar vocabulary ONLY: these words cannot independently produce a hazard.
// It prevents a broad registry regex (e.g. `water .* electric`) swallowing an
// exception or conditional phrase and disguising it as one negative list item.
const ATOM_WORDS = new Set((
  "gas smell smells smelled smelling like of natural propane leak leaking rotten egg carbon monoxide co alarm detector " +
  "fire flame flames smoke spark sparks sparking burn burnt burning something it its is are has a the " +
  "water flood flooding flooded standing near around at outlet outlets panel panels breaker electric electrical " +
  "ceiling sagging collapsing caving wall bulging structural sewage sewer raw waste inside through in into " +
  "melted melting plug wire arcing actively pouring gushing spreading everywhere"
).split(" "));
const MARK = "\uE000";
const atom = `${MARK}(?:\\s+(?:panel|outlet|alarm|detector))?`;
const modifiedAtom = `(?:(?:any|visible|obvious|noticeable|apparent|unusual|active)\\s+)*(?:(?:signs?|evidence)\\s+of\\s+)?${atom}`;
const location = "(?:\\s+(?:near|at|by|in|inside|outside|around|from)\\s+(?:(?:the|a|an|my|our)\\s+)?(?:furnace|heater|house|home|kitchen|basement|garage|room|unit|outlet|panel|breaker))?";
const NEGATIVE_REPORT = new RegExp(
  `^(?:(?:(?:there (?:is|are|was|were)) )?no|(?:i|we) (?:do not|don['\u2019]t))\\s+` +
  `${modifiedAtom}(?:(?:\\s*,\\s*(?:(?:and|or|nor)\\s+)?|\\s+(?:and|or|nor)\\s+)(?:no\\s+)?${modifiedAtom})*${location}$`, "i",
);

function clauses(text: string, occurrences: readonly Occurrence[]): Clause[] {
  const cuts: { start: number; end: number; question: boolean }[] = [];
  for (const boundary of text.matchAll(BREAK)) {
    cuts.push({ start: boundary.index, end: boundary.index + boundary[0].length, question: boundary[0] === "?" });
  }
  // A subject/verb after a list separator starts a separate report, e.g.
  // "No gas smell, the outlet is sparking". Bare hazard nouns remain one list.
  for (const separator of text.matchAll(SEPARATOR)) {
    const from = separator.index + separator[0].length;
    const next = occurrences.filter((item) => item.start >= from).sort((a, b) => a.start - b.start)[0];
    if (!next || cuts.some((cut) => cut.start >= from && cut.start < next.start)) continue;
    const prefix = text.slice(from, next.start).trim();
    if (prefix && !LIST_PREFIX.test(prefix)) cuts.push({ start: separator.index, end: from, question: false });
  }
  cuts.sort((a, b) => a.start - b.start);
  const result: Clause[] = [];
  let start = 0;
  for (const cut of cuts) {
    if (cut.start < start) continue;
    result.push({ start, end: cut.start, question: cut.question });
    start = cut.end;
  }
  result.push({ start, end: text.length, question: false });
  return result.filter((clause) => text.slice(clause.start, clause.end).trim());
}

function isNegativeReport(text: string, clause: Clause, occurrences: readonly Occurrence[]): boolean {
  if (clause.question) return false;
  const source = text.slice(clause.start, clause.end);
  if (source.includes(MARK)) return false;
  const covered = new Set<number>();
  for (const match of occurrences) {
    if (match.start < clause.start || match.end > clause.end) continue;
    let end = match.end;
    // Existing patterns sometimes end inside a word: burn(ing), electric(al).
    while (end < clause.end && /[a-z]/i.test(text[end])) end++;
    const words = text.slice(match.start, end).toLowerCase().replace(/['\u2019]/g, "").split(/\s+/);
    if (!words.every((word) => ATOM_WORDS.has(word))) continue;
    for (let i = match.start; i < end; i++) covered.add(i - clause.start);
  }
  let masked = "";
  for (let i = 0; i < source.length; i++) {
    if (covered.has(i)) { if (!covered.has(i - 1)) masked += MARK; }
    else masked += source[i];
  }
  // A neutral observation allowed in the user's explicit negative list. This
  // does not make "leaking water" a trigger in either caller's hazard registry.
  masked = masked.replace(/\bleaking\s+water\b/gi, MARK).replace(/\s+/g, " ").trim();
  return NEGATIVE_REPORT.test(masked);
}

/** Original patterns with at least one occurrence outside a clear negative report. */
export function affirmedSafetyPatterns(text: string, patterns: readonly RegExp[]): ReadonlySet<RegExp> {
  const occurrences: Occurrence[] = [];
  for (const pattern of patterns) {
    const scan = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, "") + "g");
    for (const match of text.matchAll(scan)) occurrences.push({ pattern, start: match.index, end: match.index + match[0].length });
  }
  const parts = clauses(text, occurrences);
  const negative = parts.filter((part, index) => isNegativeReport(text, part, occurrences) &&
    // An unexplained following clause ("but I am not sure", "except when...")
    // cannot silently qualify an earlier denial. Keep the earlier match active.
    parts.slice(index + 1).every((later) => occurrences.some((match) => match.start >= later.start && match.end <= later.end)));
  return new Set(occurrences.filter((match) => !negative.some((part) => match.start >= part.start && match.end <= part.end)).map((match) => match.pattern));
}
