import Link from "next/link";
import { ResultsTemplate } from "@/components/results/ResultsTemplate";
import { HOSTED_SAMPLE_ID } from "@/domain/demo/hosted-sample";
import styles from "../sample.module.css";
export default function SampleResultsPage() {
  return <><aside className={styles.resultNotice} aria-label="Sample scope"><span>Prepared AC example · An invented home. Explore each next step without sending or booking anything.</span><Link href="/demo/sample/walkthrough">Try guided checks →</Link></aside><ResultsTemplate requestId={HOSTED_SAMPLE_ID} keepHref="/demo/sample/keep" askHref="/demo/sample/ask" navigation={{ packet: "/demo/sample/packet", email: "/demo/sample/email", send: "/demo/sample/send", find: "/demo/sample/find" }} /></>;
}
