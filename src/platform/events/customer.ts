import { randomUUID } from "node:crypto";
import { EventEnvelope } from "@/platform/events/envelope";
import type { EventName } from "@/platform/events/names";
import { runtimeStore } from "@/platform/stores/runtime";

/**
 * CUSTOMER-ATTRIBUTED EVENTS — the emitter for things a HOMEOWNER did.
 *
 * `emitPlatformEvent` (emit.ts) stamps `actor_type: "agent"` and
 * `source.channel: "agent"`, which is correct for agent activity and wrong for
 * a person opening their own packet. Recording a homeowner's view as agent
 * activity would quietly corrupt every funnel number A07 later computes off the
 * actor, so customer moments get their own builder rather than a flag on the
 * agent one.
 *
 * WHY IT EXISTS NOW (Trial Spec Audit §4, and this is the time-critical part).
 * Grepping for producers outside the dictionary files found ZERO for
 * `packet.viewed`, `packet.downloaded` and `packet.share_opened` — three names
 * registered and seeded since #14A §18.2 that nothing has ever emitted. Events
 * are append-only history and cannot be backfilled: a packet view that happens
 * during the trial and is not recorded is gone permanently, and A07's first
 * KpiSnapshot would have no baseline to compare against.
 *
 * FAIL-SOFT, ALWAYS. Telemetry is never business logic. A homeowner must never
 * see an error, lose a click, or fail to open their packet because an envelope
 * could not be written — so every failure path here is logged once and
 * swallowed, exactly as emit.ts contracts.
 *
 * IDS ONLY IN CONTEXT. Nothing a homeowner typed travels in an envelope.
 */
export interface CustomerEventInput {
  event_name: EventName;
  /** Their anonymous session, when one is known. */
  guest_session_id?: string | null;
  /** Canonical *_id keys and short enums only — never raw text. */
  context?: Record<string, string>;
  /** The path they were on. */
  landing_path?: string | null;
  referrer?: string | null;
  versions?: Record<string, string>;
  /** Reserved — white-label condition C7. Default "prn"; NO tenant logic. */
  tenant_id?: string;
}

let missLogged = false;
let invalidLogged = false;

/**
 * Build + append one customer EventEnvelope. NEVER THROWS; returns the envelope
 * on success and null when nothing could be recorded.
 */
export async function recordCustomerEvent(
  input: CustomerEventInput
): Promise<EventEnvelope | null> {
  const candidate = EventEnvelope.safeParse({
    event_id: `ev_${randomUUID()}`,
    tenant_id: input.tenant_id ?? "prn",
    event_name: input.event_name,
    event_version: 1,
    occurred_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    actor: { actor_type: "guest", actor_id: null },
    guest_session_id: input.guest_session_id ?? null,
    context: input.context ?? {},
    source: {
      channel: "web",
      referrer: input.referrer ?? null,
      landing_path: input.landing_path ?? null,
    },
    versions: input.versions ?? { schema: "1.0.0" },
    result: { status: "ok", duration_ms: null, cost_usd: null },
    privacy_class: "internal",
    trace_id: null,
    agent_run_id: null,
    action_request_id: null,
  });
  if (!candidate.success) {
    if (!invalidLogged) {
      invalidLogged = true;
      console.warn(
        `[customer-events] refused a malformed envelope for "${input.event_name}" — proceeding without telemetry.`
      );
    }
    return null;
  }
  try {
    await runtimeStore().recordEvents([candidate.data]);
  } catch (err) {
    if (!missLogged) {
      missLogged = true;
      console.warn(
        `[customer-events] event store write failed (${
          err instanceof Error ? err.message : String(err)
        }) — proceeding without telemetry.`
      );
    }
  }
  return candidate.data;
}

/** Test seam. */
export function resetCustomerEventEmitterForTests(): void {
  missLogged = false;
  invalidLogged = false;
}
