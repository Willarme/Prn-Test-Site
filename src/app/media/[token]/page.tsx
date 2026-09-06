import type { Metadata } from "next";
import { redactSharedText } from "@/domain/privacy/share-text";
import { notFound } from "next/navigation";
import { LinkOff, linkOffReason } from "@/components/links/LinkOff";
import { verifyLinkForRoute as verifyLink } from "@/platform/links/tokens";
import { loadRecordView } from "@/platform/links/views";

/**
 * /media/<token> — THE PROVIDER MEDIA LINK (track P3; DECISIONS FOR MELISSA
 * decision 7, recommendation A, taken as the campaign default).
 *
 * A read-only gallery of the journey's photos and video for the person the
 * packet was handed to. The two conditions on A are not optional and both
 * live in the bytes route: location metadata is stripped from every JPEG on
 * the way out, and the link is revocable from the homeowner's side. This
 * page shows the homeowner's own first sentence for context and nothing
 * that identifies them: no name, no contact, no address (§17 rule 5).
 *
 * Design the link on the assumption it will end up with someone the
 * homeowner never chose: a revoked, expired, forged or wrong-scope token
 * gets the plain switched-off screen.
 */
export const metadata: Metadata = {
  referrer: "no-referrer",
  title: "Photos and video for this job",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function MediaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await verifyLink(token, "media");
  if (!link.ok) return <LinkOff reason={linkOffReason(link.reason)} />;

  const view = await loadRecordView(link.request_id);
  if (!view) notFound();

  const bytesHref = (evidenceId: string) => `/media/${encodeURIComponent(token)}/${encodeURIComponent(evidenceId)}`;

  return (
    <main className="section section-light">
      <div className="wrap-narrow">
        <p className="eyebrow">Provider link</p>
        <h1 className="d2">Photos and video for this job</h1>
        <p className="lede">
          Shared by the homeowner. Each image is served with its location data removed. Full-size
          originals open on tap.
        </p>

        <section className="card-light" style={{ padding: 24, marginTop: 28 }}>
          <p className="mono">In the homeowner&apos;s words</p>
          <blockquote className="prose" style={{ margin: "8px 0 0", fontSize: "1.05rem" }}>
            {redactSharedText(view.statement)}
          </blockquote>
        </section>

        <section style={{ marginTop: 24 }}>
          {view.media.length === 0 ? (
            <p className="hint">No photos or video on this job yet.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {view.media.map((m) =>
                m.kind === "video" ? (
                  <div key={m.evidence_id} className="card-light" style={{ padding: 8 }}>
                    <video controls preload="metadata" src={bytesHref(m.evidence_id)} style={{ width: "100%", borderRadius: 4 }} />
                    <p className="hint">Video</p>
                  </div>
                ) : (
                  <a key={m.evidence_id} href={bytesHref(m.evidence_id)} className="card-light" style={{ padding: 8, display: "block" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={bytesHref(m.evidence_id)}
                      alt={m.field_key ? `Photo: ${m.field_key.replace(/_/g, " ")}` : "Photo"}
                      style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 4 }}
                    />
                    <p className="hint">{m.field_key ? m.field_key.replace(/_/g, " ") : "Photo"}</p>
                  </a>
                )
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
