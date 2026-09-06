import type { Metadata } from "next";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";

/**
 * /terms — DRAFT placeholder. The intake disclosure links to "the Terms and
 * Privacy Notice", so the link has to land somewhere honest. This page prints
 * the counsel-review draft disclosure (domain/privacy/disclosures.ts, the one
 * text the consent record points at) and nothing invented: no clauses, no
 * jurisdiction language, no dates beyond the disclosure's own. Counsel writes
 * the rest.
 */
export const metadata: Metadata = {
  title: "Terms",
  robots: { index: false, follow: false },
};

export default function TermsPage() {
  return (
    <main>
      <section className="section">
        <div className="wrap-narrow">
          <div className="eyebrow">Terms</div>
          <h1 className="d1">Terms of use.</h1>
          <p className="pill pill-amber" style={{ display: "inline-block", marginTop: 16 }} data-draft>
            Draft — counsel review pending
          </p>
        </div>
      </section>
      <section className="section section-light">
        <div className="wrap-narrow">
          <div className="card-light">
            <p className="hint" style={{ marginBottom: 8 }}>
              What you agree to when you start a request, as shown at the point you agreed
              (disclosure version {ACTIVE_DISCLOSURE.version_label}):
            </p>
            <p className="disclosure">{ACTIVE_DISCLOSURE.content_text}</p>
          </div>
          <p className="hint" style={{ marginTop: 18 }}>
            The full terms arrive after counsel review. Until then, the disclosure above is the whole of
            what you have agreed to.
          </p>
        </div>
      </section>
    </main>
  );
}
