import { z } from "zod";

/**
 * A00 Policy + Config Store (spec §4, §9 step 6) — typed, versioned,
 * git-tracked settings replacing scattered magic numbers.
 *
 * Wave 0 declares the SHAPE (canon's seven-level inheritance ladder,
 * COMPANY → … → EXPERIMENT) and migrates exactly ONE real trial tunable as
 * proof; the full ladder resolution engine is deliberately NOT built until a
 * lower level actually needs to override a higher one.
 *
 * This is a VERSIONED CODE MODULE by the approved Wave-0 persistence split
 * (nothing needs to mutate these without a deploy yet). It is distinct from
 * the existing SeoFactoryPolicy store (stores/policy-file.ts /
 * policy-supabase.ts), which is the door-factory's own runtime-editable
 * policy document — that store predates A00 and stays as-is.
 *
 * RULES (spec §7):
 *  - NEVER a secret in here — secrets stay in environment variables.
 *  - Any dollar figure MUST set is_test_figure: true (hard canon rule 4);
 *    by convention every key containing "usd"/"dollar" is checked in tests.
 *  - White-label condition (c): PRN-specific branding/templates/market names
 *    do not belong in PLATFORM modules; business-tunable values like these
 *    caps are exactly what this store is for.
 */
export const PolicyLevel = z.enum([
  "COMPANY",
  "LAYER",
  "POLICY",
  "TEMPLATE",
  "MARKET",
  "CATEGORY",
  "COHORT",
  "ENTITY",
  "EXPERIMENT",
]);
export type PolicyLevel = z.infer<typeof PolicyLevel>;

export const PolicySetting = z.object({
  key: z.string().regex(/^[a-z_]+(\.[a-z_]+)*$/),
  level: PolicyLevel,
  value: z.unknown(),
  version: z.number().int().min(1),
  /** MUST be true for any dollar figure — no invented prices, ever. */
  is_test_figure: z.boolean().optional(),
});
export type PolicySetting<T = unknown> = Omit<z.infer<typeof PolicySetting>, "value"> & {
  value: T;
};

/**
 * The platform policy table. Versioned in git: changing a value bumps its
 * `version` in the same commit, so "what was this cap when that run happened"
 * is answerable from history.
 *
 * MIGRATED TUNABLES (behavior unchanged, proven by tests):
 *  - intake.media_max_bytes — was the hard-coded MEDIA_MAX_BYTES constant in
 *    platform/adapters/media-storage.ts (25 MB upload cap on customer
 *    photo/video evidence). Same value, now versioned here.
 */
export const PLATFORM_POLICY_SETTINGS: readonly PolicySetting[] = [
  {
    key: "intake.media_max_bytes",
    level: "COMPANY",
    value: 25 * 1024 * 1024, // 25 MB — short phone clips fit (value unchanged in the A00 migration)
    version: 1,
  },
  {
    key: "intake.max_clarifying_questions",
    level: "COMPANY",
    /**
     * THE CEILING ON CLARIFYING QUESTIONS — the mechanism A01's mandate needs,
     * with a number that is NOT a decision.
     *
     * WHY THE MECHANISM SHIPS AND THE NUMBER DOES NOT. A01's whole argument is
     * that every clarifying question is unpaid work extracted from an anxious
     * customer, so a real enforced ceiling is buildable now and belongs in code.
     * The VALUE is a homeowner-experience judgement and is Melissa's
     * (Loop Spec Audit A01 pre-answer 11, verbatim: "read it from config with a
     * TODO-ASK-OWNER default, never a guessed integer presented as a limit").
     *
     * 5 IS AN OBSERVED CONSTANT, NOT A CHOSEN LIMIT. It is the `.slice(0, 5)`
     * already shipping in buildJobPacketFixture's question list. Reproducing a
     * number the codebase already enforces is not the same as inventing one.
     *
     * TODO-ASK-OWNER (Melissa): the real ceiling.
     *
     * WHERE IT LIVES, and the one deviation worth naming: the audit's A01
     * pre-answer 10 points A01's admin knobs at the runtime-editable pattern.
     * The knobs that need to move at 2am — model choice, enablement, spend — do
     * live there (platform/ai/policy.ts). This one is a reproduction of shipped
     * behaviour that nobody needs to change without a deploy, and it sits beside
     * `intake.media_max_bytes`, the other intake ceiling, in the store whose own
     * test guarantees it stays a plain number.
     */
    value: 5,
    version: 1,
  },
  {
    key: "intake.max_photos_per_request",
    level: "COMPANY",
    /**
     * THE 4-PHOTO CAP — the one hard cap in A01's set that IS decided, and the
     * only number in this block that is not a placeholder.
     *
     * WHY IT IS A REAL DECISION AND NOT A GUESS. The standing decision of 20 Aug
     * (crew log) is that hard caps must exist, and it names this one: max 4
     * pictures per request. A01's spec repeats it in §3, §10 and §11's HARD
     * CONSTRAINTS as though it were in force. It was not: before this commit no
     * photo-count cap existed anywhere in src/, so an unbounded number of
     * uploads was accepted per request. Loop Spec Audit condition 13 exists
     * precisely because a decided cap nobody built is a decision that did not
     * happen.
     *
     * WHAT IS STILL PARKED, AND STAYS PARKED. Video LENGTH and the number of AI
     * calls per request are explicitly undetermined — the same audit says do not
     * invent numbers for either. So there is no video-length key and no
     * AI-call-count key here; adding one with a plausible value would convert a
     * parked question into a shipped limit nobody chose.
     *
     * TODO-ASK-OWNER (Melissa): maximum video length, maximum AI calls per
     * request, and whether the photo cap counts videos too (it does not today —
     * this cap is about pictures, which is what was decided).
     */
    value: 4,
    version: 1,
  },
  /**
   * A08 dictionary tunables (A08 §10 requires these be configuration, not
   * hard-coded constants). The two NAMING PATTERNS cannot live here — this
   * store's own shipped test asserts every value is a number or boolean — so
   * they live in platform/events/config.ts and are documented there.
   */
  {
    key: "events.near_duplicate_max_distance",
    level: "COMPANY",
    // Max normalized edit distance at which two names are FLAGGED for human
    // judgement. Flags, never auto-blocks: only an EXACT collision is a hard
    // block (canon: "new events cannot duplicate an existing meaning under a
    // new name"); a near match is a question, not a verdict.
    value: 2,
    version: 1,
  },
  {
    key: "events.dictionary_audit_cadence_hours",
    level: "COMPANY",
    // Stage F scheduled dictionary audit. Nothing schedules it yet — no cron
    // route exists in Wave 0; the function is callable and tested.
    value: 24,
    version: 1,
  },
  /**
   * A09 data-quality tunables (§10 requires the rule set, tolerances, sampling,
   * alert severity, quarantine behaviour and auto-repair classes be
   * configuration rather than constants).
   *
   * The auto-repair ALLOW-LIST itself cannot live here — this store's own
   * shipped test asserts every value is a number or boolean — so it lives in
   * platform/quality/repairs.ts as an explicitly empty array, and this boolean
   * is the master switch above it. Both must be turned on for anything to
   * auto-execute, and both ship off.
   */
  {
    key: "quality.ingest_validation_enabled",
    level: "COMPANY",
    // The cheap synchronous guard at the store boundary. ON: catching a bad
    // write in the same request cycle is the whole point of ingest validation.
    value: true,
    version: 1,
  },
  {
    key: "quality.reconciliation_cadence_hours",
    level: "COMPANY",
    // The heavier sweep. Nothing schedules it in Wave 0 — the orchestrator is
    // interface-only and A09 does not build A00's job; the function is a plain
    // callable with a run-level idempotency key so a retry cannot double-write.
    value: 24,
    version: 1,
  },
  {
    key: "quality.auto_repair_enabled",
    level: "COMPANY",
    // MASTER SWITCH ABOVE AN ALREADY-EMPTY ALLOW-LIST (condition 11 / pre-answer
    // 5). OD-10 records that autonomy graduation is a process gate, not a
    // machine gate. Joshua turns this on for one named class at a time, at
    // review, with that class's reversal test green.
    value: false,
    version: 1,
  },
  {
    key: "quality.cross_source_tolerance_pct",
    level: "COMPANY",
    // Percentage delta two independently-derived totals may differ by before a
    // mismatch is raised. Zero: in a deterministic trial with no sampling,
    // any drift between two counts of the same thing is a real finding.
    value: 0,
    version: 1,
  },
  {
    key: "quality.quarantine_customer_reads",
    level: "COMPANY",
    /**
     * OFF, AND NOT A DECISION — the knob exists so the parked question has a
     * home (pre-answer 10, melissa-park).
     *
     * TODO-ASK-OWNER (Melissa): what does a homeowner see when their own record
     * is quarantined mid-journey — their ProblemRecord, their Job Packet, or
     * their /results page? Nothing, an error, a neutral holding state? Can
     * their intake still complete? That is homeowner experience, copy and
     * psychology, not an engineering call. Until it is answered, quarantine is
     * scoped to KPI and admin reads ONLY and a live homeowner journey cannot be
     * broken by one. Turning this on without answering the question first ships
     * an unwritten experience.
     */
    value: false,
    version: 1,
  },
] as const;

export function getPolicySetting<T = unknown>(key: string): PolicySetting<T> | null {
  const found = PLATFORM_POLICY_SETTINGS.find((s) => s.key === key);
  return (found as PolicySetting<T> | undefined) ?? null;
}

/**
 * Read a required numeric tunable. Throws at module-load time on a missing
 * or non-numeric key — a policy key referenced in code but absent here is a
 * programmer error a test catches, never a runtime surprise.
 */
export function requirePolicyNumber(key: string): number {
  const setting = getPolicySetting<number>(key);
  if (!setting || typeof setting.value !== "number" || !Number.isFinite(setting.value)) {
    throw new Error(`policy setting "${key}" is missing or not a number`);
  }
  return setting.value;
}

/** Same discipline for a required boolean flag. */
export function requirePolicyBoolean(key: string): boolean {
  const setting = getPolicySetting<boolean>(key);
  if (!setting || typeof setting.value !== "boolean") {
    throw new Error(`policy setting "${key}" is missing or not a boolean`);
  }
  return setting.value;
}
