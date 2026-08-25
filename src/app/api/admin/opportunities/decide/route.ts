import { NextResponse } from "next/server";
import { z } from "zod";
import { OpportunityDecisionKind } from "@/domain/search/decision";
import { isAdminUnlocked } from "@/platform/admin/auth";
import { loadOpportunities } from "@/platform/admin/data";
import { decideOpportunity } from "@/platform/search/opportunity-decisions";

/**
 * THE OWNER'S ACCEPT / REJECT / DEFER ON A SEARCH OPPORTUNITY — the loop's
 * first human gate (coherence report seams 1 and 2), which had no code path at
 * all before this build.
 *
 * OWNER-GATED, SERVER-SIDE, SAME SHAPE AS THE EXISTING OWNER ACTIONS
 * (api/admin/pages/publish, api/admin/approvals/resolve): session check first,
 * validated body, one durable state change, fully audited. No scoring internals
 * cross the wire in either direction — the browser sends an id and a verb.
 *
 * THIS ROUTE CANNOT PUBLISH ANYTHING. Accepting an opportunity makes it
 * ELIGIBLE for page building; the page still has to be built, still has to pass
 * A06 QA, and still has to be published by the owner through a different
 * owner-gated route. A04's opportunity gate and A06's publish gate never
 * collapse into one (A04 spec §11 stop-and-ask 6 — and they still do not).
 */
const Body = z.object({
  search_opportunity_id: z.string().min(1),
  decision: OpportunityDecisionKind,
  note: z.string().max(500).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isAdminUnlocked())) {
    return NextResponse.json({ error: "Owner sign-in required" }, { status: 403 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { search_opportunity_id, decision, note } = parsed.data;

  const opportunity = loadOpportunities().opportunities.find(
    (o) => o.search_opportunity_id === search_opportunity_id
  );
  if (!opportunity) {
    return NextResponse.json({ error: "unknown opportunity" }, { status: 404 });
  }

  try {
    const result = await decideOpportunity({
      opportunity,
      kind: decision,
      decided_by: "owner",
      note: note ?? null,
    });
    return NextResponse.json({
      ok: true,
      status: result.opportunity.status,
      decision_id: result.decision.decision_id,
      approval_id: result.approval_id,
      /**
       * WHAT THE ACCEPT ACTUALLY BUILT (inspection F3). Accepting an
       * opportunity triggers A05 directly, and until now the owner was told
       * nothing about the outcome — including when policy refused the topic as
       * ineligible for a door. Page ids and reason CODES only: no page copy and
       * no scoring internals cross the wire, same rule as the generate route.
       */
      page_build: result.page_build,
    });
  } catch (err) {
    // The decision write is fail-LOUD by design: if it did not land, the owner
    // must be told their click did not take rather than shown a green refresh.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not record decision" },
      { status: 500 }
    );
  }
}
