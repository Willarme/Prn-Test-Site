import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";

/**
 * A06's event emissions — ALL of them, in one file, through A08's
 * `validateAndEmit` and never beside it. Same shape and same discipline as
 * A05's `page-events.ts`, for the same reasons.
 *
 * A06 MINTS NOTHING. Every name below was registered by A08's build before A06
 * built, which is the whole point of the ordering (coherence issues 3 and 5):
 *
 *   page.qa_passed       CORE_EVENT_NAMES  (14A §18.2)
 *   page.qa_failed       SLICE_EVENT_NAMES
 *   page.defect_found    LOOP_SEAM_EVENT_NAMES — A08 prefixed A06 §5's bare
 *   page.defect_repaired LOOP_SEAM_EVENT_NAMES   `defect_found`/`defect_repaired`,
 *                                                which failed the shipped
 *                                                domain.action regex outright
 *   page.published       CORE_EVENT_NAMES  (14A §18.2)
 *
 * `page.qa_started` from A06 §5 is NOT emitted. A08's dictionary does not carry
 * it, `emitPlatformEvent` types its input against that closed enum, and A06 does
 * not add names to another agent's contract to satisfy its own spec — the same
 * ruling A05's build made about `page.rendered` / `template.used` /
 * `page.regenerated`. It is listed in A06_PROPOSED_TO_A08 below and in the build
 * report, not invented here.
 *
 * page.published IS A06'S TO EMIT (coherence issue 9, verbatim: "assign it to
 * whichever of A05/A06 builds second so it does not fall between them" — A05's
 * build recorded that as A06's, and this is it). Without it, defect-escape rate,
 * time-to-publish and every A07 SEO gauge are uncomputable, because nothing
 * carries the moment a page went live. It is emitted from the owner's publish
 * route with `page_id`, `page_spec_id`, `canonical_path` and
 * `search_opportunity_id` — exactly the four keys the issue names, and exactly
 * the join key the defect events need.
 *
 * THE ACTOR IS AN AGENT SURFACE, THE ACT IS A HUMAN'S. The shipped envelope
 * types `actor.actor_type` as "agent" for anything emitted this way, so
 * `published_by: "owner"` travels in `context` instead of being silently lost.
 * A06 did not publish the page; A06's surface recorded that the owner did.
 *
 * EVERY NAME IS A LITERAL ON AN `event_name:` PROPERTY, never positional and
 * never assembled from a variable, so A08's standing reconciliation scan
 * (tests/a08.reconciliation.test.ts) can read A06's entire emitting surface out
 * of this file.
 *
 * DEFERRED IMPORT, same reason as A04/A05/A09: A08's steward reaches
 * approvals/center.ts, which imports stores/runtime.ts. Nothing at module scope
 * needs the steward, so `await import()` resolves it at CALL time and no import
 * ring closes at load.
 *
 * FAIL-SOFT. Emission is telemetry ABOUT a page, not the page. A lost envelope
 * must never cost a QA verdict, and it must never cost a publish.
 */

type Ctx = Record<string, string>;

async function send(
  emission: { event_name: string; context: Ctx },
  clientProvider: PlatformClientProvider
): Promise<string> {
  try {
    const { validateAndEmit } = await import("@/platform/events/steward");
    const result = await validateAndEmit(
      { event_name: emission.event_name, agent_id: "A06", context: emission.context },
      clientProvider
    );
    return result.status;
  } catch {
    return "error";
  }
}

/** The page cleared A06's gauntlet and entered the owner's publish queue. */
export async function emitPageQaPassed(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<string> {
  return send({ event_name: "page.qa_passed", context }, clientProvider);
}

/** The page failed and went back for a rebuild. */
export async function emitPageQaFailed(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<string> {
  return send({ event_name: "page.qa_failed", context }, clientProvider);
}

/**
 * ONE DEFECT. The context is deliberately wide enough to JOIN AGAINST PUBLISH
 * STATUS, which is the done-when requirement: `page_id` and `page_spec_id` are
 * the same keys `page.published` carries, so defect-escape rate is a join rather
 * than a guess. `check`, `severity` and `rule_set_version` say what was wrong and
 * which rule set said so; `where` is a block_id or field name. IDs and labels
 * only — never the copy that failed.
 */
export async function emitPageDefectFound(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<string> {
  return send({ event_name: "page.defect_found", context }, clientProvider);
}

/** The same defect, on a later run, is gone. Same keys, so the pair joins. */
export async function emitPageDefectRepaired(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<string> {
  return send({ event_name: "page.defect_repaired", context }, clientProvider);
}

/** The owner published. The join key for the entire return leg (issue 9). */
export async function emitPagePublished(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<string> {
  return send({ event_name: "page.published", context }, clientProvider);
}

/** The complete set, for the never-do tests and the build report. */
export const A06_EMITTED_EVENT_NAMES = [
  "page.qa_passed",
  "page.qa_failed",
  "page.defect_found",
  "page.defect_repaired",
  "page.published",
] as const;

/**
 * PROPOSED TO A08, NOT EMITTED. The one name from A06 §5 the dictionary does not
 * carry. This constant exists so the proposal lives in the codebase rather than
 * only in a build report, and so a test can assert it is never emitted.
 */
export const A06_PROPOSED_TO_A08 = [
  {
    canon_name: "page.qa_started",
    used_instead: null,
    why: "A08's dictionary does not carry it. A06 emits the two OUTCOME names it does carry (page.qa_passed / page.qa_failed) and the run itself is already recorded on the Agent Run Ledger, so nothing is unobservable — only the start edge is unnamed.",
  },
] as const;
