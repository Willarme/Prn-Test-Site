import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";

/**
 * A05's event emissions — ALL of them, in one file, through A08's
 * `validateAndEmit` and never beside it.
 *
 * A05 MINTS NOTHING. Loop Spec Audit condition C7 and pre-answer 7 are blunt
 * about this: three of the four events A05 §5 orders it to emit "exactly" —
 * `page.rendered`, `template.used`, `page.regenerated` — are ABSENT from the
 * closed `z.enum(EVENT_NAMES)` at envelope.ts:31, whose `.parse()` sits OUTSIDE
 * emit.ts's try/catch. Emitting one THROWS at runtime; it does not fail soft.
 * That is "the single instruction in §11 that is impossible to execute as
 * written", and A05's own §5 assigns final naming authority to A08 anyway.
 *
 * SO A05 EMITS WHAT THE DICTIONARY CARRIES:
 *   page.draft_created — CORE_EVENT_NAMES (14A §18.2), the page was compiled
 *   page.staged        — SLICE_EVENT_NAMES, it entered the STAGED lifecycle state
 *   page.refreshed     — SLICE_EVENT_NAMES, the regeneration moment
 *
 * and the three canon-named events are filed to A08 as a PROPOSED contract
 * change (names.ts: "Adding a name here is a contract change: it requires a
 * version bump and appears in the wave gate report"). They are listed in this
 * build's report, not added here.
 *
 * page.published STAYS UNEMITTED. Coherence issue 9 assigns it to "whichever of
 * A05/A06 builds second so it does not fall between them" — that is A06. The
 * publish route is untouched by this build.
 *
 * EVERY NAME IS A LITERAL ON AN `event_name:` PROPERTY, never positional and
 * never assembled from a variable, so A08's standing reconciliation scan
 * (tests/a08.reconciliation.test.ts) can read A05's entire emitting surface out
 * of this file. A04's build hit exactly this: names passed positionally
 * compiled, worked, and were INVISIBLE to the scan.
 *
 * DEFERRED IMPORT, same reason as A04's platform/search/events.ts and A09's
 * platform/quality/events.ts: A08's steward reaches approvals/center.ts, which
 * imports stores/runtime.ts. Nothing at module scope needs the steward, so
 * `await import()` resolves it at CALL time and no import ring closes at load.
 *
 * FAIL-SOFT. Emission is telemetry ABOUT a page, not the page. A lost envelope
 * must never cost a staged page.
 */

type Ctx = Record<string, string>;

async function send(
  emission: { event_name: string; context: Ctx },
  clientProvider: PlatformClientProvider
): Promise<string> {
  try {
    const { validateAndEmit } = await import("@/platform/events/steward");
    const result = await validateAndEmit(
      { event_name: emission.event_name, agent_id: "A05", context: emission.context },
      clientProvider
    );
    return result.status;
  } catch {
    return "error";
  }
}

/** The page was compiled into a PageSpec. */
export async function emitPageDraftCreated(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<string> {
  return send({ event_name: "page.draft_created", context }, clientProvider);
}

/** The page entered the STAGED lifecycle state and its registry row exists. */
export async function emitPageStaged(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<string> {
  return send({ event_name: "page.staged", context }, clientProvider);
}

/** A regeneration completed — the semantically correct shipped name for it. */
export async function emitPageRefreshed(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<string> {
  return send({ event_name: "page.refreshed", context }, clientProvider);
}

/** The complete set, for the never-do tests and the build report. */
export const A05_EMITTED_EVENT_NAMES = [
  "page.draft_created",
  "page.staged",
  "page.refreshed",
] as const;

/**
 * PROPOSED TO A08, NOT EMITTED. The three canon-named events from A05 §5 that
 * the dictionary does not carry, with the shipped name A05 uses instead. This
 * constant exists so the proposal is in the codebase rather than only in a
 * build report, and so a test can assert none of them is ever emitted.
 */
export const A05_PROPOSED_TO_A08 = [
  { canon_name: "page.rendered", used_instead: "page.staged" },
  { canon_name: "template.used", used_instead: null },
  { canon_name: "page.regenerated", used_instead: "page.refreshed" },
] as const;
