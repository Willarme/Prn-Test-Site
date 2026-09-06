import { NextResponse } from "next/server";
import { z } from "zod";
import { flagEnabled } from "@/platform/flags";
import { buildPacketMessage } from "@/platform/results/packet-email";
import { runtimeStore, type Journey } from "@/platform/stores/runtime";
import { journeySafetyRule } from "@/domain/problem/journey-safety";
import { ownerAllowed } from "@/platform/links/owner";
import { signLink } from "@/platform/links/tokens";
import { demoAwareOrigin } from "@/platform/demo-origin";

/**
 * POST /api/results/email — "Email it to me instead" (campaign track P2).
 *
 * A plain HTML form post from /results/[id]/email: `request_id`, `email`, and
 * an optional `name`. Every outcome is a 303 a browser renders:
 *
 *   ok           → /mail/<email_id>  (P3 renders the stored message; in live
 *                  mode the same page shows whether it went)
 *   bad email    → back to the form with ?error=email
 *   unknown id   → back to the form with ?error=unavailable
 *   store fault  → back to the form with ?error=try_again
 *
 * THE OUTBOX IS P3's (src/platform/email/send.ts, imported lazily so this
 * route compiles on its own): `send()` stores the message and, only when
 * EMAIL_MODE=live (routine decision 8), posts it to Resend. In the default
 * preview mode this route touches no network at all —
 * tests/loop.p2.email-route.test.ts forbids fetch for the whole call.
 *
 * Name and phone (§16.1): the name goes at the top of the message when given.
 * A phone number has no store surface today and the packet prints no contact
 * details by rule, so the form does not ask for one; noted in the P2 report.
 * Nothing the homeowner typed goes in a URL: the redirects carry an error
 * word, never the address.
 */
const Form = z.object({
  request_id: z.string().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(320),
  name: z.string().trim().max(120).optional(),
  skip: z.string().optional(),
  k: z.string().max(4096).optional(),
});

function back(origin: string, request_id: string, error: string, k?: string): NextResponse {
  return NextResponse.redirect(
    `${origin}/results/${encodeURIComponent(request_id)}/email?error=${error}${k ? `&k=${encodeURIComponent(k)}` : ""}`,
    303
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!flagEnabled("results_shell_enabled")) {
    return NextResponse.json({ error: "not enabled" }, { status: 404 });
  }
  const origin = demoAwareOrigin(request);
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const raw = Object.fromEntries(
    Array.from(form.entries()).map(([k, v]) => [k, typeof v === "string" ? v : ""])
  );
  const request_id = typeof raw.request_id === "string" ? raw.request_id.slice(0, 120) : "";
  if (!request_id) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const k = typeof raw.k === "string" ? raw.k : undefined;
  if (!(await ownerAllowed(request_id, k))) return NextResponse.json({ error: "unavailable" }, { status: 404 });

  const parsed = Form.safeParse(raw);
  if (!parsed.success) return back(origin, request_id, "email", k);
  const d = parsed.data;

  let journey: Journey | null = null;
  try {
    journey = await runtimeStore().getJourney(request_id);
  } catch {
    /* treated as unknown */
  }
  if (!journey) return back(origin, request_id, "unavailable", k);
  const safety = journeySafetyRule(journey.problem);
  if (safety && !safety.intake_may_continue) {
    return NextResponse.redirect(`${origin}/safety/${encodeURIComponent(safety.safety_rule_id)}`, 303);
  }

  const ownerKey = k || signLink({ scope: "keep", request_id });
  const message = buildPacketMessage({
    request_id,
    // "skip for now" leaves the name blank even if the field was typed in.
    name: d.skip ? null : d.name && d.name.length > 0 ? d.name : null,
    origin,
    owner_key: ownerKey,
  });

  try {
    const { send } = await import("@/platform/email/send");
    const result = await send({ ...message, to: d.email, request_id });
    return NextResponse.redirect(
      `${origin}/mail/${encodeURIComponent(result.email_id)}?k=${encodeURIComponent(ownerKey)}`,
      303
    );
  } catch {
    return back(origin, request_id, "try_again", k);
  }
}
