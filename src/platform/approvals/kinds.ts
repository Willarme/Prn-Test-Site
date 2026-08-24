import { z } from "zod";

/**
 * APPROVAL KIND — the Approval Center's item taxonomy. Registered by A08 as
 * dictionary steward (Loop Spec Audit "Loop coherence report", issue 14).
 *
 * WHY IT EXISTS. Four producers are heading for one queue — A04's opportunity
 * decisions, A06's page publishes, A09's repairs and identity merges — and
 * `ApprovalItem` requires agent_id, run_id, impact, risk, reversibility and
 * proposed_change but has no way to say what CLASS of decision the owner is
 * being asked to make. Without this, the owner faces opportunity approvals,
 * page publishes and data repairs in one undifferentiated list. Registering
 * the vocabulary BEFORE the first producer ships is the whole point; A09 is
 * likely the first real producer, ahead of A06.
 *
 * THE CARRIER, and why this one. Two options were on the table: an optional
 * typed field on `ApprovalItem`, or a metadata convention inside the existing
 * free-form `evidence` column. The optional field ships, because:
 *   - it is ADDITIVE under this build's own rule set (pre-answer 3: "adding an
 *     optional field" is additive, never breaking), so every existing item,
 *     reader and test is untouched — an ApprovalItem with no kind still parses,
 *     and a test pins that;
 *   - `evidence` is documented "IDs and summaries only — never raw customer
 *     evidence"; overloading it with control metadata is a worse contract
 *     violation than an optional field, and it would be neither queryable nor
 *     type-checked;
 *   - the database column is added in migration 00009 rather than by editing
 *     the already-committed 00007.
 *
 * The four SEO/data kinds are the coherence report's own list, verbatim. The
 * fifth is A08's, and it is not an invention: A08 routes every change to an
 * already-registered definition here — including its own proposals — so
 * without a kind of its own, the agent that built the taxonomy would be the
 * one agent filing untyped items into it.
 */
export const ApprovalKind = z.enum([
  /** A04: the owner's accept/reject/defer on a SearchOpportunity. */
  "seo.opportunity_decision",
  /** A06: the owner-gated publish of a page. */
  "seo.page_publish",
  /** A09: a proposed data repair. */
  "data.repair",
  /** A09: a proposed identity merge — unconditionally an owner decision. */
  "data.identity_merge",
  /** A08: any change to an already-registered event or metric definition. */
  "dictionary.definition_change",
]);
export type ApprovalKind = z.infer<typeof ApprovalKind>;

export const APPROVAL_KINDS = ApprovalKind.options;
