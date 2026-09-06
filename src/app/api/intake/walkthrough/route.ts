import { NextResponse } from "next/server";
import { projectWalkthroughView } from "@/domain/intake/playbook";
import { flagEnabled } from "@/platform/flags";
import { loadJourneyContext } from "@/platform/intake/complete";
import { ownerAllowed } from "@/platform/links/owner";
import { journeySafetyRule } from "@/domain/problem/journey-safety";
import { intakeReadiness } from "@/platform/intake/readiness";

/**
 * Resume the currently authorized, budget-feasible walkthrough view.
 *
 * The browser no longer holds the playbook graph (T1-15) — it only ever
 * holds one step or outcome. Completed checks never reappear through this
 * endpoint; a new walkthrough starts a new request. No answer is written.
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
  const current = await intakeReadiness(ctx, true);
  const view = projectWalkthroughView(ctx.playbook,
    current.screen.questions.some(q => q.source_kind === "check") ? current.position.currentStepId : null,
    current.position.outcomeId);
  return NextResponse.json({ view });
}
