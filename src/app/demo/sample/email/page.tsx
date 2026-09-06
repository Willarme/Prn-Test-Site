import Link from "next/link";
import { SampleFrame } from "../SampleFrame";
import { CopyPreview } from "../CopyPreview";
import styles from "../sample.module.css";
const message = "Subject: Your sample AC Job Packet\n\nHere is the prepared example showing the AC observations, safe checks and questions for a provider.\n\nOpen the demonstration at https://prn-test-site.vercel.app/demo/sample/results\n\nThis is an invented example, not a service request.";
export default function SampleEmail() { return <SampleFrame title="A packet you could return to." intro="Preview the kind of email that would accompany the packet. This demonstration does not ask for an address or send a message."><section className={styles.panel}><p className={styles.label}>Email preview / No recipient</p><div className={styles.preview}>{message}</div><div className={styles.actions}><CopyPreview text={message} /><Link href="/demo/sample/packet.pdf" className={`${styles.button} ${styles.secondary}`}>Download the prepared PDF</Link></div></section></SampleFrame>; }
