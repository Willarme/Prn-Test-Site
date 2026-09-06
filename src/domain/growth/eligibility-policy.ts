import { z } from "zod";

/**
 * ELIGIBILITY POLICY — the tuning knobs of the PageEligibilityGate, as DATA.
 *
 * WHY THIS FILE EXISTS (Josh's ruling R4, 2026-08-28). The factor weights and
 * the demand cut-off bands were constants inside page-eligibility-gate.ts, so
 * retuning the gate meant editing code, reviewing a diff of business judgement
 * dressed as a function, and shipping a release. They now live in the same data
 * layer the playbooks live in: a zod-validated authored record
 * (eligibility-policy-v1.ts), parsed at module load exactly like the graph and
 * the playbooks, with the gate reading it rather than owning it.
 *
 * The VALUES did not change when they moved. Same weights, same 100/mo and
 * 20/mo bands. Retuning them before A04 supplies real demand data would be
 * guessing twice; this move only means the next tune is a data edit.
 *
 * THE THRESHOLD IS NULL, AND NULL HAS A MEANING (Josh's ruling R2, following
 * the OD-5 precedent in docs/canon/OPEN_DECISIONS.md — a threshold whose
 * recorded default is null until real scores exist).
 *
 *   NULL DOES NOT MEAN "EVERYTHING PASSES". It means NO SCORE AUTO-APPROVES.
 *   The three unoutvotable vetoes still refuse outright, and anything that
 *   survives them is RETURNED FOR A HUMAN DECISION with its score attached.
 *   The score is still computed, still weighted, still reported in full.
 *
 * Josh's reason, recorded so nobody re-derives it: the gate's reachable range
 * on today's inputs is roughly 34 to 83.5, not 0 to 100, so any threshold
 * between about 48 and 76 changes nothing about a single real candidate. A
 * decorative number that reads like a real one is worse than an honest null.
 * When A04 produces real demand data, a number goes here and the gate starts
 * auto-approving above it — that is a data edit, and the semantics below are
 * already written to handle both cases.
 */

export const ELIGIBILITY_POLICY_SCHEMA_VERSION = "1.0.0";

/** The seven factors, in the order canon doc 23 / the T6-01 done-when lists them. */
export const ELIGIBILITY_FACTORS = [
  "distinct_intent",
  "demand",
  "answer_uniqueness",
  "safety_importance",
  "conversion_value",
  "local_uniqueness",
  "evidence_depth",
] as const;
export type EligibilityFactor = (typeof ELIGIBILITY_FACTORS)[number];

/** One demand cut-off band: at or above `min_monthly` searches, the demand factor scores this. */
const DemandBand = z
  .object({
    min_monthly: z.number().int().nonnegative(),
    score: z.number().int().min(0).max(10),
    /** How the band reads in the audit trail, e.g. "real cluster". */
    label: z.string().min(3),
  })
  .strict();

export type DemandBand = z.infer<typeof DemandBand>;

/** A 0–10 factor score. The gate multiplies these by the weights and by 10. */
const FactorScore = z.number().int().min(0).max(10);

/**
 * THE RAW FACTOR SCORES — the other half of R4, which the first pass missed.
 *
 * Moving the weights and the demand bands out was only two of the numbers. The
 * gate still hardcoded ELEVEN raw scores plus a confidence cut-off in its own
 * file, so the header's "retuning the gate is a data edit; this file holds the
 * judgement about WHAT is scored, never the numbers" was false in eleven
 * places: changing "a routine problem class scores 3" was a code edit and a
 * release, which is precisely what R4 says it must not be.
 *
 * Every number the gate can produce now lives here. The gate decides WHICH
 * branch a candidate is in; this decides what that branch is worth.
 */
const FactorScores = z
  .object({
    distinct_intent: z
      .object({
        /** A page for this exact intent already exists. */
        duplicate: FactorScore,
        /** No existing page covers it. */
        distinct: FactorScore,
      })
      .strict(),
    demand: z
      .object({
        /**
         * No demand estimate at all. The BANDS cover every non-null estimate;
         * this is the null case, and like every other unknown it is worth 0.
         */
        unknown: FactorScore,
      })
      .strict(),
    answer_uniqueness: z
      .object({
        /** No competitor review has been done. Unknown scores 0, by the gate's default-is-no rule. */
        unreviewed: FactorScore,
        /** Existing pages already say this. */
        indistinguishable: FactorScore,
        /** Review found a gap PRN can genuinely fill. */
        distinguishable: FactorScore,
      })
      .strict(),
    safety_importance: z
      .object({
        /**
         * The query anchored to no node, so the graph supplied no urgency class.
         * Unknown, and therefore 0 — see the note in eligibility-policy-v1.ts
         * about the fabricated "routine" this replaced.
         */
        unknown: FactorScore,
        emergency_possible: FactorScore,
        urgency_possible: FactorScore,
        routine: FactorScore,
      })
      .strict(),
    conversion_value: z
      .object({
        /** The query matched at least one problem node, so there is an honest next step. */
        matched: FactorScore,
        unmatched: FactorScore,
      })
      .strict(),
    local_uniqueness: z
      .object({
        unreviewed: FactorScore,
        present: FactorScore,
        absent: FactorScore,
      })
      .strict(),
    evidence_depth: z
      .object({
        /** No authoritative playbook covers a matched node. */
        no_authored_content: FactorScore,
        /** Covered, but the match confidence is below `min_confidence`. */
        low_confidence: FactorScore,
        /** Covered, confident, and the playbook's own evidence declarations are satisfied. */
        covered: FactorScore,
        /**
         * The match confidence below which a covered node still cannot anchor a
         * page. The last number that was hiding in the gate's source.
         */
        min_confidence: z.number().min(0).max(1),
      })
      .strict(),
  })
  .strict();

export type FactorScores = z.infer<typeof FactorScores>;

const FactorWeights = z
  .object({
    distinct_intent: z.number().positive(),
    demand: z.number().positive(),
    answer_uniqueness: z.number().positive(),
    safety_importance: z.number().positive(),
    conversion_value: z.number().positive(),
    local_uniqueness: z.number().positive(),
    evidence_depth: z.number().positive(),
  })
  .strict();

export type FactorWeights = z.infer<typeof FactorWeights>;

export const EligibilityPolicy = z
  .object({
    policy_id: z.string().regex(/^elig_[a-z0-9_]+_v\d+$/, "policy ids are elig_<slug>_v<N>"),
    schema_version: z.literal(ELIGIBILITY_POLICY_SCHEMA_VERSION),
    /**
     * The score a candidate must clear to be AUTO-APPROVED, or null.
     *
     * null = no score auto-approves; every non-vetoed candidate is returned for
     * a human decision. It is NOT an open gate — see the header, and R2.
     */
    threshold: z.number().min(0).max(100).nullable(),
    /** Per-factor weights. Must sum to 1.0: factors score 0–10, and the gate multiplies the weighted total by 10. */
    weights: FactorWeights,
    /** Demand cut-offs, highest band first. The last band must start at 0 so every non-null estimate lands somewhere. */
    demand_bands: z.array(DemandBand).min(1),
    /** Every raw 0–10 score the gate can award, plus the evidence confidence cut-off. */
    factor_scores: FactorScores,
    /** Why these values are what they are, for whoever tunes them next. */
    rationale: z.string().min(20),
  })
  .strict();

export type EligibilityPolicy = z.infer<typeof EligibilityPolicy>;

/** Structural validation beyond the schema: weights sum to 1, bands are ordered and total. */
export function validateEligibilityPolicy(policy: EligibilityPolicy): string[] {
  const errors: string[] = [];

  const sum = ELIGIBILITY_FACTORS.reduce((acc, f) => acc + policy.weights[f], 0);
  if (Math.abs(sum - 1) > 1e-9) {
    errors.push(`${policy.policy_id}: weights sum to ${sum}, not 1.0 — the [0,100] score scale would be a lie`);
  }

  for (let i = 1; i < policy.demand_bands.length; i += 1) {
    if (policy.demand_bands[i].min_monthly >= policy.demand_bands[i - 1].min_monthly) {
      errors.push(`${policy.policy_id}: demand bands must be ordered highest-first, strictly descending`);
    }
  }
  const last = policy.demand_bands[policy.demand_bands.length - 1];
  if (last.min_monthly !== 0) {
    errors.push(`${policy.policy_id}: the lowest demand band must start at 0, or some estimates score nothing`);
  }

  /**
   * THE DEFAULT-IS-NO RULE, AS A POLICY INVARIANT.
   *
   * The gate's header promises "missing data scores 0, not benefit-of-the-doubt"
   * and "unknown inputs are passed as null and score 0 with a 'no data' reason".
   * That was true of three factors and false of a fourth: an unknown urgency
   * scored 3 with the reason "routine class", asserting a class the graph never
   * supplied.
   *
   * Now that every raw score is data, the promise has to be defended in the data
   * layer too — otherwise the next tune could reintroduce the same lie without
   * touching a line of code. Every branch that means "nobody has looked yet"
   * must be worth exactly nothing.
   */
  const mustBeZero: ReadonlyArray<[string, number]> = [
    ["demand.unknown", policy.factor_scores.demand.unknown],
    ["answer_uniqueness.unreviewed", policy.factor_scores.answer_uniqueness.unreviewed],
    ["safety_importance.unknown", policy.factor_scores.safety_importance.unknown],
    ["local_uniqueness.unreviewed", policy.factor_scores.local_uniqueness.unreviewed],
    ["conversion_value.unmatched", policy.factor_scores.conversion_value.unmatched],
    ["evidence_depth.no_authored_content", policy.factor_scores.evidence_depth.no_authored_content],
  ];
  for (const [name, value] of mustBeZero) {
    if (value !== 0) {
      errors.push(
        `${policy.policy_id}: factor_scores.${name} is ${value}, but it means "no data" and the gate promises unknowns score 0 — benefit of the doubt is exactly what this gate refuses to give`,
      );
    }
  }

  return errors;
}

/** The band a demand estimate falls in. Never called with null — a null estimate has no band, it has a refusal. */
export function bandFor(policy: EligibilityPolicy, monthly: number): DemandBand {
  const band = policy.demand_bands.find((b) => monthly >= b.min_monthly);
  // The schema guarantees a 0-floor band, so this is unreachable; it stays as a
  // typed floor rather than a non-null assertion.
  return band ?? policy.demand_bands[policy.demand_bands.length - 1];
}
