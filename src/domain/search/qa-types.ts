/**
 * A06's result contract — `PageQAResult`, GROWN FROM the shipped `QaResult`
 * rather than forked beside it (Loop Spec Audit condition C2 / pre-answer 6:
 * "Extend, do not fork. Grow QaResult into PageQAResult in place ... Creating a
 * second type beside the first is how two QA truths and two publish gates get
 * born").
 *
 * The four original `QaResult` fields — `page_spec_id`, `state`, `reasons`,
 * `user_value_score` — are still here, still mean what they meant, and are still
 * what `tools/run-factory.ts`, the admin queue and the publish route read. The
 * fifth, `critic_ran`, is GONE: it was set `true` by a pure heuristic
 * (`fixtureCritic`), which is precisely the dishonest critic A06's own spec
 * forbids (condition C3, pre-answer 7). What replaced it is
 * `ai_critic.status = "SKIPPED_NO_MODEL"` plus `heuristic_score`, which say the
 * two true things the one boolean was conflating.
 *
 * THE TYPES LIVE IN THEIR OWN MODULE so the check implementations
 * (qa-accessibility, qa-critic) and the rule set (qa.ts) can share them without
 * an import ring. `qa.ts` re-exports everything here, so every existing
 * `from "@/domain/search/qa"` import keeps working unchanged.
 */

/** The verdict vocabulary the PageSpec's `qa.state` has always used. */
export type QaVerdict = "PASS" | "FAIL";

/**
 * A check's outcome. `SKIPPED_NOT_MEASURABLE` is condition C12's honest answer
 * for anything that needs a browser: this repo has vitest and no headless
 * browser, no axe, nothing that can measure contrast or load time. A skipped
 * check is REPORTED as skipped — it never silently passes and it never fakes a
 * measurement.
 */
export type QaCheckStatus = "PASS" | "FAIL" | "SKIPPED_NOT_MEASURABLE";

/**
 * `blocker` stops release. `major` and `minor` are reported on the owner's queue
 * and alone do not stop a page. An explicit critic FAIL still stops release.
 * Which checks sit in which class is per-tenant policy
 * (`policy.page_qa.blocker_checks`), never a hardcoded constant.
 */
export type QaSeverity = "blocker" | "major" | "minor";

export interface QaFinding {
  /** Stable check id from A06_CHECK_IDS — the join key for every downstream report. */
  check: string;
  severity: QaSeverity;
  /** Where it was found: a block_id or a field name. IDs and field names ONLY. */
  where: string;
  /**
   * What is wrong, in words. Quotes at most the matched fragment — never a
   * customer string, because a PageSpec carries no customer data by contract.
   */
  message: string;
  /**
   * What A05 should do about it. This is the repair-and-rerun loop that makes
   * first-pass rate mean anything; null when the finding is informational.
   */
  repair_instructions: string | null;
}

export interface QaSkippedCheck {
  check: string;
  status: "SKIPPED_NOT_MEASURABLE";
  /** Why it cannot be measured here, and what would be needed to measure it. */
  why: string;
}

export interface DeterministicStageResult {
  state: QaVerdict;
  /** Every check id that actually ran. */
  checks_run: string[];
  /** Every check that could not run, with the reason. Never silently absent. */
  checks_skipped: QaSkippedCheck[];
  /**
   * Required check ids from policy that A06 does not implement. An unrun
   * "required" check is the worst failure mode an inspector has, so it is
   * surfaced rather than ignored.
   */
  unknown_required_checks: string[];
  findings: QaFinding[];
}

/**
 * `SKIPPED_NO_MODEL` is the ONLY status any real page gets today, and that is
 * the point (condition C3/C4). `NOT_RUN` is different and also honest: the
 * deterministic stage already returned a blocker, so no critic was paid for a
 * page that was already failing (#23 §2.4/§8.3), or the gateway refused the
 * call. Neither is ever treated as PASS.
 */
export type AiCriticStatus = "PASS" | "FAIL" | "SKIPPED_NO_MODEL" | "NOT_RUN";

export interface AiCriticStageResult {
  status: AiCriticStatus;
  /** Why this status — always populated, including on PASS. */
  reason: string;
  findings: QaFinding[];
  /** The gateway's provider label when a call actually happened; null otherwise. */
  provider: string | null;
  /** TEST-labeled internal figure, never customer-facing. null when nothing ran. */
  cost_usd: number | null;
  latency_ms: number | null;
}

/**
 * `BLOCKED_PENDING_AI` is retained as the honest label for a deterministic-only
 * PASS while no critic exists — pre-answer 1 point (3), verbatim: "rather than
 * reusing PASS". It does NOT mean the page is ineligible: a human still
 * publishes every page, so `release_eligible` may be true while `overall` reads
 * BLOCKED_PENDING_AI, and the owner's queue shows both.
 */
export type QaOverall = "PASS" | "FAIL" | "BLOCKED_PENDING_AI";

export interface PageQAResult {
  page_spec_id: string;
  /**
   * Reserved — white-label condition C7. Default "prn"; NO tenant logic exists.
   * Optional so a result computed from a spec that predates tenancy still
   * carries the same shape.
   */
  tenant_id?: string;
  /** Which version of A06's rule set produced this verdict. */
  rule_set_version: string;
  deterministic: DeterministicStageResult;
  ai_critic: AiCriticStageResult;
  overall: QaOverall;
  /** Findings whose severity is `blocker`. Explicit critic FAIL can also stop release. */
  blockers: QaFinding[];
  /**
   * THE ONE RELEASE SIGNAL (condition C10, coherence issue 6). The publish route
   * reads exactly this, through `evaluateReleaseForPublish`. Never a second gate
   * beside `qa.state` — `qa.state` is DERIVED from the same verdict.
   */
  release_eligible: boolean;
  /** Why release_eligible is what it is. Populated on true as well as false. */
  release_reasons: string[];

  /* --- the shipped QaResult fields, unchanged in meaning ------------------- */
  /** PASS/FAIL written onto `PageSpec.qa.state`. A06 is its sole writer. */
  state: QaVerdict;
  /** Written onto `PageSpec.qa.reasons`: blockers and explicit critic failure details. */
  reasons: string[];
  /** Written onto `PageSpec.user_value_score`. */
  user_value_score: number | null;
  /**
   * The DETERMINISTIC HEURISTIC score (pre-answer 7). Same function that used to
   * be called `fixtureCritic`, reported as what it is. It feeds
   * `user_value_score`, which `SeoFactoryPolicy.min_user_value_score` gates on —
   * it is NOT a critic judgment and never sets `ai_critic.status`.
   */
  heuristic_score: number | null;
}

/**
 * BACK-COMPAT ALIAS. `contracts://search/QaResult[]` was the registered output
 * of capability `seo.qa_candidate_pages`; the registry entry is updated to
 * `PageQAResult[]` in the same change (condition C2). This alias keeps any
 * remaining `QaResult` reference compiling against the grown type rather than a
 * second, stale one.
 */
export type QaResult = PageQAResult;
