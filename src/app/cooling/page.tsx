import type { Metadata } from "next";
import Link from "next/link";

/**
 * /cooling — the hub the door links up to. One card per door in the cooling
 * family; the trial has one door, so it has one card. The label is the door's
 * own H1 (content/doors/ac-blowing-warm-air.html), so the words she clicks
 * are the words she lands on.
 */
export const metadata: Metadata = {
  title: "Cooling",
  robots: { index: false, follow: false },
};

export default function CoolingPage() {
  return (
    <main>
      <section className="section">
        <div className="wrap-narrow">
          <div className="eyebrow">Cooling</div>
          <h1 className="d1">Your AC, one problem at a time.</h1>
          <p className="lede" style={{ margin: "18px 0 0" }}>
            Pick the thing your AC is doing. Each page walks it with you and builds a Job Packet
            from what you see.
          </p>
        </div>
      </section>
      <section className="section section-light">
        <div className="wrap-narrow">
          <div className="card-light">
            <span className="pill pill-green">Walkthrough</span>
            <h2 className="d3" style={{ margin: "10px 0 6px" }}>
              <Link href="/problems/ac-blowing-warm-air">AC running but blowing warm air?</Link>
            </h2>
            <p style={{ marginBottom: 12 }}>
              Filter, outdoor unit, fan, fins. A few looks narrow it, and the packet keeps every one.
            </p>
            <Link href="/problems/ac-blowing-warm-air" className="btn btn-pink btn-sm">
              Start with what your AC is doing
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
