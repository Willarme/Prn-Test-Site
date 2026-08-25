import { establishEnv } from "./env";
import { renderReport, run } from "./runner";
import type { Suite } from "./types";

/**
 * `npm run evals` — THE OWNER'S REPORT.
 *
 *   npm run evals            offline. No network, no credential in the process,
 *                            no writes outside a throwaway temp store.
 *   npm run evals -- --live  the same, PLUS real model calls on the free model.
 *   npm run evals -- --json  machine-readable, for a future cockpit tile.
 *
 * THE ENVIRONMENT IS ESTABLISHED BEFORE ANY SUITE IS IMPORTED, which is why
 * every suite below is a dynamic import. `establishEnv` points the dev store at
 * a temp file, removes the Supabase variables so the file backend is selected,
 * and removes the model credential unless --live was asked for. A platform
 * module that loaded first would read the wrong environment and the drill would
 * write into the owner's real runtime data.
 */

async function main(): Promise<void> {
  const env = establishEnv(process.argv.slice(2));

  const suites: Suite[] = [];
  const { wave0Suite } = await import("./suites/done-when-wave0");
  suites.push(await wave0Suite());
  const { wave2Suite } = await import("./suites/done-when-wave2");
  suites.push(await wave2Suite());
  const { seamSuite } = await import("./suites/loop-seams");
  suites.push(await seamSuite());
  const { neverDoSuite } = await import("./suites/never-do");
  suites.push(await neverDoSuite());
  const { a00ConditionsSuite } = await import("./suites/a00-conditions");
  suites.push(await a00ConditionsSuite());
  const { loopDrillSuite } = await import("./suites/loop-drill");
  suites.push(await loopDrillSuite());
  const { liveModelSuite } = await import("./suites/live-model");
  suites.push(await liveModelSuite());

  if (!env.json) {
    process.stdout.write("running expectations...\n");
  }
  const report = await run(suites, {
    live: env.live,
    stream: env.json ? undefined : (line) => process.stdout.write(`${line}\n`),
  });

  if (env.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ...report,
          results: report.results.map((r) => ({
            id: r.expectation.id,
            group: r.expectation.group,
            expectation: r.expectation.expectation,
            source: r.expectation.source,
            how_measured: r.expectation.how,
            actual: r.actual,
            verdict: r.verdict,
            blocked_on: r.blocked_on ?? null,
            detail: r.detail ?? [],
          })),
        },
        null,
        2
      )}\n`
    );
  } else {
    process.stdout.write(`\n${renderReport(report, suites)}\n`);
  }

  // A FAIL is a non-zero exit, so this can gate a handoff. A BLOCKED is not:
  // a named missing prerequisite is information, not a broken build.
  process.exitCode = report.counts.FAIL > 0 ? 1 : 0;
}

void main();
