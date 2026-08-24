/**
 * Canonical event names — #14A §18.2 verbatim (owned by A08), plus documented
 * Door-slice additions. Adding a name here is a contract change: it requires a
 * version bump and appears in the wave gate report.
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
 * A00 platform additions — PROVISIONAL, PENDING A08 RATIFICATION (A00 spec
 * §5: A00 builds the pipe, A08 owns the dictionary; these two strings are
 * not final canonical names until the Metric & Event Steward ratifies them).
 * Added for the kill-switch audit trail: the switch itself is mutable state,
 * so every toggle emits an envelope to keep the HISTORY append-only.
 */
export const PLATFORM_EVENT_NAMES = [
  "platform.kill_switch_engaged",
  "platform.kill_switch_released",
] as const;

export const EVENT_NAMES = [...CORE_EVENT_NAMES, ...SLICE_EVENT_NAMES, ...PLATFORM_EVENT_NAMES] as const;
export type EventName = (typeof EVENT_NAMES)[number];
