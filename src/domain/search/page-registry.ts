import type { SearchOpportunity } from "@/domain/search/contracts";
import { compilePageSpec, type FactoryDeps } from "@/domain/search/factory";
import {
  assertTransition,
  canTransition,
  type PageLifecycleStatus,
} from "@/domain/search/lifecycle";
import {
  DEFAULT_PAGE_FACTORY_POLICY,
  type PageFactoryPolicy,
} from "@/domain/search/page-factory-policy";
import { IntentPage, type PageSpec } from "@/domain/search/pages";

/**
 * THE PAGE REGISTRY — A05's second write, and the lifecycle discipline around
 * it (Loop Spec Audit C17, coherence report issue 13).
 *
 * ONE STATE MACHINE, THE SHIPPED ONE. `src/domain/search/lifecycle.ts` freezes
 * a 7-state enum with canTransition/assertTransition guards, and the A05 spec
 * never mentions the file. Issue 13 rules that lifecycle.ts is the single state
 * machine in all three specs and assigns the edges:
 *
 *     A05 owns   APPROVED -> STAGED   and   REFRESH -> STAGED
 *     A06 owns   STAGED -> QA_PASS    and   STAGED -> APPROVED (rebuild)
 *     the OWNER alone owns QA_PASS -> PUBLISHED (lifecycle.ts:6)
 *
 * `qa.state` is a FACT ABOUT a STAGED page, never a parallel lifecycle. A05
 * writes PENDING at creation and never writes it again.
 *
 * TWO WRITES, NOT THREE. A05 §5 names PageSpec, PageVersion and Page Registry.
 * There is no PageVersion object in this repo and C17 says reconcile to the
 * shipped two: versioning is `PageSpec.version` plus
 * `IntentPage.current_page_spec_id`. Regeneration increments the version and
 * repoints the pointer; it never silently overwrites a spec.
 */

const SCHEMA_VERSION = "1.0.0";

export interface StageResult {
  page: IntentPage;
  spec: PageSpec;
  /** Every lifecycle hop taken, in order — the audit trail for the transition. */
  transitions: Array<{ from: PageLifecycleStatus; to: PageLifecycleStatus }>;
}

/**
 * A brand-new page. The owner approved the opportunity, so the page enters at
 * APPROVED and A05 moves it to STAGED — the edge issue 13 assigns to A05. The
 * transition is ASSERTED rather than assumed, so an illegal path throws here
 * instead of producing a row in an impossible state.
 */
export function stageNewPage(
  opportunity: SearchOpportunity,
  deps: FactoryDeps,
  options: { tenant_id?: string } = {}
): StageResult {
  const spec = compilePageSpec(opportunity, deps);
  assertTransition("APPROVED", "STAGED");
  const page = IntentPage.parse({
    page_id: spec.page_id,
    schema_version: SCHEMA_VERSION,
    ...(options.tenant_id ? { tenant_id: options.tenant_id } : {}),
    canonical_path: spec.canonical_path,
    current_page_spec_id: spec.page_spec_id,
    lifecycle_status: "STAGED",
    published_at: null,
    retired_at: null,
    redirect_to_path: null,
    created_at: deps.now(),
  });
  return { page, spec, transitions: [{ from: "APPROVED", to: "STAGED" }] };
}

/**
 * THE PATH BACK TO STAGED from wherever a page currently sits. Each state has
 * exactly one legal route and every hop is asserted:
 *
 *   PUBLISHED  -> REFRESH -> STAGED   (A05's regeneration edge)
 *   QA_PASS    -> STAGED              (already legal directly)
 *   STAGED     -> APPROVED -> STAGED  (the rebuild path lifecycle.ts documents)
 *   APPROVED   -> STAGED
 *   IDEA       -> APPROVED -> STAGED
 *   RETIRED    -> nothing. A retired page is not regenerated; it is a new page
 *                 or it stays retired.
 */
export function restagePath(from: PageLifecycleStatus): PageLifecycleStatus[] {
  switch (from) {
    case "PUBLISHED":
      return ["REFRESH", "STAGED"];
    case "QA_PASS":
      return ["STAGED"];
    case "STAGED":
      return ["APPROVED", "STAGED"];
    case "APPROVED":
      return ["STAGED"];
    case "IDEA":
      return ["APPROVED", "STAGED"];
    // Already mid-refresh (a prior run moved it and did not finish). This is
    // A05's own edge, so completing it is the correct resumption rather than
    // an error — found by the exhaustiveness test below, not by reading.
    case "REFRESH":
      return ["STAGED"];
    case "RETIRED":
      throw new Error(
        "Illegal page lifecycle transition: RETIRED -> STAGED. A retired page is never regenerated."
      );
    default: {
      // Compile-time exhaustiveness. The first version of this switch silently
      // omitted REFRESH and returned undefined at runtime; this makes the next
      // lifecycle state a build error instead of a crash.
      const unreachable: never = from;
      throw new Error(`unhandled page lifecycle status: ${String(unreachable)}`);
    }
  }
}

/**
 * REGENERATION. Increments `PageSpec.version`, keeps page_id and canonical_path
 * stable (the public URL must not move because content was rewritten), and
 * repoints `current_page_spec_id`. qa.state resets to PENDING because a
 * regenerated page has not been checked — carrying a stale PASS forward would
 * let A06's verdict outlive the content it was about.
 */
export function regeneratePage(
  existing: IntentPage,
  previousSpec: PageSpec,
  opportunity: SearchOpportunity,
  deps: FactoryDeps,
  reason: string
): StageResult & { reason: string } {
  const hops = restagePath(existing.lifecycle_status);
  const transitions: StageResult["transitions"] = [];
  let cursor = existing.lifecycle_status;
  for (const next of hops) {
    assertTransition(cursor, next);
    transitions.push({ from: cursor, to: next });
    cursor = next;
  }

  const rebuilt = compilePageSpec(opportunity, deps);
  const spec: PageSpec = {
    ...rebuilt,
    page_id: previousSpec.page_id,
    canonical_path: previousSpec.canonical_path,
    page_spec_id: `${previousSpec.page_spec_id.replace(/_v\d+$/, "")}_v${previousSpec.version + 1}`,
    version: previousSpec.version + 1,
    status: "STAGED",
    qa: { state: "PENDING", reasons: [] },
    user_value_score: null,
    intake_context: { ...rebuilt.intake_context, page_id: previousSpec.page_id },
    created_at: previousSpec.created_at,
    updated_at: deps.now(),
    ...(previousSpec.tenant_id ? { tenant_id: previousSpec.tenant_id } : {}),
  };

  const page = IntentPage.parse({
    ...existing,
    current_page_spec_id: spec.page_spec_id,
    lifecycle_status: "STAGED",
    // A regenerated page is no longer the published one until the owner
    // publishes again — but A05 never touches publish state, so published_at
    // is carried through untouched and the publish route remains the only
    // thing that writes it.
  });

  return { page, spec, transitions, reason };
}

/* -------------------------------------------------------------------------- */
/* INTERNAL LINKS — FAIL CLOSED                                               */
/* -------------------------------------------------------------------------- */

export interface RequestedLink {
  /** Canonical intent/page ID. Never a raw URL, never an external host. */
  target_page_id: string;
  label: string;
}

export interface ResolvedLinks {
  links: Array<{ label: string; path: string }>;
  /** Every request that did NOT become a link, with the reason. Never silent. */
  dropped: Array<{ target_page_id: string; reason: string }>;
}

/**
 * Resolve requested internal links against the page registry.
 *
 * FAILS CLOSED, which is the done-when: a target that does not resolve to a
 * canonical, existing, non-retired page is DROPPED and REPORTED — never
 * rendered as a link to nowhere and never passed through as a raw path. The
 * schema already forbids external hrefs at the PageSpec level; this is the
 * layer above, where a link is only produced from a registry row that exists.
 */
export function resolveInternalLinks(
  requested: readonly RequestedLink[],
  registry: readonly IntentPage[],
  sourcePageId: string,
  policy: PageFactoryPolicy = DEFAULT_PAGE_FACTORY_POLICY
): ResolvedLinks {
  const links: ResolvedLinks["links"] = [];
  const dropped: ResolvedLinks["dropped"] = [];
  const seen = new Set<string>();

  for (const request of requested) {
    if (request.target_page_id === sourcePageId) {
      dropped.push({ target_page_id: request.target_page_id, reason: "a page cannot link to itself" });
      continue;
    }
    if (seen.has(request.target_page_id)) {
      dropped.push({ target_page_id: request.target_page_id, reason: "duplicate link target" });
      continue;
    }
    const target = registry.find((p) => p.page_id === request.target_page_id);
    if (!target) {
      dropped.push({
        target_page_id: request.target_page_id,
        reason: "no page with that id exists in the registry — fail closed, no link emitted",
      });
      continue;
    }
    if (target.lifecycle_status === "RETIRED") {
      dropped.push({ target_page_id: request.target_page_id, reason: "target page is RETIRED" });
      continue;
    }
    if (!target.canonical_path.startsWith("/")) {
      dropped.push({
        target_page_id: request.target_page_id,
        reason: `target canonical_path "${target.canonical_path}" is not root-relative`,
      });
      continue;
    }
    if (links.length >= policy.internal_links.max_links) {
      dropped.push({
        target_page_id: request.target_page_id,
        reason: `over the internal-link cap of ${policy.internal_links.max_links}`,
      });
      continue;
    }
    seen.add(request.target_page_id);
    links.push({ label: request.label, path: target.canonical_path });
  }

  return { links, dropped };
}

/** True when every requested target resolved — nothing was dropped. */
export function allLinksResolved(result: ResolvedLinks): boolean {
  return result.dropped.length === 0;
}

/** Convenience for callers that only want to know a transition is legal. */
export function canRestage(from: PageLifecycleStatus): boolean {
  if (from === "RETIRED") return false;
  let cursor: PageLifecycleStatus = from;
  for (const next of restagePath(from)) {
    if (!canTransition(cursor, next)) return false;
    cursor = next;
  }
  return true;
}
