/**
 * THE EXPECTATION-OUTCOME HARNESS — its vocabulary.
 *
 * This is NOT a second test suite. `npm test` asks "does the code do what the
 * code says". This asks a different question, the one the owner actually asked:
 * DOES THE BUILD MATCH WHAT THE PROJECT RECORD SAID IT WOULD DO.
 *
 * So every row in this harness carries four things a test does not:
 *
 *   EXPECTATION  — stated in the record's own words, not the builder's.
 *   SOURCE       — the file and clause it was read from. If an expectation has
 *                  no citation it does not belong here; nothing in this harness
 *                  is invented, and a check somebody made up is worse than no
 *                  check because it manufactures agreement with itself.
 *   HOW MEASURED — the actual mechanism, said plainly enough that an owner can
 *                  decide whether they believe it.
 *   ACTUAL       — what was observed on this run.
 *
 * AND THREE VERDICTS, NOT TWO. `BLOCKED` is the one that earns this harness its
 * keep: an expectation that cannot be met today because a prerequisite is
 * missing (a migration not applied, an OAuth grant absent, a model not cleared
 * for customer data) is NOT a pass and is NOT a failure of the build. Collapsing
 * it into either one is how a gap disappears. A BLOCKED row must name its
 * missing prerequisite, and the runner refuses to render one that does not.
 */

export type Verdict = "PASS" | "FAIL" | "BLOCKED";

/** One live model call, recorded exactly as the vendor reported it. */
export interface LiveCallRecord {
  capability: string;
  model_id: string;
  ok: boolean;
  /** Failure reason when ok is false — a typed CallModelFailureReason. */
  reason?: string;
  prompt_tokens: number;
  completion_tokens: number;
  /** What the API itself said this cost. null when it reported nothing. */
  reported_cost_usd: number | null;
  /** What PRN recorded against the budget. TEST figure. */
  recorded_cost_usd: number;
  latency_ms: number;
  generation_id: string | null;
}

export interface Measured {
  verdict: Verdict;
  /** What was observed. One sentence an owner can read without the code. */
  actual: string;
  /** REQUIRED on BLOCKED: the named prerequisite that is missing. */
  blocked_on?: string;
  /** Supporting observations, one per line. */
  detail?: string[];
  /** Live calls made while measuring this expectation. */
  live_calls?: LiveCallRecord[];
}

export interface Expectation {
  /** Stable id — cite this in a crew log or a Master Todo evidence field. */
  id: string;
  group: string;
  /** The record's demand, in the record's own words where possible. */
  expectation: string;
  /** File + clause. Every one of these was read, not remembered. */
  source: string;
  /** The mechanism. */
  how: string;
  /** True when measuring this requires a real network call. Opt-in only. */
  live?: boolean;
  measure(): Promise<Measured> | Measured;
}

export interface Suite {
  group: string;
  /** Why this group of expectations exists and where it came from. */
  preamble: string;
  expectations: Expectation[];
}

export interface Result extends Measured {
  expectation: Expectation;
  duration_ms: number;
}

export function pass(actual: string, detail?: string[]): Measured {
  return { verdict: "PASS", actual, detail };
}

export function fail(actual: string, detail?: string[]): Measured {
  return { verdict: "FAIL", actual, detail };
}

export function blocked(actual: string, blocked_on: string, detail?: string[]): Measured {
  return { verdict: "BLOCKED", actual, blocked_on, detail };
}

/**
 * The workhorse: a list of named conditions, all of which must hold. Returns
 * every failure rather than the first, because an owner reading a FAIL should
 * see the whole trail — the same discipline `exclusionHits` and
 * `checkGeneratedCopy` already use in this codebase.
 */
export function all(
  conditions: ReadonlyArray<[label: string, held: boolean, observed?: string]>
): Measured {
  const broken = conditions.filter(([, held]) => !held);
  const detail = conditions.map(
    ([label, held, observed]) => `${held ? "ok  " : "FAIL"}  ${label}${observed ? ` — ${observed}` : ""}`
  );
  if (broken.length === 0) {
    return pass(`all ${conditions.length} conditions hold`, detail);
  }
  return fail(
    `${broken.length} of ${conditions.length} conditions do not hold: ${broken.map(([l]) => l).join("; ")}`,
    detail
  );
}
