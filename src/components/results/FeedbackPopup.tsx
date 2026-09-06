"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hasPersistedReceipt } from "@/domain/feedback/receipt";
import { FEEDBACK_DONE_KEY, FEEDBACK_DELAY_MS, FEEDBACK_VALUE_EVENT, feedbackValueKey } from "@/domain/feedback/value";

/**
 * THE FEEDBACK POPUP — copy verbatim from MOCKUP-2-results-page.html's popup
 * block; behaviour from "Unique Links and Feedback Popup - decisions" §2 and
 * PRN Master Build Spec MERGED §15 (BINDING: fires on the SECOND satisfaction
 * moment, never the first).
 *
 *   Trigger    a successfully rendered owner packet or verified save/send
 *              receipt for this request. Navigation and submission never arm.
 *   Delay      8 seconds after the trigger. When the trigger navigated the
 *              homeowner away (Save → /keep, Ask → /ask, Email → /mail) and
 *              they come back, the popup fires 8 seconds after they are back
 *              on a results-family page instead — the armed moment rides in
 *              localStorage, so the return after /claim (§15: "return the
 *              homeowner to the exact results state") is the moment it fires.
 *   Position   bottom-right card, slides up, covers nothing, no overlay.
 *   Dismiss    the X, "Skip", or Esc — three ways out.
 *   Frequency  once per browser profile (`prn_feedback_done`). No identity is
 *              collected, so this cannot promise person-wide cross-device suppression.
 *   Arrival    never: nothing fires without a trigger.
 *
 * It is rendered in the page from the start (hidden) so the approved copy is
 * part of the server HTML, which is what the template test diffs against the
 * mockup. Every localStorage access is wrapped: a browser that refuses storage
 * simply never shows the popup, which is the safe direction to fail.
 *
 * The four "What did it get right?" options post as short keys, one per design
 * claim the decisions doc says each option measures, so they can be counted.
 */
export { FEEDBACK_DONE_KEY, FEEDBACK_DELAY_MS };
/** Legacy export for compatibility only; no longer read or written. */
export const FEEDBACK_ARMED_KEY = "prn_feedback_armed_at";

const SCORES = [
  { key: "not_really", label: "Not really" },
  { key: "somewhat", label: "Somewhat" },
  { key: "very", label: "Very helpful" },
] as const;

const RIGHT_OPTIONS = [
  { key: "asked_unexpected", label: "It asked about things I would not have thought of" },
  { key: "remembered", label: "It remembered what I had already told it" },
  { key: "understand_better", label: "I understand my problem better than I did" },
  { key: "ready_to_talk", label: "I feel ready to talk to someone about it" },
] as const;

type Score = (typeof SCORES)[number]["key"];

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage refused: the popup simply never fires */
  }
}

export function FeedbackPopup({ requestId, ownerKey, eligible = false }: { requestId: string; ownerKey?: string; eligible?: boolean }) {
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState<Score | null>(null);
  const [right, setRight] = useState<string[]>([]);
  const [slow, setSlow] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);

  const finish = useCallback(() => {
    writeStorage(FEEDBACK_DONE_KEY, "1");
    writeStorage(feedbackValueKey(requestId), null);
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }, [requestId]);

  useEffect(() => {
    setOpen(false);
    if (!eligible || readStorage(FEEDBACK_DONE_KEY)) return;

    const schedule = () => {
      if (readStorage(FEEDBACK_DONE_KEY) || document.visibilityState === "hidden") {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        setOpen(false);
        return;
      }
      const value = Number(readStorage(feedbackValueKey(requestId)));
      if (!Number.isFinite(value) || value <= 0 || timer.current) return;
      // Always allow eight visible seconds on arrival/return; never pop on load.
      timer.current = setTimeout(() => {
        timer.current = null;
        if (!readStorage(FEEDBACK_DONE_KEY) && document.visibilityState !== "hidden"
          && readStorage(feedbackValueKey(requestId))) setOpen(true);
      }, FEEDBACK_DELAY_MS);
    };
    window.addEventListener(FEEDBACK_VALUE_EVENT, schedule);
    window.addEventListener("storage", schedule);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      window.removeEventListener(FEEDBACK_VALUE_EVENT, schedule);
      window.removeEventListener("storage", schedule);
      document.removeEventListener("visibilitychange", schedule);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [eligible, requestId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, finish]);

  async function send() {
    if (!score || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_id: requestId,
        k: ownerKey,
        score,
        right,
        slow: slow.trim() ? slow.trim().slice(0, 500) : null,
      }),
    }).catch(() => null);
    const receipt = response?.ok ? await response.json().catch(() => null) : null;
    pending.current = false;
    setSaving(false);
    if (!hasPersistedReceipt(receipt)) {
      setError("Your feedback could not be saved. Try again, or skip for now.");
      return;
    }
    finish();
  }

  return (
    <div
      className={`fb-dock${open ? " open" : ""}`}
      role="dialog"
      aria-label="Feedback"
      aria-hidden={!open}
      inert={!open}
      data-testid="feedback-popup"
    >
      <div className="fb">
        <button type="button" className="fb-x" aria-label="Close" onClick={finish}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <h4>Did that help narrow things down?</h4>
        <p className="fsub">30 seconds, and it makes this better for the next person.</p>

        <div className="chips">
          {SCORES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`fchip${score === s.key ? " sel" : ""}`}
              aria-pressed={score === s.key}
              onClick={() => setScore(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <p className="q">What did it get right?</p>
        <div className="opts">
          {RIGHT_OPTIONS.map((o) => {
            const on = right.includes(o.key);
            return (
              <label key={o.key} className={`opt${on ? " sel" : ""}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setRight((prev) => (on ? prev.filter((k) => k !== o.key) : [...prev, o.key]))
                  }
                />
                {o.label}
              </label>
            );
          })}
        </div>

        <p className="q">Where did it get slow or confusing?</p>
        <div className="opts">
          <textarea
            className="opt"
            placeholder="One line is plenty…"
            maxLength={500}
            value={slow}
            onChange={(e) => setSlow(e.target.value)}
            aria-label="Where did it get slow or confusing?"
          />
        </div>

        {error && <p role="alert">{error}</p>}
        <div className="fbbtn">
          <button type="button" className="fb-send" disabled={!score || saving} onClick={send}>
            Send
          </button>
          <button type="button" className="fb-skip" onClick={finish}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
