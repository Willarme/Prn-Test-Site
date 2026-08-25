import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * THE HARNESS'S OWN ENVIRONMENT, established BEFORE any platform module loads.
 *
 * THREE THINGS THIS FILE EXISTS TO GUARANTEE, and each one was a real hazard:
 *
 * 1. THE DRILL MUST NOT WRITE INTO THE OWNER'S RUNTIME DATA. `data/runtime/
 *    dev-db.json` is the file-backed store the dev server reads; a drill that
 *    stages pages and publishes them into it would leave fixture pages in the
 *    owner's admin queue. `PRN_DEV_DB_PATH` points at a fresh temp file per run,
 *    which is the seam `dev-db.ts` already ships for exactly this.
 *
 * 2. THE DRILL MUST NOT REACH A DATABASE. `supabaseConfigured()` reads
 *    `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from the environment. This
 *    process never loads `.env.local` wholesale, so those are absent and the
 *    file backend is selected — which is the requirement ("file backend, no
 *    network") and also the honest posture, because migrations 00006+ are
 *    written but NOT applied (src/platform/db/client.ts:15).
 *
 * 3. THE LIVE PORTION MUST BE OPT-IN AND MUST TAKE EXACTLY ONE SECRET.
 *    `loadModelCredential()` reads `.env.local` and copies across ONE key,
 *    `OPENROUTER_API_KEY`. Not the file. Not the Supabase service role. One
 *    named variable, and only when `--live` was asked for. A harness that
 *    quietly inherited a service-role key would be a harness that could write to
 *    production while claiming to be a report.
 */

export interface HarnessEnv {
  live: boolean;
  json: boolean;
  /** Absolute path of the throwaway dev-db this run wrote to. */
  devDbPath: string;
  modelCredentialPresent: boolean;
}

let established: HarnessEnv | null = null;

export function establishEnv(argv: readonly string[]): HarnessEnv {
  if (established) return established;

  const live = argv.includes("--live") || process.env.PRN_EVALS_LIVE === "1";
  const json = argv.includes("--json");

  // 1. An isolated store. Must be set before anything imports dev-db.ts.
  const dir = mkdtempSync(join(tmpdir(), "prn-evals-"));
  const devDbPath = join(dir, "dev-db.json");
  process.env.PRN_DEV_DB_PATH = devDbPath;

  // 2. No database. Explicit deletes, so a shell that exported them is covered.
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  // 3. No credential unless the run is live. An offline run must be UNABLE to
  //    call out, not merely uninclined to.
  delete process.env.OPENROUTER_API_KEY;

  let modelCredentialPresent = false;
  if (live) {
    const key = readOneEnvVar(".env.local", "OPENROUTER_API_KEY") ?? undefined;
    if (key) {
      process.env.OPENROUTER_API_KEY = key;
      modelCredentialPresent = true;
    }
  }

  established = { live, json, devDbPath, modelCredentialPresent };
  return established;
}

export function harnessEnv(): HarnessEnv {
  if (!established) throw new Error("establishEnv() must run before any suite loads");
  return established;
}

/**
 * Read exactly ONE variable out of a dotenv file. Deliberately not a dotenv
 * loader: this returns a single named value and never populates the process
 * environment with everything it found.
 */
function readOneEnvVar(file: string, name: string): string | null {
  try {
    const raw = readFileSync(join(process.cwd(), file), "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && m[1] === name) return m[2];
    }
  } catch {
    /* no file — the credential is simply absent, which is a valid state */
  }
  return null;
}
