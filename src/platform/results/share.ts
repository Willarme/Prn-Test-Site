import { recordCustomerEvent } from "@/platform/events/customer";
import { issueLink } from "@/platform/links/ledger";
import { runtimeStore } from "@/platform/stores/runtime";
import { journeySafetyRule } from "@/domain/problem/journey-safety";

/**
 * "I ALREADY HAVE SOMEONE" — the share message for the homeowner's own
 * provider (campaign track P2, 2026-09-05).
 *
 * One signed `packet` link (§16.2: scoped, revocable, never opens Home Memory
 * or anything else; src/platform/links/tokens.ts), wrapped in the one line
 * the homeowner sends, plus the two one-tap targets: an sms: URL and a
 * mailto: URL carrying the same text. The person's name and number never
 * touch the store or a URL of ours; they only fill the sms:/mailto: target
 * the homeowner's own phone opens.
 *
 * THE EVENT. The brief asks for `trust.own_provider_named` if it exists in the
 * registry. It does not (src/platform/events/names.ts carries the reserved
 * trust.* set: request_created, share_opened, response_submitted, no_provider,
 * good_neighbor_*), and minting a name is A08's call, not this track's. What
 * the registry DOES have is `packet.share_opened`, whose contract in
 * src/app/api/packet-activity/route.ts says exactly this: "when there is [a
 * share link], it emits this same name with a different `surface` value". So
 * that is what is recorded, surface `own_provider_link`.
 *
 * Returns null for a request the store does not know: no link is minted for a
 * record that does not exist.
 */
export const SHARE_TEXT_PREFIX = "Here is my Job Packet: ";
export const SHARE_SUBJECT = "My Job Packet";
/** The one error the send form can show (WORDING: the next step, stated as a fact). */
export const SHARE_UNAVAILABLE = "Start from your results page to make this link.";

export interface ShareMessage {
  share_url: string;
  text: string;
  sms_href: string;
  mailto_href: string;
  link_id_hint: "packet";
}

/** Whether the contact the homeowner typed looks like an email (else a phone). */
export function contactKind(contact: string | null): "email" | "phone" | null {
  if (!contact) return null;
  const c = contact.trim();
  if (!c) return null;
  return c.includes("@") ? "email" : "phone";
}

export async function buildShareMessage(input: {
  request_id: string;
  origin: string;
  contact: string | null;
}): Promise<ShareMessage | null> {
  const store = runtimeStore();
  const journey = await store.getJourney(input.request_id);
  if (!journey) return null;
  const safety = journeySafetyRule(journey.problem);
  if (safety && !safety.intake_may_continue) return null;

  const { token } = (await issueLink({ scope: "packet", request_id: input.request_id }));
  const share_url = `${input.origin}/p/${token}`;
  const text = `${SHARE_TEXT_PREFIX}${share_url}`;
  const body = encodeURIComponent(text);
  const kind = contactKind(input.contact);
  const contact = input.contact?.trim() ?? "";
  // `?&body=` is the form both iOS and Android honour for an sms: body.
  const sms_href = `sms:${kind === "phone" ? contact.replace(/[^\d+]/g, "") : ""}?&body=${body}`;
  const mailto_href = `mailto:${kind === "email" ? encodeURIComponent(contact) : ""}?subject=${encodeURIComponent(
    SHARE_SUBJECT
  )}&body=${body}`;

  await recordCustomerEvent({
    event_name: "packet.share_opened",
    guest_session_id: journey.session.guest_session_id,
    context: {
      request_id: input.request_id,
      problem_id: journey.problem.problem_id,
      job_packet_id: journey.packet.job_packet_id,
      packet_version: String(journey.packet.packet_version),
      surface: "own_provider_link",
    },
    landing_path: `/results/${input.request_id}/send`,
  });

  return { share_url, text, sms_href, mailto_href, link_id_hint: "packet" };
}
