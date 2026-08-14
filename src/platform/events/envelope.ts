import { z } from "zod";
import { Id, IsoDateTime, UsdAmount } from "@/domain/shared/primitives";
import { EVENT_NAMES, type EventName } from "@/platform/events/names";

export const ActorType = z.enum([
  "guest",
  "customer",
  "admin",
  "agent",
  "system",
  "external_agent",
]);

export const Channel = z.enum(["web", "api", "mcp", "admin", "agent", "import"]);

export const PrivacyClass = z.enum(["private", "internal", "public_safe"]);

/**
 * Canonical EventEnvelope (#14A §18.1). Every material action emits one of
 * these from Day 1; vendor analytics are never the source of truth.
 */
export const EventEnvelope = z.object({
  event_id: Id,
  event_name: z.enum(EVENT_NAMES as unknown as [EventName, ...EventName[]]),
  event_version: z.number().int().min(1),
  occurred_at: IsoDateTime,
  actor: z.object({
    actor_type: ActorType,
    actor_id: Id.nullable(),
  }),
  guest_session_id: Id.nullable(),
  /** canonical *_id context keys as applicable (person_id, problem_id, page_id, ...) */
  context: z.record(z.string()),
  source: z.object({
    channel: Channel,
    referrer: z.string().nullable(),
    landing_path: z.string().nullable(),
  }),
  /** schema/template/prompt/model/capability/workflow versions as applicable */
  versions: z.record(z.string()),
  result: z.object({
    status: z.enum(["ok", "error", "denied"]).nullable(),
    duration_ms: z.number().min(0).nullable(),
    cost_usd: UsdAmount.nullable(),
  }),
  privacy_class: PrivacyClass,
  trace_id: z.string().nullable(),
  agent_run_id: Id.nullable(),
  action_request_id: Id.nullable(),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;
