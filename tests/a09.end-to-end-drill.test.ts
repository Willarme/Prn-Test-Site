import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceObject, ProblemRecord } from "@/domain/problem/contracts";
import { listApprovals, resetApprovalCenterForTests } from "@/platform/approvals/center";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import { cleanConsentEvent, cleanJobPacket, cleanProblemRecord } from "@/platform/quality/fixtures";
import {
  currentFindings,
  resetQualityCountersForTests,
} from "@/platform/quality/issues";
import {
  exceptionQueue,
  qualityFilteredJourneyTotals,
  qualityKpiSnapshot,
  resetQualityKpiForTests,
} from "@/platform/quality/kpi";
import {
  activeQuarantine,
  allQuarantineMarkers,
  releaseQuarantine,
} from "@/platform/quality/quarantine";
import { proposeRepair } from "@/platform/quality/repairs";
import { qualityStore } from "@/platform/quality/store";
import { recentAgentRuns, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { readDevDb } from "@/platform/stores/dev-db";
import {
  resetRuntimeStore,
  runtimeStore,
  unguardedRuntimeStore,
  type RecordJourneyInput,
  type RuntimeStore,
} from "@/platform/stores/runtime";

/**
 * THE END-TO-END DRILL (A09 Definition of Done).
 *
 * "Inject a bad record -> confirm ingest-time catch -> confirm quarantine ->
 * confirm it does not appear in the KPI numbers -> confirm it DOES appear in
 * the unresolved exception queue -> confirm an owner can review and either
 * approve a proposed repair or reject it, and confirm the event fires
 * correctly either way."
 *
 * Every step below runs through the REAL path with DEFAULT providers: the
 * guarded `runtimeStore()`, the shipped Approval Center, and the owner's actual
 * HTTP route. Nothing is stubbed except the admin session cookie, which is the
 * one thing a test cannot hold.
 */

const AT = "2026-08-24T12:00:00Z";
let unlocked = true;

vi.mock("@/platform/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform/admin/auth")>();
  return { ...actual, isAdminUnlocked: async () => unlocked };
});

let POST: (request: Request) => Promise<Response>;

function evidence(): EvidenceObject {
  return {
    evidence_id: "ev_drill",
    kind: "customer_text",
    content: "fixture text",
    privacy: "private",
    captured_at: AT,
  };
}

/** A journey carrying ONE deliberate defect: a blank id in the evidence list. */
function badJourney(problem: ProblemRecord): RecordJourneyInput {
  return {
    session: {
      intake_session_id: "is_drill",
      schema_version: "1.0.0",
      guest_session_id: "gs_drill",
      request_id: "rq_drill",
      attribution: {
        page_id: null,
        intent_cluster_id: null,
        search_opportunity_id: null,
        problem_family_hint: null,
        experiment_id: null,
        variant: null,
        referrer: null,
        landing_path: "/start",
      },
      consent_event_ids: ["ce_drill"],
      entered_at: AT,
      intake_started_at: AT,
    },
    consent: cleanConsentEvent({ consent_event_id: "ce_drill", problem_id: "pr_drill" }),
    problem,
    evidence: evidence(),
    packet: cleanJobPacket({ job_packet_id: "jp_drill", problem_id: "pr_drill" }),
    events: [],
  };
}

const BAD_EVIDENCE_IDS = ["ev_drill", "", "ev_second"];

function badProblem(): ProblemRecord {
  return cleanProblemRecord({
    problem_id: "pr_drill",
    intake_session_id: "is_drill",
    evidence_ids: [...BAD_EVIDENCE_IDS],
  });
}

async function recordBadJourney(store: RuntimeStore): Promise<void> {
  await store.recordJourney(badJourney(badProblem()));
  // The sole intentional defect is the blank reference. Every nonblank id
  // must have real fixture evidence so the approved repair restores safety.
  await store.attachEvidence("pr_drill", "rq_drill", { ...evidence(), evidence_id: "ev_second" });
}

function resolveRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/approvals/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function emittedNames(): string[] {
  return readDevDb().events.map((e) => (e as { event_name: string }).event_name);
}

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a09-drill-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  ({ POST } = await import("@/app/api/admin/approvals/resolve/route"));
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
  resetRuntimeStore();
});

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a09-drill-case-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  unlocked = true;
  resetQualityCountersForTests();
  resetQualityKpiForTests();
  resetAgentRunLedgerForTests();
  resetApprovalCenterForTests();
  resetKillSwitchForTests();
  resetRuntimeStore();
});

describe("THE DRILL — approve path", () => {
  it("injects a bad record and walks it all the way to a verified repair", async () => {
    // ---- 1. INJECT: a bad record goes in through the real write path -------
    const store = runtimeStore();
    await recordBadJourney(store);

    // ---- 2. INGEST CATCH: same request cycle, no polling -------------------
    const findings = await currentFindings();
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding.rule_id).toBe("problem_record.required_ids");
    expect(finding.detail_code).toBe("blank_evidence_id");
    expect(finding.severity).toBe("critical");
    expect(finding.source).toBe("ingest");
    expect(emittedNames()).toContain("data_quality.issue_detected");

    // ...and the validation run is on the ledger.
    const runs = recentAgentRuns().filter((r) => r.agent_id === "A09");
    expect(runs).toHaveLength(1);
    expect(runs[0].outputs_summary).toMatchObject({ verdict: "findings_recorded" });

    // ---- 3. QUARANTINE: contained, never dropped ---------------------------
    const markers = await activeQuarantine();
    expect(markers).toHaveLength(1);
    expect(markers[0].entity_id).toBe("pr_drill");
    expect(emittedNames()).toContain("data_quality.quarantined");
    // The original row is untouched and still there.
    expect(readDevDb().problems[0].evidence_ids).toEqual(BAD_EVIDENCE_IDS);

    // ---- 4. ABSENT FROM THE KPI READ ---------------------------------------
    const totals = await qualityFilteredJourneyTotals();
    expect(totals.excluded_by_quarantine).toBe(1);
    expect(totals.journeys).toBe(0);
    // ...while the RAW store still counts it — excluded, not deleted.
    expect((await unguardedRuntimeStore().totals()).journeys).toBe(1);
    // Safety cannot be established while a referenced evidence id is absent.
    await expect(store.getJourney("rq_drill")).rejects.toThrow("Journey evidence is unavailable");

    // ---- 5. PRESENT IN THE EXCEPTION QUEUE ---------------------------------
    const queue = await exceptionQueue();
    expect(queue.map((f) => f.issue_id)).toContain(finding.issue_id);
    const snapshot = await qualityKpiSnapshot();
    expect(snapshot.critical_open).toBe(1);
    expect(snapshot.quarantined_active).toBe(1);
    expect(snapshot.could_not_verify).toBe(false);

    // ---- 6. A REPAIR IS PROPOSED, NEVER EXECUTED --------------------------
    const proposed = await proposeRepair(finding, { run_id: runs[0].run_id });
    expect(proposed.outcome).toBe("queued_for_approval");
    expect(proposed.proposal!.requires_approval).toBe(true);
    expect(emittedNames()).toContain("data_quality.repair_proposed");
    expect(readDevDb().problems[0].evidence_ids).toEqual(BAD_EVIDENCE_IDS);

    const pending = await listApprovals();
    expect(pending).toHaveLength(1);
    expect(pending[0].approval_kind).toBe("data.repair");
    expect(pending[0].status).toBe("PENDING");

    // ---- 7. THE OWNER APPROVES, through the new resolve control -----------
    const res = await POST(
      resolveRequest({ approval_id: proposed.approval_id, decision: "approve" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("APPROVED");
    expect(body.repair.outcome).toBe("executed");
    expect(body.repair.verified).toBe(true);

    // ---- 8. THE CORRESPONDING EVENTS FIRE, under APPROVED names -----------
    const names = emittedNames();
    expect(names).toContain("data_quality.repair_executed");
    expect(names).toContain("data_quality.repair_verified");
    // No second family, no dotless spelling, nothing off the dictionary.
    expect(names.some((n) => n.startsWith("repair."))).toBe(false);
    expect(names).not.toContain("repair_verified");

    // ---- 9. THE RECORD IS ACTUALLY FIXED, and the finding is closed -------
    expect(readDevDb().problems[0].evidence_ids).toEqual(["ev_drill", "ev_second"]);
    expect(await store.getJourney("rq_drill")).not.toBeNull();
    const closed = (await currentFindings())[0];
    expect(closed.status).toBe("repair_verified");
    expect(closed.resolved_at).not.toBeNull();

    // ---- 10. THE QUARANTINE CAN BE RELEASED, and that is evented too ------
    const released = await releaseQuarantine(markers[0].marker_id, "owner");
    expect(released?.ok).toBe(true);
    expect(emittedNames()).toContain("data_quality.quarantine_released");
    expect(await activeQuarantine()).toHaveLength(0);
    // Released, never deleted.
    expect(await allQuarantineMarkers()).toHaveLength(1);
    // ...and the journey is back in the owner's numbers.
    expect((await qualityFilteredJourneyTotals()).journeys).toBe(1);

    // ---- 11. THE WHOLE TRAIL IS PERMANENT --------------------------------
    const store09 = qualityStore();
    expect((await store09.listFindings()).length).toBeGreaterThanOrEqual(3); // v1..v3
    expect(await store09.listRepairProposals()).toHaveLength(1);
    expect(await store09.listRepairExecutions()).toHaveLength(1);
    expect(await store09.listReversalSnapshots()).toHaveLength(1);
  });
});

describe("THE DRILL — reject path", () => {
  it("records the rejection, changes no data, and fires no repair event", async () => {
    const store = runtimeStore();
    await recordBadJourney(store);
    const finding = (await currentFindings())[0];
    const runId = recentAgentRuns().filter((r) => r.agent_id === "A09")[0].run_id;
    const proposed = await proposeRepair(finding, { run_id: runId });

    const res = await POST(
      resolveRequest({ approval_id: proposed.approval_id, decision: "reject" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("REJECTED");
    expect(body.repair.outcome).toBe("rejected");

    // The rejection is RECORDED — the finding is not dismissed, it is resolved
    // as rejected and stays in the record forever.
    const closed = (await currentFindings())[0];
    expect(closed.status).toBe("rejected");
    expect(closed.resolved_at).not.toBeNull();
    expect((await qualityStore().listFindings()).length).toBeGreaterThanOrEqual(3);

    // Nothing was repaired, nothing was executed, and no repair event fired.
    expect(readDevDb().problems[0].evidence_ids).toEqual(BAD_EVIDENCE_IDS);
    expect(await qualityStore().listRepairExecutions()).toEqual([]);
    const names = emittedNames();
    expect(names).toContain("data_quality.repair_proposed");
    expect(names).not.toContain("data_quality.repair_executed");
    expect(names).not.toContain("data_quality.repair_verified");

    // The record stays quarantined — a rejected repair does not make bad data
    // good, and it must not silently rejoin the KPI numbers.
    expect(await activeQuarantine()).toHaveLength(1);
    expect((await qualityFilteredJourneyTotals()).journeys).toBe(0);
    await expect(store.getJourney("rq_drill")).rejects.toThrow("Journey evidence is unavailable");
  });
});

describe("THE DRILL — safety remains independent of repair", () => {
  it("restores the unchanged packet only after the missing reference is repaired", async () => {
    const store = runtimeStore();
    await recordBadJourney(store);
    const beforePacket = readDevDb().packets[0];
    await expect(store.getJourney("rq_drill")).rejects.toThrow("Journey evidence is unavailable");

    const finding = (await currentFindings())[0];
    const runId = recentAgentRuns().filter((r) => r.agent_id === "A09")[0].run_id;
    const proposed = await proposeRepair(finding, { run_id: runId });

    // Proposing a repair is not evidence that the missing reference is fixed.
    await expect(store.getJourney("rq_drill")).rejects.toThrow("Journey evidence is unavailable");

    await POST(resolveRequest({ approval_id: proposed.approval_id, decision: "approve" }));

    const after = await store.getJourney("rq_drill");
    expect(after).not.toBeNull();
    expect(after!.packet.job_packet_id).toBe(beforePacket.job_packet_id);
    expect(after!.problem.problem_id).toBe("pr_drill");
    // The packet the homeowner sees was never rewritten by A09.
    expect(after!.packet).toEqual(beforePacket);
  });
});
