import Link from "next/link";
import { FEATURE_CONCEPTS } from "@/domain/feature-lab/concepts";
import { allStagedSpecs } from "@/platform/admin/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  // UI only — zero business logic lives in this layer.
  const staged = await allStagedSpecs();
  return (
    <main>
      <section className="section">
        <div className="wrap">
          <div className="eyebrow">One clear next step</div>
          <h1 className="d1">
            Something happened in your home.
            <br />
            <em>Start with what happened.</em>
          </h1>
          <p className="lede" style={{ margin: "22px 0 34px" }}>
            You don&apos;t have to know what broke, what it&apos;s called, or who fixes it.
            Describe it the way you&apos;d tell a neighbor — we turn it into an organized,
            provider-ready Job Packet.
          </p>
          <Link href="/start" className="btn btn-pink">
            Start with what happened
          </Link>
        </div>
      </section>
      <section className="section section-light">
        <div className="wrap">
          <div className="grid3">
            <div className="cell">
              <span className="tag">01 · Tell us</span>
              <h2 className="d3">Plain words are enough</h2>
              <p>&quot;Water drips through the kitchen ceiling when someone showers.&quot; That&apos;s a perfect start.</p>
            </div>
            <div className="cell">
              <span className="tag">02 · We organize</span>
              <h2 className="d3">One Job Packet</h2>
              <p>Symptoms, timing, photos, context and the questions that matter — organized once, ready for any provider.</p>
            </div>
            <div className="cell">
              <span className="tag">03 · You choose</span>
              <h2 className="d3">Your people first</h2>
              <p>Send it to someone you already trust, ask your people, or have us suggest one provider with reasons.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Trial navigator: staging is private (noindex + robots-blocked), so
          every surface is linked here for the owner and testers. */}
      <section className="section">
        <div className="wrap">
          <div className="eyebrow">Trial navigator · staging only</div>
          <h2 className="d3" style={{ marginBottom: 18 }}>Everything built so far, one click away</h2>
          <div className="grid3">
            <div className="cell">
              <span className="tag">Owner</span>
              <Link href="/admin" className="btn btn-pink btn-sm">Open Admin dashboard</Link>
              <p className="hint" style={{ color: "var(--on-dark-mute)", marginTop: 10 }}>Opportunities, pages, QA, publish, page-creator controls, requests.</p>
            </div>
            <div className="cell">
              <span className="tag">Customer journey</span>
              <Link href="/start" className="btn btn-ghost btn-sm">/start</Link>
              <p className="hint" style={{ color: "var(--on-dark-mute)", marginTop: 10 }}>The shared intake — same form every door embeds.</p>
            </div>
            <div className="cell">
              <span className="tag">Future Feature Lab</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {FEATURE_CONCEPTS.map((c) => (
                  <Link key={c.slug} href={`/future/${c.slug}`} className="chip">{c.name}</Link>
                ))}
              </div>
            </div>
          </div>
          <div className="cell" style={{ marginTop: 1 }}>
            <span className="tag">Staged door pages ({staged.length}) — pending QA + your approval</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {staged.map((s) => (
                <Link key={s.page_spec_id} href={`/staged/${s.canonical_path.replace(/^\/problems\//, "")}`} className="chip">
                  {s.h1} <span className={`pill ${s.qa.state === "PASS" ? "pill-green" : s.qa.state === "FAIL" ? "pill-pink" : "pill-amber"}`}>{s.qa.state}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
