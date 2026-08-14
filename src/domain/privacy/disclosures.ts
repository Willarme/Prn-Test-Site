import { shortHash } from "@/domain/shared/hash";
import { DisclosureVersion } from "@/domain/privacy/contracts";

/**
 * The initial intake disclosure — #14A §9.2 COUNSEL-REVIEW DRAFT, verbatim.
 * Owned by the shared intake component and versioned HERE; generated pages
 * never carry their own consent wording (SEO_DOORS Wave 2). Production
 * traffic stays gated until counsel signs off (OWNER_TODO).
 */
const CONTENT =
  "Your details stay private. We use what you share to build your request and Job Packet. " +
  "We may also turn non-identifying details from requests into local repair records, trends and reports that improve the service. " +
  "We do not publish or send your name, contact information, exact address, private photos or other sensitive details unless you choose to share them. " +
  "By continuing, you agree to the Terms and Privacy Notice.";

export const ACTIVE_DISCLOSURE: DisclosureVersion = DisclosureVersion.parse({
  disclosure_version_id: "dv_intake_0_1",
  version_label: "0.1-draft-counsel-review",
  content_text: CONTENT,
  content_hash: shortHash(CONTENT),
  status: "active",
  jurisdiction_hint: "US (Indiana-first); counsel review required before launch",
  effective_from: "2026-08-14T00:00:00Z",
});

export const CONSENT_SCOPE_INTAKE = "intake.data_processing";
