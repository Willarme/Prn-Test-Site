import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanEventEnvelope, cleanProblemRecord } from "@/platform/quality/fixtures";
import {
  currentFindings,
  resetQualityCountersForTests,
} from "@/platform/quality/issues";
import { resetQualityKpiForTests } from "@/platform/quality/kpi";
import { activeQuarantine } from "@/platform/quality/quarantine";
import {
  RECONCILIATION_CHECKS,
  resetReconciliationForTests,
  runReconciliation,
} from "@/platform/quality/reconciliation";
import { recentAgentRuns, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { updateDevDb } from "@/platform/stores/dev-db";
import { resetRuntimeStore } from "@/platform/stores/runtime";
import { getPolicySetting } from "@/platform/policy/store";

/**
 * A09 §9 step 3 failable check, second half: "a manufactured cross-source
 * mismatch is caught by the next reconciliation run."
 *
 * Plus condition 3: the pass is a PLAIN CALLABLE, not wired to the workflow
 * orchestrator, with a run-level idempotency key so a retry cannot double-write.
 */

const noDb = () => null;
const AT = "2026-08-24T12:00:00Z";

/**
 * Seed the store directly rather than through the guarded write path — these
 * tests are about the sweep, and going around the guard is what lets a
 * mismatch be manufactured at all.
 */
function seedJourney(n: number, sessionId = `is_${n}`): void {
  updateDevDb((db) => {
    db.intake_sessions.push({
      intake_session_id: sessionId,
      schema_version: "1.0.0",
      guest_session_id: `gs_${n}`,
      request_id: `rq_${n}`,
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
      consent_event_ids: [],
      entered_at: AT,
      intake_started_at: AT,
    });
    db.problems.push(cleanProblemRecord({ problem_id: `pr_${n}`, intake_session_id: sessionId }));
    db.packets.push({
      job_packet_id: `jp_${n}`,
      packet_version: 1,
      schema_version: "1.0.0",
      problem_id: `pr_${n}`,
      summary_plain: "fixture packet",
      observed_statements: [],
      symptoms_and_timing: null,
      likely_service_category: {
        value: "hvac",
        confidence: "medium",
        note: "This is an inference from the description, not a diagnosis.",
      },
      what_remains_unknown: [],
      safe_prep_notes: [],
      questions_for_provider: [],
      call_script: "fixture script",
      collected_details: [],
      media_count: 0,
      diagnosis: null,
      generated_at: AT,
      engine: "fixture",
    });
  });
}

/** Seed telemetry rows so the two independently-derived totals can be compared. */
function seedEvents(name: "packet.generated" | "problem.created", count: number): void {
  updateDevDb((db) => {
    for (let i = 0; i < count; i += 1) {
      db.events.push(
        cleanEventEnvelope({ event_id: `ev_${name}_${i}`, event_name: name, context: {} })
      );
    }
  });
}

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a09-recon-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
  resetRuntimeStore();
});

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a09-recon-case-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  resetQualityCountersForTests();
  resetQualityKpiForTests();
  resetAgentRunLedgerForTests();
  resetReconciliationForTests();
  resetRuntimeStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("it is a plain callable, NOT wired to the workflow orchestrator", () => {
  it("imports nothing from platform/workflows", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "platform", "quality", "reconciliation.ts"),
      "utf-8"
    );
    // Comments stripped first: the module DISCUSSES the orchestrator at length
    // (explaining why it does not use it), and a prose mention is not a wiring.
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(/platform\/workflows/);
    expect(code).not.toMatch(/runWorkflow|defineWorkflow|WORKFLOW_ORCHESTRATOR/);
  });

  it("no A09 module reaches the orchestrator at all", () => {
    for (const file of [
      "ingest.ts",
      "issues.ts",
      "quarantine.ts",
      "reconciliation.ts",
      "repairs.ts",
      "store.ts",
      "kpi.ts",
    ]) {
      let source: string;
      try {
        source = readFileSync(join(process.cwd(), "src", "platform", "quality", file), "utf-8");
      } catch {
        continue; // module not built yet at this step
      }
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/platform\/workflows/);
    }
  });

  it("runs from one call with no scheduler, and names its cadence as configuration", async () => {
    const report = await runReconciliation({ clientProvider: noDb });
    expect(report.checks_run).toBe(RECONCILIATION_CHECKS.length);
    expect(getPolicySetting<number>("quality.reconciliation_cadence_hours")!.value).toBe(24);
  });

  it("reports a COMPLETE scan on the file backend and cannot claim clean otherwise", async () => {
    const report = await runReconciliation({ clientProvider: noDb, run_key: "scan" });
    expect(report.scan_complete).toBe(true);
    expect(report.verdict).toBe("clean");
  });
});

describe("idempotency", () => {
  it("skips a repeat of a run key already completed — a retry cannot double-write", async () => {
    seedJourney(1);
    seedEvents("packet.generated", 5); // manufacture a mismatch worth finding
    const first = await runReconciliation({ clientProvider: noDb, run_key: "recon:2026-08-24" });
    expect(first.verdict).toBe("findings_recorded");
    const firstCount = (await currentFindings({ clientProvider: noDb })).length;
    expect(firstCount).toBeGreaterThan(0);

    const retry = await runReconciliation({ clientProvider: noDb, run_key: "recon:2026-08-24" });
    expect(retry.verdict).toBe("skipped_duplicate_run");
    expect(retry.findings).toBe(0);
    expect((await currentFindings({ clientProvider: noDb })).length).toBe(firstCount);
  });

  it("a different key runs normally", async () => {
    await runReconciliation({ clientProvider: noDb, run_key: "recon:day-1" });
    const second = await runReconciliation({ clientProvider: noDb, run_key: "recon:day-2" });
    expect(second.verdict).not.toBe("skipped_duplicate_run");
  });

  it("an ad-hoc call with no key is never accidentally skipped", async () => {
    await runReconciliation({ clientProvider: noDb });
    const second = await runReconciliation({ clientProvider: noDb });
    expect(second.verdict).not.toBe("skipped_duplicate_run");
  });
});

describe("a manufactured cross-source mismatch is caught", () => {
  it("catches packets-vs-events disagreeing", async () => {
    seedJourney(1);
    seedJourney(2);
    // Two packets stored, five packet.generated events recorded. Two
    // independently-derived counts of the same quantity now disagree.
    seedEvents("packet.generated", 5);
    seedEvents("problem.created", 2);

    const report = await runReconciliation({ clientProvider: noDb, run_key: "k1" });
    expect(report.verdict).toBe("findings_recorded");
    expect(report.by_check["reconcile.packet_count_vs_events"]).toBe(1);

    const findings = await currentFindings({ clientProvider: noDb });
    const mismatch = findings.find((f) => f.rule_id === "reconcile.packet_count_vs_events")!;
    expect(mismatch.kind).toBe("reconciliation_mismatch");
    expect(mismatch.source).toBe("reconciliation");
    expect(mismatch.check_kind).toBe("cross_source_total");
    expect(mismatch.expected_count).toBe(2);
    expect(mismatch.observed_count).toBe(5);
    expect(mismatch.delta_pct).toBeCloseTo(150);
    expect(mismatch.tolerance_applied).toBe(0);
    expect(mismatch.detail_code).toBe("cross_source_total_mismatch");
  });

  it("does NOT fire when the two totals agree", async () => {
    seedJourney(1);
    seedJourney(2);
    seedEvents("packet.generated", 2);
    seedEvents("problem.created", 2);
    const report = await runReconciliation({ clientProvider: noDb, run_key: "k2" });
    expect(report.by_check["reconcile.packet_count_vs_events"]).toBeUndefined();
    expect(report.by_check["reconcile.problem_count_vs_events"]).toBeUndefined();
  });

  it("names no single record at fault for a total — that would be fabricated attribution", async () => {
    seedJourney(1);
    seedEvents("packet.generated", 9);
    seedEvents("problem.created", 1);
    await runReconciliation({ clientProvider: noDb, run_key: "k3" });
    const mismatch = (await currentFindings({ clientProvider: noDb })).find(
      (f) => f.rule_id === "reconcile.packet_count_vs_events"
    )!;
    expect(mismatch.entity_id).toBe("total:reconcile.packet_count_vs_events");
    expect(mismatch.root_hypothesis.suspected_owner).toBe("A08");
    expect(mismatch.root_hypothesis.basis).toBe("rule_declared_owner");
  });

  it("stays quiet inside the configured tolerance", async () => {
    expect(getPolicySetting<number>("quality.cross_source_tolerance_pct")!.value).toBe(0);
    seedJourney(1);
    seedEvents("packet.generated", 1);
    seedEvents("problem.created", 1);
    const report = await runReconciliation({ clientProvider: noDb, run_key: "k4" });
    expect(report.verdict).toBe("clean");
    expect(report.findings).toBe(0);
  });
});

describe("the other three sweeps", () => {
  it("catches a dangling packet -> problem reference and quarantines it", async () => {
    seedJourney(1);
    updateDevDb((db) => {
      db.packets[0].problem_id = "pr_does_not_exist";
    });
    seedEvents("packet.generated", 1);
    seedEvents("problem.created", 1);
    const report = await runReconciliation({ clientProvider: noDb, run_key: "k5" });
    expect(report.by_check["reconcile.packet_problem_referential"]).toBe(1);
    // Critical, therefore contained.
    expect(report.quarantined).toBe(1);
    const markers = await activeQuarantine({ clientProvider: noDb });
    expect(markers[0].entity_type).toBe("job_packet");
  });

  it("FLAGS duplicates once per group, never once per side, and never merges", async () => {
    seedJourney(1, "is_shared");
    seedJourney(2, "is_shared");
    seedEvents("packet.generated", 2);
    seedEvents("problem.created", 2);
    const report = await runReconciliation({ clientProvider: noDb, run_key: "k6" });
    expect(report.by_check["reconcile.problem_duplicate_intake_session"]).toBe(1);

    const dupe = (await currentFindings({ clientProvider: noDb })).find(
      (f) => f.rule_id === "reconcile.problem_duplicate_intake_session"
    )!;
    expect(dupe.severity).toBe("low");
    // Sorted, so the same duplicate pair produces the same record every run.
    expect(dupe.entity_id).toBe("pr_1");
    expect(dupe.related_entity_ids).toEqual(["pr_2"]);
    // Low severity, so nothing is quarantined and certainly nothing is merged.
    expect(await activeQuarantine({ clientProvider: noDb })).toHaveLength(0);
  });

  it("catches schema drift and attributes it to A08, who owns naming", async () => {
    seedJourney(1);
    seedEvents("packet.generated", 1);
    seedEvents("problem.created", 1);
    // A name that is not in the dictionary at all. Manufactured by writing the
    // stream directly — validateAndEmit would have blocked it, which is the
    // point: this is what a drifted historical row looks like.
    updateDevDb((db) => {
      db.events.push({
        ...cleanEventEnvelope({ event_id: "ev_drift", context: {} }),
        event_name: "legacy.orphan_name",
      } as never);
    });
    const report = await runReconciliation({ clientProvider: noDb, run_key: "k7" });
    expect(report.by_check["reconcile.unregistered_event_name"]).toBe(1);
    const drift = (await currentFindings({ clientProvider: noDb })).find(
      (f) => f.rule_id === "reconcile.unregistered_event_name"
    )!;
    expect(drift.entity_id).toBe("name:legacy.orphan_name");
    expect(drift.root_hypothesis.suspected_owner).toBe("A08");
  });
});

describe("the run ledger row", () => {
  it("writes exactly one row per reconciliation run", async () => {
    await runReconciliation({ clientProvider: noDb, run_key: "k8" });
    const runs = recentAgentRuns().filter((r) => r.agent_id === "A09");
    expect(runs).toHaveLength(1);
    expect(runs[0].trigger).toBe("schedule");
    expect(runs[0].capabilities_used).toEqual(["quality.reconcile"]);
    expect(runs[0].cost_usd).toBe(0);
    expect(runs[0].outputs_summary).toMatchObject({ run_key: "k8", verdict: "clean" });
  });

  it("reports COULD NOT VERIFY, never clean, when its own writes did not land", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    seedJourney(1);
    seedEvents("packet.generated", 7);
    const broken = () =>
      ({
        from: () => ({
          insert: async () => ({ error: { message: "relation does not exist" } }),
          select: () => ({
            order: () => ({ limit: async () => ({ data: null, error: { message: "no" } }) }),
            limit: async () => ({ data: null, error: { message: "no" } }),
          }),
        }),
      }) as never;
    const report = await runReconciliation({ clientProvider: broken, run_key: "k9" });
    expect(report.verdict).toBe("could_not_verify");
    const run = recentAgentRuns().filter((r) => r.agent_id === "A09")[0];
    expect(run.outputs_summary).toMatchObject({ verdict: "could_not_verify" });
    expect(run.errors?.[0]).toMatch(/could not verify/);
  });

  it("carries IDs, rule ids and counts only — no customer text", async () => {
    seedJourney(1);
    updateDevDb((db) => {
      db.problems[0].problem_summary = "MY PIPE EXPLODED IN THE PURPLE BATHROOM";
      db.packets[0].problem_id = "pr_missing";
    });
    await runReconciliation({ clientProvider: noDb, run_key: "k10" });
    const serialized = JSON.stringify([
      ...recentAgentRuns(),
      ...(await currentFindings({ clientProvider: noDb })),
    ]);
    expect(serialized).not.toContain("PURPLE BATHROOM");
  });
});
