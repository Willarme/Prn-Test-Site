import type { Metadata } from "next";
import Link from "next/link";

/**
 * /local-records/methodology — PRN AI SEO Live Release Final Spec §17,
 * required before any live number. No number is published yet, so this page
 * explains how one WOULD be calculated, and mirrors the door's own
 * "How the numbers are calculated" paragraph verbatim
 * (content/doors/ac-blowing-warm-air.html, the record-method block).
 */
export const metadata: Metadata = {
  title: "How the numbers are calculated",
  robots: { index: false, follow: false },
};

/** VERBATIM from the door. Edit the door first; this copy follows it. */
const DOOR_METHOD_PARAGRAPH =
  "every published metric carries its geography, time window, sample size, source class, calculation version and “reported” or “verified” status. Percentages never publish without a denominator. Small cells are suppressed. A provider-confirmed cause is never inferred from a homeowner guess.";

const RULES: Array<{ h: string; p: string }> = [
  {
    h: "Source records",
    p: "A record is one walkthrough: the first sentence, the photos, the checks done and their results, and the packet built from them. Records that stop early still count as records; they carry fewer facts.",
  },
  {
    h: "Reported, observed, verified",
    p: "Reported is what a homeowner typed. Observed is what a photo or a check showed. Verified is what a provider confirmed on site, and no verified number exists until providers can sign a packet.",
  },
  {
    h: "Geography",
    p: "Every metric names its place: national, state, metro or county. The most specific place with a trustworthy sample is the one shown, and a national figure can appear first while a local cell is still small.",
  },
  {
    h: "Deduplication",
    p: "Two records for the same house and the same problem within the same window count once.",
  },
  {
    h: "Sample thresholds and suppression",
    p: "A cell publishes only once it clears a minimum count. Below that count the card reads “Building the repair record”, and a small cell is suppressed rather than rounded.",
  },
  {
    h: "Time windows",
    p: "Every metric carries the window it was calculated over, and the window is printed beside the number.",
  },
  {
    h: "Medians and percentages",
    p: "A percentage prints with its denominator. A typical value is a median, printed with the count it came from.",
  },
  {
    h: "How updates occur",
    p: "Metrics recalculate on a schedule, carry a calculation version, and a changed version prints as a new number with the old one kept.",
  },
  {
    h: "What is left out",
    p: "Prices, quotes, budgets and anything a homeowner typed that names a person, an address, a code or a contact. A homeowner’s guess at the cause is a reported guess, never a confirmed cause.",
  },
  {
    h: "Privacy",
    p: "Only non-identifying details from a record can reach a metric, and only in aggregate. Photos, addresses and contact details stay with the homeowner.",
  },
  {
    h: "Why national and local can differ",
    p: "A local cell is smaller, more recent and closer to one climate and one housing stock, so it can differ from the national view, and both print their own sample size.",
  },
];

export default function MethodologyPage() {
  return (
    <main>
      <section className="section">
        <div className="wrap-narrow">
          <div className="eyebrow">Local records</div>
          <h1 className="d1">How the numbers are calculated.</h1>
          <p className="lede" style={{ margin: "18px 0 0" }}>
            The first numbers publish when a cell clears the sample threshold. Until then every record
            card reads &ldquo;Building the repair record&rdquo;, and these are the rules a number has to
            pass before it prints.
          </p>
        </div>
      </section>
      <section className="section section-light">
        <div className="wrap-narrow">
          <div className="card-light" data-door-method>
            <p>
              <b>How the numbers are calculated:</b> {DOOR_METHOD_PARAGRAPH}
            </p>
          </div>
          {RULES.map((r) => (
            <div key={r.h} style={{ margin: "22px 0 0" }}>
              <h2 className="d3" style={{ margin: "0 0 6px" }}>
                {r.h}
              </h2>
              <p>{r.p}</p>
            </div>
          ))}
          <p className="hint" style={{ marginTop: 26 }}>
            <Link href="/problems/ac-blowing-warm-air">Back to your AC page</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
