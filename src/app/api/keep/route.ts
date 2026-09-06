import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { send, sendSms } from "@/platform/email/send";
import { recordKeepRequested } from "@/platform/links/ledger";
import { readBody, redirect303 } from "@/platform/links/body";
import { signLink, verifyLinkForRoute as verifyLink } from "@/platform/links/tokens";
import { classifyContact, linkBase } from "@/platform/links/views";
import { runtimeStore } from "@/platform/stores/runtime";

/**
 * "KEEP THIS" — the one-field Home Memory claim (Master Build Spec MERGED
 * §16.1 BINDING: one field, email or phone, magic link, no password).
 *
 * The keep token proves the caller holds the record's own link; the contact
 * they type is where the magic link goes. Nothing about them travels in a
 * URL: the contact lands in keep_claims and the outbox, the magic link
 * carries only a random id (§16.2's security constraint).
 *
 * ORDER OF WRITES. Magic link row, then the claim row that points at it,
 * then the message. A message that fails to send leaves a claim the
 * homeowner can retry from the same page; a claim without its magic row
 * would be a dead end, which is why the row goes first.
 *
 * DEFAULT pending Melissa: no decision names a magic-link lifetime; 7 days,
 * single use (the store's consumeMagicLink is the single-use gate).
 */
const MAGIC_TTL_DAYS = 7;

export async function POST(request: Request): Promise<Response> {
  const { data, wantsJson } = await readBody(request);
  const token = data.token ?? "";
  const back = `/keep/${encodeURIComponent(token)}`;

  const link = await verifyLink(token, "keep");
  if (!link.ok) {
    return wantsJson ? NextResponse.json({ error: link.reason === "unavailable" ? "unavailable" : "link_off" }, { status: link.reason === "unavailable" ? 503 : 403 }) : redirect303(back);
  }
  const contact = classifyContact(data.contact ?? "");
  if (!contact) {
    return wantsJson
      ? NextResponse.json({ error: "contact" }, { status: 400 })
      : redirect303(`${back}?error=contact`);
  }

  const store = runtimeStore();
  const now = new Date().toISOString();
  const magic_id = `mg_${randomBytes(24).toString("base64url")}`;
  await store.saveMagicLink({
    magic_id,
    request_id: link.request_id,
    contact: contact.value,
    created_at: now,
    consumed_at: null,
  });
  await store.saveKeepClaim({
    request_id: link.request_id,
    contact: contact.value,
    contact_kind: contact.kind,
    claimed_at: now,
    magic_link_id: magic_id,
  });

  const magicToken = signLink({
    scope: "magic",
    request_id: link.request_id,
    ttl_days: MAGIC_TTL_DAYS,
    extra: { magic_id },
  });
  const base = linkBase(request);
  const claimUrl = `${base}/claim/${magicToken}`;
  const resultsUrl = `${base}/results/${link.request_id}?k=${encodeURIComponent(token)}`;
  const linksUrl = `${base}/links/${link.request_id}?k=${encodeURIComponent(token)}`;

  let email_id: string;
  let sent = false;
  let mode: "preview" | "live" = "preview";
  if (contact.kind === "email") {
    const result = await send({
      to: contact.value,
      subject: "Your link to keep this record",
      text: [
        "Tap this link to keep this record with your house:",
        claimUrl,
        "",
        `The link works once. Your results page stays at ${resultsUrl}`,
        `Links you have shared, with a switch for each: ${linksUrl}`,
      ].join("\n"),
      request_id: link.request_id,
    });
    email_id = result.email_id;
    mode = result.mode;
    sent = result.sent;
  } else {
    const result = await sendSms({
      to: contact.value,
      text: `Property Response Network: tap to keep this record with your house. Works once. ${claimUrl}`,
      request_id: link.request_id,
    });
    email_id = result.email_id;
  }
  recordKeepRequested(link.request_id, { email_id, magic_id });

  if (wantsJson) {
    return NextResponse.json({ ok: true, email_id, mode, sent, request_id: link.request_id });
  }
  if (mode === "preview") return redirect303(`/mail/${email_id}?k=${encodeURIComponent(token)}`);
  return redirect303(`${back}?sent=${sent ? "1" : "failed"}`);
}
