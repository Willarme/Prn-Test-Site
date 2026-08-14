import { z } from "zod";
import { Id, IsoDateTime } from "@/domain/shared/primitives";

/**
 * Immutable disclosure text shown to a user. Consent language is owned by the
 * shared intake component and versioned HERE — A05 never writes consent
 * wording onto generated pages (SEO_DOORS spec Wave 2). Final wording requires
 * counsel review before production traffic (#14A §9.2).
 */
export const DisclosureVersion = z.object({
  disclosure_version_id: Id,
  version_label: z.string().min(1),
  content_text: z.string().min(1),
  content_hash: z.string().min(1),
  status: z.enum(["draft", "active", "superseded"]),
  jurisdiction_hint: z.string().nullable(),
  effective_from: IsoDateTime,
});
export type DisclosureVersion = z.infer<typeof DisclosureVersion>;

export const ConsentAction = z.enum(["GRANT", "REVOKE", "RENEW"]);

/**
 * Append-only consent ledger event (#14A §9.3). Field names intentionally
 * mirror the Build Kit's consent_event.schema.json — parity is enforced by
 * tests/privacy.kit-parity.test.ts.
 */
export const ConsentEvent = z.object({
  consent_event_id: Id,
  person_id: Id.nullable(),
  guest_session_id: Id.nullable(),
  problem_id: Id.nullable(),
  scope: z.string().min(1),
  action: ConsentAction,
  disclosure_version_id: Id,
  surface: z.string().min(1),
  trace_id: z.string().nullable(),
  occurred_at: IsoDateTime,
});
export type ConsentEvent = z.infer<typeof ConsentEvent>;
