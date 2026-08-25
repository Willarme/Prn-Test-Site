import { NextResponse } from "next/server";
import { z } from "zod";
import { recordCustomerEvent } from "@/platform/events/customer";
import { flagEnabled } from "@/platform/flags";
import { runtimeStore } from "@/platform/stores/runtime";

/**
 * PACKET ACTIVITY — the two instruments that can only be observed in a browser.
 *
 * `packet.viewed` is emitted server-side by the results page itself, because a
 * server-rendered view IS the view. `packet.downloaded` and
 * `packet.share_opened` are not: printing and copying happen entirely in the
 * page, so the only honest way to record them is for the packet's own action
 * buttons to say so. That is what this route is for, and it is why it exists at
 * all rather than the events being emitted from a "use client" file — the event
 * dictionary is server-only by rule (tests/client-boundary.test.ts).
 *
 * ─── WHAT COUNTS AS WHICH NAME, STATED PLAINLY ─────────────────────────────
 *
 * `packet.downloaded` — the customer took the packet away as a document. Today
 * that is exactly one path: Print / Save as PDF (the audit's own words: "TODAY
 * ONLY print-to-PDF via a client button"). A real PDF render later emits the
 * same name from the same moment.
 *
 * `packet.share_opened` — the customer opened the thing they hand to a
 * provider. Today that is copying the 30-second summary, or revealing the call
 * script. There is NO share link in the product yet; when there is, it emits
 * this same name with a different `surface` value rather than a new one.
 * `packet.shared` was deliberately NOT minted — see names.ts A02_EVENT_NAMES.
 *
 * `surface` is what keeps those readings separable, so nobody later has to
 * guess which button a number came from.
 *
 * ─── WHY IT VERIFIES THE JOURNEY FIRST ─────────────────────────────────────
 *
 * This is an unauthenticated POST. Without the lookup, anyone could inflate
 * `packet.downloaded` for any request_id they invented, and the KPI it feeds
 * would be unfalsifiable. The lookup also supplies the problem and packet ids
 * so the CLIENT never sends them — a browser asserting which packet it is
 * looking at is not evidence.
 *
 * NOTHING IS EVER RETURNED TO THE BROWSER except {ok}. No packet data, no
 * problem data, no confirmation of what a request_id belongs to.
 */
const Body = z.object({
  request_id: z.string().min(1),
  action: z.enum(["downloaded", "share_opened"]),
  /** Which control the customer used. A short enum, never free text. */
  surface: z.enum(["print_pdf", "copy_call_script", "reveal_call_script"]),
});

const NAME_FOR = {
  downloaded: "packet.downloaded",
  share_opened: "packet.share_opened",
} as const;

export async function POST(request: Request): Promise<NextResponse> {
  if (!flagEnabled("results_shell_enabled")) {
    return NextResponse.json({ error: "not enabled" }, { status: 404 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { request_id, action, surface } = parsed.data;

  let journey: Awaited<ReturnType<ReturnType<typeof runtimeStore>["getJourney"]>> = null;
  try {
    journey = await runtimeStore().getJourney(request_id);
  } catch {
    /* a telemetry read must never surface a failure to the customer */
  }
  // Unknown request: recorded as nothing, answered as ok. The customer's button
  // worked; there is simply nothing truthful to count.
  if (!journey) return NextResponse.json({ ok: true, recorded: false });

  const envelope = await recordCustomerEvent({
    event_name: NAME_FOR[action],
    guest_session_id: journey.session.guest_session_id,
    context: {
      request_id,
      problem_id: journey.problem.problem_id,
      job_packet_id: journey.packet.job_packet_id,
      packet_version: String(journey.packet.packet_version),
      surface,
    },
    landing_path: `/results/${request_id}`,
  });
  return NextResponse.json({ ok: true, recorded: envelope !== null });
}
