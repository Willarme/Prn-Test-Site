"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CANNOT_REACH_STEP_ANSWER } from "@/domain/intake/extract";
import type { Outcome, StepView, WalkthroughView } from "@/domain/intake/playbook";
import styles from "./DiagnoseWalkthrough.module.css";

/**
 * Box 2 — guided diagnosis. One step at a time; the branch is resolved
 * SERVER-SIDE (the playbook graph never reaches the browser — T1-15). Every
 * answer, photo, and "Start over" is a round-trip that returns exactly the
 * next `WalkthroughView`: the current step, or the reached outcome, never
 * the rest of the graph. No AI call per step. Answers are saved as they
 * happen so the packet updates even if the customer stops halfway.
 *
 * Campaign track P4 (2026-09-05):
 *   - every step carries "I can't get to this" (merged spec §8.3 — no question
 *     is ever blocking). It is a real answer: the server records the gap, the
 *     packet lists it under Still unknown with the reason, and the walkthrough
 *     moves on. There is no view without a way to the Job Packet.
 *   - after each answer, one line says what it changed (checklist C6), in the
 *     server's words for the branch actually taken.
 */
export function DiagnoseWalkthrough({
  requestId,
  ownerKey,
  initialView,
  resumed,
}: {
  requestId: string;
  ownerKey?: string;
  initialView: WalkthroughView;
  resumed: boolean;
}) {
  const router = useRouter();
  const controlId = useId();
  const [step, setStep] = useState<StepView | null>(initialView.step);
  const [outcome, setOutcome] = useState<Outcome | null>(initialView.outcome);
  const [changed, setChanged] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  function applyView(view: WalkthroughView | undefined | null) {
    setStep(view?.step ?? null);
    setOutcome(view?.outcome ?? null);
  }

  async function answer(value: string) {
    if (!step) return;
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/intake/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, k: ownerKey, step: { step_id: step.step_id, answer: value } }),
    }).catch(() => null);
    setBusy(false);
    const data = await res?.json().catch(() => null);
    if (data?.safety?.intake_may_continue === false && typeof data.next === "string" && /^\/safety\/[a-z0-9_]+$/.test(data.next)) {
      router.replace(data.next);
      return;
    }
    if (!res?.ok) {
      setErr(typeof data?.error === "string" ? data.error : "Could not save that answer — try again.");
      return;
    }
    setChanged(typeof data.changed === "string" ? data.changed : null);
    setStarted(true);
    applyView(data.view);
    setText("");
    router.refresh();
  }

  async function photo(file: File) {
    if (!step) return;
    setBusy(true);
    setErr(null);
    const form = new FormData();
    form.set("request_id", requestId);
    if (ownerKey) form.set("k", ownerKey);
    form.set("target", `step:${step.step_id}`);
    form.set("file", file);
    const res = await fetch("/api/intake/media", { method: "POST", body: form }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setErr(data?.error ?? "Upload failed — try again.");
      return;
    }
    const data = await res.json();
    setChanged("Your photo is in the packet.");
    setStarted(true);
    applyView(data.view);
    router.refresh();
  }

  const packetLink = (
    <Link href={`/results/${requestId}${ownerKey ? `?k=${encodeURIComponent(ownerKey)}` : ""}`} className="btn btn-pink btn-sm" data-packet-link>
      View my Job Packet →
    </Link>
  );

  const changedLine = changed ? (
    <p
      className="hint"
      data-changed
      style={{
        margin: "0 0 12px",
        padding: "8px 10px",
        borderLeft: "3px solid var(--green)",
        background: "var(--chalk)",
        color: "var(--ink)",
      }}
    >
      <strong>What that changed:</strong> {changed}
    </p>
  ) : null;

  if (outcome) {
    return (
      <div className={`card-light ${styles.root}`}>
        {changedLine}
        <span className="pill pill-green">Walkthrough complete</span>
        <h2 className="d3" style={{ margin: "10px 0 6px" }}>
          {outcome.title}
        </h2>
        <p style={{ marginBottom: 12 }}>{outcome.likely_cause}</p>
        {outcome.diy_steps.length > 0 && (
          <>
            <strong>{outcome.diy_possible ? "What you can safely do now" : "For now"}</strong>
            <ul style={{ paddingLeft: 20, margin: "6px 0 12px" }}>
              {outcome.diy_steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </>
        )}
        <strong>How to think about the next step</strong>
        <ul style={{ paddingLeft: 20, margin: "6px 0 12px" }}>
          {outcome.decision_frame.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
        <p className="hint">
          This is an elimination guide, not a diagnosis. Everything you answered is already in your
          Job Packet so a provider starts where you left off.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          {packetLink}
          <Link className="btn btn-ghost btn-sm" href="/start">Start a new walkthrough</Link>
        </div>
      </div>
    );
  }

  if (!step) {
    return (
      <div className={`card-light ${styles.root}`}>
        {changedLine}
        {started ? (
          <>
            <p>That is everything for this one. What you answered is in your Job Packet.</p>
            <div style={{ marginTop: 12 }}>{packetLink}</div>
          </>
        ) : (
          <p>This problem type doesn&apos;t have a guided walkthrough yet — your details above are what matter most.</p>
        )}
      </div>
    );
  }

  return (
    <div className={`card-light ${styles.root}`}>
      {changedLine}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="mono" style={{ color: "var(--on-light-mute)" }}>
          Step {step.step_number} of {step.total_steps}
        </span>
        {resumed && <span className="pill">resumed</span>}
      </div>
      <h2 id={`${controlId}-title`} className="d3" style={{ margin: "8px 0 6px" }}>
        {step.title}
      </h2>
      {step.safety_note && (
        <div className="safety-note" style={{ margin: "8px 0 12px" }}>
          {step.safety_note}
        </div>
      )}
      <p style={{ marginBottom: 8 }}>{step.instruction}</p>
      <p className="hint" style={{ marginBottom: 14 }}>
        <strong>What you&apos;re looking for:</strong> {step.look_for}
      </p>
      {err && (
        <p role="alert" style={{ color: "var(--pink-ink)", marginBottom: 10 }}>
          {err}
        </p>
      )}

      {step.input.kind === "yes_no" && (
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-pink" disabled={busy} onClick={() => answer("yes")}>Yes</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => answer("no")}>No</button>
        </div>
      )}
      {step.input.kind === "choice" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {step.input.options.map((o) => (
            <button key={o} className="chip" disabled={busy} onClick={() => answer(o)}>
              {o}
            </button>
          ))}
        </div>
      )}
      {step.input.kind === "rating" && (
        <div className={styles.rating}>
          <input
            id={controlId}
            className={styles.ratingInput}
            type="range"
            min={0}
            max={10}
            value={rating}
            aria-labelledby={`${controlId}-title`}
            aria-describedby={`${controlId}-min ${controlId}-max`}
            onChange={(e) => setRating(Number(e.target.value))}
          />
          <output className={styles.ratingValue} htmlFor={controlId}>{rating}</output>
          <div className={`hint ${styles.ratingLabels}`}>
            <span id={`${controlId}-min`}>{step.input.min_label}</span>
            <span id={`${controlId}-max`}>{step.input.max_label}</span>
          </div>
          <button className="btn btn-pink" style={{ marginTop: 10 }} disabled={busy} onClick={() => answer(String(rating))}>
            That&apos;s about a {rating}
          </button>
        </div>
      )}
      {step.input.kind === "photo" && (
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,video/mp4,video/quicktime"
            capture="environment"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) photo(f);
            }}
          />
          <button className="btn btn-pink" disabled={busy} onClick={() => fileInput.current?.click()}>
            {busy ? "Uploading…" : "📷 Snap a photo"}
          </button>
        </div>
      )}
      {step.input.kind === "text" && (
        <div className={styles.textControls}>
          <input className="inp" aria-labelledby={`${controlId}-title`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && answer(text)} />
          <button className="btn btn-pink btn-sm" disabled={busy || !text.trim()} onClick={() => answer(text)}>Next</button>
        </div>
      )}

      {/* The way out, on every step. A real answer: the gap is recorded and the packet says why. */}
      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
        <button
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => answer(CANNOT_REACH_STEP_ANSWER)}
          data-escape={step.step_id}
        >
          I can&apos;t get to this
        </button>
        <span className="hint" style={{ color: "var(--on-light-mute)" }}>
          It goes in the packet as not checked, and you keep going.
        </span>
      </div>
    </div>
  );
}
