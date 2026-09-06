import { cookies } from "next/headers";
import Link from "next/link";
import { HOSTED_SAMPLE_COOKIE, hostedWalkthrough, parseHostedSampleState } from "@/domain/demo/hosted-sample";
import { SampleFrame } from "../SampleFrame";
import styles from "../sample.module.css";
export const dynamic = "force-dynamic";
export default async function SampleWalkthrough() {
  const state = parseHostedSampleState((await cookies()).get(HOSTED_SAMPLE_COOKIE)?.value);
  const view = hostedWalkthrough(state.trail)!;
  return <SampleFrame title="Follow an example, one check at a time." intro="Imagine an eight-year-old Carrier AC that runs but blows warm air. Choose an example observation below and see where the guided questions go. You do not need to inspect any equipment for this demo.">
    <div className={styles.grid}><section className={styles.panel}>
      {view.step ? <><p className={styles.step}>Example check {state.trail.length + 1}</p><h2>{view.step.title}</h2><p>{view.step.instruction}</p><p><strong>What the guide looks for:</strong> {view.step.look_for}</p>{view.step.safety_note && <div className={styles.notice}>{view.step.safety_note}</div>}
        {view.step.input.kind === "rating" && <p>{view.step.input.min_label}<br />{view.step.input.max_label}</p>}
        <form action="/demo/sample/choose" method="post"><input type="hidden" name="action" value="answer" /><input type="hidden" name="step" value={view.step.step_id} /><p className={styles.label}>Choose a fictional response</p><div className={styles.choices}>{view.choices.map(choice => <button className={styles.button} key={choice} name="answer" value={choice} type="submit">{choice === "cannot_reach" ? "Leave this check unperformed" : choice === "yes" ? "Yes" : choice === "no" ? "No" : choice}</button>)}</div></form></> : view.outcome ? <><p className={styles.step}>Example path complete</p><h2>{view.outcome.title}</h2><p>{view.outcome.likely_cause}</p><p>{view.outcome.provider_note}</p><div className={styles.notice}>This is the guidance for your fictional choices. It is not a diagnosis of your own equipment.</div></> : <><h2>Your example observations are ready.</h2><p>Continue to the sample packet to see how they are organized.</p></>}
      <div className={styles.actions}><Link className={styles.button} href="/demo/sample/packet">See these choices in the packet →</Link><Link href="/demo/sample/results">Finish with the sample results</Link></div>
    </section><aside className={styles.panel}><h2>The record grows with the answers.</h2><p>{state.trail.length ? `${state.trail.length} example response${state.trail.length === 1 ? "" : "s"} held in this browser. The HTML packet reflects this path.` : "The prepared packet starts with a clean filter and a running outdoor fan. Your fictional choices let you explore another path."}</p><p>Only the current check appears here. Skipping the remaining questions leaves those observations unknown.</p><p>The downloadable PDF is the original prepared example. Use “Print this view” on the HTML packet for your current choices.</p><form action="/demo/sample/choose" method="post"><input type="hidden" name="action" value="reset" /><button className={`${styles.button} ${styles.secondary}`} type="submit">Start the example over</button></form></aside></div>
  </SampleFrame>;
}
