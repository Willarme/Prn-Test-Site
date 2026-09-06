import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./sample.module.css";

export function SampleFrame({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return <div className={styles.surface}><main className={styles.shell}><nav className={styles.bar} aria-label="Sample demonstration"><Link href="/demo">← Demo entrance</Link><span className={styles.label}>Prepared AC example / Explore the process</span><Link href="/demo/sample/results">Sample results →</Link></nav><p className={styles.label}>Property Response Network</p><h1 className={styles.title}>{title}</h1><p className={styles.intro}>{intro}</p>{children}<div className={styles.notice}>This is an invented AC example. It does not create a service request, contact a provider, send an email or access a homeowner’s records. Choices stay in this browser’s sample cookie for one day.</div><nav className={styles.links} aria-label="Continue the sample"><Link href="/demo/sample/walkthrough">Try guided checks</Link><Link href="/demo/sample/packet">Read the sample packet</Link><Link href="/demo/all">Explore every demo</Link></nav></main></div>;
}
