"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";

/**
 * THE shared intake entry component. Every door renders this same component.
 * It OWNS the consent presentation — the disclosure text/version comes from
 * ACTIVE_DISCLOSURE here, never from a caller prop, and its content hash is
 * submitted so the server can verify what was actually shown. It contains
 * ZERO analysis logic (doors, not brains).
 */
export interface StartRequestFormProps {
  attribution: {
    page_id: string | null;
    intent_cluster_id: string | null;
    search_opportunity_id: string | null;
    problem_family_hint: string | null;
    landing_path: string;
  };
}

const DRAFT_KEY = "prn_intake_draft";

export function StartRequestForm({ attribution }: StartRequestFormProps) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [safetyMessage, setSafetyMessage] = useState<string | null>(null);

  // Restore a draft saved before a safety hold or accidental navigation.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY);
      if (saved) setDescription(saved);
    } catch {
      /* storage unavailable — fine */
    }
  }, []);

  function saveDraft(value: string) {
    setDescription(value);
    try {
      sessionStorage.setItem(DRAFT_KEY, value);
    } catch {
      /* storage unavailable — fine */
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
          attribution: {
            ...attribution,
            experiment_id: null,
            variant: null,
            referrer: null,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong — your text is still here, try again.");
        return;
      }
      if (data.safety && data.safety.intake_may_continue === false) {
        setSafetyMessage(data.safety.message); // draft stays in sessionStorage
        return;
      }
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* fine */
      }
      router.push(data.next ?? `/results/${data.request_id}`);
    } catch {
      setError("Connection hiccup — your text is still here, try again.");
    } finally {
      setBusy(false);
    }
  }

  if (safetyMessage) {
    return (
      <div className="card-light" role="alert">
        <span className="pill pill-amber">Safety first</span>
        <p style={{ margin: "14px 0" }}>{safetyMessage}</p>
        <p className="hint">
          Your words are saved in this browser tab — when everyone is safe, come back and
          continue from where you left off.
        </p>
      </div>
    );
  }

  return (
    <div className="card-light">
      <div className="field">
        <label className="field-label" htmlFor="what-happened">
          What went wrong? In your own words
        </label>
        <textarea
          id="what-happened"
          className="inp"
          placeholder="Say it the way you'd say it to a neighbor. You don't have to know what broke or who fixes it — that's our job."
          value={description}
          onChange={(e) => saveDraft(e.target.value)}
        />
        <p className="hint">
          If there&apos;s an immediate danger to people, or a gas smell or downed line — call 911 or
          your utility first. We&apos;ll still be here after.
        </p>
      </div>
      <p className="disclosure">{ACTIVE_DISCLOSURE.content_text}</p>
      {error && (
        <p role="alert" style={{ color: "var(--pink-ink)", marginBottom: 12 }}>
          {error}
        </p>
      )}
      <button className="btn btn-pink" onClick={submit} disabled={busy || description.trim().length === 0}>
        {busy ? "Organizing…" : "Continue"}
      </button>
    </div>
  );
}
