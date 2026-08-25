import { z } from "zod";
import { Id, IsoDateTime, SchemaVersion, UsdAmount } from "@/domain/shared/primitives";

/**
 * AiPolicy — every model knob the owner can change WITHOUT A DEPLOY.
 *
 * ─── WHY THIS DOCUMENT AND NOT ONE OF THE TWO THAT ALREADY EXIST ────────────
 *
 * The repo has two policy mechanisms with opposite properties, and the Loop
 * Spec Audit (A06 pre-answer 9, A01 pre-answer 10) is explicit about the split:
 *
 *   platform/policy/store.ts   A VERSIONED CODE MODULE. Its own shipped test
 *                              asserts every value is a number or a boolean and
 *                              that no key is named like a secret. Changing a
 *                              value is a commit. Model enablement and per-model
 *                              caps must be changeable at 2am without a deploy,
 *                              so they cannot live here.
 *   domain/search/policy.ts    RUNTIME-EDITABLE — the door factory's own
 *                              document, edited through /admin/controls. A04
 *                              owns it; A05 owns `page_factory.*`; A06 owns
 *                              `page_qa.*`. It is the right PATTERN and the
 *                              wrong DOCUMENT: A01's homeowner-intake knobs are
 *                              not SEO factory settings, and filing them there
 *                              would make a door-factory policy the home of the
 *                              customer engine's spend controls.
 *
 * So this is the same PATTERN with its own SCHEMA — exactly what A01 pre-answer
 * 10 prescribes ("A01's knobs need the second pattern with their own schema").
 * One document, one owner-editable file, validated on save.
 *
 * ─── EVERY DEFAULT IS OFF ───────────────────────────────────────────────────
 *
 * `enabled` is false globally AND on every capability. That is not caution
 * theatre: with the flags off, every customer-visible output in this codebase is
 * byte-identical to what shipped before this build, and a test proves it. Turning
 * one on is a deliberate owner act, one capability at a time.
 *
 * ─── EVERY DOLLAR IS TEST ───────────────────────────────────────────────────
 *
 * `budget_figures.is_test_figure` is a LITERAL true, copied from
 * SeoFactoryPolicy's pattern, so a policy document that drops the label does not
 * parse. An unlabelled PRN dollar cannot ship (hard canon rule 4). The vendor's
 * own per-token PRICES are a different class of number and live in models.ts,
 * sourced and dated — see the figure-discipline note there.
 *
 * ─── WHITE-LABEL ────────────────────────────────────────────────────────────
 *
 * `tenant_id` is reserved, default "prn", with no logic around it — the pattern
 * A00 shipped in six modules. A second client's deployment swaps this document;
 * nothing about the port or the wirings forks.
 */

/** The four capability keys this build wires. Policy is keyed by capability, not by agent. */
export const AI_CAPABILITY_KEYS = [
  "classify_home_problem",
  "select_next_clarifier",
  "generate_page_copy",
  "seo.critique_page",
] as const;
export type AiCapabilityKey = (typeof AI_CAPABILITY_KEYS)[number];

export const AiCapabilityPolicy = z.object({
  /**
   * THE PER-CAPABILITY OFF SWITCH. Ships false, always. This is also the
   * per-capability PAUSE the kill switch does not have an engage path for:
   * A00's switch operates at GLOBAL and AGENT scope, and inventing a new scope
   * value was out of scope for this build, so "stop just the page critic without
   * stopping all of A06" is this flag, in a document an owner edits live.
   */
  enabled: z.boolean().default(false),
  /** Which catalogue model answers this capability. A swap is an edit here. */
  model_id: z.string().min(1),
  /** TEST. Refuse any single call whose worst-case estimate exceeds this. */
  max_cost_per_call_usd: UsdAmount,
  /** TEST. Refuse once this capability's spend today has reached this. */
  daily_cap_usd: UsdAmount,
  /**
   * Output ceiling, and therefore the number the pre-call estimate prices
   * against.
   *
   * ⚠ IT IS ALSO A CORRECTNESS SETTING, NOT ONLY A COST ONE, and that was
   * MEASURED rather than reasoned about. The first live smoke on
   * stealth/ox-alpha with a 100-token ceiling returned `finish_reason: length`
   * and NO CONTENT AT ALL: the model spent its entire output budget before
   * emitting the object. The same call at 800 succeeded using 449 output tokens
   * — for a reply with two fields in it. So a ceiling set for cost can silently
   * become a ceiling that makes every call fail validation, and the numbers
   * below are sized from that measurement.
   */
  max_output_tokens: z.number().int().min(1).max(32_000).default(1_200),
});
export type AiCapabilityPolicy = z.infer<typeof AiCapabilityPolicy>;

export const AiPolicy = z
  .object({
    policy_id: Id,
    schema_version: SchemaVersion,
    version: z.number().int().positive(),
    /** Reserved — white-label approval condition (a). Default "prn"; NO tenant logic. */
    tenant_id: z.string().min(1).optional(),
    /**
     * THE MASTER SWITCH ABOVE EVERY CAPABILITY FLAG. Both must be on for any
     * model call to happen anywhere — the same two-key shape A09's auto-repair
     * uses (a master boolean above an already-empty allow-list).
     */
    enabled: z.boolean().default(false),
    /**
     * Per-call wall-clock budget. A model that has not answered by here is a
     * timeout.
     *
     * ⚠ MEASURED, AND IT MATTERS MORE THAN IT LOOKS. The live smoke's trivial
     * two-field call took 13.2 SECONDS on stealth/ox-alpha. This value stays at
     * 30s and is deliberately NOT raised, because A01 runs IN-REQUEST while a
     * homeowner waits: a longer budget would not fix a slow model, it would just
     * make the homeowner wait longer before falling back to a deterministic
     * answer that was always available. The right response to a 13-second model
     * on the intake path is an owner decision about the model, not a bigger
     * timeout here. TODO-ASK-OWNER (Joshua + Melissa).
     */
    request_timeout_ms: z.number().int().min(1_000).max(120_000).default(30_000),
    /**
     * How many times a json_object-mode reply that failed zod validation may be
     * sent back with the error. ONE, deliberately: a second repair is a model
     * that cannot follow the schema, and the deterministic fallback is right
     * there. Zero disables repair entirely.
     */
    max_repair_retries: z.number().int().min(0).max(3).default(1),
    /** TEST. The ceiling across ALL capabilities for one day. */
    global_daily_budget_usd: UsdAmount,
    /**
     * EVERY PRN DOLLAR IS A TEST FIGURE, AND THE SCHEMA SAYS SO. Literal `true`,
     * so a document that drops the label does not parse.
     */
    budget_figures: z
      .object({
        is_test_figure: z.literal(true),
        note: z.string().min(1),
      })
      .default({
        is_test_figure: true,
        note: "TEST figures, not commitments. These caps were set to be small enough that a mistake is cheap, not because anyone priced the work. Vendor per-token prices are a different class of number and are SOURCED and dated in platform/ai/models.ts. TODO-ASK-OWNER (Joshua + Melissa): the real per-request AI cost ceiling is still parked (Loop Spec Audit A01 pre-answer 4).",
      }),
    capabilities: z.record(AiCapabilityPolicy),
    effective_from: IsoDateTime,
  })
  .superRefine((p, ctx) => {
    for (const [key, cap] of Object.entries(p.capabilities)) {
      if (cap.max_cost_per_call_usd > cap.daily_cap_usd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key}: one call may not be allowed to cost more than the whole day's cap`,
          path: ["capabilities", key, "max_cost_per_call_usd"],
        });
      }
      if (cap.daily_cap_usd > p.global_daily_budget_usd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key}: a capability's daily cap may not exceed the global daily budget — the global figure is the brake, not a suggestion`,
          path: ["capabilities", key, "daily_cap_usd"],
        });
      }
    }
  });
export type AiPolicy = z.infer<typeof AiPolicy>;

/**
 * THE SHIPPED DEFAULTS. Everything off; every model the free one; every cap
 * small enough that a mistake is cheap.
 *
 * WHY ox-alpha IS THE DEFAULT MODEL ON ALL FOUR even though two of them can
 * never run on it: the owner picked it, it costs $0, and naming it here is what
 * makes the eventual swap a one-line edit. `classify_home_problem` and
 * `select_next_clarifier` will refuse it on the privacy rule (models.ts seeds
 * `allows_customer_data: false`) and fall back deterministically, saying exactly
 * why — which is a better state than a placeholder model id nobody chose.
 */
export const DEFAULT_AI_POLICY: AiPolicy = AiPolicy.parse({
  policy_id: "ai_policy_default",
  schema_version: "1.0.0",
  version: 1,
  tenant_id: "prn",
  enabled: false,
  request_timeout_ms: 30_000,
  max_repair_retries: 1,
  // TEST. One dollar a day across everything — the same order of magnitude as the
  // shipped max_external_seo_spend_usd_month, and for the same reason: a cap you
  // can blow through by accident is not a cap.
  global_daily_budget_usd: 1,
  capabilities: {
    /**
     * EVERY `max_output_tokens` BELOW IS SIZED FROM THE LIVE SMOKE, 2026-08-25:
     * stealth/ox-alpha spent 449 output tokens answering a two-field schema. A
     * ceiling that looks generous against the SIZE of the answer is not
     * necessarily generous against the tokens the model spends reaching it.
     */
    classify_home_problem: {
      enabled: false,
      model_id: "stealth/ox-alpha",
      max_cost_per_call_usd: 0.02,
      daily_cap_usd: 0.25,
      max_output_tokens: 1_600,
    },
    select_next_clarifier: {
      enabled: false,
      model_id: "stealth/ox-alpha",
      max_cost_per_call_usd: 0.01,
      daily_cap_usd: 0.25,
      // Was 400 — under the measured floor. A cheap-looking ceiling that
      // guarantees `finish_reason: length` is not a saving.
      max_output_tokens: 1_200,
    },
    generate_page_copy: {
      enabled: false,
      model_id: "stealth/ox-alpha",
      max_cost_per_call_usd: 0.05,
      daily_cap_usd: 0.5,
      max_output_tokens: 3_000,
    },
    "seo.critique_page": {
      enabled: false,
      model_id: "stealth/ox-alpha",
      max_cost_per_call_usd: 0.03,
      daily_cap_usd: 0.5,
      max_output_tokens: 2_000,
    },
  },
  effective_from: "2026-08-25T00:00:00Z",
});

export function capabilityPolicy(policy: AiPolicy, key: string): AiCapabilityPolicy | null {
  return policy.capabilities[key] ?? null;
}
