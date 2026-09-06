import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isSmsMessage } from "@/platform/email/send";
import { readLinkLedger } from "@/platform/links/ledger";
import { formatWhen } from "@/platform/links/views";
import { runtimeStore } from "@/platform/stores/runtime";
import { ownerAllowed } from "@/platform/links/owner";

/**
 * /mail/<email_id> — THE OUTBOX, SHOWN (track P3; routine decision 8).
 *
 * In preview mode nothing is sent, so this page IS the message: the stored
 * subject and text, the links inside it clickable, under a banner that says
 * plainly it was never sent. In live mode it shows the same message with
 * when it went. An SMS-shaped row (a phone number as the address) says that
 * text delivery is not wired, which is a real limit stated once, flat.
 *
 * The id is a random uuid; the page is not indexed; a message shows only
 * what the homeowner typed and the links minted for their own request.
 */
export const metadata: Metadata = {
  referrer: "no-referrer",
  title: "Message",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Plain text with its URLs turned into anchors. Everything else is rendered as text. */
function linkify(text: string): ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s<]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} style={{ wordBreak: "break-all" }}>
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export default async function MailPage({ params, searchParams }: { params: Promise<{ email_id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { email_id } = await params;
  const email = await runtimeStore().getEmail(email_id);
  const query = await searchParams;
  const k = typeof query.k === "string" ? query.k : undefined;
  if (!email?.request_id || !(await ownerAllowed(email.request_id, k))) notFound();

  const sms = isSmsMessage(email);
  const preview = email.mode === "preview";
  const keepLink = email.request_id
    ? readLinkLedger(email.request_id).links.find((l) => l.scope === "keep")
    : null;
  const linksHref = email.request_id
    ? `/links/${email.request_id}${keepLink ? `?k=${encodeURIComponent(keepLink.token)}` : ""}`
    : null;

  return (
    <main className="section section-light">
      <div className="wrap-narrow">
        <p className="eyebrow">{sms ? "Text message" : "Email"}</p>
        {preview ? (
          <p className="pill pill-pink" role="status">
            PREVIEW — not sent
          </p>
        ) : email.sent_at ? (
          <p className="pill pill-green" role="status">
            Sent {formatWhen(email.sent_at)}
          </p>
        ) : (
          <p className="pill pill-amber" role="status">
            Sending failed. The message is stored here.
          </p>
        )}
        {sms && (
          <p className="disclosure">Text message delivery is not wired yet. The message is stored here instead.</p>
        )}

        <article className="card-light" style={{ padding: 24, marginTop: 20 }}>
          <p className="hint" style={{ marginTop: 0 }}>
            To <strong>{email.to}</strong>
          </p>
          <h1 className="d3" style={{ marginTop: 6 }}>
            {email.subject}
          </h1>
          <div className="prose" style={{ whiteSpace: "pre-wrap", marginTop: 16 }}>
            {linkify(email.text)}
          </div>
        </article>

        {linksHref && (
          <p style={{ marginTop: 20 }}>
            <Link className="btn btn-ghost btn-sm" href={linksHref}>
              Links you shared
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
