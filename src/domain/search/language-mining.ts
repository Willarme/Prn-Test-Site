import { z } from "zod";

/**
 * INTERNAL-LANGUAGE MINING — the POLICY, shipped OFF, with no mining code.
 * (C11, coherence report issue 11, pre-answer 12 — MELISSA-PARK.)
 *
 * WHAT THIS IS ABOUT. A04's spec declares an input it wants: the language
 * homeowners actually use, mined from PRN's own ProblemRecords, so the page
 * factory can target real phrasing instead of vendor keyword lists. The danger
 * is specific and not hypothetical: `SearchOpportunity.keyword` is free text,
 * it renders in the admin table, and downstream it becomes a PAGE TITLE. So
 * "mine our customers' words" and "publish a homeowner's sentence on the open
 * web under their own problem" are one short path apart.
 *
 * It is also an edge asserted on ONE side only — A01's spec never names A04 or
 * A05 as a consumer, and no object, consent gate, privacy class or aggregation
 * threshold exists on either end. A04 §6 already marks it "nice-to-have, not
 * blocking".
 *
 * SO: THE PATH SHIPS OFF AND NO MINING CODE EXISTS. There is deliberately no
 * miner in this file. What ships is the RULE, as policy, enforced by test, for
 * whenever it is turned on — because the expensive mistake is not "we did not
 * build the miner", it is "we built it first and wrote the rule afterwards".
 *
 * TODO-ASK-OWNER (Melissa) — PARKED, NOT DECIDED:
 *   - the value of N (the minimum distinct-record cohort). The FLOOR of 5 below
 *     is a hard structural minimum a build may set; the actual value is a
 *     privacy judgment about how many homeowners must have said a thing before
 *     it stops being any one of them.
 *   - whether customer-derived phrasing may EVER become public page text at
 *     all, and in what wording. This sits downstream of the append-only consent
 *     ledger and adjacent to OD-3 (consent wording, still unwritten).
 */

/**
 * The structural floor. Not the owner's answer — the minimum any answer must
 * clear. A pattern observed in fewer than this many DISTINCT ProblemRecords is
 * not a pattern, it is one person's sentence.
 */
export const MINING_COHORT_FLOOR = 5;

export const LanguageMiningPolicy = z
  .object({
    /**
     * SHIPS FALSE. Turning this on is an owner decision that presupposes the
     * two parked questions above have answers.
     */
    enabled: z.boolean(),
    /** Minimum DISTINCT ProblemRecords a phrase must appear in. Floor-enforced. */
    min_distinct_problem_records: z.number().int().min(MINING_COHORT_FLOOR),
    /**
     * HARD, AND NOT A KNOB. No customer-derived string may be written into
     * SearchOpportunity.keyword in this wave. It is a literal `true` so a
     * policy that relaxes it does not parse — the guarantee cannot be turned
     * off by editing a config file.
     */
    never_write_customer_text_to_keyword: z.literal(true),
  })
  .superRefine((p, ctx) => {
    if (p.min_distinct_problem_records < MINING_COHORT_FLOOR) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a mining cohort below ${MINING_COHORT_FLOOR} distinct records is one homeowner's sentence, not a pattern`,
        path: ["min_distinct_problem_records"],
      });
    }
  });
export type LanguageMiningPolicy = z.infer<typeof LanguageMiningPolicy>;

export const DEFAULT_LANGUAGE_MINING_POLICY: LanguageMiningPolicy =
  LanguageMiningPolicy.parse({
    enabled: false,
    // The FLOOR, standing in for an owner value that does not exist yet. It is
    // the most conservative number the schema permits, not a chosen one.
    min_distinct_problem_records: MINING_COHORT_FLOOR,
    never_write_customer_text_to_keyword: true,
  });

export interface MiningGateResult {
  allowed: boolean;
  reasons: string[];
}

/**
 * The gate any future miner must pass. It exists now, ahead of the miner, so
 * that whoever writes one finds the rule already enforced rather than having to
 * remember it.
 *
 * `distinctRecordCount` is the number of DISTINCT ProblemRecords a candidate
 * phrase was observed in — never the number of occurrences, which one talkative
 * homeowner can inflate on their own.
 */
export function miningGate(
  policy: LanguageMiningPolicy,
  candidate: { phrase: string; distinctRecordCount: number }
): MiningGateResult {
  const reasons: string[] = [];
  if (!policy.enabled) {
    reasons.push(
      "internal-language mining is OFF (policy language_mining.enabled = false) — TODO-ASK-OWNER (Melissa)"
    );
  }
  if (candidate.distinctRecordCount < policy.min_distinct_problem_records) {
    reasons.push(
      `observed in ${candidate.distinctRecordCount} distinct ProblemRecords, below the required ${policy.min_distinct_problem_records}`
    );
  }
  return { allowed: reasons.length === 0, reasons };
}
