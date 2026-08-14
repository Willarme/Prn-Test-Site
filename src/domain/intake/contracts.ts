import { z } from "zod";
import { Id, IsoDateTime, SchemaVersion } from "@/domain/shared/primitives";

/**
 * Stable route contracts — frozen in Door Wave 0. Every door either renders
 * the shared StartRequestForm or routes here. These strings are contracts;
 * changing them is a versioned owner-approved decision.
 */
export const ROUTES = {
  start: "/start",
  resultsPattern: "/results/[request_id]",
  results: (requestId: string) => `/results/${requestId}`,
} as const;

/**
 * Door -> intake attribution. PRIOR CONTEXT, NOT TRUTH: someone can arrive
 * from "water-from-ceiling-after-shower" and describe something else entirely;
 * A01 is free to conclude differently (SEO_DOORS spec Wave 5).
 */
export const DoorAttribution = z.object({
  page_id: Id.nullable(),
  intent_cluster_id: Id.nullable(),
  search_opportunity_id: Id.nullable(),
  problem_family_hint: z.string().nullable(),
  experiment_id: Id.nullable(),
  variant: z.string().nullable(),
  referrer: z.string().nullable(),
  landing_path: z.string().min(1),
});
export type DoorAttribution = z.infer<typeof DoorAttribution>;

/**
 * IntakeSession — Owner Decision D-2: an ADDITIVE attribution record linking a
 * visitor's guest session and request to the door they entered through. It is
 * not a second session system; guest_session_id and request_id remain the
 * canonical #14A identifiers.
 */
export const IntakeSession = z.object({
  intake_session_id: Id,
  schema_version: SchemaVersion,
  guest_session_id: Id.nullable(),
  request_id: Id.nullable(),
  attribution: DoorAttribution,
  consent_event_ids: z.array(Id),
  entered_at: IsoDateTime,
  intake_started_at: IsoDateTime.nullable(),
});
export type IntakeSession = z.infer<typeof IntakeSession>;
