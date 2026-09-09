import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HomeMemoryBlock } from "@/components/links/ApprovedBlocks";
import { LinkOff, linkOffReason } from "@/components/links/LinkOff";
import { emailMode } from "@/platform/email/send";
import { verifyLinkForRoute as verifyLink } from "@/platform/links/tokens";
import { formatWhen, loadRecordView, maskContact } from "@/platform/links/views";

/**
 * /keep/<token> — HOME MEMORY, THIS RECORD PRE-LOADED (track P3).
 *
 * "The filled-in page IS the argument for Home Memory" (Unique Links and
 * Feedback Popup decisions §1): the homeowner scans the pink QR on page 1 of
 * their packet and lands on their own record with nothing to type. The one
 * ask, a single field, comes after they have seen it (§16.1: one field,
 * email or phone, magic link).
 *
 * The keep token is the record's own capability link, so the page shows the
 * homeowner's whole record: statement, facts, photos, timeline, packet
 * summary, address when known. Photos are served through the media bytes
 * route, which accepts a keep-scoped token for its own request.
 */
export const metadata: Metadata = {
  referrer: "no-referrer",
  title: "Keep this",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function KeepPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const link = await verifyLink(token, "keep");
  if (!link.ok) return <LinkOff reason={linkOffReason(link.reason)} />;

  const view = await loadRecordView(link.request_id);
  if (!view) notFound();

  const error = typeof query.error === "string" ? query.error : null;
  const sent = typeof query.sent === "string" ? query.sent : null;
  const kept = Boolean(view.keepState?.confirmed_at);
  const pending = Boolean(view.keepClaim) && !kept;
  const masked = view.keepClaim ? maskContact(view.keepClaim.contact, view.keepClaim.contact_kind) : null;
  const bytesHref = (evidenceId: string) => `/media/${encodeURIComponent(token)}/${encodeURIComponent(evidenceId)}`;
  const linksHref = `/links/${view.request_id}?k=${encodeURIComponent(token)}`;
  const thing = view.thing;
  const Thing = thing.charAt(0).toUpperCase() + thing.slice(1);

  return (
    <main className="section section-light">
      <div className="wrap-narrow">
        <p className="eyebrow">Home Memory</p>
        {kept ? (
          <>
            <h1 className="d2">{`${Thing}'s record is kept.`}</h1>
            <p className="lede">{`Linked to ${masked}. Come back to it any time from your results page.`}</p>
            <p style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link className="btn btn-pink" href={`/results/${view.request_id}?k=${encodeURIComponent(token)}`}>
                Open my results
              </Link>
              <Link className="btn btn-ghost" href={linksHref}>
                Links you shared
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="d2">{`${Thing}, already on file.`}</h1>
            <p className="lede">
              Everything from this request in one place: what you said, what your photos showed, and
              the packet that came out of it.
            </p>
          </>
        )}

        <section className="card-light" style={{ padding: 24, marginTop: 28 }}>
          <p className="mono">What you said</p>
          <blockquote className="prose" style={{ margin: "8px 0 0", fontSize: "1.05rem" }}>
            {view.statement}
          </blockquote>
        </section>

        <section className="card-light" style={{ padding: 24, marginTop: 16 }}>
          <p className="mono">What we know about {thing}</p>
          {view.facts.length === 0 ? (
            <p className="hint">Nothing on file yet beyond what you said. A photo of the label fills this in.</p>
          ) : (
            <dl style={{ margin: "10px 0 0", display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              {view.facts.map((f) => (
                <div key={f.label} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <dt className="hint" style={{ marginTop: 0 }}>{f.label}</dt>
                  <dd style={{ margin: 0, textAlign: "right" }}>
                    <strong>{f.value}</strong>{" "}
                    <span className="hint" style={{ display: "inline", marginTop: 0 }}>({f.source})</span>
                  </dd>
                </div>
              ))}
              {view.address && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <dt className="hint" style={{ marginTop: 0 }}>Address</dt>
                  <dd style={{ margin: 0, textAlign: "right" }}>
                    <strong>
                      {view.address.street}, {view.address.city_state_zip}
                    </strong>
                  </dd>
                </div>
              )}
            </dl>
          )}
        </section>

        <section className="card-light" style={{ padding: 24, marginTop: 16 }}>
          <p className="mono">Your photos</p>
          {view.media.length === 0 ? (
            <p className="hint">No photos on this request yet.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginTop: 10 }}>
              {view.media.map((m) =>
                m.kind === "video" ? (
                  <a key={m.evidence_id} href={bytesHref(m.evidence_id)} className="pill" style={{ padding: 14 }}>
                    Video
                  </a>
                ) : (
                  <a key={m.evidence_id} href={bytesHref(m.evidence_id)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={bytesHref(m.evidence_id)}
                      alt={m.field_key ? `Photo: ${m.field_key.replace(/_/g, " ")}` : "Photo"}
                      style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 4 }}
                    />
                  </a>
                )
              )}
            </div>
          )}
        </section>

        <section className="card-light" style={{ padding: 24, marginTop: 16 }}>
          <p className="mono">What happened, in order</p>
          <ol style={{ margin: "10px 0 0", paddingLeft: 18 }}>
            {view.moments.map((m, i) => (
              <li key={`${m.at}-${i}`} style={{ marginBottom: 6 }}>
                <span className="hint" style={{ display: "inline", marginTop: 0 }}>{formatWhen(m.at)}</span>{" "}
                {m.what}
              </li>
            ))}
          </ol>
        </section>

        <section className="card-light" style={{ padding: 24, marginTop: 16 }}>
          <p className="mono">Your Job Packet</p>
          <p className="prose" style={{ marginTop: 8 }}>{view.summary}</p>
          <p>
            <Link className="btn btn-ghost btn-sm" href={`/results/${view.request_id}?k=${encodeURIComponent(token)}`}>
              Open my Job Packet
            </Link>
          </p>
        </section>

        {!kept && (
          <>
            <HomeMemoryBlock />

            <section className="card-light" style={{ padding: 24 }}>
              {emailMode() === "preview" && (
                <p className="disclosure">Trial preview: your sign-in link opens here. No email or text will be sent.</p>
              )}
              {pending && (
                <p className="disclosure">
                  {emailMode() === "preview"
                    ? `Your preview message for ${masked} is ready. One tap on its link keeps this record.`
                    : `A link went to ${masked}. One tap on it keeps this record.`}
                  {emailMode() === "preview" && view.keepState?.email_id && (
                    <>
                      {" "}
                      <Link href={`/mail/${view.keepState.email_id}?k=${encodeURIComponent(token)}`}>Open the message</Link>
                    </>
                  )}
                </p>
              )}
              {sent === "failed" && (
                <p className="disclosure">The message did not go out. Try the field again in a minute.</p>
              )}
              <form method="post" action="/api/keep">
                <input type="hidden" name="token" value={token} />
                <div className="field">
                  <label className="field-label" htmlFor="contact">
                    Your email or phone
                  </label>
                  <input id="contact" name="contact" className="inp" inputMode="email" autoComplete="email" required />
                  <p className="hint">
                    {error === "contact"
                      ? "Enter an email or a phone number so the link has somewhere to go."
                      : "A link comes to it. One tap on that link and this record stays with your house."}
                  </p>
                </div>
                <button className="btn btn-pink" type="submit">
                  Keep this
                </button>
              </form>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
