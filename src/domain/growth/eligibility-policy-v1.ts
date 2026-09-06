import {
  EligibilityPolicy,
  validateEligibilityPolicy,
  type EligibilityPolicy as EligibilityPolicyType,
} from "@/domain/growth/eligibility-policy";

/**
 * ELIGIBILITY POLICY v1 — the authored data. Edit THIS to retune the gate; no
 * code change is needed, and none should be made (Josh's ruling R4).
 *
 * Every value here is carried over unchanged from the constants that used to
 * live inside page-eligibility-gate.ts. The move was the point; the numbers
 * were deliberately left alone until A04 produces real demand data.
 *
 * Validated at module load, like the graph and the playbooks: a policy whose
 * weights do not sum to 1, or whose demand bands leave a gap, fails at import
 * rather than skewing a score quietly three months from now.
 */
const POLICY: EligibilityPolicyType = {
  policy_id: "elig_page_v1",
  schema_version: "1.0.0",

  // NULL, per R2. Not "no bar" — no AUTO-APPROVAL. Vetoes still refuse;
  // everything else comes back to a human with its score attached. See the
  // header of eligibility-policy.ts, and OD-5's precedent.
  threshold: null,

  weights: {
    distinct_intent: 0.2,
    demand: 0.15,
    answer_uniqueness: 0.2,
    safety_importance: 0.1,
    conversion_value: 0.1,
    local_uniqueness: 0.1,
    evidence_depth: 0.15,
  },

  demand_bands: [
    { min_monthly: 100, score: 8, label: "real cluster" },
    { min_monthly: 20, score: 5, label: "thin but present" },
    { min_monthly: 0, score: 2, label: "below meaningful" },
  ],

  /**
   * The eleven raw factor scores and the confidence cut-off, carried over from
   * the constants that were still hardcoded inside page-eligibility-gate.ts
   * after the first R4 pass moved only the weights and the bands.
   *
   * ONE VALUE DELIBERATELY CHANGED, and it is the reason this half mattered:
   * safety_importance had NO unknown branch. When the query matched no node the
   * graph supplied no urgency, control fell through to the routine case, and
   * the gate scored 3 with the reason "routine class — useful but not
   * safety-bearing" — asserting a safety class about a problem it had failed to
   * identify. That is a fabricated fact in an audit trail, the same defect
   * class as the geography guessing. `unknown` is 0, and
   * validateEligibilityPolicy refuses any policy that sets it otherwise.
   */
  factor_scores: {
    distinct_intent: { duplicate: 0, distinct: 9 },
    demand: { unknown: 0 },
    answer_uniqueness: { unreviewed: 0, indistinguishable: 1, distinguishable: 8 },
    safety_importance: { unknown: 0, emergency_possible: 9, urgency_possible: 6, routine: 3 },
    conversion_value: { matched: 7, unmatched: 0 },
    local_uniqueness: { unreviewed: 0, present: 8, absent: 3 },
    evidence_depth: { no_authored_content: 0, low_confidence: 4, covered: 9, min_confidence: 0.4 },
  },

  rationale:
    "Weights and bands are the T6-01 build's originals, moved out of code unchanged (R4): retuning them before A04 supplies real demand numbers would be guessing twice. The eleven raw factor scores and the 0.4 evidence confidence cut-off moved on the second pass, which is what made R4's 'this file holds no numbers' claim actually true; they too are the originals, with one exception — safety_importance.unknown is a NEW branch scoring 0, replacing a fall-through that scored an unidentified problem as 'routine' and said so in the audit trail. The threshold is null (R2) because the gate's reachable range on today's inputs is about 34 to 83.5, so any number between roughly 48 and 76 would change nothing about a real candidate while reading like a decision. A number goes here when real scores exist.",
};

const PARSED = EligibilityPolicy.parse(POLICY);

const POLICY_ERRORS = validateEligibilityPolicy(PARSED);
if (POLICY_ERRORS.length > 0) {
  throw new Error(`eligibility policy failed validation: ${POLICY_ERRORS.join("; ")}`);
}

export const ELIGIBILITY_POLICY_V1: EligibilityPolicyType = PARSED;
