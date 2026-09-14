import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Journey } from "@/platform/stores/runtime";

const reads = vi.hoisted(() => ({ runtime: vi.fn(), approvals: vi.fn(), quality: vi.fn(), findings: vi.fn(), quarantine: vi.fn(), releases: vi.fn(), spend: vi.fn(), switches: vi.fn(), runs: vi.fn() }));
vi.mock("@/platform/stores/runtime", () => ({ runtimeStore: reads.runtime }));
vi.mock("@/platform/admin/data", () => ({ loadOpportunities: () => ({ generated_at: "2026-08-14T12:00:00Z", summary: { total: 96, needs_enrichment: 58 } }) }));
vi.mock("@/platform/approvals/center", () => ({ readApprovalSnapshot: reads.approvals }));
vi.mock("@/platform/quality/kpi", () => ({ qualityKpiSnapshot: reads.quality }));
vi.mock("@/platform/quality/issues", () => ({ currentFindings: reads.findings, isUnresolved: (finding: { status: string }) => finding.status === "open" }));
vi.mock("@/platform/quality/quarantine", () => ({ activeQuarantineKeys: reads.quarantine, quarantineKey: (type: string, id: string) => `${type}:${id}` }));
vi.mock("@/platform/search/page-qa-gate", () => ({ publishQueueSnapshot: reads.releases }));
vi.mock("@/platform/ai/spend", () => ({ spendLedger: () => ({ read: reads.spend }), utcDay: () => "2026-09-06" }));
vi.mock("@/platform/killswitch", () => ({ readKillSwitchSnapshot: reads.switches }));
vi.mock("@/platform/admin/run-history", () => ({ readRunHistory: reads.runs }));

import { observe, observeAiPolicy, summarizeRecentRequests, readConsoleSnapshot, consoleAttention } from "@/platform/admin/console-data";
import { DEFAULT_AI_POLICY } from "@/platform/ai/policy";
import { FileAiPolicyStore, MemoryAiPolicyStore, setAiPolicyStoreForTests } from "@/platform/ai/policy-store";

let root: string;
const store = { kind: "file", listJourneys: vi.fn(), totals: vi.fn(), listAudit: vi.fn(), getPublishedPageIds: vi.fn() };
function journey(id: string, entered_at = "2026-09-06T12:00:00Z"): Journey {
  return { session: { intake_session_id: `is_${id}`, entered_at }, problem: { problem_id: `pb_${id}` }, packet: { job_packet_id: `jp_${id}` } } as Journey;
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prn-console-read-")); vi.stubEnv("VERCEL", ""); vi.clearAllMocks();
  reads.runtime.mockReturnValue(store);
  store.listJourneys.mockResolvedValue([]); store.totals.mockResolvedValue({ journeys: 0, packets: 0, consents: 0 });
  store.listAudit.mockResolvedValue([]); store.getPublishedPageIds.mockResolvedValue(new Set());
  reads.approvals.mockResolvedValue({ items: [], verified: true, source: "local" });
  reads.quality.mockResolvedValue({ read_failed: false, could_not_verify: false, critical_open: 0 });
  reads.findings.mockResolvedValue([]); reads.quarantine.mockResolvedValue(new Set()); reads.releases.mockResolvedValue([]);
  reads.spend.mockResolvedValue({ total_usd: 0 }); reads.switches.mockResolvedValue({ states: [], verified: true, source: "this process" });
  reads.runs.mockResolvedValue({ rows: [], state: "available", source: "local receipts" });
  setAiPolicyStoreForTests(new MemoryAiPolicyStore(structuredClone(DEFAULT_AI_POLICY)));
});
afterEach(() => { setAiPolicyStoreForTests(null); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

describe("operating observations are evidence, not fallback zeroes", () => {
  it("distinguishes a measured zero from a thrown read and excludes private errors", async () => {
    expect(await observe("fixture", async () => 0)).toMatchObject({ value: 0, state: "available" });
    const unavailable = await observe("fixture", async () => { throw new Error("private fixture detail"); });
    expect(unavailable).toMatchObject({ value: null, state: "unavailable" }); expect(JSON.stringify(unavailable)).not.toContain("private");
  });
  it("shows actual empty operating sources without inventing customer outcomes", async () => {
    const result = await readConsoleSnapshot();
    expect(result.requests).toMatchObject({ state: "available", value: { included: 0, withheld: 0, packets: 0, total_recorded: 0 } });
    expect(result.published).toMatchObject({ state: "available", value: 0 });
    expect(consoleAttention(result).map(item => item.id)).toEqual(["clear"]);
  });
  it("does not let a failed count or quarantine read become a healthy request count", async () => {
    for (const fail of [() => store.totals.mockRejectedValueOnce(new Error("offline")), () => reads.quarantine.mockRejectedValueOnce(new Error("offline"))]) {
      fail(); const result = await readConsoleSnapshot();
      expect(result.requests).toMatchObject({ state: "unavailable", value: null });
      expect(result.spend.state).toBe("available"); expect(result.published.value).toBe(0);
      expect(consoleAttention(result).some(item => item.id === "reads")).toBe(true);
    }
  });
  it("isolates runtime-construction failures from the other sources", async () => {
    reads.runtime.mockImplementationOnce(() => { throw new Error("misconfigured database"); });
    const result = await readConsoleSnapshot();
    expect(result.storage).toBe("unavailable");
    for (const field of [result.requests, result.audit, result.published]) expect(field).toMatchObject({ state: "unavailable", value: null });
    expect(result.spend.state).toBe("available"); expect(result.policy.state).toBe("available");
  });
  it("does not report a stale unverified cached switch as a confirmed current pause", async () => {
    reads.switches.mockResolvedValueOnce({ verified: false, source: "database", states: [{ engaged: true, scope: "GLOBAL" }] });
    const result = await readConsoleSnapshot();
    const ids = consoleAttention(result).map(item => item.id);
    expect(ids).toContain("reads"); expect(ids).not.toContain("paused"); expect(ids).not.toContain("clear");
  });
  it("marks failed findings and partial run evidence as incomplete", async () => {
    reads.findings.mockRejectedValueOnce(new Error("offline"));
    expect(consoleAttention(await readConsoleSnapshot()).some(item => item.id === "reads")).toBe(true);
    reads.runs.mockResolvedValueOnce({ state: "partial", rows: [], skipped: 1, limit: 80, source: "local receipts" });
    expect(consoleAttention(await readConsoleSnapshot())).toContainEqual(expect.objectContaining({ id: "runs", severity: "warning", title: "Run receipt evidence is incomplete", href: "/admin/agents" }));
  });
  it("describes capped readable history without a connection-recovery warning", async () => {
    reads.runs.mockResolvedValueOnce({ state: "partial", rows: Array.from({ length: 80 }, () => ({})), scanned: 108, skipped: 0, limit: 80, source: "local receipts" });
    const attention = consoleAttention(await readConsoleSnapshot());
    expect(attention).toEqual([expect.objectContaining({ id: "runs", severity: "neutral", title: "Run history is a bounded window", href: "/admin/agents" })]);
    expect(JSON.stringify(attention)).not.toMatch(/unavailable|recovery|connections/);
  });
  it("never gives unavailable or excluded run evidence a clean status", async () => {
    for (const history of [{ state: "unavailable", rows: [], skipped: 0 }, { state: "available", rows: [], skipped: 2 }]) {
      reads.runs.mockResolvedValueOnce(history);
      const attention = consoleAttention(await readConsoleSnapshot());
      expect(attention).toEqual([expect.objectContaining({ id: "runs", severity: "warning", href: "/admin/agents" })]);
    }
    reads.runs.mockRejectedValueOnce(new Error("private receipt failure"));
    expect(consoleAttention(await readConsoleSnapshot())).toEqual([expect.objectContaining({ id: "runs", severity: "warning" })]);
  });
  it("keeps missing-directory or process-only history explicitly limited", async () => {
    reads.runs.mockResolvedValueOnce({ state: "partial", rows: [], skipped: 0, limit: 80, source: "local receipts" });
    expect(consoleAttention(await readConsoleSnapshot())).toEqual([expect.objectContaining({ id: "runs", severity: "neutral", title: "Run history has limited coverage" })]);
  });
  it("marks missing/corrupt AI policy fallback unavailable without altering runtime defaults", async () => {
    const filename = join(root, "policy.json"); const policy = new FileAiPolicyStore(filename); setAiPolicyStoreForTests(policy);
    expect(await policy.getActive()).toBe(DEFAULT_AI_POLICY);
    expect(await observeAiPolicy()).toMatchObject({ value: null, state: "unavailable", source: expect.stringContaining("safe disabled defaults") });
    writeFileSync(filename, "{broken");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try { expect(await observeAiPolicy()).toMatchObject({ value: null, state: "unavailable" }); expect(await policy.getActive()).toBe(DEFAULT_AI_POLICY); }
    finally { warning.mockRestore(); }
    writeFileSync(filename, JSON.stringify(DEFAULT_AI_POLICY));
    expect(await observeAiPolicy()).toMatchObject({ state: "available", value: { enabled: false } });
  });
});

describe("quarantine totals describe only the inspected cohort", () => {
  it("filters session/problem/packet markers once and leaves total recorded separate", () => {
    const sample = [journey("session"), journey("problem"), journey("packet"), journey("kept")];
    const keys = new Set(["intake_session:is_session", "problem_record:pb_problem", "job_packet:jp_packet", "job_packet:jp_problem"]);
    expect(summarizeRecentRequests(sample, keys, 250)).toMatchObject({ included: 1, inspected: 4, withheld: 3, packets: 1, total_recorded: 250,
      scope: "complete records in the recent session sample" });
  });
  it("finds the latest included request by time, excluding a newer quarantined record", () => {
    const sample = [journey("held", "2026-09-07T12:00:00Z"), journey("early", "2026-09-06T12:00:00+05:00"), journey("latest", "2026-09-06T09:00:00Z")];
    expect(summarizeRecentRequests(sample, new Set(["job_packet:jp_held"]), 3)).toMatchObject({ included: 2, withheld: 1, packets: 2, latest: "2026-09-06T09:00:00Z" });
  });
  it("does not invent all-history packet-version counts or a complete cohort from incomplete sessions", () => {
    expect(summarizeRecentRequests([journey("one")], new Set(), 20)).toMatchObject({ packets: 1, total_recorded: 20, inspected: 1,
      scope: "complete records in the recent session sample" });
    expect(summarizeRecentRequests([], new Set(), 20)).toMatchObject({ included: 0, packets: 0, total_recorded: 20 });
    expect(() => summarizeRecentRequests([journey("one")], new Set(), 0)).toThrow();
  });
});
