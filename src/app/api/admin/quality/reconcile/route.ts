import { NextResponse } from "next/server";
import { isAdminUnlocked } from "@/platform/admin/auth";
import { runReconciliation } from "@/platform/quality/reconciliation";

/**
 * THE RECONCILIATION TRIGGER — the missing half of T1-03 clause 3.
 *
 * WHY THIS EXISTS. `runReconciliation()` shipped with A09 fully built, fully
 * unit-covered, and with ZERO callers anywhere in src/ or tools/. It was
 * reachable only from tests, so the four §2/§9 sweeps had never once looked at
 * real data. That was not an oversight: A09 §6 names the Durable Workflow
 * Orchestrator as the thing that should schedule it, and this repo ships that
 * orchestrator as WORKFLOW_ORCHESTRATOR_STATUS = "DEFERRED_INTERFACE_ONLY".
 * The pass was therefore written as a plain idempotent callable, waiting for
 * something to call it. This is that something.
 *
 * WHAT THIS IS NOT: A CADENCE. "Nightly reconciliation catches a manufactured
 * mismatch" needs a run that happens with nobody awake, and a button is not
 * that. NO scheduler, NO cron entry, NO timer, NO `export const revalidate`
 * heartbeat was added — on purpose. Wiring a fake cadence here would let eval
 * row T1-03.3 read PASS while the actual guarantee ("this ran last night")
 * remained untrue, which is precisely the false confidence A09 exists to
 * withhold. The row stays BLOCKED on the cadence and now says so.
 *
 * THE SAME SHAPE AS EVERY OTHER OWNER ACTION. Modelled on
 * api/admin/approvals/resolve: `isAdminUnlocked()` first, 403 without a
 * session, one state change, audited. No new top-level admin page — the
 * control is a button in the A09 section of the cockpit that already exists.
 *
 * GOVERNANCE IS NOT THIS ROUTE'S JOB, AND THAT IS DELIBERATE. The kill-switch
 * check and the single Agent Run Ledger row both live inside
 * `runReconciliation()` itself, not here. If they lived on the button, the
 * scheduler that eventually arrives would have to remember to re-implement
 * them. This route contributes exactly two things a function cannot: the owner
 * session check, and `trigger: "admin_action"` on the ledger row so the record
 * says a human asked.
 *
 * NO NEW EVENT NAMES, AND NO EMISSION FROM HERE AT ALL. Everything the run
 * emits — `data_quality.issue_detected`, `data_quality.quarantined` — is
 * emitted inside A09's own `platform/quality/events.ts` through A08's
 * `validateAndEmit`, from names already in the dictionary. A trigger is not a
 * new fact about the data, so it mints nothing.
 *
 * EVERY CLICK IS A RUN, not a retry. The module's `run_key` idempotency guard
 * exists so a retried SCHEDULED invocation cannot double-write; an owner
 * pressing the button a second time is asking for a second look, so the route
 * passes no key and takes the module's per-call unique default. Skipping the
 * owner's second click as a "duplicate" would be answering a question he did
 * not ask.
 *
 * WHY A COULD-NOT-VERIFY RUN IS STILL HTTP 200. A09's WRITES fail loud and its
 * READS fail soft, and this route must not blur the two. A run that lost one of
 * its own finding writes DID run and DID produce a report; that report — with
 * `verdict: "could_not_verify"` and `ok: false` — is the loud part, and
 * throwing it away behind a 500 would destroy the very evidence the fail-loud
 * contract exists to preserve. The response therefore carries the verdict
 * verbatim and `ok` is false for anything that is not a completed, verified
 * pass, so no caller can read a lost write as a clean bill of health.
 */
export async function POST(): Promise<NextResponse> {
  if (!(await isAdminUnlocked())) {
    return NextResponse.json({ error: "Owner sign-in required" }, { status: 403 });
  }

  const report = await runReconciliation({ trigger: "admin_action" });

  if (report.verdict === "halted_by_kill_switch") {
    return NextResponse.json(
      {
        ok: false,
        verdict: report.verdict,
        error: `A09 is paused by the ${report.halted?.scope ?? "GLOBAL"} kill switch${
          report.halted?.reason ? `: ${report.halted.reason}` : ""
        }`,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    // "clean" and "findings_recorded" are both successful passes: one looked
    // and found nothing, the other looked and found something. Neither
    // "could_not_verify" nor a skipped duplicate is a verified run.
    ok: report.verdict === "clean" || report.verdict === "findings_recorded",
    verdict: report.verdict,
    run_id: report.run_id,
    run_key: report.run_key,
    checks_run: report.checks_run,
    findings: report.findings,
    quarantined: report.quarantined,
    by_check: report.by_check,
    scan_complete: report.scan_complete,
  });
}
