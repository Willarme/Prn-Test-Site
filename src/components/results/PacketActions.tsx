"use client";

import { useState } from "react";

export function PacketActions({ copyText }: { copyText: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="no-print" style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "18px 0" }}>
      <button className="btn btn-pink btn-sm" onClick={() => window.print()}>
        Print / Save as PDF
      </button>
      <button
        className="btn btn-ghost btn-sm"
        onClick={async () => {
          await navigator.clipboard.writeText(copyText);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied ✓" : "Copy 30-second summary"}
      </button>
    </div>
  );
}

export function AlreadyHaveSomeone({ callScript }: { callScript: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cell">
      <span className="tag">Path 1 · Ready now</span>
      <h3 className="d3">I already have someone</h3>
      <p style={{ margin: "8px 0 14px" }}>
        Send them the whole story once, instead of re-explaining it on the phone.
      </p>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>
        {open ? "Hide call script" : "Get the 30-second call script"}
      </button>
      {open && (
        <p style={{ marginTop: 14, fontStyle: "italic" }}>&ldquo;{callScript}&rdquo;</p>
      )}
    </div>
  );
}

export function ConceptInterest({ concept, landingPath }: { concept: string; landingPath: string }) {
  const [voted, setVoted] = useState<string | null>(null);
  async function vote(thumb: "up" | "down") {
    setVoted(thumb);
    await fetch("/api/feature-interest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concept, kind: "thumb", thumb, landing_path: landingPath }),
    }).catch(() => {});
  }
  if (voted) {
    return <p className="pill pill-green">Noted — thank you. This really does steer what we build.</p>;
  }
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <button className="chip" onClick={() => vote("up")}>
        👍 I&apos;d use this
      </button>
      <button className="chip" onClick={() => vote("down")}>
        👎 Not for me
      </button>
    </div>
  );
}
