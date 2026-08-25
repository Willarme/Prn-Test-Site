import { randomUUID } from "node:crypto";
import type { SearchOpportunity } from "@/domain/search/contracts";
import {
  DECISION_STATUS,
  OpportunityDecision,
  type OpportunityDecisionKind,
} from "@/domain/search/decision";
import { queueApproval, resolveApproval } from "@/platform/approvals/center";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { emitOpportunityDecision } from "@/platform/search/events";
import { opportunityDecisionStore } from "@/platform/search/decision-store";
import { recordAgentRun } from "@/platform/runs/ledger";

/**
 * THE OWNER-DECISION PATH — coherence report seams 1 and 2, wired end to end.
 *
 * Before this, A04's "first human gate" existed in two specs and zero lines of
 * code: `src/app/admin/opportunities/page.tsx` was a read-only table, nothing
 * wrote `status: "approved"`, and A04 emitted no events at all.
 *
 * ONE CALL, FOUR DURABLE CONSEQUENCES, in this order:
 *
 *   1. THE DECISION RECORD (append-only, decision-store.ts) — fail-LOUD. If
 *      this write does not land, the owner's click did not happen and the
 *      route says so. Everything after it is provenance ABOUT a decision that
 *      already exists, so everything after it is fail-soft.
 *   2. THE APPROVAL CENTER ITEM (approval_kind "seo.opportunity_decision" —
 *      the taxonomy A08 registered for exactly this producer).
 *   3. THE AGENT RUN LEDGER ROW — full provenance: what was decided, on what,
 *      by whom, what A04 had recommended and scored at that moment.
 *   4. THE EVENT — seo.opportunity_accepted / _rejected / _deferred, through
 *      A08's validateAndEmit. All three names were registered by A08's build
 *      (names.ts LOOP_SEAM_EVENT_NAMES) with owning_agent "A04". A04 mints NO
 *      new names; the dictionary is closed to it.
 *
 * WHY THE APPROVAL ITEM IS FILED *AND RESOLVED* IN THE SAME CALL — for accept
 * and reject. The owner is standing at the queue making the decision; filing a
 * PENDING item that nobody will ever resolve would be queue litter, and
 * training the owner to clear routine rows is the exact failure mode the Loop
 * Spec Audit warns about (A08 pre-answer 1: do not fill the queue with rows
 * that teach rubber-stamping). The item exists so the Approval Center is the
 * one place every owner decision is on the record — with resolved_by and
 * resolved_at filled in, and the decision echoed onto the admin audit trail by
 * resolveApproval itself.
 *
 * DEFER IS DIFFERENT, DELIBERATELY. A deferred opportunity's item stays
 * PENDING — that is what "come back to this" means, and it gives the owner a
 * real to-do in the Approval Center. Resolving it there later applies the
 * accept/reject to the opportunity through this same module
 * (api/admin/approvals/resolve), so there is one decision path, not two.
 *
 * NO KILL-SWITCH GATE HERE, ON PURPOSE. checkKillSwitch("agent:A04") pauses
 * THE AGENT — its discovery runs and its vendor spend. A human deciding on
 * work the agent already did is not agent activity, and a paused agent that
 * also froze the owner's ability to reject its output would be exactly
 * backwards. The kill switch gates spend (see domain/search/discovery.ts).
 */

const A04 = "A04";

export interface DecideInput {
  opportunity: SearchOpportunity;
  kind: OpportunityDecisionKind;
  decided_by: string;
  note?: string | null;
  tenant_id?: string;
  /**
   * A05's second run mode (condition C9 / pre-answer 6): "a direct call from
   * A04's approval flow". Defaults ON for `accept` — an owner who accepts an
   * opportunity has said the thing may become a page, and building a STAGED,
   * noindexed, QA-PENDING page is the whole of what "eligible" means in
   * practice. Set false to record the decision without building (the admin
   * route can then run the factory separately).
   */
  build_page?: boolean;
}

export interface DecideResult {
  decision: OpportunityDecision;
  opportunity: SearchOpportunity;
  approval_id: string | null;
  run_id: string | null;
  event_status: string;
  /**
   * A05's outcome, when the accept path triggered it. `null` means A05 was not
   * invoked at all (a reject/defer, or build_page: false).
   */
  page_build: {
    staged: string[];
    skipped: number;
    /**
     * WHY nothing was built, by reason code (inspection F3). A bare count is
     * how "policy refused this topic" and "it already had a page" become the
     * same silence to whoever is watching. Reason codes only — never page copy,
     * never scoring internals.
     */
    skipped_reasons: string[];
    halted: boolean;
  } | null;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

const REVERSIBILITY: Record<OpportunityDecisionKind, "reversible"> = {
  // Every opportunity decision is reversible: nothing is published, nothing is
  // deleted, and a later decision supersedes an earlier one by append.
  accept: "reversible",
  reject: "reversible",
  defer: "reversible",
};

const IMPACT: Record<OpportunityDecisionKind, string> = {
  accept:
    "This opportunity becomes eligible for page building. No page is created and nothing is published by this decision.",
  reject: "This opportunity will not become a page. It stays in the record.",
  defer: "No page is built from this opportunity yet; it stays in the queue for a later decision.",
};

export async function decideOpportunity(
  input: DecideInput,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<DecideResult> {
  const { opportunity, kind } = input;
  const decidedAt = nowIso();
  const tenantId = input.tenant_id ?? opportunity.tenant_id ?? "prn";

  // 1. THE DECISION RECORD — fail-loud. Written FIRST, so nothing downstream
  //    can claim provenance for a decision that never persisted.
  const decision: OpportunityDecision = OpportunityDecision.parse({
    decision_id: `od_${randomUUID()}`,
    tenant_id: tenantId,
    search_opportunity_id: opportunity.search_opportunity_id,
    decision: kind,
    status_after: DECISION_STATUS[kind],
    decided_by: input.decided_by,
    decided_at: decidedAt,
    note: input.note ?? null,
    recommendation_at_decision: opportunity.recommendation ?? null,
    score_at_decision: opportunity.opportunity_score ?? null,
    score_version_at_decision: opportunity.score_version ?? null,
    approval_id: null,
    run_id: null,
  });
  await opportunityDecisionStore(clientProvider).append(decision);

  // 2. THE APPROVAL CENTER ITEM. Fail-soft from here down: the decision is
  //    already durable, and losing its paperwork must not lose the decision.
  let approvalId: string | null = null;
  try {
    const item = await queueApproval(
      {
        agent_id: A04,
        tenant_id: tenantId,
        run_id: decision.decision_id,
        approval_kind: "seo.opportunity_decision",
        what_happened: `Owner ${kind === "accept" ? "accepted" : kind === "reject" ? "rejected" : "deferred"} search opportunity ${opportunity.search_opportunity_id}.`,
        // IDs, enum values and numbers only — never customer evidence.
        evidence: {
          search_opportunity_id: opportunity.search_opportunity_id,
          recommendation: opportunity.recommendation,
          opportunity_score: opportunity.opportunity_score,
          score_version: opportunity.score_version ?? "1.0.0",
          intent_type: opportunity.intent_type,
          decision_id: decision.decision_id,
        },
        recommendation: opportunity.recommendation ?? undefined,
        impact: IMPACT[kind],
        risk:
          "A04 cannot publish. An accepted opportunity is still gated by A06 QA and the owner publish action.",
        reversibility: REVERSIBILITY[kind],
        proposed_change: { status: DECISION_STATUS[kind] },
      },
      clientProvider
    );
    approvalId = item.approval_id;
    // accept/reject resolve immediately (the owner is the one deciding);
    // defer stays PENDING so it reads as a real to-do.
    if (kind !== "defer") {
      await resolveApproval(
        item.approval_id,
        {
          status: kind === "accept" ? "APPROVED" : "REJECTED",
          resolved_by: input.decided_by,
        },
        clientProvider
      );
    }
  } catch {
    /* the decision already landed; its paperwork is not the decision */
  }

  // 3. THE AGENT RUN LEDGER — provenance for every decision, per C9.
  let runId: string | null = null;
  try {
    const record = await recordAgentRun(
      {
        agent_id: A04,
        tenant_id: tenantId,
        trigger: "admin_action",
        input_ids: [opportunity.search_opportunity_id],
        capabilities_used: [],
        outputs_summary: {
          decision: kind,
          status_after: decision.status_after,
          decision_id: decision.decision_id,
          approval_id: approvalId,
          recommendation_at_decision: decision.recommendation_at_decision,
          score_at_decision: decision.score_at_decision,
        },
        decisions: [`${kind}:${opportunity.search_opportunity_id}`],
        cost_usd: 0,
        actions_taken: [`opportunity.${kind}`],
      },
      clientProvider
    );
    runId = record.run_id;
  } catch {
    /* ledger is provenance, never the gate */
  }

  // 4. THE EVENT — A08-registered names only.
  const eventStatus = await emitOpportunityDecision(
    kind,
    {
      search_opportunity_id: opportunity.search_opportunity_id,
      decision_id: decision.decision_id,
      status_after: decision.status_after,
      ...(approvalId ? { approval_id: approvalId } : {}),
      ...(runId ? { agent_run_id: runId } : {}),
    },
    clientProvider
  );

  /**
   * THE JOIN RUNS ONE WAY, AND THAT IS DELIBERATE. The persisted decision row
   * carries `approval_id: null` and `run_id: null`, because the decision is
   * written FIRST (it is the fail-loud part) and its paperwork is created
   * afterwards — and the store is append-only, so there is no update to stamp
   * them back in. Verified by running the app: the stored rows show
   * `run: none`.
   *
   * Provenance is still complete, in the other direction: the Agent Run Ledger
   * row's `outputs_summary` carries `decision_id` and `approval_id`, and the
   * Approval Center item's `evidence` carries `decision_id`. So a decision
   * resolves to its ledger row and its approval item by lookup; only the
   * inline back-pointers are absent.
   *
   * Filing the approval first would populate them and would also leave an
   * orphaned approval item whenever the decision write fails — trading a
   * cosmetic null for a real inconsistency. The columns stay in the schema for
   * the day the write becomes transactional. The returned object below IS
   * stamped, so callers in the same request see the full picture.
   */
  const stamped: OpportunityDecision = { ...decision, approval_id: approvalId, run_id: runId };
  const updatedOpportunity: SearchOpportunity = {
    ...opportunity,
    status: decision.status_after,
    approved_at: kind === "accept" ? decidedAt : null,
    approved_by: kind === "accept" ? input.decided_by : null,
    updated_at: decidedAt,
  };

  /**
   * 5. A05's DIRECT TRIGGER — the second of its two run modes (C9 /
   *    pre-answer 6: "an admin-triggered API route plus a direct call from
   *    A04's approval flow, both idempotent on opportunity_id").
   *
   *    ACCEPT ONLY, and fail-soft. The decision is already durable; a page
   *    factory that fell over must not take the owner's decision down with it,
   *    and the admin route can always run the factory again — it is idempotent
   *    on opportunity_id, so a retry cannot produce a second door.
   *
   *    DEFERRED IMPORT, the idiom this codebase already uses for the steward:
   *    the run module reaches the approval center and the runtime store, and
   *    nothing at module scope here needs it.
   *
   *    NOTHING BECOMES PUBLIC. The page lands STAGED, noindexed, qa.state
   *    PENDING; A06 has to pass it and the owner has to publish it.
   */
  let pageBuild: DecideResult["page_build"] = null;
  if (kind === "accept" && input.build_page !== false) {
    try {
      const [{ loadPageCorpus }, { runPageFactory }, { policyStore }] = await Promise.all([
        import("@/platform/search/page-corpus"),
        import("@/platform/search/page-factory-run"),
        import("@/platform/admin/data"),
      ]);
      const corpus = await loadPageCorpus(clientProvider);
      const policy = await policyStore().getActive();
      const result = await runPageFactory(
        {
          opportunities: [updatedOpportunity],
          existingPages: corpus.pages,
          existingSpecs: corpus.specs,
          policy: policy.page_factory,
          // WHICH INTENTS MAY BECOME DOORS (inspection F3). Accepting a
          // tool-intent opportunity used to build a door page from this hook,
          // because `page_eligible_intent_types` was read only by the CLI.
          eligible_intent_types: policy.page_eligible_intent_types,
          maxPages: 1,
          tenant_id: tenantId,
          trigger: "admin_action",
        },
        clientProvider
      );
      pageBuild = {
        staged: result.staged.map((s) => s.spec.page_id),
        skipped: result.skipped.length,
        skipped_reasons: result.skipped.map((s) => s.reason),
        halted: result.halted !== null,
      };
    } catch {
      /* the decision already landed; the factory is downstream of it */
    }
  }

  return {
    decision: stamped,
    opportunity: updatedOpportunity,
    approval_id: approvalId,
    run_id: runId,
    event_status: eventStatus,
    page_build: pageBuild,
  };
}
