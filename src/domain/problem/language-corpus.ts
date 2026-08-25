import {
  MINING_COHORT_FLOOR,
  miningGate,
  type LanguageMiningPolicy,
} from "@/domain/search/language-mining";

/**
 * THE HOMEOWNER-LANGUAGE CORPUS — A01's side of the loop's highest-value seam
 * (Loop Spec Audit A01 condition 15 "WRITE DOWN THE SEO LOOP EDGE"; Trial Spec
 * Audit HO-2).
 *
 * ─── THE EDGE THAT EXISTED IN PROSE AND NOWHERE ELSE ───────────────────────
 *
 * A01's spec §1 says A01 is "the first place PRN generates genuinely proprietary
 * data — the actual language homeowners use" and that it compounds into every
 * later page. §5's Writes never turned that into a contract, so the audit
 * treated it as an unwired edge rather than an implied one. Meanwhile the OTHER
 * end was already built: `domain/search/language-mining.ts` ships the POLICY
 * with no miner, and `miningGate()` declares the exact input shape whoever
 * builds one must produce — `{ phrase, distinctRecordCount }`, where the count
 * is DISTINCT ProblemRecords and never occurrences, floored at 5.
 *
 * This file is the producer for that shape. It is the whole contract, and
 * nothing more: it hands over counted phrases, and A04 decides what to do with
 * them under a policy that ships OFF.
 *
 * ─── WHY IT LIVES HERE AND NOT UNDER domain/search ─────────────────────────
 *
 * A04's shipped guard (tests/a04.enrichment-and-mining.test.ts) fails if any
 * customer contract type name appears anywhere under `domain/search`. That guard
 * is the structural half of "A04 cannot write customer text into a page title,
 * because it never has any", and it is worth more intact than convenient. So the
 * corpus is produced on A01's side of the line and crosses it already
 * aggregated, already counted, already non-identifying.
 *
 * ─── THE THREE THINGS THAT MAKE THIS SAFE, IN THE ORDER THEY APPLY ─────────
 *
 *   1. CONSENT, FIRST. A record with no reuse-scoped consent is dropped before
 *      its text is read. Not filtered afterwards — dropped, so nothing it
 *      contains can influence a count.
 *   2. AGGREGATION. A phrase's count is the number of DISTINCT ProblemRecords it
 *      appeared in. One talkative homeowner saying the same thing nine times
 *      contributes exactly one, which is the difference between a pattern and a
 *      person.
 *   3. THE FLOOR. Below the cohort floor a phrase is not emitted at all. This is
 *      the actual privacy mechanism and it is worth being clear about why: a
 *      street name, a surname or a serial number will never appear in five
 *      unrelated households' descriptions, so the floor removes identifying
 *      strings without needing to recognise them.
 *
 * NOTHING HERE STORES OR RETURNS ANY RECORD'S TEXT. The input text is read to
 * count phrases and is never copied into the output, which carries only phrases
 * that cleared the floor and integer counts.
 *
 * ─── WHAT A01 DELIBERATELY DOES NOT DO ─────────────────────────────────────
 *
 * A01 DOES NOT FLIP `enabled`. The policy ships false, and turning it on
 * presupposes answers to two parked questions: the real cohort value, and
 * whether customer-derived phrasing may become public page text at all and in
 * what wording. Both sit downstream of OD-3, and both are Melissa's.
 *
 * TODO-ASK-OWNER (Melissa): the consent wording for reuse (OD-3), the cohort
 * value above the floor, and whether this corpus may ever reach a published
 * page. Until those land, the scope below is granted by nothing and this
 * producer returns an empty corpus in production — which is the correct
 * behaviour, not a gap.
 */

/**
 * THE CONSENT SCOPE THIS CORPUS REQUIRES — and which NO SURFACE GRANTS TODAY.
 *
 * The active intake disclosure does say non-identifying details may become local
 * repair records and trends, but the ConsentEvent the intake route records
 * carries `intake.data_processing`, and reading that scope as covering language
 * reuse would be a build session deciding a consent question by inference. So
 * this is a separate scope, no path records it, and the corpus is therefore
 * empty until the wording exists and a surface asks for it.
 */
export const CONSENT_SCOPE_LANGUAGE_REUSE = "intake.language_reuse";

/** One record's contribution. The text is READ here and never leaves. */
export interface CorpusRecordInput {
  /** Distinctness is per ProblemRecord — this id is what makes a cohort real. */
  problem_id: string;
  /** The homeowner's own words. Used for counting; never copied out. */
  text: string;
  /** Scopes granted on this record's consent ledger, at the time of the run. */
  consent_scopes: readonly string[];
}

/** Exactly the shape `miningGate()` declares. Nothing extra travels. */
export interface CorpusPhrase {
  phrase: string;
  /** DISTINCT ProblemRecords, never occurrences. */
  distinctRecordCount: number;
}

export interface LanguageCorpus {
  phrases: CorpusPhrase[];
  /** How many records were eligible to contribute. */
  eligible_records: number;
  /** Dropped before their text was read, by reason. */
  excluded: { no_consent: number };
  /** The floor applied to this run. */
  cohort_floor: number;
  /** How many candidate phrases were suppressed for being below it. */
  suppressed_below_floor: number;
}

export interface BuildCorpusOptions {
  /**
   * Minimum distinct records. Defaults to the structural floor, never lower —
   * a caller cannot ask for a smaller cohort than the schema permits.
   */
  min_distinct_records?: number;
  /** Phrase lengths in words. Two and three cover how people describe faults. */
  phrase_lengths?: readonly number[];
}

/**
 * Tokens that can never appear in an emitted phrase. NOT a privacy mechanism on
 * its own — the floor is — but a cheap first pass that keeps obviously
 * record-specific strings out of the counting entirely: anything with a digit
 * (addresses, phone numbers, model and serial numbers), anything that looks like
 * an address or a URL, and anything implausibly long.
 */
function tokenIsCountable(token: string): boolean {
  if (token.length === 0 || token.length > 24) return false;
  if (/\d/.test(token)) return false;
  if (token.includes("@") || token.includes("/")) return false;
  return /^[a-z][a-z'-]*$/.test(token);
}

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9@/'\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * The phrases one record contributes, DE-DUPLICATED WITHIN THE RECORD. A record
 * contributes each distinct phrase exactly once, which is what makes the output
 * count records rather than repetitions.
 */
function phrasesIn(text: string, lengths: readonly number[]): Set<string> {
  const tokens = tokenise(text);
  const out = new Set<string>();
  for (const n of lengths) {
    for (let i = 0; i + n <= tokens.length; i += 1) {
      const window = tokens.slice(i, i + n);
      if (!window.every(tokenIsCountable)) continue;
      out.add(window.join(" "));
    }
  }
  return out;
}

/**
 * Build the aggregate, non-identifying, consent-scoped corpus.
 *
 * Deterministic: the same records in any order produce the same output, sorted
 * by count then alphabetically, so a diff between two runs means the data moved
 * rather than the iteration order.
 */
export function buildLanguageCorpus(
  records: readonly CorpusRecordInput[],
  options: BuildCorpusOptions = {}
): LanguageCorpus {
  const floor = Math.max(options.min_distinct_records ?? MINING_COHORT_FLOOR, MINING_COHORT_FLOOR);
  const lengths = options.phrase_lengths ?? [2, 3];

  // 1. CONSENT FIRST — dropped before the text is read.
  const eligible = records.filter((r) => r.consent_scopes.includes(CONSENT_SCOPE_LANGUAGE_REUSE));
  const noConsent = records.length - eligible.length;

  // 2. AGGREGATE — distinct records per phrase, and distinct records only.
  const seenRecords = new Set<string>();
  const counts = new Map<string, Set<string>>();
  for (const record of eligible) {
    // A record that appears twice in the input is still one record.
    if (seenRecords.has(record.problem_id)) continue;
    seenRecords.add(record.problem_id);
    for (const phrase of phrasesIn(record.text, lengths)) {
      const bucket = counts.get(phrase) ?? new Set<string>();
      bucket.add(record.problem_id);
      counts.set(phrase, bucket);
    }
  }

  // 3. THE FLOOR — below it, a phrase is one person's sentence and is not emitted.
  const phrases: CorpusPhrase[] = [];
  let suppressed = 0;
  for (const [phrase, ids] of counts) {
    if (ids.size < floor) {
      suppressed += 1;
      continue;
    }
    phrases.push({ phrase, distinctRecordCount: ids.size });
  }
  phrases.sort((a, b) =>
    b.distinctRecordCount - a.distinctRecordCount || a.phrase.localeCompare(b.phrase)
  );

  return {
    phrases,
    eligible_records: seenRecords.size,
    excluded: { no_consent: noConsent },
    cohort_floor: floor,
    suppressed_below_floor: suppressed,
  };
}

/**
 * Run the produced corpus through A04's OWN gate, so the two ends are checked
 * against each other rather than trusted to agree. Every phrase that comes back
 * `allowed` has passed the policy A04 ships — including its `enabled` flag,
 * which is false, so today this returns nothing regardless of the corpus.
 *
 * That is the point of calling it: A01 hands over candidates and does not decide
 * whether mining happens.
 */
export function corpusPassingGate(
  policy: LanguageMiningPolicy,
  corpus: LanguageCorpus
): CorpusPhrase[] {
  return corpus.phrases.filter((c) => miningGate(policy, c).allowed);
}
