import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EvidenceObject, JobPacket, ProblemRecord } from "@/domain/problem/contracts";
import type { ConsentEvent } from "@/domain/privacy/contracts";
import type { IntakeSession } from "@/domain/intake/contracts";
import type { PageSpec } from "@/domain/search/pages";
import type { EventEnvelope } from "@/platform/events/envelope";

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
  staged_specs: PageSpec[];
  intake_answers: Array<{ request_id: string; field_key: string; value_text: string | null; evidence_id: string | null; source: string; answered_at: string }>;
  diagnosis_answers: Array<{ request_id: string; step_id: string; answer: string | null; evidence_id: string | null; answered_at: string }>;
  /** page_ids the OWNER published from Admin (QA PASS required). */
  published_page_ids: string[];
  /** Owner publish/unpublish/policy actions — audit trail (#14A §17). */
  admin_audit: Array<{ at: string; action: string; target: string; detail: string | null }>;

  /**
   * A09 Data Quality (migration 00010 — written, NOT applied). These four are
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
   * NOT applied). APPEND-ONLY and deliberately an OVERLAY: a decision must not
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
    staged_specs: [],
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

export function readDevDb(): DevDb {
  const path = dbPath();
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return emptyDb(); // no file yet — genuinely empty
  }
  try {
    return { ...emptyDb(), ...(JSON.parse(raw) as Partial<DevDb>) };
  } catch {
    // Corrupt/partial file: preserve it for recovery instead of letting the
    // next write silently erase all prior journeys (verification finding).
    try {
      renameSync(path, `${path}.corrupt-${Date.now()}`);
    } catch {
      /* best effort */
    }
    return emptyDb();
  }
}

export function writeDevDb(db: DevDb): void {
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(db, null, 2), "utf-8");
}

export function updateDevDb(mutate: (db: DevDb) => void): DevDb {
  const db = readDevDb();
  mutate(db);
  writeDevDb(db);
  return db;
}
