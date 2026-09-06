"use client";
import { useState } from "react";
import styles from "./sample.module.css";
export function CopyPreview({ text, link = false }: { text: string; link?: boolean }) {
  const [message, setMessage] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(link ? `${window.location.origin}/demo/sample/results` : text); setMessage(link ? "Generic sample link copied. It carries no private record or your browser choices." : "Example message copied. Nothing has been sent."); }
    catch { setMessage("Clipboard is unavailable. Select and copy the example text shown on this page."); }
  }
  return <div><button className={styles.button} type="button" onClick={copy}>{link ? "Copy sample link" : "Copy example message"}</button>{message && <p className={styles.receipt} role="status">{message}</p>}</div>;
}
