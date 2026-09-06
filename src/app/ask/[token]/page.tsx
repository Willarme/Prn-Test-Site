import type { Metadata } from "next";
import { redactSharedText } from "@/domain/privacy/share-text";
import { notFound } from "next/navigation";
import { TrustMapBlock } from "@/components/links/ApprovedBlocks";
import { LinkOff, linkOffReason } from "@/components/links/LinkOff";
import { verifyLinkForRoute as verifyLink } from "@/platform/links/tokens";
import { loadRecordView } from "@/platform/links/views";

/**
 * /ask/<token> — THE FRIEND'S PAGE (track P3).
 *
 * Master Build Spec MERGED §16.2: "The friend answers without an account.
 * Limited to the specific request context." WORDING 41: one name, the
 * person it came from, the reason attached, one tap; nothing asks the
 * friend to learn what PRN is. So the page shows the friend exactly one
 * thing about the request, the homeowner's own first sentence, and asks for
 * the one name. No photos, no address, no contact details.
 */
export const metadata: Metadata = {
  referrer: "no-referrer",
  title: "Who would you call?",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AskPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const link = await verifyLink(token, "ask");
  if (!link.ok) return <LinkOff reason={linkOffReason(link.reason)} />;

  const view = await loadRecordView(link.request_id);
  if (!view) notFound();

  const thanks = query.thanks === "1";
  const error = typeof query.error === "string" ? query.error : null;

  if (thanks) {
    return (
      <main className="section section-light">
        <div className="wrap-narrow">
          <p className="eyebrow">Trust Network</p>
          <h1 className="d2">Sent.</h1>
          <p className="lede">Your friend gets the name and the reason you gave it.</p>
          <TrustMapBlock />
        </div>
      </main>
    );
  }

  return (
    <main className="section section-light">
      <div className="wrap-narrow">
        <p className="eyebrow">Trust Network</p>
        <p className="prose">A friend of yours has this problem:</p>
        <blockquote className="card-light" style={{ padding: 20, margin: "0 0 28px", fontSize: "1.1rem" }}>
          {redactSharedText(view.statement)}
        </blockquote>
        <h1 className="d2">Who would you call for this?</h1>
        <p className="lede">One name. Your friend gets it with your reason attached, and that is the whole favour.</p>

        <form method="post" action="/api/ask" className="card-light" style={{ padding: 24, marginTop: 24 }}>
          <input type="hidden" name="token" value={token} />
          <div className="field">
            <label className="field-label" htmlFor="friend_name">
              Your name
            </label>
            <input id="friend_name" name="friend_name" className="inp" maxLength={120} autoComplete="name" required />
            {error === "name" && <p className="hint">Add your name so your friend knows who this came from.</p>}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="provider_name">
              Who you would call
            </label>
            <input id="provider_name" name="provider_name" className="inp" maxLength={160} required />
            {error === "provider" && <p className="hint">Add the name you would call.</p>}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="provider_contact">
              Their phone or website (if you have it)
            </label>
            <input id="provider_contact" name="provider_contact" className="inp" maxLength={200} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="reason">
              Why them (a line is plenty)
            </label>
            <textarea id="reason" name="reason" className="inp" maxLength={500} style={{ minHeight: 90 }} />
          </div>
          <button className="btn btn-pink" type="submit">
            Send this name
          </button>
        </form>
      </div>
    </main>
  );
}
