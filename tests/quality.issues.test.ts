import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findRule } from "@/platform/quality/invariants";
import {
  appendFindingStatus,
  currentFindings,
  isUnresolved,
  qualityCounters,
  recordFinding,
  resetQualityCountersForTests,
  resolveRootHypothesis,
  severityFor,
  shouldQuarantine,
  writesLost,
  type RecordFindingInput,
} from "@/platform/quality/issues";
import { qualityKpiSnapshot, resetQualityKpiForTests } from "@/platform/quality/kpi";
import {
  activeQuarantine,
  allQuarantineMarkers,
  applyQuarantine,
  isQuarantined,
  releaseQuarantine,
} from "@/platform/quality/quarantine";
import { qualityStore } from "@/platform/quality/store";
import { QualityFinding, QuarantineMarker } from "@/platform/quality/types";
import { recordAgentRun, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";

/**
 * A09 §9 step 2 failable check: findings persist correctly, severity comes from
 * rule defaults, and suspected_owner is populated deterministically — never
 * blank, never fabricated beyond what the Agent Run Ledger actually supports.
 *
 * Plus the condition-7 divergence: an issue or quarantine write that does not
 * land must be a LOUD, COUNTED failure, never a silent skip.
 */

const noDb = () => null;

/** A client whose every write errors — the "durable store is broken" case. */
function brokenClient(): SupabaseClient {
  const failing = {
    insert: async () => ({ error: { message: "relation does not exist" } }),
    update: () => failing,
    select: () => failing,
    eq: async () => ({ error: { message: "relation does not exist" } }),
    order: () => failing,
    limit: async () => ({ data: null, error: { message: "relation does not exist" } }),
  };
  return { from: () => failing } as unknown as SupabaseClient;
}

const RULE = findRule("problem_record.required_ids")!;

function input(overrides: Partial<RecordFindingInput> = {}): RecordFindingInput {
  return {
    kind: "data_quality_issue",
    source: "ingest",
    rule: RULE,
    entity_type: "problem_record",
    entity_id: "pr_test_0001",
    violation: { detail_code: "missing_problem_id" },
    ...overrides,
  };
}

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a09-issues-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a09-case-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  resetQualityCountersForTests();
  resetQualityKpiForTests();
  resetAgentRunLedgerForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recording a finding", () => {
  it("persists it, readable back through the store", async () => {
    const result = await recordFinding(input(), { clientProvider: noDb });
    expect(result.ok).toBe(true);
    const stored = await currentFindings({ clientProvider: noDb });
    expect(stored).toHaveLength(1);
    expect(stored[0].issue_id).toBe(result.record.issue_id);
    expect(QualityFinding.safeParse(stored[0]).success).toBe(true);
  });

  it("takes severity from the rule default and can be overridden per violation", async () => {
    expect(severityFor(input())).toBe("critical");
    expect(severityFor(input({ violation: { detail_code: "x_code", severity: "low" } }))).toBe("low");
  });

  it("carries the reserved tenant_id, defaulting to prn with no tenant logic", async () => {
    const a = await recordFinding(input(), { clientProvider: noDb });
    expect(a.record.tenant_id).toBe("prn");
    const b = await recordFinding(input({ tenant_id: "other" }), { clientProvider: noDb });
    expect(b.record.tenant_id).toBe("other");
  });

  it("starts at version 1, status open, unresolved", async () => {
    const r = await recordFinding(input(), { clientProvider: noDb });
    expect(r.record.finding_version).toBe(1);
    expect(r.record.status).toBe("open");
    expect(isUnresolved(r.record)).toBe(true);
  });

  it("stores IDs and codes only — no field can carry customer text", async () => {
    const r = await recordFinding(input(), { clientProvider: noDb });
    const serialized = JSON.stringify(r.record);
    expect(serialized).not.toMatch(/\s{2,}/);
    // Every string value is an id, an enum member or a snake_case code.
    for (const [key, value] of Object.entries(r.record)) {
      if (typeof value !== "string") continue;
      expect(/^[A-Za-z0-9_:.-]+$/.test(value), `${key}=${value}`).toBe(true);
    }
  });
});

describe("suspected owner — deterministic, never fabricated", () => {
  it("names the last agent run that wrote this record", async () => {
    await recordAgentRun(
      { agent_id: "A01", trigger: "request", input_ids: ["pr_test_0001"], capabilities_used: [], outputs_summary: {} },
      noDb
    );
    const hypothesis = resolveRootHypothesis("pr_test_0001", null);
    expect(hypothesis.suspected_owner).toBe("A01");
    expect(hypothesis.basis).toBe("last_agent_run_ledger_write");
    expect(hypothesis.agent_run_id).toMatch(/^ar_/);
  });

  it("prefers the LAST run when several touched the record", async () => {
    for (const agent of ["A01", "A02"] as const) {
      await recordAgentRun(
        { agent_id: agent, trigger: "request", input_ids: ["pr_test_0001"], capabilities_used: [], outputs_summary: {} },
        noDb
      );
    }
    expect(resolveRootHypothesis("pr_test_0001", null).suspected_owner).toBe("A02");
  });

  it("falls back to the rule's declared owner, LABELLED as a declaration not an observation", () => {
    const hypothesis = resolveRootHypothesis("pr_unseen", "A01");
    expect(hypothesis.suspected_owner).toBe("A01");
    expect(hypothesis.basis).toBe("rule_declared_owner");
    expect(hypothesis.agent_run_id).toBeNull();
  });

  it("returns null rather than a guess when nothing supports naming an owner", () => {
    const hypothesis = resolveRootHypothesis("pr_unseen", null);
    expect(hypothesis.suspected_owner).toBeNull();
    expect(hypothesis.basis).toBe("no_agent_run_found");
  });

  it("never claims model assistance — A09 wires no model", async () => {
    const r = await recordFinding(input(), { clientProvider: noDb });
    expect(r.record.root_hypothesis.method).toBe("deterministic");
  });
});

describe("FAIL LOUD — the deliberate divergence from the platform's fail-soft default", () => {
  it("returns ok:false and NEVER throws when the finding write does not land", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await recordFinding(input(), { clientProvider: brokenClient });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/relation does not exist/);
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).toMatch(/LOST WRITE/);
  });

  it("logs at console.error, not console.warn — a lost finding is not a nuisance", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await recordFinding(input(), { clientProvider: brokenClient });
    expect(err).toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs EVERY lost write, not once per process like the platform's fail-soft miss", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordFinding(input(), { clientProvider: brokenClient });
    await recordFinding(input(), { clientProvider: brokenClient });
    await recordFinding(input(), { clientProvider: brokenClient });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("counts the loss so the run reports could-not-verify instead of clean", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(writesLost()).toBe(false);
    await recordFinding(input(), { clientProvider: brokenClient });
    expect(qualityCounters().findings_write_failed).toBe(1);
    expect(qualityCounters().findings_recorded).toBe(0);
    expect(writesLost()).toBe(true);
    const snapshot = await qualityKpiSnapshot({ clientProvider: noDb });
    // Zero findings AND could_not_verify — the honest reading of "we lost it".
    expect(snapshot.critical_open).toBe(0);
    expect(snapshot.could_not_verify).toBe(true);
  });

  it("a lost quarantine write is equally loud and equally counted", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const finding = (await recordFinding(input(), { clientProvider: noDb })).record;
    const result = await applyQuarantine(finding, { clientProvider: brokenClient });
    expect(result.ok).toBe(false);
    expect(qualityCounters().quarantines_write_failed).toBe(1);
    expect(spy).toHaveBeenCalled();
    expect(writesLost()).toBe(true);
  });
});

describe("append-only lifecycle", () => {
  it("a status change APPENDS a version — the earlier one stays readable", async () => {
    const first = (await recordFinding(input(), { clientProvider: noDb })).record;
    const moved = await appendFindingStatus(first, "repair_proposed", { clientProvider: noDb });
    expect(moved.ok).toBe(true);
    expect(moved.record.finding_version).toBe(2);

    const rows = await qualityStore(noDb).listFindings();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.finding_version).sort()).toEqual([1, 2]);
    expect(rows.find((r) => r.finding_version === 1)!.status).toBe("open");

    const current = await currentFindings({ clientProvider: noDb });
    expect(current).toHaveLength(1);
    expect(current[0].status).toBe("repair_proposed");
  });

  it("stamps resolved_at only on a terminal status", async () => {
    const first = (await recordFinding(input(), { clientProvider: noDb })).record;
    const proposed = (await appendFindingStatus(first, "repair_proposed", { clientProvider: noDb })).record;
    expect(proposed.resolved_at).toBeNull();
    const done = (await appendFindingStatus(proposed, "repair_verified", { clientProvider: noDb })).record;
    expect(done.resolved_at).not.toBeNull();
    expect(isUnresolved(done)).toBe(false);
  });

  it("a rejection is a terminal status, so no rejection event name is needed", async () => {
    const first = (await recordFinding(input(), { clientProvider: noDb })).record;
    const rejected = (await appendFindingStatus(first, "rejected", { clientProvider: noDb })).record;
    expect(rejected.resolved_at).not.toBeNull();
    expect(isUnresolved(rejected)).toBe(false);
  });
});

describe("quarantine — its own store, nothing deleted", () => {
  it("quarantines critical and high, flags medium and low without quarantining", () => {
    expect(shouldQuarantine("critical")).toBe(true);
    expect(shouldQuarantine("high")).toBe(true);
    expect(shouldQuarantine("medium")).toBe(false);
    expect(shouldQuarantine("low")).toBe(false);
  });

  it("writes a marker referencing the original row, never a column on it", async () => {
    const finding = (await recordFinding(input(), { clientProvider: noDb })).record;
    const applied = await applyQuarantine(finding, { clientProvider: noDb });
    expect(applied.ok).toBe(true);
    expect(QuarantineMarker.safeParse(applied.record).success).toBe(true);
    expect(applied.record.entity_id).toBe("pr_test_0001");
    expect(applied.record.issue_id).toBe(finding.issue_id);
    expect(await isQuarantined("problem_record", "pr_test_0001", { clientProvider: noDb })).toBe(true);
  });

  it("scopes to the exact entity — a different record is untouched", async () => {
    const finding = (await recordFinding(input(), { clientProvider: noDb })).record;
    await applyQuarantine(finding, { clientProvider: noDb });
    expect(await isQuarantined("problem_record", "pr_other", { clientProvider: noDb })).toBe(false);
    expect(await isQuarantined("job_packet", "pr_test_0001", { clientProvider: noDb })).toBe(false);
  });

  it("a release stays owner-retrievable — released, never deleted", async () => {
    const finding = (await recordFinding(input(), { clientProvider: noDb })).record;
    const marker = (await applyQuarantine(finding, { clientProvider: noDb })).record;
    const released = await releaseQuarantine(marker.marker_id, "owner", { clientProvider: noDb });
    expect(released?.ok).toBe(true);
    expect(await isQuarantined("problem_record", "pr_test_0001", { clientProvider: noDb })).toBe(false);
    expect(await activeQuarantine({ clientProvider: noDb })).toHaveLength(0);

    const all = await allQuarantineMarkers({ clientProvider: noDb });
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("released");
    expect(all[0].released_by).toBe("owner");
    expect(all[0].released_at).not.toBeNull();
  });

  it("releasing an unknown or already-released marker is null, not a silent success", async () => {
    expect(await releaseQuarantine("qm_nope", "owner", { clientProvider: noDb })).toBeNull();
    const finding = (await recordFinding(input(), { clientProvider: noDb })).record;
    const marker = (await applyQuarantine(finding, { clientProvider: noDb })).record;
    await releaseQuarantine(marker.marker_id, "owner", { clientProvider: noDb });
    expect(await releaseQuarantine(marker.marker_id, "owner", { clientProvider: noDb })).toBeNull();
  });
});

/**
 * Regression pin for a latent defect A09 surfaced in the shared dev store.
 * `readDevDb()` returned `{ ...EMPTY }` — a SHALLOW spread — so every
 * "genuinely empty" database shared its array objects with the module-level
 * constant, and a caller's push mutated the template. The next read of a
 * still-nonexistent file returned those rows as though they had been loaded: a
 * ghost store accumulating in memory. It bit A09 first because A09 is the first
 * writer whose store legitimately starts empty many times in one process.
 */
describe("dev store isolation (regression)", () => {
  it("a fresh path is genuinely empty, even after another path was written", async () => {
    await recordFinding(input(), { clientProvider: noDb });
    expect(await currentFindings({ clientProvider: noDb })).toHaveLength(1);

    const dir = await mkdtemp(join(tmpdir(), "prn-a09-fresh-"));
    process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
    expect(await currentFindings({ clientProvider: noDb })).toHaveLength(0);
    expect(await allQuarantineMarkers({ clientProvider: noDb })).toHaveLength(0);
  });
});

describe("KPI snapshot", () => {
  it("counts criticals, unresolved and quarantined, and reports verified when writes landed", async () => {
    const finding = (await recordFinding(input(), { clientProvider: noDb })).record;
    await applyQuarantine(finding, { clientProvider: noDb });
    const snapshot = await qualityKpiSnapshot({ clientProvider: noDb });
    expect(snapshot.critical_open).toBe(1);
    expect(snapshot.critical_open_7d).toBe(1);
    expect(snapshot.unresolved_total).toBe(1);
    expect(snapshot.quarantined_active).toBe(1);
    expect(snapshot.by_severity.critical).toBe(1);
    expect(snapshot.could_not_verify).toBe(false);
  });

  it("stops counting a finding as open once it reaches a terminal status", async () => {
    const first = (await recordFinding(input(), { clientProvider: noDb })).record;
    await appendFindingStatus(first, "wont_fix", { clientProvider: noDb });
    const snapshot = await qualityKpiSnapshot({ clientProvider: noDb });
    expect(snapshot.unresolved_total).toBe(0);
    expect(snapshot.critical_open).toBe(0);
  });

  it("computes the unresolved-mismatch rate over mismatches only", async () => {
    await recordFinding(
      input({ kind: "reconciliation_mismatch", source: "reconciliation" }),
      { clientProvider: noDb }
    );
    const resolvedOne = (
      await recordFinding(input({ kind: "reconciliation_mismatch", source: "reconciliation" }), {
        clientProvider: noDb,
      })
    ).record;
    await appendFindingStatus(resolvedOne, "repair_verified", { clientProvider: noDb });
    const snapshot = await qualityKpiSnapshot({ clientProvider: noDb });
    expect(snapshot.mismatches_total).toBe(2);
    expect(snapshot.unresolved_mismatches).toBe(1);
    expect(snapshot.unresolved_mismatch_rate).toBeCloseTo(0.5);
  });
});
