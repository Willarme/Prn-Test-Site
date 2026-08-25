import type { LiveCallRecord, Result, Suite, Verdict } from "./types";

/**
 * THE RUNNER — and the report is the product, not a side effect.
 *
 * WHAT AN OWNER GETS: for every expectation, the four columns in the order a
 * person reads them — what was expected, where that came from, how it was
 * measured, what actually happened. Failures and blocks are expanded; passes
 * are one line each, because forty passing rows that each want a paragraph is a
 * report nobody finishes.
 *
 * WHAT THE RUNNER REFUSES TO DO: mark an unmet expectation as met. A measure
 * that throws is a FAIL, not a skip — an expectation whose measurement crashed
 * has not been met, and reporting it as "error, moving on" is the same lie in a
 * different font. A BLOCKED verdict with no named prerequisite is upgraded to
 * FAIL for the same reason.
 */

export interface RunOptions {
  live: boolean;
  /** Print each row as it completes. */
  stream?: (line: string) => void;
}

export interface RunReport {
  started_at: string;
  finished_at: string;
  live: boolean;
  results: Result[];
  counts: Record<Verdict | "SKIPPED_NOT_LIVE", number>;
  live_calls: LiveCallRecord[];
  /** TEST. Sum of what PRN recorded against the budget for this run. */
  total_recorded_usd: number;
  /** Sum of what the vendor's own API reported, where it reported anything. */
  total_reported_usd: number;
}

export async function run(suites: readonly Suite[], options: RunOptions): Promise<RunReport> {
  const started = new Date();
  const results: Result[] = [];
  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0, SKIPPED_NOT_LIVE: 0 };
  const liveCalls: LiveCallRecord[] = [];

  for (const suite of suites) {
    for (const expectation of suite.expectations) {
      if (expectation.live && !options.live) {
        counts.SKIPPED_NOT_LIVE += 1;
        options.stream?.(`  ..  ${expectation.id}  (live — not run; pass --live)`);
        continue;
      }
      const t0 = Date.now();
      let measured;
      try {
        measured = await expectation.measure();
      } catch (err) {
        measured = {
          verdict: "FAIL" as const,
          actual: `the measurement itself threw: ${err instanceof Error ? `${err.message}` : String(err)}`,
          detail: err instanceof Error && err.stack ? [err.stack.split("\n").slice(1, 4).join("\n")] : undefined,
        };
      }
      // A block with no named prerequisite is not a block. It is a failure
      // wearing a softer word, which is precisely what this harness must not do.
      if (measured.verdict === "BLOCKED" && !measured.blocked_on) {
        measured = {
          ...measured,
          verdict: "FAIL" as const,
          actual: `${measured.actual} [reported BLOCKED without naming a prerequisite — recorded as FAIL]`,
        };
      }
      const result: Result = { ...measured, expectation, duration_ms: Date.now() - t0 };
      results.push(result);
      counts[result.verdict] += 1;
      if (result.live_calls) liveCalls.push(...result.live_calls);
      options.stream?.(
        `  ${result.verdict === "PASS" ? "ok " : result.verdict === "FAIL" ? "XX " : "-- "} ${result.expectation.id}  ${result.actual.slice(0, 96)}`
      );
    }
  }

  const total_recorded_usd = round(liveCalls.reduce((s, c) => s + c.recorded_cost_usd, 0));
  const total_reported_usd = round(
    liveCalls.reduce((s, c) => s + (c.reported_cost_usd ?? 0), 0)
  );

  return {
    started_at: started.toISOString(),
    finished_at: new Date().toISOString(),
    live: options.live,
    results,
    counts,
    live_calls: liveCalls,
    total_recorded_usd,
    total_reported_usd,
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/* -------------------------------------------------------------------------- */
/* THE REPORT                                                                 */
/* -------------------------------------------------------------------------- */

const RULE = "=".repeat(100);
const THIN = "-".repeat(100);

export function renderReport(report: RunReport, suites: readonly Suite[]): string {
  const out: string[] = [];
  const w = (line = "") => out.push(line);

  w(RULE);
  w("PRN — EXPECTED-OUTCOME EVAL HARNESS");
  w(RULE);
  w("");
  w("This is not a test suite. Every row below is an expectation the PROJECT RECORD");
  w("states, measured against the code as it stands today. Nothing here was invented:");
  w("each row names the file and clause it came from.");
  w("");
  w(`run started   ${report.started_at}`);
  w(`live model    ${report.live ? "YES — real calls were made" : "no (offline; pass --live to include live model evals)"}`);
  w("");
  w("VERDICTS");
  w(`  PASS     ${String(report.counts.PASS).padStart(4)}   the record's expectation is met, measured`);
  w(`  FAIL     ${String(report.counts.FAIL).padStart(4)}   the expectation is NOT met`);
  w(`  BLOCKED  ${String(report.counts.BLOCKED).padStart(4)}   cannot be met today; each names the missing prerequisite`);
  if (report.counts.SKIPPED_NOT_LIVE > 0) {
    w(`  (live)   ${String(report.counts.SKIPPED_NOT_LIVE).padStart(4)}   live-only expectations not run in this offline pass`);
  }
  w("");

  for (const suite of suites) {
    const rows = report.results.filter((r) => r.expectation.group === suite.group);
    if (rows.length === 0) continue;
    const p = rows.filter((r) => r.verdict === "PASS").length;
    const f = rows.filter((r) => r.verdict === "FAIL").length;
    const b = rows.filter((r) => r.verdict === "BLOCKED").length;
    w(RULE);
    w(`${suite.group}   [${p} pass / ${f} fail / ${b} blocked]`);
    w(RULE);
    w(wrap(suite.preamble, 98));
    w("");
    for (const row of rows) {
      w(`${row.verdict.padEnd(8)} ${row.expectation.id}`);
      w(`  EXPECTATION   ${wrapIndent(row.expectation.expectation, 16)}`);
      w(`  SOURCE        ${wrapIndent(row.expectation.source, 16)}`);
      w(`  HOW MEASURED  ${wrapIndent(row.expectation.how, 16)}`);
      w(`  ACTUAL        ${wrapIndent(row.actual, 16)}`);
      if (row.blocked_on) {
        w(`  BLOCKED ON    ${wrapIndent(row.blocked_on, 16)}`);
      }
      if (row.detail && (row.verdict !== "PASS" || row.detail.length <= 12)) {
        for (const d of row.detail) {
          for (const line of String(d).split("\n")) w(`                  ${line}`);
        }
      }
      w(THIN);
    }
    w("");
  }

  if (report.live_calls.length > 0) {
    w(RULE);
    w("LIVE MODEL CALLS — every call this run made, as the vendor reported it");
    w(RULE);
    w("");
    w(
      "capability                model            ok     in/out tok   reported   recorded(TEST)  latency"
    );
    for (const c of report.live_calls) {
      w(
        `${c.capability.padEnd(25)} ${c.model_id.padEnd(16)} ${(c.ok ? "yes" : c.reason ?? "no").padEnd(6)} ` +
          `${`${c.prompt_tokens}/${c.completion_tokens}`.padEnd(12)} ` +
          `${(c.reported_cost_usd === null ? "(none)" : `$${c.reported_cost_usd}`).padEnd(10)} ` +
          `$${String(c.recorded_cost_usd).padEnd(14)} ${c.latency_ms}ms`
      );
    }
    w("");
    w(`calls                 ${report.live_calls.length}`);
    w(`vendor reported total $${report.total_reported_usd}`);
    w(`PRN recorded total    $${report.total_recorded_usd} TEST`);
    w(
      report.total_recorded_usd === 0 && report.total_reported_usd === 0
        ? "SPEND FOR THIS RUN: $0. stealth/ox-alpha is priced $0/$0, and the budget accounting agrees with the API."
        : "SPEND FOR THIS RUN IS NOT ZERO — check the model in the AI policy before running this again."
    );
    w("");
  }

  const failures = report.results.filter((r) => r.verdict === "FAIL");
  const blocks = report.results.filter((r) => r.verdict === "BLOCKED");

  w(RULE);
  w("WHAT AN OWNER SHOULD DO WITH THIS");
  w(RULE);
  w("");
  if (failures.length === 0) {
    w("NOT MET: none. Every expectation measured in this run is either met or blocked");
    w("on a prerequisite named below.");
  } else {
    w(`NOT MET (${failures.length}) — each of these is a gap between the record and the build:`);
    for (const f of failures) w(`  ${f.expectation.id}  ${f.actual}`);
  }
  w("");
  if (blocks.length === 0) {
    w("BLOCKED: none.");
  } else {
    w(`BLOCKED (${blocks.length}) — real work the record asks for that cannot be done yet.`);
    w("Each line is the prerequisite somebody has to supply:");
    const byPrereq = new Map<string, string[]>();
    for (const b of blocks) {
      const key = b.blocked_on ?? "(unnamed)";
      byPrereq.set(key, [...(byPrereq.get(key) ?? []), b.expectation.id]);
    }
    for (const [prereq, ids] of [...byPrereq.entries()].sort((a, b) => b[1].length - a[1].length)) {
      w(`  - ${prereq}`);
      w(`      blocks: ${ids.join(", ")}`);
    }
  }
  w("");
  return out.join("\n");
}

function wrap(text: string, width: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > width) {
      lines.push(line.trim());
      line = word;
    } else line += ` ${word}`;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join("\n");
}

function wrapIndent(text: string, indent: number): string {
  return wrap(text, 100 - indent)
    .split("\n")
    .join(`\n${" ".repeat(indent)}`);
}
