import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withFileLock, writeFileAtomic } from "@/platform/stores/atomic-file";
import type {
  DerivationRecord,
  EvidenceObject,
  FactClaim,
  JobPacket,
  ProblemRecord,
} from "@/domain/problem/contracts";
import type { ConsentEvent } from "@/domain/privacy/contracts";
import type { IntakeSession } from "@/domain/intake/contracts";
import type { IntentPage, PageSpec } from "@/domain/search/pages";
import type { EventEnvelope } from "@/platform/events/envelope";
import type {
  AskAnswer,
  Email,
  Feedback,
  JobAddressRow,
  KeepClaim,
  LinkRevocation,
  MagicLink,
  Signup,
} from "@/platform/stores/interfaces";

/**
 * Dev/preview runtime store: one JSON file, server-side only. This is the
 * Wave 5-7 stand-in for the Supabase-backed stores (swapped behind the same
 * shapes once the owner selects the project — OWNER_TODO). Never used in
 * production; contains only local fixture/test journeys.
 */
export interface DevDb {
  intake_sessions: Array<IntakeSession & { request_id: string }>;
  consent_events: ConsentEvent[];
  problems: ProblemRecord[];
  evidence: EvidenceObject[];
  packets: JobPacket[];
  events: EventEnvelope[];
  /**
   * A01's durable provenance objects (migration 00014 — written, applied as a
   * separate human-coordinated step). Typed properly rather than as `unknown[]`
   * because dev-db.ts already depends on domain/problem for the three records
   * these two are the provenance OF; there is no new dependency to avoid.
   */
  fact_claims: FactClaim[];
  derivation_records: DerivationRecord[];
  staged_specs: PageSpec[];
  /**
   * A05 Page Registry rows (migration 00012 — applied 2026-08-25). The
   * `staged_page_spec` table has existed since migration 00002; the REGISTRY
   * row — page_id, canonical_path, current_page_spec_id, lifecycle_status —
   * had no table anywhere, which is why 00012 exists and why the earlier waves
   * could not express "this page is at STAGED" as anything but a field on a
   * spec. One row per page, updated in place as the lifecycle moves; the
   * append-only record of WHY it moved is the event stream and the run ledger.
   */
  intent_pages: IntentPage[];
  intake_answers: Array<{ request_id: string; field_key: string; value_text: string | null; evidence_id: string | null; source: string; answered_at: string }>;
  diagnosis_answers: Array<{ request_id: string; step_id: string; answer: string | null; evidence_id: string | null; answered_at: string }>;
  /** page_ids the OWNER published from Admin (QA PASS required). */
  published_page_ids: string[];
  /** Owner publish/unpublish/policy actions — audit trail (#14A §17). */
  admin_audit: Array<{ at: string; action: string; target: string; detail: string | null }>;

  /**
   * A09 Data Quality (migration 00010 — applied 2026-08-25). These four are
   * the DURABLE store in the file-backed dev environment, not a buffer: A09's
   * writes are fail-LOUD by deliberate exception (types.ts QualityWriteResult),
   * so "no database configured" must still mean the finding lands somewhere it
   * can be read back, or a dev run would report clean while losing its own
   * findings. Typed as `unknown[]` here ONLY because dev-db.ts is a generic
   * container that must not depend on platform/quality; the arrays are parsed
   * through the zod shapes in platform/quality/types.ts on the way in and out.
   */
  quality_findings: unknown[];
  quarantine_markers: unknown[];
  repair_proposals: unknown[];
  repair_executions: unknown[];
  repair_reversal_snapshots: unknown[];

  /**
   * A04 owner decisions on search opportunities (migration 00011 — written,
   * applied 2026-08-25). APPEND-ONLY and deliberately an OVERLAY: a decision must not
   * rewrite data/factory/opportunities.json, which is committed, reproducible
   * factory output that the next `npm run factory` regenerates wholesale — and
   * regenerating it also regenerates A05's staged portfolio and A06's QA
   * results (Loop Spec Audit condition 13). Decisions are joined onto the
   * opportunity at read time instead, so the 96 committed records stay
   * byte-identical and the decision history is the record.
   *
   * `unknown[]` for the same reason as the A09 arrays above: dev-db.ts is a
   * generic container and must not depend on domain/search. Rows are parsed
   * through the zod shape in domain/search/decision.ts on the way in and out.
   */
  opportunity_decisions: unknown[];

  /**
   * LOOP SURFACES (campaign track F2b, 2026-09-05; migration 00020 on the
   * Supabase side, same table names). The rows behind the scoped links, the
   * Home Memory claim, the Trust Network ask, the feedback popup, the mail
   * outbox, the job address and the product-page vote. All append-only;
   * magic_links is the one collection updated in place (consumed once).
   */
  link_revocations: LinkRevocation[];
  keep_claims: KeepClaim[];
  magic_links: MagicLink[];
  ask_answers: AskAnswer[];
  feedback: Feedback[];
  email_outbox: Email[];
  job_addresses: JobAddressRow[];
  signups: Signup[];
}

/**
 * A FACTORY, not a shared constant.
 *
 * This was `const EMPTY: DevDb = { ... }` spread as `{ ...EMPTY }`. That spread
 * is SHALLOW: every "fresh, genuinely empty" database handed back on a
 * cache miss shared the SAME array objects with the constant, so a caller doing
 * `db.problems.push(...)` mutated the module-level template. The next read of a
 * still-nonexistent file then returned those rows as if they had been loaded —
 * a ghost store that accumulates in memory and disappears on restart. Found by
 * A09, the first writer whose store legitimately starts empty many times in one
 * process; the door-slice collections had the same defect and never surfaced it
 * because each test file used a single path.
 */
function emptyDb(): DevDb {
  return {
    intake_sessions: [],
    consent_events: [],
    problems: [],
    evidence: [],
    packets: [],
    events: [],
    fact_claims: [],
    derivation_records: [],
    staged_specs: [],
    intent_pages: [],
    intake_answers: [],
    diagnosis_answers: [],
    published_page_ids: [],
    admin_audit: [],
    quality_findings: [],
    quarantine_markers: [],
    repair_proposals: [],
    repair_executions: [],
    repair_reversal_snapshots: [],
    opportunity_decisions: [],
    link_revocations: [],
    keep_claims: [],
    magic_links: [],
    ask_answers: [],
    feedback: [],
    email_outbox: [],
    job_addresses: [],
    signups: [],
  };
}

function dbPath(): string {
  if (process.env.PRN_DEV_DB_PATH) return process.env.PRN_DEV_DB_PATH;
  // Vercel serverless FS is read-only except /tmp, and /tmp is ephemeral per
  // instance — good enough for staging walkthroughs, honest fallback copy on
  // the results page covers cold starts. Supabase replaces this store.
  if (process.env.VERCEL) return join("/tmp", "prn-runtime", "dev-db.json");
  return join(process.cwd(), "data", "runtime", "dev-db.json");
}

export function readDevDb(options: { strictRevocationLedger?: boolean; requiredCollections?: ReadonlyArray<keyof DevDb> } = {}): DevDb {
  const path = dbPath();
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" &&
        !existsSync(`${path}.initialized`) && !options.strictRevocationLedger) return emptyDb();
    throw new Error("Local record store is unavailable; existing records have been preserved.");
  }
  // Adopt an existing pre-marker store without rewriting its data. Even a
  // damaged legacy file counts as established state, never a fresh store.
  if (!existsSync(`${path}.initialized`)) writeFileAtomic(`${path}.initialized`, "1\n");
  try {
    const parsed = JSON.parse(raw) as Partial<DevDb>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid store");
    for (const key of Object.keys(emptyDb()) as Array<keyof DevDb>) {
      if (parsed[key] !== undefined && !Array.isArray(parsed[key])) throw new Error("invalid collection");
    }
    // Admin observations cannot turn absent collections in an existing file
    // into measured zeroes. Other legacy readers retain their migration seam.
    for (const key of options.requiredCollections ?? []) {
      if (!Array.isArray(parsed[key])) throw new Error("missing required collection");
    }
    if (options.strictRevocationLedger && !Array.isArray(parsed.link_revocations)) throw new Error("missing revocation ledger");
    if (parsed.link_revocations && !parsed.link_revocations.every(row => row &&
      typeof row.link_id === "string" && row.link_id.length > 0 &&
      typeof row.request_id === "string" && row.request_id.length > 0 &&
      typeof row.revoked_at === "string" && Number.isFinite(Date.parse(row.revoked_at)))) throw new Error("invalid revocation ledger");
    return { ...emptyDb(), ...parsed };
  } catch {
    // Keep the original bytes. Empty recovery followed by a normal write
    // would erase both homeowner records and previous link revocations.
    throw new Error("Local record store is damaged; restore it before continuing.");
  }
}

export function writeDevDb(db: DevDb): void {
  const path = dbPath();
  withFileLock(path, () => persist(path, db));
}

function persist(path: string, db: DevDb): void {
  // Marker first: a crash must fail closed, not turn an established missing
  // database into a new empty one. The JSON replacement itself is atomic.
  writeFileAtomic(`${path}.initialized`, "1\n");
  writeFileAtomic(path, JSON.stringify(db, null, 2));
}

export function updateDevDb(mutate: (db: DevDb) => void): DevDb {
  const path = dbPath();
  return withFileLock(path, () => {
    const db = readDevDb();
    mutate(db);
    persist(path, db);
    return db;
  });
}
