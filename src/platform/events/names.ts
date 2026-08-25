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

/**
 * A01 CUSTOMER PROBLEM INTELLIGENCE — registered by A01's build, 2026-08-25,
 * through A08's machinery rather than beside it. FLAGGED FOR OWNER RATIFICATION.
 *
 * ─── ONE NAME. THE OTHER FIVE WERE ALREADY HERE. ───────────────────────────
 *
 * A01's spec proposes six event names, none of which exist in this file. Five of
 * them are synonyms of names this dictionary already carries, so A01 emits the
 * shipped ones and mints nothing (Loop Spec Audit A01 condition 1, pre-answer
 * 12 — "A01 should be stricter, not looser, than the platform was"):
 *
 *   spec §5                    emitted instead
 *   problem.intake_started ->  intake.started
 *   clarification.asked    ->  intake.clarifier_asked
 *   clarification.answered ->  intake.clarifier_answered
 *   safety.flagged         ->  safety.triggered
 *   problem.classified     ->  problem.created / problem.updated
 *
 * ─── WHY THE SIXTH IS REAL AND NOT A SIXTH SYNONYM ─────────────────────────
 *
 * `problem.fact_extracted` has no ratified equivalent, and the gap is not
 * cosmetic. Every other name above records something that happened to a REQUEST
 * — it started, a question was asked, a record was written. This one records
 * that a durable FactClaim now exists: a specific assertion, traceable to
 * specific evidence, with a provenance and a confidence of its own. Folding it
 * into `problem.updated` would make "we established a fact" and "a field on the
 * record changed" the same event, and the first is the one the data-moat and
 * data-quality lanes need to count. A01's own success metric ("useful unique
 * fields captured") has no instrument without it.
 *
 * It is deliberately NOT `fact.extracted`: a top-level `fact.` domain would be a
 * new family for one name, and the claim belongs to a problem. `problem.` is the
 * domain already shipping `problem.created` / `problem.updated`, and the name
 * passes the shipped domain.action regex.
 *
 * CONTEXT CARRIES IDS ONLY — claim_id, problem_id, claim_class, provenance. The
 * fact's VALUE is a homeowner's own words about their home and never travels in
 * an envelope; the definition in dictionary.ts states the required keys.
 *
 * TODO-ASK-OWNER (Joshua): ratify this spelling, or rule that A01's proposed
 * `problem.fact_extracted` should be renamed — in which case A08 deprecates it
 * forward rather than A01 renaming anything itself.
 */
export const A01_EVENT_NAMES = ["problem.fact_extracted"] as const;

/**
 * A02 CUSTOMER VALUE / JOB PACKET — registered by A02's build, 2026-08-25,
 * through A08's machinery rather than beside it. FLAGGED FOR OWNER RATIFICATION.
 *
 * ─── TWO NAMES. THE THIRD ONE THE SPEC ORDERS IS A SYNONYM. ────────────────
 *
 * A02's spec orders three events emitted that this dictionary does not carry.
 * Only two of them are real gaps (Loop Spec Audit A02 condition 2, pre-answer 7;
 * Trial Spec Audit §3 "A02 (2)"):
 *
 *   spec §5 / §7            registered here
 *   problem.intake_completed  ->  problem.intake_completed   NEW — A02's own trigger
 *   packet.regenerated        ->  packet.regenerated         NEW — the version chain
 *   packet.shared             ->  packet.share_opened        ALREADY SHIPPED; NOT MINTED
 *
 * `packet.shared` is deliberately absent. The dictionary has carried
 * `packet.share_opened` since #14A §18.2, it means the same moment, and minting
 * a second spelling would create exactly the two-vocabularies-for-one-thing
 * drift A09 exists to detect. A test asserts `packet.shared` never appears.
 *
 * ─── WHY problem.intake_completed IS NOT A SYNONYM OF packet.generated ─────
 *
 * They fire microseconds apart today and they are still different facts.
 * `packet.generated` says an artifact now exists. `problem.intake_completed`
 * says the HOMEOWNER finished — they stopped answering and the system had
 * enough to proceed. The completion stage of the funnel is measured on the
 * second, not the first: a packet generated for a person who abandoned the
 * flow, and a packet generated for a person who finished it, are the same
 * `packet.generated` and must never be the same completion number. A07's
 * bottleneck walk has no edge at this stage without it, and events cannot be
 * backfilled — a trial run without this name is a trial with no completion
 * baseline, permanently.
 *
 * ─── WHY packet.regenerated IS NOT packet.generated WITH A FLAG ────────────
 *
 * Regeneration is the customer telling us the first packet was not good
 * enough — they went back, changed an answer, and asked again. That is the
 * highest-signal negative feedback the trial can collect, and A02's own success
 * metric (regeneration rate) is uncomputable if it is folded into the
 * generation count. The Agent Run Ledger's `trigger` field additionally records
 * it, so nothing is lost if A08 later rejects this spelling.
 *
 * CONTEXT CARRIES IDS ONLY — problem_id, request_id, job_packet_id,
 * packet_version. Nothing a homeowner typed travels in an envelope.
 *
 * TODO-ASK-OWNER (Joshua): ratify these two spellings, or rule otherwise — in
 * which case A08 deprecates them forward rather than A02 renaming anything.
 */
export const A02_EVENT_NAMES = [
  "problem.intake_completed",
  "packet.regenerated",
] as const;

export const EVENT_NAMES = [
  ...CORE_EVENT_NAMES,
  ...SLICE_EVENT_NAMES,
  ...PLATFORM_EVENT_NAMES,
  ...STEWARD_EVENT_NAMES,
  ...LOOP_SEAM_EVENT_NAMES,
  ...A09_EVENT_NAMES,
  ...A01_EVENT_NAMES,
  ...A02_EVENT_NAMES,
] as const;
export type EventName = (typeof EVENT_NAMES)[number];
