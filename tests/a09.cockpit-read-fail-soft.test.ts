import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPlatformClient } from "@/platform/db/client";
import { findRule } from "@/platform/quality/invariants";
import {
  currentFindings,
  qualityCounters,
  recordFinding,
  resetQualityCountersForTests,
  type RecordFindingInput,
} from "@/platform/quality/issues";
import {
  exceptionQueue,
  qualityFilteredJourneyTotals,
  qualityKpiSnapshot,
  resetQualityKpiForTests,
} from "@/platform/quality/kpi";
import { activeQuarantineKeys, applyQuarantine } from "@/platform/quality/quarantine";
import { qualityStore } from "@/platform/quality/store";
import { QualityFinding } from "@/platform/quality/types";

/**
 * A09 step 11 — THE COCKPIT MUST NOT 500 OVER AN UNAPPLIED MIGRATION.
 *
 * THE GAP THIS FILE CLOSES. Every other A09 test reaches the failure case one of
 * two ways: the file backend, or a hand-built broken client passed in as
 * `deps.clientProvider`. Neither is the path /admin actually takes. The cockpit
 * calls qualityKpiSnapshot(), qualityFilteredJourneyTotals() and exceptionQueue()
 * with NO deps, so they fall through to the DEFAULT serviceClientProvider — and
 * that path was never exercised against a real database whose A09 tables are
 * missing. So this file mocks `createClient` itself and configures the database
 * env, which makes serviceClientProvider hand back a client for real.
 *
 * THE STATE BEING SIMULATED is exactly the one this branch ships: a database is
 * configured and everything up to migration 00009 is applied, but
 * 00010_data_quality.sql is written and NOT applied. So the platform's own
 * tables answer normally and only A09's five tables raise "relation ... does not
 * exist". A blanket-broken client would not have caught this — it would have
 * failed the journey counts too and hidden which half was at fault.
 *
 * WHAT IS PINNED HERE IS AN ASYMMETRY, and both halves matter:
 *   - READS fail soft, to `could_not_verify` — never a reassuring zero, and
 *     never an exception that takes the whole owner cockpit down with it,
 *     including the panels that have nothing to do with A09.
 *   - WRITES stay fail-LOUD — `{ ok: false }`, a counter, a console.error.
 * Anyone who later "fixes" the asymmetry into consistency breaks a test here
 * and has to read why it is deliberate.
 */

// A09's five tables — the ones migration 00010 creates, and the only ones
// missing in the state being simulated.
vi.mock("@supabase/supabase-js", () => {
  const A09_TABLES = new Set([
    "data_quality_issue",
    "quarantine_marker",
    "repair_proposal",
    "repair_execution",
    "repair_reversal_snapshot",
  ]);

  /** A thenable query chain: every builder method returns itself, awaiting yields `result`. */
  function node(result: unknown): Record<string, unknown> {
    const n: Record<string, unknown> = {};
    for (const method of ["select", "order", "limit", "eq", "insert", "update", "delete"]) {
      n[method] = () => n;
    }
    n.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onOk, onErr);
    return n;
  }

  return {
    createClient: () => ({
      from: (table: string) =>
        A09_TABLES.has(table)
          ? node({ data: null, error: { message: `relation "${table}" does not exist` } })
          : node({ data: [], error: null, count: 0 }),
    }),
  };
});

const RULE = findRule("problem_record.required_ids")!;

function input(overrides: Partial<RecordFindingInput> = {}): RecordFindingInput {
  return {
    kind: "data_quality_issue",
    source: "ingest",
    rule: RULE,
    entity_type: "problem_record",
    entity_id: "pr_readsoft_0001",
    violation: { detail_code: "missing_problem_id" },
    ...overrides,
  };
}

function finding(): QualityFinding {
  return QualityFinding.parse({
    issue_id: "dq_readsoft_0001",
    finding_version: 1,
    tenant_id: "prn",
    kind: "data_quality_issue",
    source: "ingest",
    check_kind: RULE.kind,
    rule_id: RULE.rule_id,
    rule_version: RULE.rule_version,
    entity_type: "problem_record",
    entity_id: "pr_readsoft_0001",
    related_entity_ids: [],
    severity: "critical",
    detail_code: "missing_problem_id",
    expected_count: null,
    observed_count: null,
    delta_pct: null,
    tolerance_applied: null,
    root_hypothesis: {
      method: "deterministic",
      suspected_owner: null,
      basis: "no_agent_run_found",
      agent_run_id: null,
    },
    quarantined: false,
    status: "open",
    created_at: "2026-08-24T00:00:00Z",
    resolved_at: null,
  });
}

beforeAll(() => {
  // A database IS configured — this is the whole point. serviceClientProvider
  // returns a client, so the cockpit takes the Supabase branch for real.
  process.env.SUPABASE_URL = "https://a09-read-fail-soft.test.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "not-a-real-credential";
  resetPlatformClient();
});

afterAll(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  resetPlatformClient();
});

beforeEach(() => {
  resetQualityCountersForTests();
  resetQualityKpiForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the simulated state is the real one", () => {
  it("takes the DEFAULT service client path, not an injected stub", () => {
    // If this ever reports "file", the rest of this file is testing nothing.
    expect(qualityStore().kind).toBe("supabase");
  });

  it("leaves the store seam itself loud — the softening is at the read entry point", async () => {
    await expect(qualityStore().listFindings()).rejects.toThrow(/does not exist/);
  });

  it("simulates ONLY migration 00010 missing — the platform's own tables answer", async () => {
    const { runtimeStore } = await import("@/platform/stores/runtime");
    await expect(runtimeStore().totals()).resolves.toBeDefined();
  });
});

describe("A09 reads fail soft to could_not_verify", () => {
  it("qualityKpiSnapshot resolves instead of throwing", async () => {
    await expect(qualityKpiSnapshot()).resolves.toBeDefined();
  });

  it("reports could_not_verify rather than a reassuring zero", async () => {
    const snapshot = await qualityKpiSnapshot();
    expect(snapshot.could_not_verify).toBe(true);
    expect(snapshot.read_failed).toBe(true);
    // Zeroes are present but MEANINGLESS — could_not_verify is what makes them
    // honest. Zero findings with could_not_verify false would be a false clean.
    expect(snapshot.critical_open).toBe(0);
    expect(snapshot.unresolved_total).toBe(0);
    expect(snapshot.quarantined_active).toBe(0);
  });

  it("distinguishes a failed READ from a lost WRITE", async () => {
    const snapshot = await qualityKpiSnapshot();
    expect(snapshot.read_failed).toBe(true);
    // No write was attempted in this test, so the write counters must stay 0 —
    // the cockpit must not claim A09 "lost 0 writes" as the reason.
    expect(snapshot.findings_write_failed).toBe(0);
    expect(snapshot.quarantines_write_failed).toBe(0);
  });

  it("qualityFilteredJourneyTotals resolves and flags the unverified filter", async () => {
    const totals = await qualityFilteredJourneyTotals();
    expect(totals.could_not_verify).toBe(true);
    expect(totals.read_failed).toBe(true);
    // The quarantine filter could not run, so nothing was withheld — and the
    // count must not be presented as quarantine-honest.
    expect(totals.excluded_by_quarantine).toBe(0);
  });

  it("exceptionQueue resolves to empty instead of throwing", async () => {
    await expect(exceptionQueue(8)).resolves.toEqual([]);
  });

  it("THE REGRESSION: the cockpit's whole Promise.all resolves", async () => {
    // src/app/admin/page.tsx awaits these three in one Promise.all with no
    // try/catch and no error.tsx. One rejection there took down every panel on
    // the page, including the ones that have nothing to do with A09.
    await expect(
      Promise.all([qualityFilteredJourneyTotals(), qualityKpiSnapshot(), exceptionQueue(8)])
    ).resolves.toHaveLength(3);
  });

  it("warns once, naming the migration a human has to apply", async () => {
    const warn = console.warn as unknown as ReturnType<typeof vi.fn>;
    await qualityKpiSnapshot();
    await exceptionQueue(8);
    await qualityFilteredJourneyTotals();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/00010/);
    // A repeated read condition is logged once; a lost write is logged every
    // time. That difference is the read/write asymmetry, in the log.
    expect(warn.mock.calls[0][0]).toMatch(/a09-quality/);
  });
});

describe("WRITES stay fail-LOUD in the identical situation", () => {
  it("recordFinding still refuses to report success", async () => {
    const result = await recordFinding(input());
    expect(result.ok).toBe(false);
    expect(qualityCounters().findings_write_failed).toBe(1);
    expect(qualityCounters().findings_recorded).toBe(0);
    expect(console.error).toHaveBeenCalled();
  });

  it("applyQuarantine still refuses to report success", async () => {
    const result = await applyQuarantine(finding());
    expect(result.ok).toBe(false);
    expect(qualityCounters().quarantines_write_failed).toBe(1);
    expect(console.error).toHaveBeenCalled();
  });

  it("a lost write and a failed read are BOTH visible, and distinguishable", async () => {
    await recordFinding(input());
    const snapshot = await qualityKpiSnapshot();
    expect(snapshot.could_not_verify).toBe(true);
    expect(snapshot.read_failed).toBe(true);
    expect(snapshot.findings_write_failed).toBe(1);
  });

  it("the store's own write seam still THROWS — nothing was softened below the read entry points", async () => {
    await expect(qualityStore().appendFinding(finding())).rejects.toThrow(/does not exist/);
  });

  it("currentFindings stays loud for write-path callers", async () => {
    // findingById() (same read) gates the approvals resolve route and repair
    // execution. A repair that silently believed "no such finding" would be the
    // exact silent no-op the fail-loud contract exists to prevent — so the raw
    // read stays loud and only the cockpit's KPI entry points soften it.
    await expect(currentFindings()).rejects.toThrow(/does not exist/);
    await expect(activeQuarantineKeys()).rejects.toThrow(/does not exist/);
  });
});
