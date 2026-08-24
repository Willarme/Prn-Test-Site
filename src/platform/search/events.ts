import type { OpportunityDecisionKind } from "@/domain/search/decision";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";

/**
 * A04's event emissions — ALL of them, in one file, through A08's
 * `validateAndEmit` and never beside it.
 *
 * A04 EMITTED NOTHING BEFORE THIS BUILD. `emitPlatformEvent`'s only callers
 * were the intake route, the gateway and the kill switch; the whole SEO loop
 * was silent. So this is net-new wiring, and the discipline is set here rather
 * than inherited.
 *
 * NO NEW NAMES. A08's dictionary is closed to A04. Every name below was
 * registered by A08's own build:
 *   - seo.opportunity_created / _scored / _budget_exhausted — SLICE_EVENT_NAMES,
 *     shipping since the door slice;
 *   - seo.opportunity_accepted / _rejected / _deferred — LOOP_SEAM_EVENT_NAMES,
 *     registered with owning_agent "A04" specifically so A04 would emit what
 *     the dictionary carries instead of minting the `search.*` family its own
 *     spec proposed (coherence report issue 1: "one family, not two").
 *
 * EVERY NAME IS A LITERAL ON AN `event_name:` PROPERTY, never a positional
 * argument and never assembled from a variable, so the standing reconciliation
 * scan (tests/a08.reconciliation.test.ts) can read A04's entire emitting
 * surface out of this file. This file first passed names positionally, as the
 * first argument to send(...) — which compiled, worked, and was INVISIBLE to
 * that scan; the scan's own coverage check caught it. Two idioms already exist
 * in the codebase and A09 uses the property form; A04 joins it rather than
 * adding a third for the scan to learn. (Writing an EXAMPLE of the idiom in
 * this comment would itself be picked up as an emitted name — the scan reads
 * the file, not the AST — so the shape is described, never spelled.)
 *
 * DEFERRED IMPORT, same reason as A09's platform/quality/events.ts: A08's
 * steward reaches approvals/center.ts, which imports stores/runtime.ts. Nothing
 * at module scope here needs the steward — only the functions do — so
 * `await import()` resolves it at CALL time and no import ring closes at load.
 *
 * FAIL-SOFT. Emission is telemetry about a decision, not the decision. The
 * decision's own write is fail-LOUD (platform/search/decision-store.ts); if the
 * envelope on top of it is lost, the decision still exists and the owner still
 * sees it.
 */

type Ctx = Record<string, string>;

interface Emission {
  event_name: string;
  context: Ctx;
}

async function send(
  emission: Emission,
  clientProvider: PlatformClientProvider
): Promise<string> {
  try {
    const { validateAndEmit } = await import("@/platform/events/steward");
    const result = await validateAndEmit(
      { event_name: emission.event_name, agent_id: "A04", context: emission.context },
      clientProvider
    );
    return result.status;
  } catch {
    return "error";
  }
}

export async function emitOpportunityDecision(
  kind: OpportunityDecisionKind,
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<string> {
  switch (kind) {
    case "accept":
      return send({ event_name: "seo.opportunity_accepted", context }, clientProvider);
    case "reject":
      return send({ event_name: "seo.opportunity_rejected", context }, clientProvider);
    case "defer":
      return send({ event_name: "seo.opportunity_deferred", context }, clientProvider);
  }
}

export async function emitOpportunityCreated(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<string> {
  return send({ event_name: "seo.opportunity_created", context }, clientProvider);
}

export async function emitOpportunityScored(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<string> {
  return send({ event_name: "seo.opportunity_scored", context }, clientProvider);
}

export async function emitBudgetExhausted(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<string> {
  return send({ event_name: "seo.budget_exhausted", context }, clientProvider);
}

/** The complete set, for the never-do tests and the build report. */
export const A04_EMITTED_EVENT_NAMES = [
  "seo.opportunity_created",
  "seo.opportunity_scored",
  "seo.budget_exhausted",
  "seo.opportunity_accepted",
  "seo.opportunity_rejected",
  "seo.opportunity_deferred",
] as const;
