import { randomUUID } from "node:crypto";
import { EventEnvelope } from "@/platform/events/envelope";
import type { EventName } from "@/platform/events/names";
import { runtimeStore } from "@/platform/stores/runtime";

/**
 * A00 Event + Metric Spine — the EMIT mechanism (spec §9 step 4).
 *
 * The envelope schema (envelope.ts), the canonical name list (names.ts,
 * owned by A08) and the append-only storage (event_envelope table via
 * RuntimeStore.recordEvents) already existed; A00 adds the one shared emit
 * function platform primitives use, so no primitive hand-rolls envelopes.
 *
 * Name discipline: A08 (Metric & Event Steward) owns the event dictionary.
 * This mechanism only accepts names already in names.ts — A00 deliberately
 * did NOT invent its proposed `platform.*` name family; the existing
 * canonical `agent.run_*` names (#14A §18.2) cover the Wave-0 proof case,
 * and the two kill-switch names added in names.ts are explicitly provisional
 * pending A08 ratification.
 *
 * FAIL-SOFT: emitting is telemetry, never business logic — a failure is logged
 * and swallowed so the wrapped call proceeds exactly as before. TWO failures
 * are possible and BOTH are swallowed:
 *
 *   STORAGE    — the append to event_envelope failed. The envelope was valid,
 *                so it is still returned; only the durable write is lost.
 *   VALIDATION — the input could not produce a schema-valid envelope (a
 *                type-legal but out-of-contract value: NaN/negative
 *                duration_ms, non-finite/negative cost_usd, an empty
 *                agent_id or tenant_id). Nothing is stored and `null` is
 *                returned. This case previously threw a ZodError into the
 *                CALLER'S business path — /api/intake, the gateway and the
 *                kill switch all emit mid-request, so a bad telemetry figure
 *                could 500 a homeowner's intake. Validating with safeParse is
 *                what makes the "never throws" contract above actually true.
 */
export interface PlatformEventInput {
  event_name: EventName;
  /** Which agent this event is about (actor when acting autonomously). */
  agent_id?: string;
  /** Canonical *_id context keys only — never raw PII. */
  context?: Record<string, string>;
  versions?: Record<string, string>;
  agent_run_id?: string | null;
  trace_id?: string | null;
  status?: "ok" | "error" | "denied";
  duration_ms?: number | null;
  /** TEST-labeled figures only until real cost data exists. */
  cost_usd?: number | null;
  privacy_class?: "private" | "internal" | "public_safe";
  /** Reserved — white-label condition (a); default "prn", no logic around it. */
  tenant_id?: string;
}

let missLogged = false;
let invalidLogged = false;

/**
 * Build + append one platform EventEnvelope. NEVER THROWS.
 *
 * Returns the envelope on success, or `null` when the input could not produce
 * a valid one — telemetry is dropped, never raised, so the caller's business
 * path is unaffected either way. Callers that only emit can ignore the return;
 * callers that read it must handle null.
 */
export async function emitPlatformEvent(
  input: PlatformEventInput
): Promise<EventEnvelope | null> {
  const candidate = EventEnvelope.safeParse({
    event_id: `ev_${randomUUID()}`,
    tenant_id: input.tenant_id ?? "prn",
    event_name: input.event_name,
    event_version: 1,
    occurred_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    actor: { actor_type: "agent", actor_id: input.agent_id ?? null },
    guest_session_id: null,
    context: input.context ?? {},
    source: { channel: "agent", referrer: null, landing_path: null },
    versions: input.versions ?? { schema: "1.0.0" },
    result: {
      status: input.status ?? "ok",
      duration_ms: input.duration_ms ?? null,
      cost_usd: input.cost_usd ?? null,
    },
    privacy_class: input.privacy_class ?? "internal",
    trace_id: input.trace_id ?? null,
    agent_run_id: input.agent_run_id ?? null,
    action_request_id: null,
  });
  if (!candidate.success) {
    if (!invalidLogged) {
      invalidLogged = true;
      const issues = candidate.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      console.warn(
        `[a00-event-spine] refused a malformed envelope for "${input.event_name}" (${issues}) — proceeding without telemetry.`
      );
    }
    return null;
  }
  const envelope: EventEnvelope = candidate.data;
  try {
    await runtimeStore().recordEvents([envelope]);
  } catch (err) {
    if (!missLogged) {
      missLogged = true;
      console.warn(
        `[a00-event-spine] event store write failed (${err instanceof Error ? err.message : String(err)}) — proceeding without telemetry.`
      );
    }
  }
  return envelope;
}

/** Test seam. */
export function resetPlatformEventEmitterForTests(): void {
  missLogged = false;
  invalidLogged = false;
}
