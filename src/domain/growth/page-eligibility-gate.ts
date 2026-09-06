import type { CompiledIntent } from "@/domain/growth/search-intent-compiler";
import { bandFor, type EligibilityPolicy } from "@/domain/growth/eligibility-policy";
import { ELIGIBILITY_POLICY_V1 } from "@/domain/growth/eligibility-policy-v1";
import { authoritativePlaybookForNode } from "@/domain/growth/playbooks";
import { unsourcedSections } from "@/domain/growth/service-playbook";
import {
  unmetEvidenceRequirements,
  type EvidenceKind,
} from "@/domain/growth/property-problem-graph";
import { GRAPH_V1, type PropertyProblemGraph } from "@/domain/growth/graph-v1";

/**
 * PAGE ELIGIBILITY GATE — T6-01. Decides whether a page may be BUILT for an
 * intent, scored on seven factors. THE DEFAULT IS NO: any factor that cannot
 * be evidenced holds the page back, and the caller must be able to say WHY a
 * page is refused in one readable line per failed factor.
 *
 * Canon doc 23's rule is the spine: optimize for useful, defensible pages,
 * never page count. A generic page that five other sites could have written is
 * a cost now and a liability later. The gate is deliberately stricter than
 * enthusiasm: missing data scores 0, not benefit-of-the-doubt.
 *
 * THE SEVEN FACTORS (done-when list, scored 0–10 each):
 *  1. distinct_intent      — is this a question no existing page already answers?
 *  2. demand               — is anyone actually searching this way?
 *  3. answer_uniqueness    — can PRN say something here others cannot?
 *  4. safety_importance    — does getting this right genuinely help someone?
 *  5. conversion_value     — does answering connect honestly to the product?
 *  6. local_uniqueness     — is there a local dimension, or is it commodity content?
 *  7. evidence_depth       — is the answer anchored in signed content whose own
 *                            evidence declarations are satisfied?
 *
 * FACTOR 7 IS NAMED FOR WHAT IT MEASURES NOW. It used to be documented as "do
 * the claim's evidence classes clear the Claim Ledger bar?" while reading only
 * a playbook_id and a confidence number — no evidence class was consulted
 * anywhere, and the string "Claim Ledger" appeared in no code path. It now
 * genuinely reads the authoritative playbook's per-section `evidence_kind` and
 * `source` (see service-playbook.ts `unsourcedSections`), so a section that
 * declares a sourced_reference and names no source, or rests on outcome data
 * PRN does not have, refuses the page. The three inputs are: is there signed
 * content, is the match confident enough to anchor it, and are that content's
 * own evidence declarations satisfied.
 *
 * SCORES COME FROM DATA, NOT VIBES. The caller supplies each factor's inputs;
 * unknown inputs are passed as null and score 0 with a "no data" reason —
 * ALL of them, now. safety_importance used to be the exception: a null urgency
 * fell through to the routine branch and scored 3 with the reason "routine
 * class", asserting a safety class the graph had never supplied for a problem
 * the compiler had failed to identify. Unknown urgency scores 0 and says it is
 * unknown. The one input this module computes itself is the evidence check,
 * from the compiled intent's matched nodes and the playbook registry.
 *
 * "AUTHORED CONTENT EXISTS" IS NOT THE CALLER'S TO ASSERT (Josh's ruling R5,
 * 2026-08-28). The gate used to take a boolean for it, which meant the
 * anti-filler veto — the one that stops PRN publishing a page it has nothing to
 * say on — was only as honest as whoever called it. The gate now READS THE
 * PLAYBOOK REGISTRY and defines the term precisely:
 *
 *   authored content exists  ⇔  an AUTHORITATIVE playbook covers a node the
 *                               query matched.
 *
 * A shadow playbook does not count. The consequence is intended, not a bug to
 * work around: with only Tree authoritative today, plumbing and roofing
 * candidates are vetoed. That is the correct answer — PRN has no signed voice
 * for those trades yet, so it has nothing to publish under them. If an override
 * is ever added it may only make the answer STRICTER than the registry's;
 * nothing may make it more permissive.
 *
 * THE TUNING KNOBS ARE NOT IN THIS FILE (Josh's ruling R4, 2026-08-28) — and
 * on the second pass that is finally true. The first pass moved the weights,
 * the demand bands and the threshold to eligibility-policy-v1.ts, and left
 * ELEVEN raw factor scores plus a 0.4 confidence cut-off sitting in this file,
 * which meant "changing what a routine problem class is worth" was still a code
 * edit and a release. Every number the gate can award now comes from
 * `policy.factor_scores`. Grep this file for a bare numeric literal in a score
 * position and you should find none; a test asserts it.
 *
 * This file holds the judgement about WHAT is scored and WHICH branch a
 * candidate falls in. The policy data holds what each branch is worth.
 *
 * THE THRESHOLD IS NULL, AND NULL MEANS A HUMAN DECIDES (Josh's ruling R2,
 * on the OD-5 precedent). It does NOT mean the gate admits everything. Read
 * the decision, not the boolean:
 *
 *   REFUSED_BY_VETO         — one of the three unoutvotable failures. No page.
 *   HUMAN_DECISION_REQUIRED — survived the vetoes, but no threshold exists to
 *                             auto-approve against. A person decides, with the
 *                             score and every factor reason in front of them.
 *   BELOW_THRESHOLD         — a numeric threshold exists and the score missed.
 *   ELIGIBLE                — a numeric threshold exists and the score cleared.
 *
 * `eligible` is true ONLY for ELIGIBLE. While the threshold is null it is
 * always false, because "nobody has decided yet" is not approval.
 *
 * No model call, no I/O, no randomness — the same inputs always produce the
 * same verdict.
 */

export interface EligibilityInput {
  compiled: CompiledIntent;
  /** Set when a page for this exact intent already exists in the registry (query-id or intent-id). */
  existing_page_for_intent: boolean;
  /** Monthly search-volume estimate for the query cluster, or null when unknown. */
  demand_estimate: number | null;
  /**
   * NOT AN INPUT ANY MORE (R5). Whether authored content exists is read from the
   * playbook registry, not asserted by the caller. The field is gone on purpose.
   */
  /** Do competing pages on this intent exist that PRN could not improve on, per review? */
  competitors_indistinguishable: boolean | null;
  /** A local dimension exists (county data, local case, local regulation) — or null when unreviewed. */
  local_dimension: boolean | null;
}

/**
 * What the gate decided, and why in one word. `eligible` is the boolean form of
 * ELIGIBLE and nothing else — a null threshold never produces it.
 */
export type EligibilityDecision =
  | "REFUSED_BY_VETO"
  | "HUMAN_DECISION_REQUIRED"
  | "BELOW_THRESHOLD"
  | "ELIGIBLE";

export interface EligibilityVerdict {
  /** True ONLY when a numeric threshold exists AND the score cleared it. Never true while the threshold is null. */
  eligible: boolean;
  /** The honest four-way answer. Callers should branch on this, not on the boolean. */
  decision: EligibilityDecision;
  /** One line saying why this decision and not another. */
  decision_reason: string;
  /** Weighted total in [0,100]. Always computed and always reported, threshold or no threshold. */
  score: number;
  /** Per-factor detail: score plus the one-line reason. */
  factors: Array<{ factor: string; score: number; reason: string }>;
  /** The threshold the score had to clear, or null when no number has been set. For the audit trail. */
  threshold: number | null;
  /**
   * Claims a page on the matched nodes MAY NOT make yet — the graph's
   * `evidence_needed` entries that no source has met. Not a veto and not a
   * score: the boundary of what the page may say, put in front of the person
   * who decides whether to build it. See withheldClaimsFor.
   */
  withheld_claims: Array<{ node_id: string; claim: string; kind: EvidenceKind }>;
}

/**
 * The auto-approval bar, from the policy DATA — null today (R2).
 *
 * Null is not an open gate. It means no score auto-approves: the vetoes still
 * refuse, and everything else comes back as HUMAN_DECISION_REQUIRED.
 */
export const ELIGIBILITY_THRESHOLD: number | null = ELIGIBILITY_POLICY_V1.threshold;

function scoreDemand(estimate: number | null, policy: EligibilityPolicy): { score: number; reason: string } {
  if (estimate === null) {
    return { score: policy.factor_scores.demand.unknown, reason: "no demand data — refusing to guess (score 0)" };
  }
  const band = bandFor(policy, estimate);
  return { score: band.score, reason: `demand estimate ${estimate}/mo — ${band.label}` };
}

export interface AuthoredContent {
  node_id: string;
  playbook_id: string;
  /**
   * Sections of that playbook whose claims outrun their evidence. Empty means
   * the content's own declarations are satisfied. See service-playbook.ts.
   */
  unsourced: ReturnType<typeof unsourcedSections>;
}

/**
 * The registry's answer, not the caller's (R5): the first matched node covered
 * by an AUTHORITATIVE playbook, if any. Shadow playbooks do not count.
 *
 * The playbook's evidence declarations come back with it, because the gate's
 * claim-safety promise cannot be kept by reading an id alone.
 */
export function authoredContentFor(compiled: CompiledIntent): AuthoredContent | null {
  for (const nodeId of compiled.matched_node_ids) {
    const pb = authoritativePlaybookForNode(nodeId);
    if (pb !== null) {
      return { node_id: nodeId, playbook_id: pb.playbook_id, unsourced: unsourcedSections(pb) };
    }
  }
  return null;
}

/**
 * The claims a page on these nodes MAY NOT make yet — the graph's
 * `evidence_needed` register, read at last.
 *
 * This does NOT veto and does not score, and the distinction matters. These are
 * claims a page is not making; they are the boundary of what it may say. Every
 * node carries at least one unmet sourced_reference requirement (permit rules,
 * insurance specifics, material lifespans), so gating on them would refuse
 * every page PRN could ever build. What they are FOR is the human who makes the
 * build decision — the threshold is null, so a person decides — and this puts
 * the boundary in front of them at the moment they decide.
 */
export function withheldClaimsFor(
  compiled: CompiledIntent,
  graph: PropertyProblemGraph = GRAPH_V1,
): Array<{ node_id: string; claim: string; kind: EvidenceKind }> {
  const out: Array<{ node_id: string; claim: string; kind: EvidenceKind }> = [];
  for (const nodeId of compiled.matched_node_ids) {
    const node = graph.problem_nodes.find((n) => n.node_id === nodeId);
    if (node !== undefined) out.push(...unmetEvidenceRequirements(node));
  }
  return out;
}

function scoreEvidence(
  compiled: CompiledIntent,
  authored: AuthoredContent | null,
  policy: EligibilityPolicy,
): { score: number; reason: string } {
  const s = policy.factor_scores.evidence_depth;
  if (authored === null) {
    return {
      score: s.no_authored_content,
      reason:
        compiled.matched_node_ids.length === 0
          ? "query matched no graph node, so no playbook can cover it — a page would be filler"
          : `no authoritative playbook covers ${compiled.matched_node_ids.join(", ")} — a page would be filler`,
    };
  }
  // The evidence declarations of the content itself. This is the half the
  // header promised and the code never did: a signed playbook whose section
  // claims outrun their sources cannot anchor a page, however confident the
  // match is.
  if (authored.unsourced.length > 0) {
    return {
      score: s.no_authored_content,
      reason: `${authored.playbook_id} covers ${authored.node_id}, but its claims outrun their evidence — ${authored.unsourced
        .map((u) => `${u.section_id} (${u.evidence_kind}): ${u.why}`)
        .join("; ")}`,
    };
  }
  if (compiled.confidence < s.min_confidence) {
    return {
      score: s.low_confidence,
      reason: `matched, but confidence ${compiled.confidence} is below the ${s.min_confidence} cut-off needed to anchor a page`,
    };
  }
  return {
    score: s.covered,
    reason: `${authored.playbook_id} authoritatively covers ${authored.node_id} at match confidence ${compiled.confidence}, and every section's evidence class is satisfied`,
  };
}

export function evaluateEligibility(
  input: EligibilityInput,
  policy: EligibilityPolicy = ELIGIBILITY_POLICY_V1,
): EligibilityVerdict {
  const { compiled } = input;
  const factors: EligibilityVerdict["factors"] = [];

  // Read the registry ONCE, up front (R5). Everything downstream — the evidence
  // factor and the anti-filler veto — uses this answer, never a caller's claim.
  const authored = authoredContentFor(compiled);
  const s = policy.factor_scores;

  // 1. distinct intent
  factors.push(
    input.existing_page_for_intent
      ? { factor: "distinct_intent", score: s.distinct_intent.duplicate, reason: "a page for this intent already exists — a second one is cannibalization" }
      : { factor: "distinct_intent", score: s.distinct_intent.distinct, reason: "no existing page covers this intent" },
  );

  // 2. demand
  const d = scoreDemand(input.demand_estimate, policy);
  factors.push({ factor: "demand", score: d.score, reason: d.reason });

  // 3. answer uniqueness
  factors.push(
    input.competitors_indistinguishable === null
      ? { factor: "answer_uniqueness", score: s.answer_uniqueness.unreviewed, reason: "no competitor review done — cannot claim a unique answer (score 0)" }
      : input.competitors_indistinguishable
        ? { factor: "answer_uniqueness", score: s.answer_uniqueness.indistinguishable, reason: "existing pages already say this — nothing unique to add" }
        : { factor: "answer_uniqueness", score: s.answer_uniqueness.distinguishable, reason: "competitor review found a gap PRN can genuinely fill" },
  );

  // 4. safety importance. The null branch is FIRST and explicit: when the query
  //    anchored to no node the graph supplied no urgency, and an unidentified
  //    problem must not be filed as routine — that was a fabricated class in an
  //    audit trail, not a conservative default.
  factors.push(
    compiled.fields.urgency === null
      ? { factor: "safety_importance", score: s.safety_importance.unknown, reason: "no urgency class — the query anchored to no graph node, so no safety claim is available (score 0)" }
      : compiled.fields.urgency === "emergency_possible"
        ? { factor: "safety_importance", score: s.safety_importance.emergency_possible, reason: "emergency-possible problem class — accurate content genuinely protects someone" }
        : compiled.fields.urgency === "urgency_possible"
          ? { factor: "safety_importance", score: s.safety_importance.urgency_possible, reason: "urgency-possible class — accurate content helps" }
          : { factor: "safety_importance", score: s.safety_importance.routine, reason: "routine class per the matched node — useful but not safety-bearing" },
  );

  // 5. conversion value
  factors.push(
    compiled.matched_node_ids.length > 0
      ? { factor: "conversion_value", score: s.conversion_value.matched, reason: "answering this connects honestly to a Problem Record next step" }
      : { factor: "conversion_value", score: s.conversion_value.unmatched, reason: "no matched problem — nothing honest to route to" },
  );

  // 6. local uniqueness
  factors.push(
    input.local_dimension === null
      ? { factor: "local_uniqueness", score: s.local_uniqueness.unreviewed, reason: "local dimension unreviewed — score 0 until someone looks" }
      : input.local_dimension
        ? { factor: "local_uniqueness", score: s.local_uniqueness.present, reason: "a real local dimension exists" }
        : { factor: "local_uniqueness", score: s.local_uniqueness.absent, reason: "no local dimension — national commodity content" },
  );

  // 7. evidence depth
  const e = scoreEvidence(compiled, authored, policy);
  factors.push({ factor: "evidence_depth", score: e.score, reason: e.reason });

  // Weights sum to 1.0 over 0–10 factors → ×10 puts the total on the promised
  // [0,100] scale. The weights come from the policy DATA, never from here (R4).
  const total = factors.reduce(
    (sum, f) => sum + f.score * policy.weights[f.factor as keyof EligibilityPolicy["weights"]],
    0,
  ) * 10;
  const score = Math.round(total * 10) / 10;

  // VETOES — three failures no amount of other goodness can outvote. A vetoed
  // page is refused even at a high score: cannibalization is cannibalization
  // at any price, filler is filler, and an unanchored query has nothing
  // honest for a page to say. The score still prints, for the audit trail.
  // These survive a null threshold intact — that is the whole reason a null
  // threshold is safe (R2).
  const vetoes: string[] = [];
  if (input.existing_page_for_intent) vetoes.push("a page already covers this intent");
  if (authored === null) vetoes.push("no authoritative playbook covers the matched nodes (registry, not caller)");
  if (compiled.matched_node_ids.length === 0) vetoes.push("the query anchors to no graph node");
  if (authored !== null && authored.unsourced.length > 0) {
    // THE CLAIM-SAFETY VETO. service-playbook.ts has promised since it was
    // written that "a page whose claims outrun their evidence class does not
    // ship"; this is the line that makes it so. A fourth unoutvotable failure:
    // an unsourced factual claim is not a page that scores lower, it is a page
    // that does not go out.
    vetoes.push(
      `the covering playbook's claims outrun their evidence — ${authored.unsourced
        .map((u) => `${authored.playbook_id}/${u.section_id} (${u.evidence_kind})`)
        .join("; ")}`,
    );
  }

  const { threshold } = policy;
  const withheld_claims = withheldClaimsFor(compiled);

  if (vetoes.length > 0) {
    return {
      eligible: false,
      decision: "REFUSED_BY_VETO",
      decision_reason: `refused at any score — ${vetoes.join("; ")}`,
      score,
      factors,
      threshold,
      withheld_claims,
    };
  }

  if (threshold === null) {
    // R2. No number exists to auto-approve against, so nothing is auto-approved.
    // The candidate goes back to a person WITH its score, not through the gate.
    return {
      eligible: false,
      decision: "HUMAN_DECISION_REQUIRED",
      decision_reason: `no eligibility threshold is set, so no score auto-approves; scored ${score}/100 and returned for a human decision`,
      score,
      factors,
      threshold,
      withheld_claims,
    };
  }

  const cleared = score >= threshold;
  return {
    eligible: cleared,
    decision: cleared ? "ELIGIBLE" : "BELOW_THRESHOLD",
    decision_reason: cleared
      ? `scored ${score}/100, clearing the ${threshold} threshold`
      : `scored ${score}/100, below the ${threshold} threshold`,
    score,
    factors,
    threshold,
    withheld_claims,
  };
}
