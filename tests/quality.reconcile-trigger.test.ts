import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { engageKillSwitch, resetKillSwitchForTests } from "@/platform/killswitch";
import { cleanEventEnvelope, cleanProblemRecord } from "@/platform/quality/fixtures";
import { currentFindings, resetQualityCountersForTests } from "@/platform/quality/issues";
import { resetQualityKpiForTests } from "@/platform/quality/kpi";
import {
  RECONCILIATION_CHECKS,
  resetReconciliationForTests,
  runReconciliation,
} from "@/platform/quality/reconciliation";
import { recentAgentRuns, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { updateDevDb } from "@/platform/stores/dev-db";
import { resetRuntimeStore } from "@/platform/stores/runtime";

/**
 * THE RECONCILIATION TRIGGER — T1-03 clause 3, second half, driven.
 *
 * `runReconciliation()` had ZERO callers in src/ or tools/. The sweeps were
 * defined, unit-covered and unreachable: nothing had ever run them against a
 * real store outside a test process. This file proves the trigger by DRIVING
 * THE ROUTE — importing the real POST handler and calling it — rather than
 * grepping for the function name, because a caller that exists and 403s, or
 * exists and writes three ledger rows, would satisfy a grep and fail the
 * requirement.
 *
 * WHAT IS DELIBERATELY NOT PROVED HERE, because it is deliberately not built:
 * a cadence. There is no scheduler, and one of the tests below exists to keep
 * it that way.
 */

const AT = "2026-08-25T12:00:00Z";

/**
 * The admin gate is a cookie check; these tests drive the route both ways.
 * `adminMode` is stubbed from the SAME flag because the cockpit render below
 * goes through `adminGate()`, and `adminMode` calls its module-local
 * `isAdminUnlocked` — which would reach `cookies()` outside a request scope.
 * One variable still decides the answer, so the two can never disagree.
 */
let unlocked = true;
vi.mock("@/platform/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform/admin/auth")>();
  return {
    ...actual,
    isAdminUnlocked: async () => unlocked,
    adminMode: async () => (unlocked ? "unlocked" : "locked"),
  };
});

/**
 * The control is a client component, so rendering the cockpit runs its hooks.
 * `useRouter` needs an app-router context that does not exist outside Next, so
 * it is stubbed — and ONLY it. Everything else on that page renders for real.
 */
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, useRouter: () => ({ refresh: () => {}, push: () => {} }) };
});

let POST: () => Promise<Response>;

/**
 * Seed the store DIRECTLY, around the ingest guard — that is what makes a bad
 * record manufacturable at all. A packet whose problem_id resolves to nothing
 * is the referential defect the first sweep exists to find, and it is invisible
 * to the guard because the guard only ever sees one write at a time.
 */
function seedDanglingPacket(n: number): void {
  updateDevDb((db) => {
    db.packets.push({
      job_packet_id: `jp_dangling_${n}`,
      packet_version: 1,
      schema_version: "1.0.0",
      problem_id: `pr_does_not_exist_${n}`,
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

/** Two ProblemRecords claiming one intake session — the duplicate sweep's subject. */
function seedDuplicateProblems(): void {
  updateDevDb((db) => {
    db.problems.push(
      cleanProblemRecord({ problem_id: "pr_dupe_a", intake_session_id: "is_shared" })
    );
    db.problems.push(
      cleanProblemRecord({ problem_id: "pr_dupe_b", intake_session_id: "is_shared" })
    );
  });
}

/** Telemetry rows, so the two independently-derived totals can disagree. */
function seedEvents(name: "packet.generated" | "problem.created", count: number): void {
  updateDevDb((db) => {
    for (let i = 0; i < count; i += 1) {
      db.events.push(
        cleanEventEnvelope({ event_id: `ev_${name}_${i}`, event_name: name, context: {} })
      );
    }
  });
}

function a09Runs() {
  return recentAgentRuns().filter((r) => r.agent_id === "A09");
}

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a09-trigger-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  ({ POST } = await import("@/app/api/admin/quality/reconcile/route"));
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
  resetRuntimeStore();
});

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a09-trigger-case-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  unlocked = true;
  resetQualityCountersForTests();
  resetQualityKpiForTests();
  resetAgentRunLedgerForTests();
  resetReconciliationForTests();
  resetKillSwitchForTests();
  resetRuntimeStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the trigger is owner-gated like every other admin action", () => {
  it("403s without an owner session — and nothing ran", async () => {
    seedDanglingPacket(1);
    unlocked = false;

    const res = await POST();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Owner sign-in required/);

    // Not merely refused — the pass did not happen. No ledger row, no finding.
    expect(a09Runs()).toHaveLength(0);
    expect(await currentFindings({ clientProvider: () => null })).toHaveLength(0);
  });
});

describe("with an owner session it actually runs", () => {
  it("catches a manufactured bad record and reports it", async () => {
    seedDanglingPacket(1);

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.verdict).toBe("findings_recorded");
    expect(body.checks_run).toBe(RECONCILIATION_CHECKS.length);
    expect(body.scan_complete).toBe(true);
    // The dangling packet was found, by name, by the referential sweep.
    expect(body.by_check["reconcile.packet_problem_referential"]).toBe(1);

    const findings = await currentFindings({ clientProvider: () => null });
    const referential = findings.filter(
      (f) => f.rule_id === "reconcile.packet_problem_referential"
    );
    expect(referential).toHaveLength(1);
    expect(referential[0].entity_id).toBe("jp_dangling_1");
    expect(referential[0].detail_code).toBe("dangling_problem_reference");
    // IDs only — the finding names the packet and the problem it points at,
    // and carries no copy of either record.
    expect(referential[0].related_entity_ids).toContain("pr_does_not_exist_1");
  });

  it("catches a manufactured CROSS-SOURCE mismatch — two counts of one quantity disagreeing", async () => {
    seedEvents("packet.generated", 5); // five events, zero stored packets

    const res = await POST();
    const body = await res.json();
    expect(body.verdict).toBe("findings_recorded");
    expect(body.by_check["reconcile.packet_count_vs_events"]).toBe(1);
  });

  it("reports a clean pass as clean when there is genuinely nothing to find", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.verdict).toBe("clean");
    expect(body.findings).toBe(0);
    // "Clean" is only allowed to mean clean when the scan actually saw everything.
    expect(body.scan_complete).toBe(true);
  });
});

describe("ONE Agent Run Ledger row per RUN, not per finding", () => {
  it("writes exactly one row for one run", async () => {
    seedDanglingPacket(1);
    await POST();
    expect(a09Runs()).toHaveLength(1);
  });

  it("still writes exactly one row when the run raises MANY findings", async () => {
    seedDanglingPacket(1);
    seedDanglingPacket(2);
    seedDanglingPacket(3);
    seedDuplicateProblems();
    seedEvents("packet.generated", 9);

    const res = await POST();
    const body = await res.json();
    expect(body.findings).toBeGreaterThan(3);

    const runs = a09Runs();
    expect(runs).toHaveLength(1);
    // The row carries the whole run, which is what makes one row sufficient.
    const summary = runs[0].outputs_summary as Record<string, unknown>;
    expect(summary.findings_created).toBe(body.findings);
    expect(summary.checks_run).toBe(RECONCILIATION_CHECKS.length);
    expect(summary.verdict).toBe("findings_recorded");
  });

  it("records that a HUMAN asked, and that the run cost nothing", async () => {
    await POST();
    const run = a09Runs()[0];
    expect(run.trigger).toBe("admin_action");
    expect(run.agent_id).toBe("A09");
    expect(run.capabilities_used).toContain("quality.reconcile");
    // A09 makes no model call; 0 here is a measurement, not a placeholder.
    expect(run.cost_usd).toBe(0);
  });

  it("two clicks are two runs — an owner asking again is not a retry", async () => {
    await POST();
    await POST();
    expect(a09Runs()).toHaveLength(2);
  });
});

describe("the kill switch is a hard stop on this path", () => {
  it("the AGENT switch blocks the run: 409, no ledger row, no finding", async () => {
    seedDanglingPacket(1);
    await engageKillSwitch(
      { scope: "AGENT", scope_ref: "A09", by: "owner:test", reason: "paused for the demo" },
      () => null
    );

    const res = await POST();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.verdict).toBe("halted_by_kill_switch");
    expect(body.error).toMatch(/A09 is paused by the AGENT kill switch: paused for the demo/);

    // Halted means nothing ran: no audit row for work not done, and the
    // manufactured defect is still sitting there undetected.
    expect(a09Runs()).toHaveLength(0);
    expect(await currentFindings({ clientProvider: () => null })).toHaveLength(0);
  });

  it("the GLOBAL switch blocks it too", async () => {
    await engageKillSwitch({ scope: "GLOBAL", by: "owner:test" }, () => null);
    const res = await POST();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/GLOBAL kill switch/);
    expect(a09Runs()).toHaveLength(0);
  });

  it("a halted run does NOT burn its run key — a pause must not become a skipped night", async () => {
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A09", by: "owner:test" }, () => null);
    const halted = await runReconciliation({ clientProvider: () => null, run_key: "recon:night" });
    expect(halted.verdict).toBe("halted_by_kill_switch");

    // Switch released, same key: the real run must still happen. If the halted
    // call had consumed the key this would come back skipped_duplicate_run and
    // the night's pass would be silently lost.
    resetKillSwitchForTests();
    seedDanglingPacket(1);
    const real = await runReconciliation({ clientProvider: () => null, run_key: "recon:night" });
    expect(real.verdict).toBe("findings_recorded");
    expect(real.run_id).not.toBeNull();
  });
});

describe("the trigger does not overreach", () => {
  it("adds NO scheduler, cron entry or timer — the cadence is still genuinely missing", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/admin/quality/reconcile/route.ts"),
      "utf-8"
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(route).not.toMatch(/setInterval|setTimeout|cron|revalidate|schedule/i);
    // A GET would let any uptime pinger become an accidental scheduler.
    expect(route).not.toMatch(/export async function GET/);
    expect(route).toMatch(/export async function POST/);
  });

  it("checks the owner session BEFORE it runs anything", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/admin/quality/reconcile/route.ts"),
      "utf-8"
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(route.indexOf("isAdminUnlocked")).toBeLessThan(route.indexOf("runReconciliation("));
  });

  it("mints no event name — the route emits nothing at all", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/admin/quality/reconcile/route.ts"),
      "utf-8"
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(route).not.toMatch(/validateAndEmit|emitPlatformEvent|event_name/);
  });

  it("ships a client control that imports nothing from the platform", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/admin/ReconciliationRun.tsx"),
      "utf-8"
    );
    expect(source).toMatch(/^"use client"/);
    expect(source).not.toMatch(/@\/platform\//);
  });

  it("adds NO new top-level admin page — the control lives on the cockpit that exists", () => {
    const page = readFileSync(join(process.cwd(), "src/app/admin/page.tsx"), "utf-8");
    expect(page).toMatch(/ReconciliationRun/);
  });
});

/**
 * The control, RENDERED. The route above is driven; this makes sure the button
 * that drives it actually reaches the owner's screen, rather than being an
 * import that a source scan is happy with.
 */
describe("the control reaches the cockpit HTML", () => {
  async function renderCockpit(): Promise<string> {
    const { default: AdminOverview } = await import("@/app/admin/page");
    return renderToStaticMarkup(await AdminOverview());
  }

  it("renders inside the existing A09 data-quality section", async () => {
    unlocked = true;
    const html = await renderCockpit();
    expect(html).toMatch(/Data quality/);
    expect(html).toMatch(/Run reconciliation now/);
    // A button, on the page that already existed — not a link to a new screen.
    expect(html).toMatch(/<button[^>]*>Run reconciliation now<\/button>/);
    expect(html).not.toMatch(/href="\/admin\/quality/);
  });

  it("is not rendered at all without an owner session", async () => {
    unlocked = false;
    const html = await renderCockpit();
    expect(html).not.toMatch(/Run reconciliation now/);
  });
});
