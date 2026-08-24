/**
 * A08 dictionary configuration (spec §10 requires the naming convention, the
 * near-duplicate threshold and the audit cadence be CONFIGURATION, not
 * hard-coded constants — so they can change without a rewrite).
 *
 * WHY THIS FILE AND NOT THE A00 POLICY STORE. The numeric tunables DO live in
 * `PLATFORM_POLICY_SETTINGS` (policy/store.ts) — see `events.*` there. The two
 * PATTERNS cannot: the shipped A00 test `policy.platform-store.test.ts` asserts
 * every policy value is a `number` or `boolean` ("no secrets — values are plain
 * business tunables"). Widening that A00 contract to admit strings would be a
 * change to an already-shipped definition for A08's own convenience, which is
 * exactly the move A08 exists to refuse. So the patterns live here, typed and
 * overridable, and the numbers live in the policy store where they belong.
 *
 * NAMING CONVENTION — DECIDED BY CODE, NOT ASKED (Loop Spec Audit condition 11
 * / pre-answer 4). `tests/events.registry.test.ts` has asserted
 * /^[a-z_]+\.[a-z_]+$/ across all shipped names since the door slice and calls
 * it "the domain.action naming convention". That is the configured default.
 * The flat snake_case list in vault `02 Supporting/17` is recorded as a
 * LOWER-PRECEDENCE HISTORICAL VARIANT, not a live fork — nothing reads it.
 *
 * METRIC KEYS are NOT event names. Canon fixes no syntax for them, so the
 * metric pattern admits both flat (`useful_outcome_rate`) and dotted
 * (`seo.pages_published`) keys; the eleven 14A §18.3 owner gauges are seeded
 * flat because that is how canon writes them.
 */

export interface DictionaryConfig {
  /** The configured event-name convention. Default: domain.action. */
  event_name_pattern: RegExp;
  /** Metric-key convention — flat or dotted snake_case. */
  metric_key_pattern: RegExp;
  /**
   * Near-duplicate flag threshold: max normalized edit distance at which two
   * names are FLAGGED (never auto-blocked — a near match needs human
   * judgement about whether it is the same thing). Mirrors the policy-store
   * value; kept here so the checker has one read.
   */
  near_duplicate_max_distance: number;
  /** Scheduled dictionary-audit cadence, hours. */
  audit_cadence_hours: number;
}

const DEFAULTS: DictionaryConfig = {
  event_name_pattern: /^[a-z_]+\.[a-z_]+$/,
  metric_key_pattern: /^[a-z_]+(\.[a-z_]+)*$/,
  near_duplicate_max_distance: 2,
  audit_cadence_hours: 24,
};

let active: DictionaryConfig = { ...DEFAULTS };

export function dictionaryConfig(): DictionaryConfig {
  return active;
}

/** Configuration seam — used by tests and by a future policy-store binding. */
export function setDictionaryConfig(patch: Partial<DictionaryConfig>): void {
  active = { ...active, ...patch };
}

export function resetDictionaryConfigForTests(): void {
  active = { ...DEFAULTS };
}

/**
 * Naming normalization (canon's first reusable A08 capability). Lower-cases,
 * trims, collapses separators — the input to both the convention check and the
 * near-duplicate distance, so "Packet.Generated " and "packet.generated"
 * cannot register as two different things.
 */
export function normalizeName(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/_{2,}/g, "_");
}

/** Levenshtein distance — deterministic, no model, used by the Stage C flag. */
export function nameDistance(a: string, b: string): number {
  const s = normalizeName(a);
  const t = normalizeName(b);
  if (s === t) return 0;
  const rows = s.length + 1;
  const cols = t.length + 1;
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i += 1) {
    const cur = new Array<number>(cols);
    cur[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[cols - 1];
}
