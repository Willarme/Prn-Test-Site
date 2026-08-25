import { z } from "zod";
import { Id, SchemaVersion } from "@/domain/shared/primitives";
import type { JobPacket } from "@/domain/problem/contracts";

/**
 * THE `prn_last_journey` COOKIE — an ACCEPTED, BOUNDED EXPOSURE, written down
 * truthfully rather than asserted away (Loop Spec Audit A02 condition 6).
 *
 * ─── THE FINDING, RESTATED HONESTLY ────────────────────────────────────────
 *
 * The A02 spec's §2 claims, absolutely, that "nothing about a packet is
 * computed or stored client-side". That was already false when it was written:
 * api/intake/route.ts base64url-encodes a journey into this cookie and
 * /results/[request_id] reads it back. §2 is amended here rather than in prose
 * somewhere: the exception EXISTS, these are its exact bounds, and a test pins
 * them.
 *
 * ─── WHY IT WAS NOT NARROWED TO IDS ONLY ───────────────────────────────────
 *
 * The audit's preferred fix — carry ids and let the server rehydrate — rests on
 * a premise that is FALSE in the only environment where this cookie is ever
 * set. The cookie is written only when `store.kind === "file"`, i.e. no Supabase
 * configured, and stores/dev-db.ts:111-115 says why that store cannot rehydrate
 * there: on Vercel it writes to `/tmp/prn-runtime/dev-db.json`, which is
 * per-instance and ephemeral. The write succeeds; the NEXT request — the
 * results page — can land on a different instance with an empty /tmp and find
 * nothing. Ids alone would 404 a homeowner's own packet on any keyless preview
 * deploy. With the migrations applied and keys present, the store is Supabase,
 * `store.kind !== "file"`, and this cookie is never set at all.
 *
 * So the exposure is accepted, and narrowed as far as it can be narrowed
 * without breaking the walkthrough it exists for:
 *
 *   1. THE ProblemRecord IS GONE ENTIRELY. It used to ride in full —
 *      problem_summary (240 characters of the homeowner's own words),
 *      service_category, intake_session_id, evidence_ids, claim_ids. The
 *      results page reads exactly ONE field off it, `safety_rule_id`, so that
 *      is all that travels now.
 *   2. THE PACKET IS PROJECTED, NOT PASSED. Only the fields the results page
 *      actually renders. Everything A02 added this wave — evidence_basis,
 *      claim_basis, generation_run_id, uncertainty_notes, safety_notes,
 *      superseded_by, status, privacy_marking, tenant_id, template_version,
 *      model_id — and `observed_statements` are structurally excluded. The
 *      audit's condition is "must not extend it to any newly added sensitive
 *      field"; an allow-list makes that TRUE rather than PROMISED, because the
 *      next field added to JobPacket cannot arrive here by default.
 *
 * ─── WHAT IS STILL EXPOSED, SAID PLAINLY ───────────────────────────────────
 *
 * `summary_plain` and `call_script` contain the homeowner's own description.
 * That is the packet, and the page's whole job is to show it to them. The
 * mitigations are the ones the audit already recorded and none of them is
 * relaxed here: httpOnly (so no script and no View-Source reads it), sameSite
 * lax, secure in production, path-scoped to /results, size-capped, and set only
 * when there is no database at all.
 *
 * THIS COOKIE MUST NEVER GROW A NON-httpOnly VARIANT for regenerate or share.
 */

/** The ONE cookie name. Never a second variant. */
export const JOURNEY_COOKIE_NAME = "prn_last_journey";

/**
 * Refused above this many base64url characters rather than truncated — a
 * half-written journey that parses is worse than none.
 */
export const JOURNEY_COOKIE_MAX_CHARS = 3800;

/**
 * THE PACKET ALLOW-LIST. Exactly the fields /results/[request_id] renders, plus
 * the two ids its own `packet.viewed` envelope needs. Adding a field here is a
 * deliberate act with a test to update; forgetting to add one costs a render
 * detail, which is the safe direction to fail.
 */
export const PacketCookieView = z.object({
  job_packet_id: Id,
  problem_id: Id,
  packet_version: z.number().int().positive(),
  schema_version: SchemaVersion,
  engine: z.enum(["fixture", "production"]),
  summary_plain: z.string().min(1),
  collected_details: z.array(z.object({ label: z.string(), value: z.string(), source: z.string() })),
  media_count: z.number().int().min(0),
  diagnosis: z
    .object({
      outcome_title: z.string(),
      likely_cause: z.string(),
      steps_answered: z.array(z.object({ step: z.string(), answer: z.string() })),
      provider_note: z.string(),
    })
    .nullable(),
  likely_service_category: z.object({
    value: z.string().nullable(),
    confidence: z.enum(["high", "medium", "low"]),
    note: z.string().min(1),
  }),
  what_remains_unknown: z.array(z.string()),
  safe_prep_notes: z.array(z.string()),
  questions_for_provider: z.array(z.string()),
  call_script: z.string().min(1),
});
export type PacketCookieView = z.infer<typeof PacketCookieView>;

export const JourneyCookiePayload = z.object({
  request_id: z.string().min(1),
  /**
   * The ONLY thing left of the ProblemRecord: which safety rule fired, so the
   * results page can look its approved copy up server-side. An id, not copy.
   */
  safety_rule_id: Id.nullable(),
  packet: PacketCookieView,
});
export type JourneyCookiePayload = z.infer<typeof JourneyCookiePayload>;

/**
 * Project a full packet down to what may travel. Deliberately field-by-field
 * rather than a spread-with-omissions: a spread inherits every future field by
 * default, which is precisely the widening this exists to prevent.
 */
export function projectPacketForCookie(packet: JobPacket): PacketCookieView {
  return PacketCookieView.parse({
    job_packet_id: packet.job_packet_id,
    problem_id: packet.problem_id,
    packet_version: packet.packet_version,
    schema_version: packet.schema_version,
    engine: packet.engine,
    summary_plain: packet.summary_plain,
    collected_details: packet.collected_details,
    media_count: packet.media_count,
    diagnosis: packet.diagnosis,
    likely_service_category: packet.likely_service_category,
    what_remains_unknown: packet.what_remains_unknown,
    safe_prep_notes: packet.safe_prep_notes,
    questions_for_provider: packet.questions_for_provider,
    call_script: packet.call_script,
  });
}

/**
 * Encode, or return null when the result is too large. Null means "do not set
 * the cookie" — never "set a truncated one".
 */
export function encodeJourneyCookie(payload: JourneyCookiePayload): string | null {
  const encoded = Buffer.from(JSON.stringify(JourneyCookiePayload.parse(payload))).toString(
    "base64url"
  );
  return encoded.length < JOURNEY_COOKIE_MAX_CHARS ? encoded : null;
}

/**
 * Decode and VALIDATE. A cookie that does not parse to the allow-listed shape
 * is discarded, not partially trusted — including one written by an older
 * deploy with a wider payload.
 */
export function decodeJourneyCookie(
  raw: string | undefined,
  expectedRequestId: string
): JourneyCookiePayload | null {
  if (!raw) return null;
  try {
    const parsed = JourneyCookiePayload.safeParse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"))
    );
    if (!parsed.success) return null;
    return parsed.data.request_id === expectedRequestId ? parsed.data : null;
  } catch {
    return null;
  }
}
