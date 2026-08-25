import type { StructuredOutputMode } from "@/platform/ai/provider";

/**
 * MODEL CONFIG AS DATA — so swapping a model is an edit here, never a code
 * change anywhere else.
 *
 * The owner's direction is explicit that the model will move ("maybe deepseek,
 * we will probably change it at some point"). Everything a swap needs is in this
 * file: the id, how it takes structured output, what it costs, how much context
 * it has, and whether it may see customer data. `callModel` reads all five from
 * here and from the runtime policy; no capability wiring names a model.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * FIGURE DISCIPLINE — two kinds of number, and they are not interchangeable.
 * This follows the rule platform/economics/rates.ts already wrote down:
 *
 *   VENDOR-SOURCED (this file). A third party's published price. It is a FACT
 *   about the world, quoted with the date it was read, and must NEVER be
 *   labelled TEST as if a build session invented it. Every price below came from
 *   one live probe of GET https://openrouter.ai/api/v1/models on 2026-08-25.
 *
 *   PRN-OWN (platform/ai/policy.ts). Our caps, budgets and ceilings. Those ARE
 *   TEST figures, never commitments, and the policy schema refuses to parse
 *   without the label.
 *
 * DERIVED SPEND IS ALWAYS TEST. A dollar figure this system PRODUCES — an
 * estimate, a recorded call cost, a day's total — is a PRN figure computed from
 * a vendor fact, so `TEST_FIGURE_LABEL` travels with it onto the ledger row and
 * into every report. See callModel.ts.
 *
 * ⚠ RE-PROBE BEFORE ANY REAL-MONEY DECISION. This is a marketplace of ~419
 * models whose prices vary per model and change without notice. A stale price
 * silently under-estimates every call, which is precisely how a cap gets blown.
 * `npm run ai:models` re-probes the live catalogue and prints the drift against
 * this file; it changes nothing on its own, because a price edit should be a
 * commit somebody can read.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The date every price and capability flag below was read from the live API. */
export const MODEL_CATALOGUE_PROBED_AT = "2026-08-25";
export const MODEL_CATALOGUE_SOURCE =
  "GET https://openrouter.ai/api/v1/models (live probe, 419 models)";

/** Stamped on every PRN-derived dollar figure — estimates, call costs, day totals. */
export const TEST_FIGURE_LABEL = "TEST";

export interface ModelConfig {
  /** The provider's own model identifier, passed through verbatim. */
  id: string;
  /** Which provider serves it. One provider today; the field is what makes a second one a data edit. */
  provider: "openrouter";
  /** How this model takes a schema. A CONFIG value — never guessed at call time. */
  mode: StructuredOutputMode;
  /** VENDOR-SOURCED, per million prompt tokens, as of MODEL_CATALOGUE_PROBED_AT. */
  price_in_per_mtok: number;
  /** VENDOR-SOURCED, per million completion tokens, as of MODEL_CATALOGUE_PROBED_AT. */
  price_out_per_mtok: number;
  /** VENDOR-SOURCED context window in tokens. */
  context: number;
  /**
   * MAY THIS MODEL SEE RAW HOMEOWNER TEXT?
   *
   * Ships FALSE on every model, and that is the ruling rather than an oversight.
   * Whether a given vendor's retention and training terms are acceptable for a
   * homeowner's own words is a data-processing decision with legal weight — it
   * belongs to the owners, not to a build session, and the fail-closed default
   * costs nothing while it is unanswered.
   *
   * Free and stealth models are generally free BECAUSE prompts may be retained,
   * so `stealth/ox-alpha` would be false on the evidence alone even if the
   * default were open.
   *
   * TODO-ASK-OWNER (Joshua + Melissa): which model, if any, is cleared for
   * customer text? Until one is, `classify_home_problem` and
   * `select_next_clarifier` cannot run on a model at all — they refuse BEFORE
   * any network I/O and fall back deterministically. See callModel.ts.
   */
  allows_customer_data: boolean;
  /** Where the numbers above came from, carried with them. */
  price_source: string;
  /** Free-tier marker — a $0 model is still a model whose prompts may be retained. */
  free: boolean;
}

/**
 * THE SEEDED CATALOGUE. Four models, chosen to cover both structured-output
 * modes and both price classes, every field from the 2026-08-25 probe.
 *
 * THREE MORE FREE MODELS DO SUPPORT STRUCTURED OUTPUTS and were seen in the same
 * probe, recorded here rather than seeded because only their context windows
 * were read, not their full price records:
 *   nvidia/nemotron-3-super-120b-a12b:free  262,144 ctx
 *   openrouter/free                         200,000 ctx
 *   dots-studio/dots-3-note-preview:free    512,000 ctx
 * Adding one is a data edit here after `npm run ai:models` confirms its fields.
 */
export const MODEL_CATALOGUE: readonly ModelConfig[] = [
  {
    /**
     * THE MODEL THE OWNER IS STARTING ON. Free, enormous context, and — the fact
     * that shapes this whole build — it advertises `response_format` and `tools`
     * but NOT `structured_outputs`. So it runs in json_object mode: schema in the
     * prompt, zod on the reply, one repair retry, deterministic fallback.
     *
     * KNOWN RELIABILITY BEHAVIOUR, recorded in this project's own operations log:
     * the free ox-alpha pool saturates and returns 429
     * `upstream_provider_shared_pool` for everyone at once. That is why retry with
     * backoff and a deterministic fallback are mandatory rather than defensive,
     * and why a 429 must never reach a customer.
     */
    id: "stealth/ox-alpha",
    provider: "openrouter",
    mode: "json_object",
    price_in_per_mtok: 0,
    price_out_per_mtok: 0,
    context: 1_048_576,
    allows_customer_data: false,
    price_source: `${MODEL_CATALOGUE_SOURCE}, ${MODEL_CATALOGUE_PROBED_AT}: pricing $0/$0, supported_parameters includes response_format and tools, EXCLUDES structured_outputs`,
    free: true,
  },
  {
    id: "deepseek/deepseek-v4-flash",
    provider: "openrouter",
    mode: "json_schema",
    /**
     * THE EXACT FIGURES, and how they got here. These were first seeded from the
     * probe's ROUNDED summary — $0.0886 / $0.177, context 1,000,000 — and
     * `npm run ai:models` immediately flagged all three against the live
     * catalogue. That is the drift script earning its place on its first run: a
     * rounded price under-estimates every call by a fraction of a percent
     * forever, and a rounded context window is simply wrong.
     */
    price_in_per_mtok: 0.088606,
    price_out_per_mtok: 0.177212,
    context: 1_048_576,
    allows_customer_data: false,
    price_source: `${MODEL_CATALOGUE_SOURCE}, ${MODEL_CATALOGUE_PROBED_AT}: $0.088606/M in, $0.177212/M out, structured_outputs supported`,
    free: false,
  },
  {
    id: "deepseek/deepseek-v4-flash-0731",
    provider: "openrouter",
    mode: "json_schema",
    price_in_per_mtok: 0.14,
    price_out_per_mtok: 0.28,
    context: 1_310_720,
    allows_customer_data: false,
    price_source: `${MODEL_CATALOGUE_SOURCE}, ${MODEL_CATALOGUE_PROBED_AT}: $0.14/M in, $0.28/M out, structured_outputs supported`,
    free: false,
  },
  {
    /** A FREE model that DOES support strict schemas — the cheapest way to test mode A. */
    id: "z-ai/glm-5.2:free",
    provider: "openrouter",
    mode: "json_schema",
    price_in_per_mtok: 0,
    price_out_per_mtok: 0,
    context: 256_000,
    allows_customer_data: false,
    price_source: `${MODEL_CATALOGUE_SOURCE}, ${MODEL_CATALOGUE_PROBED_AT}: free tier, structured_outputs supported`,
    free: true,
  },
] as const;

export function findModel(
  modelId: string,
  catalogue: readonly ModelConfig[] = MODEL_CATALOGUE
): ModelConfig | null {
  return catalogue.find((m) => m.id === modelId) ?? null;
}

export interface ModelCostEstimate {
  estimated_usd: number;
  basis: string;
  /**
   * FALSE means "this model is not in the catalogue". An unestimable call is
   * never made: an unknown price is not a free one. Same rule, same words, as
   * the search-metrics budget brake in platform/economics/rates.ts.
   */
  known: boolean;
  /** Always TEST — this is a PRN-derived figure, not a vendor quote. */
  figure_label: string;
}

/**
 * Worst-case cost of a call BEFORE it is made. Prompt tokens are estimated from
 * characters; completion tokens are priced at the full `maxTokens` ceiling,
 * because a brake that assumes a short answer is a brake that lets the long one
 * through. Rounds UP, always.
 */
export function estimateModelCall(
  modelId: string,
  promptChars: number,
  maxOutputTokens: number,
  catalogue: readonly ModelConfig[] = MODEL_CATALOGUE
): ModelCostEstimate {
  const model = findModel(modelId, catalogue);
  if (!model) {
    return {
      estimated_usd: Number.POSITIVE_INFINITY,
      basis: `no catalogue entry for "${modelId}" — call refused rather than priced at zero (add it to MODEL_CATALOGUE after \`npm run ai:models\` confirms its fields)`,
      known: false,
      figure_label: TEST_FIGURE_LABEL,
    };
  }
  // ~4 characters per token is the conventional English approximation. It is an
  // ESTIMATE and is labelled as one; the post-call re-check uses reported usage.
  const promptTokens = Math.ceil(promptChars / 4);
  const cost =
    (promptTokens / 1_000_000) * model.price_in_per_mtok +
    (maxOutputTokens / 1_000_000) * model.price_out_per_mtok;
  return {
    estimated_usd: Math.ceil(cost * 1e6) / 1e6,
    basis: `~${promptTokens} prompt tok @ $${model.price_in_per_mtok}/M + ${maxOutputTokens} max output tok @ $${model.price_out_per_mtok}/M (${model.id}, prices probed ${MODEL_CATALOGUE_PROBED_AT})`,
    known: true,
    figure_label: TEST_FIGURE_LABEL,
  };
}

/** Cost of a call that already happened, from the tokens it actually used. */
export function actualModelCost(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
  catalogue: readonly ModelConfig[] = MODEL_CATALOGUE
): ModelCostEstimate {
  const model = findModel(modelId, catalogue);
  if (!model) {
    return {
      estimated_usd: Number.POSITIVE_INFINITY,
      basis: `no catalogue entry for "${modelId}" — an unpriced call counts as unbounded against the cap, never as free`,
      known: false,
      figure_label: TEST_FIGURE_LABEL,
    };
  }
  const cost =
    (promptTokens / 1_000_000) * model.price_in_per_mtok +
    (completionTokens / 1_000_000) * model.price_out_per_mtok;
  return {
    estimated_usd: Math.ceil(cost * 1e6) / 1e6,
    basis: `${promptTokens} + ${completionTokens} tok @ $${model.price_in_per_mtok}/$${model.price_out_per_mtok} per M (${model.id}, prices probed ${MODEL_CATALOGUE_PROBED_AT})`,
    known: true,
    figure_label: TEST_FIGURE_LABEL,
  };
}
