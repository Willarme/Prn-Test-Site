/**
 * Canonical event names — #14A §18.2 verbatim (owned by A08), plus documented
 * Door-slice additions. Adding a name here is a contract change: it requires a
 * version bump and appears in the wave gate report.
 *
 * A08 NOTE (2026-08-24): this file is now the GENERATED-SHAPE SEED ARTIFACT and
 * the compile-time union, per Loop Spec Audit pre-answer 10 — the authority is
 * the EventDefinition registry (dictionary.ts, table `event_definition` in
 * migration 00009). Every name below has a seeded EventDefinition row; a name
 * here with no row, or a row for a name not here, is a test failure. TypeScript
 * keeps catching typos while the dictionary itself becomes data — and a
 * white-label deployment swaps a seed file rather than agent code.
 */
export const CORE_EVENT_NAMES = [
  "page.viewed",
  "intake.started",
  "intake.evidence_added",
  "intake.clarifier_asked",
  "intake.clarifier_answered",
  "safety.triggered",
  "problem.created",
  "problem.updated",
  "packet.generated",
  "packet.viewed",
  "packet.downloaded",
  "packet.share_opened",
  "customer_lite.claim_offered",
  "customer_lite.claimed",
  "trust.request_created",
  "trust.share_opened",
  "trust.response_submitted",
  "trust.no_provider",
  "trust.good_neighbor_offered",
  "trust.good_neighbor_contributed",
  "trust.good_neighbor_skipped",
  "home_person.offer_shown",
  "home_person.saved",
  "provider.autocomplete_selected",
  "provider.manual_created",
  "provider.match_candidate",
  "provider.merged",
  "provider.review_required",
  "provider.recommendation_shown",
  "provider.show_another",
  "feature_lab.viewed",
  "feature_lab.cta",
  "feature_lab.thumb",
  "feature_lab.email",
  "consent.granted",
  "consent.revoked",
  "message.sent",
  "message.delivered",
  "message.failed",
  "message.opted_out",
  "page.draft_created",
  "page.qa_passed",
  "page.published",
  "capability.invoked",
  "capability.denied",
  "action.requested",
  "action.attempted",
  "action.reconciled",
  "agent.run_started",
  "agent.run_completed",
  "agent.run_failed",
  "data_quality.issue_detected",
  "data_quality.quarantined",
  "ai_readiness.check_completed",
  "ai_readiness.regression_blocked",
  "transition_signal.recorded",
] as const;

/** Door-slice additions (per #23 autonomous SEO + economics; documented in DECISIONS.md). */
export const SLICE_EVENT_NAMES = [
  "seo.opportunity_created",
  "seo.opportunity_scored",
  "seo.metrics_refreshed",
  "seo.search_console_ingested",
  "seo.budget_exhausted",
  "page.staged",
  "page.qa_failed",
  "page.refreshed",
  "page.retired",
  "economics.cost_recorded",
  "economics.revenue_recorded",
] as const;

/**
 * A00 platform additions — RATIFIED BY A08, 2026-08-24 (Loop Spec Audit
 * pre-answer 14: "Ratify them as-is"). A00 added these two provisionally for
 * the kill-switch audit trail — the switch itself is mutable state, so every
 * toggle emits an envelope to keep the HISTORY append-only — and deferred the
 * naming call to the Metric & Event Steward rather than inventing a family.
 *
 * A08's ruling: KEEP BOTH VERBATIM. They already satisfy the shipped
 * domain.action convention, they carry a real audit trail nothing else
 * carries, and renaming them would cost a migration for no gain. They are
 * seeded as `approved` EventDefinitions in dictionary.ts like every other
 * canonical name; the word "provisional" no longer applies to them anywhere.
 */
export const PLATFORM_EVENT_NAMES = [
  "platform.kill_switch_engaged",
  "platform.kill_switch_released",
] as const;

/**
 * A08's own six emitted names — canon-named in the A08 spec §5 ("canon-named,
 * verbatim, do not rename") and REQUIRED here before A08 can emit anything at
 * all: `emitPlatformEvent` types its input against this list, so a steward
 * event whose name is absent cannot typecheck (Loop Spec Audit condition 8).
 *
 * These describe the dictionary's own lifecycle, never customer activity.
 */
export const STEWARD_EVENT_NAMES = [
  "schema.proposed",
  "schema.approved",
  "event.deprecated",
  "metric.created",
  "metric.versioned",
  "compatibility.failed",
] as const;

/**
 * LOOP-SEAM registrations — A08 ruling, 2026-08-24, on the cross-spec
 * coherence report (Loop Spec Audit "Loop coherence report", issues 1, 3, 4,
 * 9, 10 and 14). These are names OTHER agents' specs depend on; A08 registers
 * them now, before those agents build, so A04/A05/A06 emit what the dictionary
 * carries instead of minting a competing family that A08 is asked to ratify
 * after the fact.
 *
 *  - seo.opportunity_accepted / _rejected / _deferred — the owner's decision
 *    on a SearchOpportunity (coherence issue 1). A04 §5 proposed a `search.*`
 *    family; the shipped dictionary already uses `seo.*` for every other
 *    opportunity event, so the seo.* family wins and `search.*` is NOT
 *    registered. One family, not two.
 *  - page.defect_found / page.defect_repaired — A06 §5 specified these
 *    unprefixed (`defect_found`, `defect_repaired`), which fails the shipped
 *    domain.action regex outright (coherence issue 3). Prefixed to `page.`,
 *    matching the page.qa_failed / page.qa_passed names already shipping.
 *  - seo.page_performance_recorded — the RETURN-LEG carrier (coherence issue
 *    10). Registered with NO producer today, deliberately: context keys
 *    page_id, search_opportunity_id, window, impressions, clicks,
 *    avg_position, source. PageSpec.search_opportunity_id is already
 *    populated, so the day Search Console is wired the loop closes with no
 *    schema change. Its EventDefinition documents the context contract.
 */
export const LOOP_SEAM_EVENT_NAMES = [
  "seo.opportunity_accepted",
  "seo.opportunity_rejected",
  "seo.opportunity_deferred",
  "page.defect_found",
  "page.defect_repaired",
  "seo.page_performance_recorded",
] as const;

/**
 * A09 DATA-QUALITY additions — registered by A09's build, 2026-08-24, through
 * A08's machinery rather than beside it. FLAGGED FOR OWNER RATIFICATION.
 *
 * WHAT WAS ALREADY HERE. `data_quality.issue_detected` and
 * `data_quality.quarantined` ship in CORE_EVENT_NAMES (14A §18.2) and A09 emits
 * those unchanged — including for reconciliation mismatches, which are the same
 * finding under a `kind` discriminator, not a second family. Nothing about the
 * issue/quarantine half of A09 needed a new name.
 *
 * WHY THESE FOUR EXIST ANYWAY. A09's Definition of Done requires an owner to
 * approve or reject a proposed repair and requires the corresponding event to
 * fire either way; with no repair name registered, the repair half of the agent
 * is unobservable. Canon doc 20 §A09 names five events
 * (`data.quality_issue`, `reconciliation.mismatch`, `repair.proposed`,
 * `repair.executed`, `repair_verified`). None is registered here, and
 * `repair_verified` fails the shipped domain.action regex outright
 * (tests/events.registry.test.ts). Rather than mint canon's `repair.*` family
 * as a SECOND vocabulary alongside the `data_quality.*` one already shipping —
 * exactly the metric drift A09 exists to detect — the repair lifecycle is
 * registered INSIDE the existing `data_quality.` domain:
 *
 *   canon doc 20            registered here
 *   repair.proposed    ->   data_quality.repair_proposed
 *   repair.executed    ->   data_quality.repair_executed
 *   repair_verified    ->   data_quality.repair_verified   (dot restored)
 *
 * `data_quality.quarantine_released` is the fourth and pairs with the shipped
 * `data_quality.quarantined`, on the precedent A00 set with
 * platform.kill_switch_engaged / _released: a marker's current status is
 * mutable state, so both edges are evented to keep the HISTORY append-only. A
 * release changes which rows KPI reads include, so a release that left no
 * record would be a silent restatement of every number.
 *
 * NO REJECTION EVENT. An owner rejecting a repair is recorded as the
 * ApprovalItem's own REJECTED status plus a new append-only finding version on
 * the issue — the decision already has a durable home, and a name registered
 * for it would be a fifth thing to ratify for no added visibility.
 *
 * TODO-ASK-OWNER (Joshua): ratify these four spellings, or rule that canon doc
 * 20's `repair.*` family is the one of record — in which case A08 deprecates
 * these forward rather than A09 renaming anything itself.
 */
export const A09_EVENT_NAMES = [
  "data_quality.quarantine_released",
  "data_quality.repair_proposed",
  "data_quality.repair_executed",
  "data_quality.repair_verified",
] as const;

export const EVENT_NAMES = [
  ...CORE_EVENT_NAMES,
  ...SLICE_EVENT_NAMES,
  ...PLATFORM_EVENT_NAMES,
  ...STEWARD_EVENT_NAMES,
  ...LOOP_SEAM_EVENT_NAMES,
  ...A09_EVENT_NAMES,
] as const;
export type EventName = (typeof EVENT_NAMES)[number];
