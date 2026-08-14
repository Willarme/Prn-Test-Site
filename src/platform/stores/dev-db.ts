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
}

const EMPTY: DevDb = {
  intake_sessions: [],
  consent_events: [],
  problems: [],
  evidence: [],
  packets: [],
  events: [],
  staged_specs: [],
};

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
    return { ...EMPTY }; // no file yet — genuinely empty
  }
  try {
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<DevDb>) };
  } catch {
    // Corrupt/partial file: preserve it for recovery instead of letting the
    // next write silently erase all prior journeys (verification finding).
    try {
      renameSync(path, `${path}.corrupt-${Date.now()}`);
    } catch {
      /* best effort */
    }
    return { ...EMPTY };
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
