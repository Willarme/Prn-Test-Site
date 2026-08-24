import { VendorCostRate } from "@/platform/economics/contracts";

/**
 * THE VENDOR COST-RATE REGISTRY — the thing the budget brake needs and the
 * repo did not have (C8).
 *
 * `VendorCostRate` has existed as a contract since the door slice and NOTHING
 * populated it: every snapshot the DataForSEO adapter returns carries
 * `rate_version: null`. That is why the brake could only ever check spend
 * AFTER a call returned — with no prices, there was nothing to estimate with.
 *
 * FIGURE DISCIPLINE (pre-answer 11, Compendium §5.10 trap 48). Two kinds of
 * number live near each other here and must never be confused:
 *
 *   VENDOR-SOURCED — a third party's published price. It is a FACT about the
 *   world, quoted with its date, and must NEVER be labelled TEST as if a build
 *   session invented it. The figures below are doc 23's, vendor-quoted as of
 *   2026-08-13, and are marked for re-verification because vendor pricing
 *   moves and a stale price silently under-estimates every call.
 *
 *   PRN-OWN — our caps and planning bands. Those are TEST figures, never
 *   commitments, and they live in the policy (see SeoFactoryPolicy.budget_figures).
 *
 * NOTHING HERE IS INVENTED. Every price is the one the spec quotes. Where the
 * spec quotes no price, there is no entry — and a call whose cost cannot be
 * estimated is a call the brake refuses to make, which is the conservative
 * answer and the only honest one.
 */

export const RATE_REGISTRY_VERSION = "dataforseo-2026-08-13";

/**
 * DataForSEO bills per TASK, and one task carries up to 1,000 keywords
 * (Standard Queue, vendor-quoted). Batching is therefore not a nicety: sending
 * 4,000 keywords in one call is four tasks' worth of money in a single
 * un-estimated request, which is exactly the overshoot C8 describes.
 */
export const KEYWORDS_PER_VENDOR_TASK = 1000;

export const TRIAL_VENDOR_COST_RATES: readonly VendorCostRate[] = [
  ...["keyword_ideas", "keyword_metrics", "search_intent", "serp_snapshot", "trend"].map(
    (service) =>
      VendorCostRate.parse({
        rate_id: `rate_dataforseo_${service}_20260813`,
        vendor: "dataforseo",
        service,
        sku: "standard_queue_task",
        unit: "task",
        // VENDOR-SOURCED, NOT TEST: doc 23 quotes roughly $0.06/task for up to
        // 1,000 keywords in the Standard Queue, as of 2026-08-13.
        unit_price_usd: 0.06,
        free_cap: null,
        tier: "standard",
        currency: "USD",
        effective_from: "2026-08-13T00:00:00Z",
        effective_to: null,
        source_url: null,
        verified_at: "2026-08-13T00:00:00Z",
        version: 1,
      })
  ),
  // The fixture adapter spends nothing. Registered explicitly so the
  // vendor-unavailable fallback path is estimable rather than "unknown", which
  // the brake would otherwise refuse.
  ...["keyword_ideas", "keyword_metrics", "search_intent", "serp_snapshot", "trend"].map(
    (service) =>
      VendorCostRate.parse({
        rate_id: `rate_fixture_${service}`,
        vendor: "fixture",
        service,
        sku: null,
        unit: "task",
        unit_price_usd: 0,
        free_cap: null,
        tier: null,
        currency: "USD",
        effective_from: "2026-08-13T00:00:00Z",
        effective_to: null,
        source_url: null,
        verified_at: "2026-08-13T00:00:00Z",
        version: 1,
      })
  ),
];

export interface CostEstimate {
  /** Worst-case cost of the call about to be made. */
  estimated_usd: number;
  /** How it was computed — carried into the reasons trail and the ledger. */
  basis: string;
  /**
   * FALSE means "no rate is registered for this vendor+service". An
   * unestimable call is never made: an unknown price is not a free one, and
   * the whole point of the brake is that a cap cannot be blown by one request.
   */
  known: boolean;
  rate_version: string | null;
}

export function estimateVendorCall(
  vendor: string,
  service: string,
  units: number,
  rates: readonly VendorCostRate[] = TRIAL_VENDOR_COST_RATES
): CostEstimate {
  const rate = rates.find((r) => r.vendor === vendor && r.service === service);
  if (!rate) {
    return {
      estimated_usd: Number.POSITIVE_INFINITY,
      basis: `no registered rate for ${vendor}/${service} — call refused rather than priced at zero`,
      known: false,
      rate_version: null,
    };
  }
  // Per-TASK pricing: N keywords cost ceil(N / keywords-per-task) tasks. Round
  // UP, always — a brake that rounds down is a brake that lets the last call
  // through.
  const tasks = Math.max(1, Math.ceil(units / KEYWORDS_PER_VENDOR_TASK));
  return {
    estimated_usd: Math.round(tasks * rate.unit_price_usd * 1e6) / 1e6,
    basis: `${tasks} × ${rate.unit} @ $${rate.unit_price_usd} (${rate.vendor}/${rate.service}, verified ${rate.verified_at.slice(0, 10)})`,
    known: true,
    rate_version: RATE_REGISTRY_VERSION,
  };
}

/** Split a keyword list into vendor-task-sized chunks. */
export function chunkKeywords(keywords: readonly string[], perCall: number): string[][] {
  const size = Math.max(1, Math.floor(perCall));
  const chunks: string[][] = [];
  for (let i = 0; i < keywords.length; i += size) {
    chunks.push(keywords.slice(i, i + size));
  }
  return chunks;
}
