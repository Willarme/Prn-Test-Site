import { NextResponse } from "next/server";
import { z } from "zod";
import { DoorAttribution } from "@/domain/intake/contracts";
import { flagEnabled } from "@/platform/flags";
import { startIntake } from "@/platform/intake/start";

/**
 * The JSON intake entry — what the React `StartRequestForm` posts. Doors own
 * zero business logic; this route owns TRANSPORT ONLY.
 *
 * REFACTORED 2026-09-05 (campaign track F1). The whole body of this handler —
 * the safety gate, the consent check, A01's classification, A02's packet, the
 * events, the journey write and the fallback cookie — moved verbatim into
 * `platform/intake/start.ts::startIntake` so the static door page's multipart
 * adapter (`POST /api/intake/start`) reaches the SAME path rather than a second
 * copy of it. A safety gate that exists twice is a safety gate that can differ.
 *
 * Every response shape below is byte-for-byte the one this route already
 * returned; the existing tests pin that.
 */
const IntakeRequest = z.object({
  description: z.string().min(8, "Tell us a little more — a sentence is plenty."),
  /** Hash of the disclosure the client actually rendered — verified server-side. */
  disclosure_content_hash: z.string().min(1),
  attribution: DoorAttribution,
});

export async function POST(request: Request): Promise<NextResponse> {
  if (!flagEnabled("intake_shell_enabled")) {
    return NextResponse.json({ error: "intake is not enabled" }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const parsed = IntakeRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const outcome = await startIntake({
    description: parsed.data.description,
    attribution: parsed.data.attribution,
    disclosure_content_hash: parsed.data.disclosure_content_hash,
    source: "json",
  });

  if (outcome.kind === "error") {
    return NextResponse.json(
      { error: outcome.error, ...(outcome.detail ? { detail: outcome.detail } : {}) },
      { status: outcome.status }
    );
  }
  if (outcome.kind === "safety_halt") {
    // A halt-class hazard creates no ProblemRecord and no packet; the form
    // shows the approved copy and keeps the homeowner's draft.
    return NextResponse.json({
      request_id: null,
      safety: {
        state: "urgent",
        message: outcome.message,
        intake_may_continue: false,
      },
    });
  }

  const res = NextResponse.json({
    request_id: outcome.request_id,
    next: outcome.next,
    safety: outcome.safety,
  });
  if (outcome.cookie) {
    res.cookies.set(outcome.cookie.name, outcome.cookie.value, outcome.cookie.options);
  }
  return res;
}
