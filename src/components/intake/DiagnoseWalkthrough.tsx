"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DiagnosticStep, Outcome } from "@/domain/intake/playbook";

/**
 * Box 2 — guided diagnosis. Static replay of the playbook: one step at a
 * time, the branch decided client-side from the same rules the server uses.
 * No AI call per step. Answers are saved as they happen so the packet
 * updates even if the customer stops halfway.
 */
export function DiagnoseWalkthrough({
  requestId,
  steps,
  outcomes,
  firstStepId,
  resume,
}: {
  requestId: string;
  steps: DiagnosticStep[];
  outcomes: Outcome[];
  firstStepId: string;
  resume: { currentStepId: string | null; outcomeId: string | null; answered: number };
}) {
  const router = useRouter();
  const [currentId, setCurrentId] = useState<string | null>(resume.outcomeId ? null : (resume.currentStepId ?? firstStepId));
  const [outcomeId, setOutcomeId] = useState<string | null>(resume.outcomeId);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const step = steps.find((s) => s.step_id === currentId) ?? null;
  const outcome = outcomes.find((o) => o.outcome_id === outcomeId) ?? null;
  const index = step ? steps.findIndex((s) => s.step_id === step.step_id) + 1 : steps.length;

  function branchFor(s: DiagnosticStep, answer: string) {
    const normalized = answer.trim().toLowerCase();
    for (const b of s.branches) {
      const when = b.when.toLowerCase();
      if (when === "any" || when === normalized) return b;
      const m = /^rating:(>=|<)(\d+)$/.exec(when);
      if (m && s.input.kind === "rating") {
        const n = Number(normalized);
        if (m[1] === ">=" && n >= Number(m[2])) return b;
        if (m[1] === "<" && n < Number(m[2])) return b;
      }
    }
    return s.branches.find((b) => b.when === "any") ?? null;
  }

  async function answer(value: string) {
    if (!step) return;
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/intake/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, step: { step_id: step.step_id, answer: value } }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr("Could not save that answer — try again.");
      return;
    }
    const b = branchFor(step, value);
    if (!b) return;
    if (b.outcome_id) {
      setOutcomeId(b.outcome_id);
      setCurrentId(null);
    } else {
      setCurrentId(b.next_step_id);
    }
    setText("");
    router.refresh();
  }

  async function photo(file: File) {
    if (!step) return;
    setBusy(true);
    setErr(null);
    const form = new FormData();
    form.set("request_id", requestId);
    form.set("target", `step:${step.step_id}`);
    form.set("file", file);
    const res = await fetch("/api/intake/media", { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErr(data.error ?? "Upload failed — try again.");
      return;
    }
    const b = branchFor(step, "any");
    if (b?.outcome_id) {
      setOutcomeId(b.outcome_id);
      setCurrentId(null);
    } else if (b) {
      setCurrentId(b.next_step_id);
    }
    router.refresh();
  }

  if (outcome) {
    return (
      <div className="card-light">
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
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 10 }}
          onClick={() => {
            setOutcomeId(null);
            setCurrentId(firstStepId);
          }}
        >
          Start over
        </button>
      </div>
    );
  }

  if (!step) {
    return (
      <div className="card-light">
        <p>This problem type doesn&apos;t have a guided walkthrough yet — your details above are what matter most.</p>
      </div>
    );
  }

  return (
    <div className="card-light">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="mono" style={{ color: "var(--on-light-mute)" }}>
          Step {index} of {steps.length}
        </span>
        {resume.answered > 0 && <span className="pill">resumed</span>}
      </div>
      <h2 className="d3" style={{ margin: "8px 0 6px" }}>
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
        <div>
          <input type="range" min={0} max={10} value={rating} onChange={(e) => setRating(Number(e.target.value))} style={{ width: "100%" }} />
          <div style={{ display: "flex", justifyContent: "space-between" }} className="hint">
            <span>{step.input.min_label}</span>
            <strong style={{ color: "var(--ink)" }}>{rating}</strong>
            <span>{step.input.max_label}</span>
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
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 10 }} disabled={busy} onClick={() => answer("skipped photo")}>
            Skip, I&apos;ll describe it instead
          </button>
        </div>
      )}
      {step.input.kind === "text" && (
        <div style={{ display: "flex", gap: 8 }}>
          <input className="inp" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && answer(text)} />
          <button className="btn btn-pink btn-sm" disabled={busy || !text.trim()} onClick={() => answer(text)}>Next</button>
        </div>
      )}
    </div>
  );
}
