import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearchOpportunity } from "@/domain/search/contracts";
import {
  DECISION_STATUS,
  applyDecision,
  decisionEventName,
  effectiveStatus,
  isOwnerApproved,
  latestDecision,
  OpportunityDecision,
} from "@/domain/search/decision";
import { buildCandidatePages } from "@/domain/search/factory";
import { listApprovals, resetApprovalCenterForTests } from "@/platform/approvals/center";
import { EVENT_NAMES } from "@/platform/events/names";
import { recentAgentRuns, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { A04_EMITTED_EVENT_NAMES } from "@/platform/search/events";
import { opportunityDecisionStore } from "@/platform/search/decision-store";
import { decideOpportunity } from "@/platform/search/opportunity-decisions";

/**
 * A04 step 1 — THE OWNER-DECISION PATH (coherence report seams 1 and 2).
 *
 * The single most important assertion in this file is the last one in the
 * first block: a `recommendation: "NEW"` opportunity whose `status` is still
 * "candidate" is NOT approved anywhere. That is the gate the whole loop was
 * missing — A04's opinion had been standing in for the owner's decision.
 */

let tmp: string;

function opportunity(overrides: Partial<SearchOpportunity> = {}): SearchOpportunity {
  return SearchOpportunity.parse({
    search_opportunity_id: "so_test_1",
    schema_version: "1.0.0",
    keyword: "water heater leaking",
    intent_cluster_id: null,
    cluster_label: null,
    problem_family_hint: "plumbing",
    source: "seed_import",
    geography: { mode: "national", country: "US" },
    geography_assumed: false,
    volume_monthly: 4400,
    keyword_difficulty: 12,
    cpc_usd: 3.2,
    intent_type: "problem",
    opportunity_score: 82.4,
    score_components: { demand: 60, winnability: 76, intent_fit: 100, seed_prior: 50 },
    recommendation: "NEW",
    status: "candidate",
    metric_snapshot_ids: [],
    serp_snapshot_ids: [],
    provenance: { source_type: "seed_workbook", source_url: null, confidence_note: null },
    vendor_cost_usd: null,
    researched_at: null,
    created_at: "2026-08-14T18:00:00Z",
    updated_at: null,
    ...overrides,
  });
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "prn-a04-"));
  process.env.PRN_DEV_DB_PATH = join(tmp, "dev-db.json");
  resetApprovalCenterForTests();
  resetAgentRunLedgerForTests();
});

afterEach(() => {
  delete process.env.PRN_DEV_DB_PATH;
  rmSync(tmp, { recursive: true, force: true });
});

describe("the agent's opinion is not the owner's decision", () => {
  it("a recommendation NEW opportunity at status candidate is NOT approved", () => {
    const o = opportunity({ recommendation: "NEW", status: "candidate" });
    expect(o.recommendation).toBe("NEW");
    expect(isOwnerApproved(o)).toBe(false);
    expect(isOwnerApproved(o, [])).toBe(false);
    expect(effectiveStatus(o, [])).toBe("candidate");
  });

  it("no recommendation value can make an opportunity approved on its own", () => {
    for (const rec of ["NEW", "EXPAND", "MERGE", "WATCH", "REJECT"] as const) {
      expect(isOwnerApproved(opportunity({ recommendation: rec, status: "candidate" }))).toBe(false);
    }
  });

  it("only status approved is approval — and it does not need a recommendation at all", () => {
    expect(isOwnerApproved(opportunity({ recommendation: null, status: "approved" }))).toBe(true);
  });

  it("A05's page factory still filters on recommendation — the documented A05 handoff", () => {
    // This is NOT the desired end state: coherence seam 2 says A05's trigger
    // predicate must become status === "approved". That change belongs to A05's
    // build. Pinning the CURRENT behaviour here means A05's build has to
    // deliberately update this expectation rather than drift past it, and it
    // records that the gap is known, not missed.
    const candidate = opportunity({ recommendation: "NEW", status: "candidate" });
    const { specs } = buildCandidatePages([candidate], 10, { now: () => "2026-08-24T00:00:00Z" });
    expect(specs.length).toBe(1);
    expect(isOwnerApproved(candidate)).toBe(false);
    // The safety net today: factory.ts is reachable ONLY from tools/run-factory.ts
    // (npm run factory). No scheduled route, no API route and no admin action
    // calls it, so nothing automated bypasses the new gate.
  });
});

describe("decisions are an append-only fold", () => {
  const base = { decided_by: "owner", note: null, recommendation_at_decision: "NEW", score_at_decision: 82.4, score_version_at_decision: null, approval_id: null, run_id: null, tenant_id: "prn" };

  function decision(kind: "accept" | "reject" | "defer", at: string): OpportunityDecision {
    return OpportunityDecision.parse({
      ...base,
      decision_id: `od_${kind}_${at}`,
      search_opportunity_id: "so_test_1",
      decision: kind,
      status_after: DECISION_STATUS[kind],
      decided_at: at,
    });
  }

  it("the latest decision wins", () => {
    const o = opportunity();
    const history = [
      decision("defer", "2026-08-20T10:00:00Z"),
      decision("accept", "2026-08-21T10:00:00Z"),
      decision("reject", "2026-08-19T10:00:00Z"),
    ];
    expect(effectiveStatus(o, history)).toBe("approved");
    expect(latestDecision("so_test_1", history)?.decision).toBe("accept");
  });

  it("decisions for other opportunities never leak across", () => {
    const o = opportunity();
    const other = OpportunityDecision.parse({
      ...base,
      decision_id: "od_other",
      search_opportunity_id: "so_other",
      decision: "accept",
      status_after: "approved",
      decided_at: "2026-08-22T10:00:00Z",
    });
    expect(effectiveStatus(o, [other])).toBe("candidate");
  });

  it("applyDecision stamps approved_at/by on accept and CLEARS them otherwise", () => {
    const accepted = applyDecision(opportunity(), decision("accept", "2026-08-21T10:00:00Z"));
    expect(accepted.status).toBe("approved");
    expect(accepted.approved_by).toBe("owner");
    expect(accepted.approved_at).toBe("2026-08-21T10:00:00Z");

    const rejected = applyDecision(accepted, decision("reject", "2026-08-22T10:00:00Z"));
    expect(rejected.status).toBe("rejected");
    expect(rejected.approved_at).toBeNull();
    expect(rejected.approved_by).toBeNull();
  });
});

describe("decideOpportunity wires all four consequences", () => {
  it("accept: durable decision, resolved approval, ledger row, registered event", async () => {
    const result = await decideOpportunity(
      { opportunity: opportunity(), kind: "accept", decided_by: "owner" },
      () => null
    );

    expect(result.opportunity.status).toBe("approved");
    expect(result.opportunity.approved_by).toBe("owner");

    const stored = await opportunityDecisionStore(() => null).list();
    expect(stored).toHaveLength(1);
    expect(stored[0].decision).toBe("accept");
    expect(stored[0].tenant_id).toBe("prn");
    // The disagreement between agent and owner is the signal worth keeping.
    expect(stored[0].recommendation_at_decision).toBe("NEW");
    expect(stored[0].score_at_decision).toBe(82.4);

    const approvals = await listApprovals(() => null);
    expect(approvals).toHaveLength(1);
    expect(approvals[0].approval_kind).toBe("seo.opportunity_decision");
    expect(approvals[0].agent_id).toBe("A04");
    expect(approvals[0].status).toBe("APPROVED");
    expect(approvals[0].resolved_by).toBe("owner");

    const runs = recentAgentRuns();
    expect(runs.some((r) => r.agent_id === "A04" && r.trigger === "admin_action")).toBe(true);

    expect(result.event_status).toBe("emitted");
  });

  it("reject moves the status and resolves the item REJECTED", async () => {
    const result = await decideOpportunity(
      { opportunity: opportunity(), kind: "reject", decided_by: "owner" },
      () => null
    );
    expect(result.opportunity.status).toBe("rejected");
    expect(result.opportunity.approved_at).toBeNull();
    const approvals = await listApprovals(() => null);
    expect(approvals[0].status).toBe("REJECTED");
  });

  it("defer leaves the approval item PENDING — a real to-do, not a cleared row", async () => {
    const result = await decideOpportunity(
      { opportunity: opportunity(), kind: "defer", decided_by: "owner" },
      () => null
    );
    expect(result.opportunity.status).toBe("watch");
    const approvals = await listApprovals(() => null);
    expect(approvals[0].status).toBe("PENDING");
  });

  it("the approval item carries IDs and numbers only — never customer evidence", async () => {
    await decideOpportunity(
      { opportunity: opportunity(), kind: "accept", decided_by: "owner" },
      () => null
    );
    const [item] = await listApprovals(() => null);
    const evidence = item.evidence as Record<string, unknown>;
    expect(Object.keys(evidence).sort()).toEqual([
      "decision_id",
      "intent_type",
      "opportunity_score",
      "recommendation",
      "score_version",
      "search_opportunity_id",
    ]);
  });

  /**
   * REGRESSION PIN. Platform timestamps are second-granularity, so two
   * decisions in the same second carry the SAME decided_at. The first version
   * of the fold used `>=` and kept the accumulator on a tie — the owner's
   * correction lost to the thing it was correcting. Two back-to-back calls is
   * exactly the shape that reproduces it.
   */
  it("changing your mind appends rather than overwrites — same-second included", async () => {
    const o = opportunity();
    await decideOpportunity({ opportunity: o, kind: "accept", decided_by: "owner" }, () => null);
    await decideOpportunity({ opportunity: o, kind: "reject", decided_by: "owner" }, () => null);
    const stored = await opportunityDecisionStore(() => null).list();
    expect(stored).toHaveLength(2);
    expect(stored[0].decided_at).toBe(stored[1].decided_at); // the tie is real
    expect(effectiveStatus(o, stored)).toBe("rejected");
    expect(latestDecision(o.search_opportunity_id, stored)?.decision).toBe("reject");
  });
});

describe("A04 mints no event names", () => {
  it("every name A04 emits is already in A08's dictionary", () => {
    for (const name of A04_EMITTED_EVENT_NAMES) {
      expect(EVENT_NAMES as readonly string[], name).toContain(name);
    }
  });

  it("the three decision verbs map to the three registered names", () => {
    expect(decisionEventName("accept")).toBe("seo.opportunity_accepted");
    expect(decisionEventName("reject")).toBe("seo.opportunity_rejected");
    expect(decisionEventName("defer")).toBe("seo.opportunity_deferred");
  });

  it("no search.* family exists anywhere in the dictionary", () => {
    expect((EVENT_NAMES as readonly string[]).filter((n) => n.startsWith("search."))).toEqual([]);
  });
});

describe("the committed artifact is not rewritten by a decision", () => {
  it("decisions live in their own store, joined at read time", async () => {
    const before = JSON.stringify(
      (await import("../data/factory/opportunities.json")).default
    );
    await decideOpportunity(
      { opportunity: opportunity(), kind: "accept", decided_by: "owner" },
      () => null
    );
    const after = JSON.stringify((await import("../data/factory/opportunities.json")).default);
    expect(after).toBe(before);
  });
});
