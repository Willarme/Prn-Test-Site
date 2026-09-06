import { randomUUID } from "node:crypto";
import { runtimeStore, type Email } from "@/platform/stores/runtime";

/**
 * THE OUTBOX — one way to send a message, two modes (campaign routine
 * decision 8, 2026-09-05).
 *
 *   EMAIL_MODE=preview (the default, and the demo): the message is stored in
 *   the runtime store's outbox with sent_at null and shown at /mail/<id>. No
 *   network call is made, ever, in this mode. A test pins that with a fetch
 *   seam that throws if touched.
 *
 *   EMAIL_MODE=live: the message is stored, then POSTed to Resend
 *   (https://api.resend.com/emails) with RESEND_API_KEY, and marked sent with
 *   the provider's id when Resend accepts it. Until a sending domain exists
 *   the from-address is Resend's shared onboarding sender, which Resend only
 *   delivers to the account owner's own address: good enough to prove the
 *   wire, and a note for the launch list (a verified domain, then a
 *   from-address on it).
 *
 * NEVER THROWS on the customer path. A live send that fails leaves the row
 * with sent_at null and returns { sent: false, error } so the caller can say
 * so in its own words; the homeowner's own write (the claim, the ask) has
 * already succeeded before any message is attempted.
 *
 * SMS. Nothing delivers a text yet. sendSms() stores an SMS-shaped message
 * in the same outbox (to = the phone number, mode preview) so the flow is
 * complete and honest: /mail/<id> shows it with a note that text delivery is
 * not wired. Telnyx credentials exist in .env.local; wiring them is a
 * follow-up, not a promise this module makes.
 */
export const EMAIL_FROM = "Property Response Network <onboarding@resend.dev>";
const RESEND_URL = "https://api.resend.com/emails";

export type EmailMode = "preview" | "live";

export interface SendInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** The journey this message belongs to, when it belongs to one. */
  request_id?: string | null;
}

export type SendResult =
  | { mode: "preview"; email_id: string; sent: false }
  | { mode: "live"; email_id: string; sent: true; provider_id: string | null }
  | { mode: "live"; email_id: string; sent: false; error: string };

export function emailMode(): EmailMode {
  return process.env.EMAIL_MODE === "live" ? "live" : "preview";
}

type FetchLike = typeof fetch;
let fetchImpl: FetchLike | null = null;

/** Test seam: replace (or forbid) the network call. Pass null to restore. */
export function __setFetchForTests(impl: FetchLike | null): void {
  fetchImpl = impl;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A plain-text body turned into minimal HTML: paragraphs, with URLs as links. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const withLinks = escapeHtml(para).replace(
        /(https?:\/\/[^\s<]+)/g,
        (url) => `<a href="${url}">${url}</a>`
      );
      return `<p>${withLinks.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function send(input: SendInput): Promise<SendResult> {
  const store = runtimeStore();
  const mode = emailMode();
  const email: Email = {
    email_id: `em_${randomUUID()}`,
    request_id: input.request_id ?? null,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html ?? textToHtml(input.text),
    mode,
    created_at: nowIso(),
    sent_at: null,
    provider_id: null,
  };
  await store.enqueueEmail(email);

  if (mode === "preview") {
    return { mode: "preview", email_id: email.email_id, sent: false };
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { mode: "live", email_id: email.email_id, sent: false, error: "RESEND_API_KEY is not set" };
  }
  try {
    const doFetch = fetchImpl ?? fetch;
    const res = await doFetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      return {
        mode: "live",
        email_id: email.email_id,
        sent: false,
        error: `Resend answered ${res.status}${detail ? `: ${detail}` : ""}`,
      };
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    const providerId = typeof body.id === "string" ? body.id : null;
    await store.markEmailSent(email.email_id, nowIso(), providerId);
    return { mode: "live", email_id: email.email_id, sent: true, provider_id: providerId };
  } catch (err) {
    return {
      mode: "live",
      email_id: email.email_id,
      sent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * An SMS-shaped message into the same outbox. Always preview: no text
 * delivery is wired (see the module note). The subject is what /mail shows
 * as the message's kind.
 */
export async function sendSms(input: {
  to: string;
  text: string;
  request_id?: string | null;
}): Promise<{ mode: "preview"; email_id: string; sent: false }> {
  const store = runtimeStore();
  const email: Email = {
    email_id: `sm_${randomUUID()}`,
    request_id: input.request_id ?? null,
    to: input.to,
    subject: "Text message",
    text: input.text,
    html: textToHtml(input.text),
    mode: "preview",
    created_at: nowIso(),
    sent_at: null,
    provider_id: null,
  };
  await store.enqueueEmail(email);
  return { mode: "preview", email_id: email.email_id, sent: false };
}

/** An outbox row addressed to a phone number rather than a mailbox. */
export function isSmsMessage(email: Pick<Email, "to" | "email_id">): boolean {
  return email.email_id.startsWith("sm_") || !email.to.includes("@");
}
