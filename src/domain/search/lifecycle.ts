import { z } from "zod";

/**
 * IntentPage lifecycle — frozen in Door Wave 0 (SEO_DOORS_VERTICAL_SLICE_SPEC).
 * Publishing requires owner approval during the trial (#14A §15.1, #23 §1.2):
 * QA_PASS -> PUBLISHED is the owner's decision, never an agent's.
 */
export const PAGE_LIFECYCLE_STATUSES = [
  "IDEA",
  "APPROVED",
  "STAGED",
  "QA_PASS",
  "PUBLISHED",
  "REFRESH",
  "RETIRED",
] as const;

export const PageLifecycleStatus = z.enum(PAGE_LIFECYCLE_STATUSES);
export type PageLifecycleStatus = z.infer<typeof PageLifecycleStatus>;

const ALLOWED_TRANSITIONS: Record<PageLifecycleStatus, readonly PageLifecycleStatus[]> = {
  IDEA: ["APPROVED", "RETIRED"],
  APPROVED: ["STAGED", "RETIRED"],
  // QA failure keeps the page STAGED (qa.state = FAIL on the PageSpec) or sends
  // it back to APPROVED for a rebuild.
  STAGED: ["QA_PASS", "APPROVED", "RETIRED"],
  // Owner may publish, bounce back to staging, or retire.
  QA_PASS: ["PUBLISHED", "STAGED", "RETIRED"],
  PUBLISHED: ["REFRESH", "RETIRED"],
  // A refresh re-enters staging so A06 re-checks it before re-publish.
  REFRESH: ["STAGED", "RETIRED"],
  RETIRED: [],
};

export function canTransition(from: PageLifecycleStatus, to: PageLifecycleStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PageLifecycleStatus, to: PageLifecycleStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal page lifecycle transition: ${from} -> ${to}`);
  }
}

/** A04 recommendation for an opportunity. Only NEW is eligible for the new-page quota (#23 §1.2). */
export const OpportunityRecommendation = z.enum(["NEW", "EXPAND", "MERGE", "WATCH", "REJECT"]);
export type OpportunityRecommendation = z.infer<typeof OpportunityRecommendation>;
