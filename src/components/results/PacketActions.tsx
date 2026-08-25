"use client";

import { useState } from "react";
import { ACTIVE_PACKET_COPY } from "@/domain/problem/packet-copy";

/**
 * PACKET CTA COPY FROM CONFIG (Loop Spec Audit A02 condition 8). The four
 * button labels moved VERBATIM to domain/problem/packet-copy.ts. That module is
 * pure typed DATA — no store, no adapter, no event dictionary, no env — so it
 * crosses the client boundary safely (tests/client-boundary.test.ts).
 */
const A = ACTIVE_PACKET_COPY.actions;

/**
 * THE INSTRUMENTS FOR THE TWO THINGS ONLY A BROWSER CAN SEE (Trial Spec Audit
 * §4). Printing and copying happen entirely in the page, so the packet's own
 * buttons are the only honest producer of `packet.downloaded` and
 * `packet.share_opened` — three registered names that nothing in this repo has
 * ever emitted. The canonical event dictionary is server-only by rule
 * (tests/client-boundary.test.ts), so this posts to /api/packet-activity rather
 * than importing any of it into the browser bundle.
 *
 * FIRE-AND-FORGET, ALWAYS. The customer's click does its job first and the
 * telemetry rides behind it: no await before window.print(), no error surfaced,
 * no state depending on the response. A homeowner never loses a click to an
 * event that could not be written.
 */
function note(requestId: string | null, action: "downloaded" | "share_opened", surface: string) {
  if (!requestId) return;
  void fetch("/api/packet-activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId, action, surface }),
  }).catch(() => {});
}

export function PacketActions({
  copyText,
  requestId = null,
}: {
  copyText: string;
  requestId?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="no-print" style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "18px 0" }}>
      <button
        className="btn btn-pink btn-sm"
        onClick={() => {
          note(requestId, "downloaded", "print_pdf");
          window.print();
        }}
      >
        {A.download}
      </button>
      <button
        className="btn btn-ghost btn-sm"
        onClick={async () => {
          note(requestId, "share_opened", "copy_call_script");
          await navigator.clipboard.writeText(copyText);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? A.copy_summary_done : A.copy_summary}
      </button>
    </div>
  );
}

export function AlreadyHaveSomeone({
  callScript,
  requestId = null,
}: {
  callScript: string;
  requestId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cell">
      <span className="tag">Path 1 · Ready now</span>
      <h3 className="d3">I already have someone</h3>
      <p style={{ margin: "8px 0 14px" }}>
        Send them the whole story once, instead of re-explaining it on the phone.
      </p>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => {
          // Only the REVEAL is a share opening; hiding it again is not a second one.
          if (!open) note(requestId, "share_opened", "reveal_call_script");
          setOpen(!open);
        }}
      >
        {open ? A.hide_call_script : A.reveal_call_script}
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
