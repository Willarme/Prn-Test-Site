import { NextResponse } from "next/server";
import { z } from "zod";
import { effectiveStatus, type OpportunityDecision } from "@/domain/search/decision";
import { isAdminUnlocked } from "@/platform/admin/auth";
import { loadOpportunities, policyStore } from "@/platform/admin/data";
import { opportunityDecisionStore } from "@/platform/search/decision-store";
import { loadPageCorpus } from "@/platform/search/page-corpus";
import { runPageFactory } from "@/platform/search/page-factory-run";

/**
 * THE ADMIN-TRIGGERED GENERATION RUN — the first of A05's two run modes
 * (condition C9 / pre-answer 6).
 *
 * OWNER-GATED, SERVER-SIDE, same shape as the existing owner actions
 * (api/admin/pages/publish, api/admin/opportunities/decide): session check
 * first, validated body, then one run. The browser sends nothing but an
 * optional opportunity id — no PageSpec, no scoring internals and no policy
 * crosses the wire in either direction.
 *
 * IT CANNOT PUBLISH ANYTHING. This route stages pages at qa.state PENDING. The
 * page still has to pass A06 QA and still has to be published by the owner
 * through a different owner-gated route. A05's build gate and A06's publish
 * gate never collapse into one.
 *
 * IDEMPOTENT ON opportunity_id: an opportunity that already has a page is
 * skipped as `already_has_page`, so pressing the button twice does not produce
 * a second door.
 */
const Body = z.object({
  /** Omit to run over every owner-approved opportunity. */
  search_opportunity_id: z.string().min(1).optional(),
  max_pages: z.number().int().min(1).max(100).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isAdminUnlocked())) {
    return NextResponse.json({ error: "Owner sign-in required" }, { status: 403 });
  }
  const parsed = Body.safeParse((await request.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  /**
   * READING THE OWNER'S DECISIONS IS THE FIRST THING, AND IT FAILS CLOSED.
   *
   * FOUND BY RUNNING THE REAL APP, not by the tests — which all inject
   * `() => null` as the client provider and therefore only ever exercise the
   * FILE backend. With Supabase configured from .env.local and migration 00011
   * written-but-not-applied, this `.list()` threw straight out of the route and
   * returned a bare 500 carrying A04's WRITE message: "Your decision was NOT
   * recorded." Nothing was being recorded; this is a read.
   *
   * Worse than the wrong words: "the decisions could not be read" and "nobody
   * has approved anything" must never look the same to this route. The first is
   * a broken dependency and the second is a normal empty queue, and quietly
   * treating one as the other is how an agent ends up building from an
   * incomplete picture of what the owner said. So an unreadable decision store
   * refuses the run, names the migration, and builds nothing.
   */
  let decisions: OpportunityDecision[];
  try {
    decisions = (await opportunityDecisionStore().list()) as OpportunityDecision[];
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "Could not read the owner's opportunity decisions, so no page was built. " +
          "A05 builds only from opportunities you approved, and it cannot tell which those are right now. " +
          `Underlying cause: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 503 }
    );
  }
  const all = loadOpportunities().opportunities;
  const candidates = parsed.data.search_opportunity_id
    ? all.filter((o) => o.search_opportunity_id === parsed.data.search_opportunity_id)
    : all;

  if (parsed.data.search_opportunity_id && candidates.length === 0) {
    return NextResponse.json({ error: "unknown opportunity" }, { status: 404 });
  }

  // Only ever hand the run opportunities the OWNER approved. The run checks
  // this again itself — one gate, asserted twice, is cheap.
  const approved = candidates.filter((o) => effectiveStatus(o, decisions) === "approved");
  if (approved.length === 0) {
    return NextResponse.json(
      {
        ok: true,
        staged: 0,
        skipped: 0,
        message:
          "No owner-approved opportunities. Pages are built from your decision in Opportunities, never from the agent's recommendation.",
      },
      { status: 200 }
    );
  }

  const policy = await policyStore().getActive();
  const corpus = await loadPageCorpus();

  try {
    const result = await runPageFactory({
      opportunities: approved,
      decisions,
      existingPages: corpus.pages,
      existingSpecs: corpus.specs,
      policy: policy.page_factory,
      maxPages: parsed.data.max_pages ?? policy.max_new_pages_per_period,
      trigger: "admin_action",
    });

    if (result.halted) {
      return NextResponse.json(
        {
          error: `A05 is paused by the ${result.halted.scope} kill switch${result.halted.reason ? `: ${result.halted.reason}` : ""}`,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      run_id: result.run_id,
      staged: result.staged.length,
      page_ids: result.staged.map((s) => s.spec.page_id),
      skipped: result.skipped.length,
      // Reasons and counts only — no page copy, no scoring internals.
      skipped_detail: result.skipped.map((s) => ({
        search_opportunity_id: s.search_opportunity_id,
        reason: s.reason,
      })),
    });
  } catch (err) {
    // The page write is fail-LOUD: an admin told a page was built, when it was
    // not, has been lied to.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not build pages" },
      { status: 500 }
    );
  }
}
