import { cookies } from "next/headers";
import Link from "next/link";
import { HOSTED_SAMPLE_COOKIE, parseHostedSampleState } from "@/domain/demo/hosted-sample";
import { SampleFrame } from "../SampleFrame";
import styles from "../sample.module.css";
export const dynamic = "force-dynamic";
export default async function SampleKeep() {
  const state = parseHostedSampleState((await cookies()).get(HOSTED_SAMPLE_COOKIE)?.value);
  return <SampleFrame title="Give the example a place to return to." intro="Home Memory connects the equipment, the observations and the work that follows. Try a small browser-only example of keeping this packet."><div className={styles.grid}><section className={styles.panel}><p className={styles.label}>Example home / 123 Demo Lane</p><h2>Carrier AC · cooling problem</h2><p>Eight years old. Running but blowing warm air. Prepared notes and your fictional walkthrough choices stay together in this sample.</p>{state.kept ? <p className={styles.receipt} role="status">Example marked as saved in this browser for one day. No Home Memory account or customer record was created.</p> : <form action="/demo/sample/choose" method="post"><input type="hidden" name="action" value="keep" /><button className={styles.button} type="submit">Save the example in this browser</button></form>}<div className={styles.actions}><Link href="/demo/sample/packet">Open the sample packet →</Link></div></section><aside className={styles.panel}><h2>See the wider idea.</h2><p>The Home Memory concept shows how equipment, repair history and documents could build a useful record over time.</p><Link className={`${styles.button} ${styles.secondary}`} href="/pages/home-memory">Explore Home Memory</Link></aside></div></SampleFrame>;
}
