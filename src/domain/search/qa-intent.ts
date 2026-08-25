/**
 * A06's OWN INTENT-OVERLAP MATCHER — reimplemented, on purpose, from nothing.
 *
 * THE RULE, from the loop-coherence report (issue 15) and Master Todo T1-09:
 * A04 and A05 may share the extracted intent-family helper; A06 must
 * reimplement it independently — "an inspector that shares its subject's logic
 * is not an inspector." A test asserts this module and A06's QA path import
 * NOTHING from the page factory, the recommender or that shared helper.
 *
 * IT IS A DIFFERENT MECHANISM, NOT A COPY WITH A DIFFERENT NAME. The point of
 * the split is that a flaw in the shared matcher must be CATCHABLE here, and a
 * transliteration of the same algorithm cannot catch a flaw in the algorithm.
 * So the two differ at every layer:
 *
 *                       shared helper (A04/A05)        A06 (this file)
 *   token filter        13 function words              closed-class list, with
 *                                                      an explicit POLARITY set
 *                                                      that is NEVER dropped
 *   inflection          suffix STRIPPING (-ing/-ed/-s) PREFIX AGREEMENT scored
 *                                                      at 0.9, never collapsed
 *   negation            collapsed to the token "not"   collapsed to a marker
 *                                                      that cannot prefix-match
 *   similarity          Jaccard >= 0.7 OR containment  soft Dice over a greedy
 *                       >= 0.99 on stemmed SETS        best-match pairing, with
 *                                                      polarity tokens required
 *                                                      to match EXACTLY
 *   threshold           0.7 / 0.99                     0.85 (policy-resolved)
 *
 * WHY POLARITY IS ITS OWN CLASS. "ac won't turn ON" and "ac won't turn OFF" are
 * different home problems, and so are "water heater too HOT" and "too COLD".
 * Suffix stemming cannot distinguish them and neither can raw token overlap —
 * they differ by one short word that most stopword lists would happily eat. A06
 * therefore refuses to drop them AND refuses to fuzzy-match them, which is the
 * conservative direction for a check whose false positive costs a real page.
 *
 * NO PRN-DOMAIN IMPORTS (condition C14 / pre-answer 10). This file takes strings
 * and returns numbers. Whichever way Josh rules on the `auto-seo-core`
 * extraction, lifting it is a copy, not a rewrite.
 */

/**
 * Words whose PRESENCE changes which home problem is being described. Never
 * dropped as noise, and never allowed to satisfy a fuzzy match — two phrases
 * that disagree on one of these are two different intents.
 */
const POLARITY = new Set([
  "on", "off", "up", "down", "in", "out",
  "hot", "cold", "warm", "cool", "high", "low",
  "open", "closed", "before", "after", "over", "under",
  "full", "empty", "fast", "slow", "loud", "quiet",
]);

/**
 * Closed-class function words. Deliberately its own list — sharing A04's would
 * reintroduce exactly the coupling this file exists to avoid. Every POLARITY
 * word above is excluded from this set by construction (asserted by test).
 */
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "is", "are", "am", "was", "were", "be", "been", "being",
  "my", "our", "your", "its", "their", "this", "that", "these", "those",
  "why", "how", "what", "which", "who", "whom", "when", "where",
  "do", "does", "did", "to", "of", "for", "from", "with", "and", "or", "so",
  "it", "i", "we", "you", "there", "here", "at", "as", "by",
]);

/**
 * The negation marker. A single non-alphabetic token so it can never satisfy
 * the prefix rule below (a marker that could fuzzy-match would let "not
 * heating" and "nothing" collide).
 */
const NEGATION = "~neg";

const NEGATION_SPELLINGS = new Set([
  "not", "no", "never",
  "wont", "cant", "cannot", "dont", "doesnt", "didnt", "isnt", "arent", "wasnt",
  "wouldnt", "couldnt", "shouldnt", "havent", "hasnt", "aint",
]);

/** Minimum shared prefix length before two tokens may fuzzy-match. */
const PREFIX_MIN = 4;
/** Score awarded to a prefix agreement. Never 1.0 — a near match is near. */
const PREFIX_SCORE = 0.9;

/**
 * Normalize a query into A06's token sequence. Exported so the finding can name
 * exactly what was compared rather than asserting an opaque verdict.
 */
export function qaIntentTokens(query: string): string[] {
  const raw = query
    .toLowerCase()
    // Apostrophes are REMOVED rather than treated as separators, so "won't"
    // becomes "wont" and lands on the negation list intact.
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);

  const tokens: string[] = [];
  for (const token of raw) {
    if (NEGATION_SPELLINGS.has(token)) {
      // One negation marker per phrase: "won't not turn on" is not twice as
      // negative, and a repeated marker would inflate the similarity score.
      if (!tokens.includes(NEGATION)) tokens.push(NEGATION);
      continue;
    }
    if (POLARITY.has(token)) {
      tokens.push(token);
      continue;
    }
    if (FUNCTION_WORDS.has(token)) continue;
    if (token.length < 2) continue;
    tokens.push(token);
  }
  return tokens;
}

/** True when a token must match exactly — polarity words and the negation marker. */
function isExactOnly(token: string): boolean {
  return token === NEGATION || POLARITY.has(token);
}

/** Similarity of two single tokens: 1 exact, 0.9 prefix agreement, else 0. */
export function qaTokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (isExactOnly(a) || isExactOnly(b)) return 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < PREFIX_MIN) return 0;
  return longer.startsWith(shorter) ? PREFIX_SCORE : 0;
}

/**
 * Soft Dice over a GREEDY BEST-MATCH pairing: every token in A is paired with
 * at most one token in B, highest-scoring pairs first, and the total agreement
 * is scored against the combined token count.
 *
 * Greedy rather than optimal (Hungarian) on purpose: query phrases are short,
 * the greedy result equals the optimal one for every realistic input, and a
 * matcher an owner cannot follow by hand is a matcher nobody will audit.
 */
export function qaIntentSimilarity(a: string, b: string): number {
  const ta = qaIntentTokens(a);
  const tb = qaIntentTokens(b);
  if (ta.length === 0 || tb.length === 0) {
    return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  }

  const pairs: Array<{ i: number; j: number; score: number }> = [];
  for (let i = 0; i < ta.length; i += 1) {
    for (let j = 0; j < tb.length; j += 1) {
      const score = qaTokenSimilarity(ta[i], tb[j]);
      if (score > 0) pairs.push({ i, j, score });
    }
  }
  pairs.sort((p, q) => q.score - p.score || p.i - q.i || p.j - q.j);

  const usedA = new Set<number>();
  const usedB = new Set<number>();
  let agreement = 0;
  for (const pair of pairs) {
    if (usedA.has(pair.i) || usedB.has(pair.j)) continue;
    usedA.add(pair.i);
    usedB.add(pair.j);
    agreement += pair.score;
  }

  return (2 * agreement) / (ta.length + tb.length);
}

export interface QaIntentOverlap {
  /** The similarity A06 measured, 0..1. */
  similarity: number;
  /** The threshold it was measured against — always reported with the score. */
  threshold: number;
  overlaps: boolean;
  /** A06's normalization of each side, so a verdict is inspectable. */
  tokens_a: string[];
  tokens_b: string[];
}

/**
 * The check itself. Returns the measurement AND the threshold, never a bare
 * boolean: a duplication verdict that cannot be argued with is a verdict nobody
 * can correct.
 */
export function qaIntentOverlap(a: string, b: string, threshold: number): QaIntentOverlap {
  const similarity = qaIntentSimilarity(a, b);
  return {
    similarity,
    threshold,
    overlaps: similarity >= threshold,
    tokens_a: qaIntentTokens(a),
    tokens_b: qaIntentTokens(b),
  };
}

/** The A06 stopword sets, exported so a test can assert they stay disjoint. */
export const QA_INTENT_INTERNALS = {
  POLARITY,
  FUNCTION_WORDS,
  NEGATION,
  NEGATION_SPELLINGS,
  PREFIX_MIN,
  PREFIX_SCORE,
} as const;
