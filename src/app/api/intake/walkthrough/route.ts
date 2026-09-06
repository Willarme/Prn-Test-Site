import { NextResponse } from "next/server";
import { projectWalkthroughView } from "@/domain/intake/playbook";
import { flagEnabled } from "@/platform/flags";
import { loadJourneyContext } from "@/platform/intake/complete";
import { ownerAllowed } from "@/platform/links/owner";
import { journeySafetyRule } from "@/domain/problem/journey-safety";

/**
 * Read-only reset for the guided-diagnosis walkthrough ("Start over").
 *
 * The browser no longer holds the playbook graph (T1-15) — it only ever
 * holds the ONE step or outcome it is currently showing — so returning to
 * the first step needs a server round-trip like every other step change.
 * This route never writes an answer and never regenerates the packet; it
 * only re-reads the playbook's first step through the same projection every
 * other caller uses.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!flagEnabled("intake_shell_enabled")) return NextResponse.json({ error: "not enabled" }, { status: 404 });
  const requestId = new URL(request.url).searchParams.get("request_id");
  if (!requestId) return NextResponse.json({ error: "missing request_id" }, { status: 400 });
  if (!(await ownerAllowed(requestId, new URL(request.url).searchParams.get("k") ?? undefined))) return NextResponse.json({ error: "Unknown request" }, { status: 404 });
  const ctx = await loadJourneyContext(requestId);
  if (!ctx) return NextResponse.json({ error: "Unknown request" }, { status: 404 });
  const safety = journeySafetyRule(ctx.journey.problem);
  if (safety && !safety.intake_may_continue) return NextResponse.json({
    next: `/safety/${encodeURIComponent(safety.safety_rule_id)}`,
    safety: { rule_id: safety.safety_rule_id, message: safety.approved_response, intake_may_continue: false },
  }, { status: 409 });
  const view = projectWalkthroughView(ctx.playbook, ctx.playbook.first_step_id, null);
  return NextResponse.json({ view });
}
