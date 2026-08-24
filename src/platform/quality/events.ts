import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";

/**
 * A09's event emissions — ALL of them, in one file, through A08's
 * `validateAndEmit` and never beside it. A09 ships NO bare-string emission: the
 * six names below are the complete emitting surface, every one of them is in
 * names.ts, and the reconciliation scan in tests/a08.reconciliation.test.ts
 * reads the literals here to prove it.
 *
 * WHY THE DEFERRED IMPORT. `stores/runtime.ts` imports the ingest guard so
 * validation cannot be bypassed by a new caller; the guard reaches this file;
 * and A08's steward reaches `approvals/center.ts`, which imports
 * `stores/runtime.ts`. A static import here would close that ring at module
 * load. `await import()` resolves it at CALL time instead, which is both
 * correct and honest about the direction of the dependency — nothing at module
 * scope in quality/ needs the steward, only the functions do.
 *
 * FAIL-SOFT, UNLIKE THE REST OF A09. Emission is telemetry about a finding, not
 * the finding itself. The finding's durable write is fail-LOUD (issues.ts); if
 * the envelope on top of it is lost, the record still exists and the exception
 * queue still shows it. A09 diverges from the platform default exactly once,
 * where it matters, and nowhere else.
 */

type Ctx = Record<string, string>;

interface Emission {
  event_name: string;
  context: Ctx;
}

/**
 * The single call site. Every name below is written as a LITERAL on the
 * emission object so the standing reconciliation scan
 * (tests/a08.reconciliation.test.ts) can read A09's whole emitting surface out
 * of this file — a name assembled from a variable would pass the compiler and
 * silently escape that check.
 */
async function send(
  emission: Emission,
  clientProvider: PlatformClientProvider
): Promise<void> {
  try {
    const { validateAndEmit } = await import("@/platform/events/steward");
    await validateAndEmit(
      { event_name: emission.event_name, agent_id: "A09", context: emission.context },
      clientProvider
    );
  } catch {
    /* telemetry never blocks a finding that has already been recorded */
  }
}

export async function emitIssueDetected(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<void> {
  await send({ event_name: "data_quality.issue_detected", context }, clientProvider);
}

export async function emitQuarantined(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<void> {
  await send({ event_name: "data_quality.quarantined", context }, clientProvider);
}

export async function emitQuarantineReleased(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<void> {
  await send({ event_name: "data_quality.quarantine_released", context }, clientProvider);
}

export async function emitRepairProposed(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<void> {
  await send({ event_name: "data_quality.repair_proposed", context }, clientProvider);
}

export async function emitRepairExecuted(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<void> {
  await send({ event_name: "data_quality.repair_executed", context }, clientProvider);
}

export async function emitRepairVerified(
  context: Ctx,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<void> {
  await send({ event_name: "data_quality.repair_verified", context }, clientProvider);
}

/** The complete set, for the never-do tests and the build report. */
export const A09_EMITTED_EVENT_NAMES = [
  "data_quality.issue_detected",
  "data_quality.quarantined",
  "data_quality.quarantine_released",
  "data_quality.repair_proposed",
  "data_quality.repair_executed",
  "data_quality.repair_verified",
] as const;
