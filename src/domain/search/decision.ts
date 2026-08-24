import { z } from "zod";
import { Id, IsoDateTime } from "@/domain/shared/primitives";
import { OpportunityStatus, type SearchOpportunity } from "@/domain/search/contracts";

/**
 * THE OWNER'S DECISION ON A SEARCH OPPORTUNITY — coherence report seams 1+2,
 * the loop's first human gate, unwired until now.
 *
 * WHY THIS FILE EXISTS. The repo carries two enums that read alike and mean
 * opposite things:
 *
 *   OpportunityRecommendation  NEW/EXPAND/MERGE/WATCH/REJECT  — A04's OPINION
 *   OpportunityStatus          candidate/approved/watch/...   — the OWNER'S DECISION
 *
 * Before this build, `status` was read in exactly one place in the entire
 * codebase (recommend.ts `isMergeTarget`), nothing ever wrote "approved", and
 * the page path keyed off the RECOMMENDATION. So an agent's opinion, with no
 * human in between, decided which pages got built. This module is the missing
 * half: the decision itself, as data.
 *
 * APPEND-ONLY, AND DELIBERATELY AN OVERLAY. A decision does NOT rewrite
 * data/factory/opportunities.json. That artifact is committed, reproducible
 * output of `npm run factory`, read by the admin surface AND regenerated
 * wholesale on the next factory run — a click that edited it would be silently
 * reverted, and would also regenerate A05's staged portfolio and A06's QA
 * results as a side effect (Loop Spec Audit condition 13). Decisions are
 * therefore their own append-only records joined onto the opportunity at read
 * time. The current status is a FOLD over the decision history, so the history
 * is the record and nothing is ever overwritten.
 *
 * THE THREE VERBS, and how they land on the shipped status enum — no new
 * vocabulary is invented, because `OpportunityStatus` already has the values:
 *
 *   accept  -> status "approved"  + approved_at / approved_by  -> A05 may build
 *   reject  -> status "rejected"                               -> never builds
 *   defer   -> status "watch"                                  -> decide later
 *
 * Deferral is a real decision with a real record, not the absence of one. That
 * matters: "not yet looked at" (candidate) and "looked at, not now" (watch) are
 * different states for an owner working a queue.
 */

export const OpportunityDecisionKind = z.enum(["accept", "reject", "defer"]);
export type OpportunityDecisionKind = z.infer<typeof OpportunityDecisionKind>;

/** The one mapping from verb to shipped status. Nothing else may define it. */
export const DECISION_STATUS: Record<OpportunityDecisionKind, z.infer<typeof OpportunityStatus>> = {
  accept: "approved",
  reject: "rejected",
  defer: "watch",
};

/**
 * One owner decision. IDs, enum values, scores and a short owner note only —
 * never customer evidence, never a keyword's origin story.
 */
export const OpportunityDecision = z.object({
  decision_id: Id,
  /** Reserved — white-label condition (a). Default "prn"; NO tenant logic. */
  tenant_id: z.string().min(1),
  search_opportunity_id: Id,
  decision: OpportunityDecisionKind,
  /** The status this decision puts the opportunity into — derived, stored for auditability. */
  status_after: OpportunityStatus,
  /** Owner identity as the admin session knows it ("owner" today). */
  decided_by: z.string().min(1),
  decided_at: IsoDateTime,
  /** Optional short owner note. Owner-authored, never customer-derived. */
  note: z.string().max(500).nullable(),
  /** What A04 thought at the moment of the decision — the disagreement is the signal. */
  recommendation_at_decision: z.string().nullable(),
  score_at_decision: z.number().nullable(),
  score_version_at_decision: z.string().nullable(),
  /** Provenance: the Approval Center item and the Agent Run Ledger row. */
  approval_id: z.string().min(1).nullable(),
  run_id: z.string().min(1).nullable(),
});
export type OpportunityDecision = z.infer<typeof OpportunityDecision>;

/**
 * The fold's tie-break, and why it is `>` and not `>=`.
 *
 * Platform timestamps are second-granularity by convention — every A00 module
 * writes `new Date().toISOString().replace(/\.\d+Z$/, "Z")`. An owner who
 * accepts and then immediately rejects produces two decisions with the SAME
 * `decided_at`. With `>=` the reduce keeps the accumulator on a tie, i.e. the
 * FIRST record, so the owner's correction silently lost to the thing they were
 * correcting. Found by test, not by reading.
 *
 * `>` keeps the LATER element of the pair on a tie, and the store is
 * append-only and listed in insertion order, so array order is decision order.
 * Timestamp first, insertion order as the tie-break.
 */
function newest(decisions: readonly OpportunityDecision[]): OpportunityDecision {
  return decisions.reduce((a, b) => (b.decided_at >= a.decided_at ? b : a));
}

/**
 * Fold the decision history for ONE opportunity into its effective status.
 * Latest decision wins; with no decisions the record's own status stands.
 */
export function effectiveStatus(
  opportunity: Pick<SearchOpportunity, "search_opportunity_id" | "status">,
  decisions: readonly OpportunityDecision[]
): z.infer<typeof OpportunityStatus> {
  const mine = decisions.filter(
    (d) => d.search_opportunity_id === opportunity.search_opportunity_id
  );
  if (mine.length === 0) return opportunity.status;
  return newest(mine).status_after;
}

export function latestDecision(
  opportunityId: string,
  decisions: readonly OpportunityDecision[]
): OpportunityDecision | null {
  const mine = decisions.filter((d) => d.search_opportunity_id === opportunityId);
  if (mine.length === 0) return null;
  return newest(mine);
}

/**
 * THE ONE APPROVAL PREDICATE. Every consumer that wants to know "may this
 * become a page" asks here and nowhere else.
 *
 * It reads `status`, NEVER `recommendation`. A recommendation of "NEW" on a
 * record whose status is "candidate" is A04 saying "this looks good" — it is
 * not the owner saying yes, and treating it as one is precisely the open gate
 * this build closes.
 */
export function isOwnerApproved(
  opportunity: Pick<SearchOpportunity, "search_opportunity_id" | "status">,
  decisions: readonly OpportunityDecision[] = []
): boolean {
  return effectiveStatus(opportunity, decisions) === "approved";
}

/**
 * Apply a decision to an opportunity record, returning the updated record.
 * Pure — the caller persists. `approved_at`/`approved_by` are set on accept and
 * CLEARED on anything else, so a record can never carry an approval stamp while
 * sitting in a non-approved status.
 */
export function applyDecision(
  opportunity: SearchOpportunity,
  decision: OpportunityDecision
): SearchOpportunity {
  const accepted = decision.decision === "accept";
  return {
    ...opportunity,
    status: decision.status_after,
    approved_at: accepted ? decision.decided_at : null,
    approved_by: accepted ? decision.decided_by : null,
    updated_at: decision.decided_at,
  };
}

/** The event A08 registered for each verb. NEVER assembled from a variable. */
export function decisionEventName(kind: OpportunityDecisionKind): string {
  switch (kind) {
    case "accept":
      return "seo.opportunity_accepted";
    case "reject":
      return "seo.opportunity_rejected";
    case "defer":
      return "seo.opportunity_deferred";
  }
}
