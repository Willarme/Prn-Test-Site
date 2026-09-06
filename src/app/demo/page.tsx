import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import styles from "./demo.module.css";

export const metadata: Metadata = {
  title: "Explore the PRN demo",
  description: "Walk through an AC problem, see the resulting Job Packet and explore the connected home experience.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default function DemoHome() {
  return <main className={styles.demo}>
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <p className={styles.kicker}>Property Response Network / A guided demonstration</p>
        <h1>One problem.<br />A clearer <em>next step.</em></h1>
        <p className={styles.intro}>Start with an AC that is running but blowing warm air. Follow the observations into one organized Job Packet, ready for the next conversation.</p>
        <div className={styles.actions}>
          <Link className={styles.primary} href="/ac-blowing-warm-air">Try the AC walkthrough <span aria-hidden>↗</span></Link>
          <form action="/demo/start" method="post"><input type="hidden" name="intent" value="results" /><button className={styles.secondary} type="submit">Open a sample result <span aria-hidden>→</span></button></form>
        </div>
        <p className={styles.small}>Explore with example details. No account needed. This is a demonstration, not a service request.</p>
      </div>
      <div className={styles.heroFigure}>
        <div className={styles.figureLabel}><span>01 / Start with what you can see</span><span className={styles.dot} aria-hidden /></div>
        <Image src="/images/central-ac-where-to-look-safe-vs-licensed-zones.svg" width={900} height={470} alt="Central AC equipment guide showing safe observations and areas reserved for a licensed technician" unoptimized priority />
        <p>From “it stopped being cold” to a record of what you know.</p>
      </div>
    </section>

    <section className={styles.journey} aria-labelledby="demo-journey">
      <div className={styles.sectionHeading}><p className={styles.kicker}>The working journey</p><h2 id="demo-journey">Follow one problem through.</h2><p>Each step has a job. Your observations carry forward.</p></div>
      <ol className={styles.steps}>
        <li><span className={styles.number}>01</span><h3>Describe it</h3><p>Use plain words, or attach a photo of the equipment. Start on the AC guide.</p><Link href="/ac-blowing-warm-air#intake">Start at the guide <span aria-hidden>→</span></Link></li>
        <li><span className={styles.number}>02</span><h3>Work through it</h3><p>Answer the relevant questions. Keep track of what was checked, skipped or still unknown.</p><form action="/demo/start" method="post"><input type="hidden" name="intent" value="guided" /><button type="submit">Try a sample walkthrough <span aria-hidden>→</span></button></form></li>
        <li><span className={styles.number}>03</span><h3>Take the record</h3><p>Read the result, open the Job Packet and download its PDF. Keep and share controls work on your sample.</p><form action="/demo/start" method="post"><input type="hidden" name="intent" value="results" /><button type="submit">See a sample result <span aria-hidden>→</span></button></form></li>
      </ol>
    </section>

    <section className={styles.ecosystem} aria-labelledby="demo-ecosystem">
      <div className={styles.sectionHeading}><p className={styles.kicker}>The connected experience</p><h2 id="demo-ecosystem">Same home. Different moments.</h2><p>The product previews show where the experience goes next. Their illustrated quotes, schedules and records are examples; feedback controls save real demo responses.</p></div>
      <div className={styles.featureLinks}>
        <Link href="/pages/overview"><span>See the whole picture</span><strong>One Connected Home</strong><span aria-hidden>↗</span></Link>
        <Link href="/pages/trust-network"><span>Choose who to ask</span><strong>Trust Network</strong><span aria-hidden>↗</span></Link>
        <Link href="/pages/home-memory"><span>Keep the story of the home</span><strong>Home Memory</strong><span aria-hidden>↗</span></Link>
      </div>
      <div className={styles.directoryLink}><p>Looking for a particular screen?</p><Link href="/demo/all">Open the full demo directory <span aria-hidden>→</span></Link></div>
    </section>
    <aside className={styles.scope}><strong>About this demonstration</strong><p>The AC intake, guided checks, results, packet downloads and scoped links use the working application. Prepared samples are synthetic and do not call AI. Starting your own example can use the configured AI, with a rule-based fallback when it is unavailable. Email actions create previews; no provider is contacted or booked.</p></aside>
  </main>;
}
