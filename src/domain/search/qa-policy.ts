import { z } from "zod";

/**
 * `policy.page_qa.*` — A06's OWN namespaced sub-block of the runtime
 * SeoFactoryPolicy document (Loop Spec Audit condition C8/C9, coherence report
 * seam 12: "declare A04 the owner of the object, with A05 and A06 owning
 * namespaced sub-blocks they alone write").
 *
 * WHY THIS STORE AND NOT THE A00 PLATFORM POLICY STORE — pre-answer 9, verbatim
 * on the point: SeoFactoryPolicy "is the runtime-editable door-factory policy
 * document ... The A00 store (src/platform/policy/store.ts) is by design a
 * versioned code module ('nothing needs to mutate these without a deploy yet'),
 * so putting A06's thresholds there would make §11's 'change a threshold without
 * a code deploy' DoD unachievable." A06's required-check list, blocker classes
 * and thresholds therefore live HERE, in the document an owner edits through
 * /admin/controls.
 *
 * WHITE-LABEL: THE RULE SET, NOT JUST THE FIXTURES (condition C8). Every field
 * below resolves PER TENANT because the whole block resolves per policy
 * document, and a second client's deployment swaps the document rather than
 * forking A06. Nothing in A06 compiles against one global template or one global
 * check list — `required_checks`, `blocker_checks` and every threshold are read
 * from here at run time.
 *
 * THE DEFAULTS REPRODUCE TODAY'S BEHAVIOUR EXACTLY. `min_heuristic_score: 60`
 * was the literal `score >= 60` in qa.ts; `thin_content_min_chars: 600` was the
 * literal `totalContent < 600`. Nothing about the shipped verdicts changes
 * because these moved.
 */

/**
 * EVERY DETERMINISTIC CHECK A06 CAN RUN, by stable id. The list is the contract
 * between the policy document and the rule set: a required_checks entry naming
 * an id that is not here is a configuration error A06 reports rather than
 * silently ignores (an unrun "required" check is the worst possible failure mode
 * for an inspector).
 */
export const A06_CHECK_IDS = [
  // --- duplication / cannibalization -----------------------------------------
  "duplicate.canonical_path",
  "duplicate.title",
  "duplication.cannibalization",
  // --- content ---------------------------------------------------------------
  "content.intent_answer_present",
  "content.not_thin",
  "content.no_placeholder",
  "content.heuristic_value_score",
  // --- attribution / embeds --------------------------------------------------
  "intake.attribution_matches",
  "component.intake_embed",
  // --- links -----------------------------------------------------------------
  "links.internal_root_relative",
  "links.internal_resolvable",
  "links.body_no_external",
  // --- safety / indexing -----------------------------------------------------
  "safety.urgency_block_present",
  "index.noindex_reason_recorded",
  // --- provenance ------------------------------------------------------------
  "provenance.present",
  // --- template --------------------------------------------------------------
  "template.registered",
  "template.conformance",
  // --- structured data -------------------------------------------------------
  "structured_data.allow_list",
  "structured_data.denied_type",
  "structured_data.no_rating_markup",
  // --- claims / voice (redundant, independent of A05's pre-filter) -----------
  "claims.no_unsupported_language",
  "voice.no_manufactured_urgency",
  "voice.no_directory_framing",
  "voice.no_unsourced_price",
  "claims.no_fabricated_statistic",
  "claims.no_testimonial",
  "voice.unqualified_verification_claim",
  // --- accessibility ---------------------------------------------------------
  "a11y.image_alt_present",
  "a11y.heading_order",
  "a11y.no_second_h1",
  "a11y.link_text_non_empty",
  "a11y.color_contrast",
  "a11y.focus_and_screen_reader",
  // --- performance -----------------------------------------------------------
  "perf.page_weight_proxy",
  "perf.load_time",
] as const;
export type A06CheckId = (typeof A06_CHECK_IDS)[number];

/**
 * The checks whose failure BLOCKS release by default. Everything else is
 * reported at `major`/`minor` and is visible on the owner's queue without
 * stopping a page.
 *
 * TWO DELIBERATE OMISSIONS, both TODO-ASK-OWNER:
 *
 *  - `template.conformance` is NOT a default blocker. No page template is
 *    owner-approved — Melissa, verbatim, "I'm not approving these templates
 *    yet" (pre-answer 2) — so `templateMatchesBlocks` is measured against a
 *    DESCRIPTIVE registry entry, and blocking a page on drift from an
 *    unapproved shape would be treating that shape as approved. A06 promotes it
 *    to a blocker automatically the moment a TemplateSpec carries
 *    `owner_approved: true` (see qa.ts), which is the honest trigger.
 *  - `voice.unqualified_verification_claim` is NOT a blocker. Pre-answer 5
 *    (melissa-park) is explicit: "detect the claim, emit the finding, route to
 *    human review, never auto-pass and never auto-fail, and never invent a
 *    stand-in standard so the check looks decisive." The verification-vocabulary
 *    standard is Master Todo T2-07 (Melissa) and T7-01.
 */
export const DEFAULT_BLOCKER_CHECKS: readonly A06CheckId[] = [
  "duplicate.canonical_path",
  "duplicate.title",
  "duplication.cannibalization",
  "content.intent_answer_present",
  "content.not_thin",
  "content.no_placeholder",
  "content.heuristic_value_score",
  "intake.attribution_matches",
  "component.intake_embed",
  "links.internal_root_relative",
  "links.internal_resolvable",
  "safety.urgency_block_present",
  "index.noindex_reason_recorded",
  "provenance.present",
  "template.registered",
  "structured_data.allow_list",
  "structured_data.denied_type",
  "structured_data.no_rating_markup",
  "claims.no_unsupported_language",
  "voice.no_manufactured_urgency",
  "voice.no_directory_framing",
  "voice.no_unsourced_price",
  "claims.no_fabricated_statistic",
  "claims.no_testimonial",
  "a11y.image_alt_present",
  "a11y.no_second_h1",
  "a11y.link_text_non_empty",
] as const;

/**
 * THE RULES THE AI CRITIC IS HELD TO — as DATA, not as prose compiled into the
 * adapter (condition C8: "white-label the RULE SET, not just the fixtures").
 *
 * These defaults are PRN's canon voice rules, restated as instructions a reviewer
 * can act on. They are DEFAULTS precisely so a second client's deployment can
 * swap them in this document rather than fork A06 — the critic prompt takes its
 * vocabulary from here, and platform/ai/** carries no market vocabulary at all.
 *
 * REDUNDANT ON PURPOSE, like every other A06 check. The deterministic stage
 * already pattern-matches these families and A05 pre-filters them again. A
 * pattern list and a reader that share one implementation fail together on the
 * one input neither covers; three independent passes catch each other's gaps.
 */
export const DEFAULT_CRITIC_RULES: readonly string[] = [
  "The page must answer, on the page itself, the search intent it claims to serve. A page that redirects the question to a form or a phone call has not answered it.",
  "No manufactured urgency: no countdowns, no scarcity, no 'act now', and no implied damage or cost that is not evidenced in the copy itself.",
  "No comparison-shopping or directory framing: the page offers one clear next step, never a browsable list of providers to choose between.",
  "No prices, cost ranges, or money figures of any kind in customer-facing copy.",
  "No claim about anyone's credentials, verification, vetting, licensing or insurance — including implied ones.",
  "No guarantees of outcome, and no superlatives about price or quality.",
  "No ratings, reviews, star markup, or counts of either.",
  "Every factual statement must be something the page's own copy supports. Flag any statement that reads as a fact but is traceable to nothing.",
  "Safety guidance must describe the hazard and what to do about it. It must never be used as a pressure device.",
] as const;

export const PageQaPolicy = z.object({
  /**
   * The critic's rule set, per tenant. Empty means the critic has nothing to
   * check against, which A06 treats as a configuration error rather than a pass.
   */
  critic_rules: z.array(z.string().min(1)).default([...DEFAULT_CRITIC_RULES]),
  /**
   * WHICH CHECKS MUST RUN. Defaults to every id A06 implements. A tenant may
   * narrow this; A06 reports any required id it does not recognise rather than
   * skipping it silently.
   */
  required_checks: z.array(z.string().min(1)).default([...A06_CHECK_IDS]),
  /** WHICH FAILURES BLOCK RELEASE. See DEFAULT_BLOCKER_CHECKS for the two omissions. */
  blocker_checks: z.array(z.string().min(1)).default([...DEFAULT_BLOCKER_CHECKS]),
  /** Was the literal `totalContent < 600` in qa.ts. Same value. */
  thin_content_min_chars: z.number().int().min(0).default(600),
  /** Was the literal `score >= 60` in qa.ts. Same value. */
  min_heuristic_score: z.number().min(0).max(100).default(60),
  /**
   * A06's INDEPENDENT intent-overlap bar (coherence issue 15). Deliberately NOT
   * the shared matcher's 0.7 Jaccard — A06 reimplements the check with its own
   * mechanism and its own threshold, because an inspector calibrated by its
   * subject is not an inspector.
   */
  intent_overlap_threshold: z.number().min(0).max(1).default(0.85),
  /**
   * PAGE WEIGHT PROXY (condition C12). Not a byte count of a rendered response —
   * this repo has vitest and no headless browser, so A06 measures the only thing
   * it honestly can: the markup it was handed. Real transfer weight is reported
   * SKIPPED_NOT_MEASURABLE.
   */
  max_markup_chars: z.number().int().min(1).default(60000),
  /**
   * A06's OWN structured-data allow/deny lists — NOT a read of A05's
   * `page_factory.structured_data`. The inspector keeps its own list for the
   * same reason it keeps its own intent matcher.
   *
   * THE ALLOW LIST SHIPS EMPTY, and that is the ruling, not an oversight: A05's
   * build parked the allow/deny discipline pending Melissa (PRN Information
   * Structure §12.4 is a DESIGN DRAFT). While it is empty, ANY structured-data
   * plan is a blocker. A05 emits `structured_data_plan: null` on every page
   * today, so nothing is blocked in practice — the rule exists before the
   * surface does, which is the only order in which a guardrail is worth
   * anything.
   */
  structured_data_allowed_types: z.array(z.string().min(1)).default([]),
  structured_data_denied_types: z
    .array(z.string().min(1))
    .default([
      "LocalBusiness",
      "HomeAndConstructionBusiness",
      "Plumber",
      "HVACBusiness",
      "Electrician",
      "RoofingContractor",
      "Review",
      "AggregateRating",
      "Rating",
      "Offer",
      "AggregateOffer",
      "PriceSpecification",
      "OpeningHoursSpecification",
    ]),
});
export type PageQaPolicy = z.infer<typeof PageQaPolicy>;

/** The shipped defaults — byte-identical in effect to the literals they replaced. */
export const DEFAULT_PAGE_QA_POLICY: PageQaPolicy = PageQaPolicy.parse({});
