import type { Metadata } from "next";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";

/**
 * /privacy — DRAFT placeholder. Prints the counsel-review draft disclosure
 * (domain/privacy/disclosures.ts) and the three facts the build already
 * enforces, each of which is checkable in code. No invented clauses.
 */
export const metadata: Metadata = {
  title: "Privacy Notice",
  robots: { index: false, follow: false },
};

export default function PrivacyPage() {
  return (
    <main>
      <section className="section">
        <div className="wrap-narrow">
          <div className="eyebrow">Privacy</div>
          <h1 className="d1">Privacy Notice.</h1>
          <p className="pill pill-amber" style={{ display: "inline-block", marginTop: 16 }} data-draft>
            Draft — counsel review pending
          </p>
        </div>
      </section>
      <section className="section section-light">
        <div className="wrap-narrow">
          <div className="card-light">
            <p className="hint" style={{ marginBottom: 8 }}>
              The notice shown at the point you start a request (disclosure version{" "}
              {ACTIVE_DISCLOSURE.version_label}):
            </p>
            <p className="disclosure">{ACTIVE_DISCLOSURE.content_text}</p>
          </div>
          <h2 className="d3" style={{ margin: "22px 0 6px" }}>
            What the build does with your details today
          </h2>
          <ul style={{ paddingLeft: 20 }}>
            <li>Your photos are stored privately, and location data is stripped from them before any reading.</li>
            <li>Your Job Packet prints a contact preference, never a phone number, an email address or a door code.</li>
            <li>A link you share can be turned off by you; the record stays with your request.</li>
          </ul>
          <p className="hint" style={{ marginTop: 18 }}>
            The full notice arrives after counsel review. Until then, the disclosure above is the whole of
            what you have agreed to.
          </p>
        </div>
      </section>
    </main>
  );
}
