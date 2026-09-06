/**
 * THE "EMAIL IT TO ME INSTEAD" MESSAGE — built here, handed to the outbox
 * (src/platform/email/send.ts, track P3), which stores it and shows it at
 * /mail/<id> in preview mode (routine decision 8) or sends it through Resend
 * when EMAIL_MODE=live.
 *
 * Two links and nothing the packet does not already carry: the packet page
 * and its PDF, both under the request origin (routine decision 9, link_base =
 * the request origin). No contact details, no codes, no packet contents; the
 * message is a pointer to a page the homeowner already holds.
 *
 * WORDING (new strings, listed in the P2 report): state the fact, second
 * person, no praise for finishing our flow (rule 50), nothing negated (rule 1).
 * The optional name goes at the top when given; "skip for now" leaves it out
 * (PRN Master Build Spec MERGED §16.1).
 */
export const PACKET_EMAIL_SUBJECT = "Your Job Packet";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface PacketMessage {
  subject: string;
  text: string;
  html: string;
}

export function buildPacketMessage(input: {
  request_id: string;
  name: string | null;
  origin: string;
  owner_key: string;
}): PacketMessage {
  const id = encodeURIComponent(input.request_id);
  const query = `?k=${encodeURIComponent(input.owner_key)}`;
  const packetUrl = `${input.origin}/packet/${id}${query}`;
  const pdfUrl = `${input.origin}/packet/${id}/pdf${query}`;
  const greeting = input.name ? `Hi ${input.name},\n\n` : "";
  const text =
    `${greeting}Your Job Packet is ready.\n\n` +
    `Open your packet: ${packetUrl}\n` +
    `Download the PDF: ${pdfUrl}\n\n` +
    `Property Response Network`;
  const html =
    `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.55;color:#12161A">` +
    (input.name ? `<p>Hi ${escapeHtml(input.name)},</p>` : "") +
    `<p>Your Job Packet is ready.</p>` +
    `<p><a href="${packetUrl}">Open your packet</a><br>` +
    `<a href="${pdfUrl}">Download the PDF</a></p>` +
    `<p style="color:#5A6462">Property Response Network</p>` +
    `</div>`;
  return { subject: PACKET_EMAIL_SUBJECT, text, html };
}
