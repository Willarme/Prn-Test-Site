import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminUnlocked } from "@/platform/admin/auth";
import { publishGate, resolvePagePublishApproval } from "@/platform/search/page-qa-gate";
import { emitPagePublished } from "@/platform/search/page-qa-events";
import { runtimeStore } from "@/platform/stores/runtime";

/**
 * The OWNER publish action — the only path from QA_PASS to PUBLISHED
 * (#14A 15.1 step 8, canon). Requires an unlocked admin session and a page A06
 * says is releasable. Every action is audited.
 *
 * ONE GATE, REWIRED (Loop Spec Audit condition C10, coherence report issue 6).
 *
 * WHAT THIS ROUTE USED TO DO: test `spec.qa.state !== "PASS"` itself. That was
 * the live gate, and the audit's warning about A06 was precise — "A06's new
 * `release_eligible` field would create a second gate beside the live one at the
 * publish route unless they are rewired together ... A second, weaker gate
 * surviving beside the new one is how the human publish gate quietly erodes."
 *
 * WHAT IT DOES NOW: asks A06 once and reads ONE boolean. `qa.state` is not
 * mentioned anywhere in this file — it is a CONJUNCT INSIDE
 * `evaluateReleaseForPublish`, which is what "derived from, not checked beside"
 * means. There is exactly one server-side release condition in this codebase and
 * it is `decision.release_eligible`.
 *
 * THE OBSERVABLE BEHAVIOUR IS UNCHANGED, and that is provable rather than
 * hoped-for. The recorded-verdict conjunct IS the old gate, so the new condition
 * is `old_gate AND live_reverification AND human_gate_intact` — never weaker.
 * The same pages 409, with the same status code and the same message.
 * tests/a06.one-publish-gate.test.ts walks the whole committed portfolio and
 * asserts the two answers agree page by page.
 *
 * NO KILL-SWITCH CHECK ON THIS PATH, deliberately. `checkKillSwitch("A06")`
 * pauses THE AGENT — its QA runs, which is where it is checked. A human
 * publishing a page A06 already passed is not agent activity, and a paused
 * inspector that also froze the owner's publish button would be exactly
 * backwards. Same reasoning A05 recorded for the owner's edit path.
 *
 * page.published IS EMITTED HERE (coherence issue 9: "assign it to whichever of
 * A05/A06 builds second so it does not fall between them"). Without it the
 * return leg has no carrier at all — defect-escape rate, time-to-publish and
 * every A07 SEO gauge are uncomputable. Fail-soft: a lost envelope must never
 * cost a publish.
 */
const Body = z.object({
  page_spec_id: z.string().min(1),
  action: z.enum(["publish", "unpublish"]),
  /**
   * OWNER TIME ON THIS DECISION, in milliseconds — measured in the browser from
   * the moment the control rendered to the moment it was clicked, and recorded
   * onto the audit row (Trial Spec Audit §4 item 5).
   *
   * WHAT IT IS, EXACTLY, so nobody later reads it as something it is not: time
   * with this decision on screen. It is NOT total owner time, it is not
   * reviewing time away from the page, and it is deliberately not the request
   * handler's latency — that would be machine time wearing a person's label,
   * and an Owner Hours average polluted with server milliseconds is worse than
   * no number at all.
   *
   * UNTRUSTED, SO BOUNDED. It comes from a browser. Anything non-finite,
   * negative, or longer than four hours is dropped rather than stored, and the
   * action proceeds either way; absent means "not measured", never 0.
   */
  owner_ms: z.number().int().positive().max(4 * 60 * 60 * 1000).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isAdminUnlocked())) {
    return NextResponse.json({ error: "Owner sign-in required" }, { status: 403 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const gate = await publishGate({ page_spec_id: parsed.data.page_spec_id });
  if (!gate) return NextResponse.json({ error: "unknown page" }, { status: 404 });
  const { spec, decision } = gate;

  // THE ONE SERVER-SIDE RELEASE CONDITION.
  if (parsed.data.action === "publish" && !decision.release_eligible) {
    return NextResponse.json({ error: "QA must PASS before publishing" }, { status: 409 });
  }

  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const store = runtimeStore();
  try {
    await store.setPublished(spec, parsed.data.action === "publish");
    await store.appendAudit({
      at: now,
      action: `page.${parsed.data.action}`,
      target: spec.page_id,
      detail: spec.canonical_path,
      duration_ms: parsed.data.owner_ms ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not save: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  if (parsed.data.action === "publish") {
    /**
     * The Approval Center item A06's QA run filed is the RECORD of the ask; the
     * route is the ACT. Closing it here is bookkeeping, never authorization —
     * nothing above consulted it, and nothing below waits on it.
     */
    await resolvePagePublishApproval(spec.page_spec_id, "owner");
    await emitPagePublished({
      page_id: spec.page_id,
      page_spec_id: spec.page_spec_id,
      canonical_path: spec.canonical_path,
      search_opportunity_id: spec.search_opportunity_id ?? "",
      // The envelope types actor as an agent; the ACT was a human's, so it is
      // recorded here rather than silently lost.
      published_by: "owner",
      rule_set_version: decision.qa.rule_set_version,
    });
  }

  return NextResponse.json({ ok: true });
}
