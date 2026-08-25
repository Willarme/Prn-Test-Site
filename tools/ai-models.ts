import { readFileSync } from "node:fs";
import path from "node:path";
import { MODEL_CATALOGUE, MODEL_CATALOGUE_PROBED_AT } from "../src/platform/ai/models";

/**
 * `npm run ai:models` — re-probe the live model catalogue and print the DRIFT
 * against src/platform/ai/models.ts.
 *
 * WHY A SCRIPT AND NOT AN AUTO-REFRESH. Prices are the input to a budget brake.
 * A file that silently rewrote itself from a marketplace would mean the cap an
 * owner approved on Monday is enforcing different arithmetic on Tuesday with no
 * commit to read. So this REPORTS and changes nothing: a price edit is a commit
 * somebody signs off.
 *
 * WHAT IT IS FOR, day to day: swapping the model is meant to be a data edit, and
 * this is how you find out what data to write. Run it, read the drift, edit
 * MODEL_CATALOGUE, commit.
 *
 * Reads OPENROUTER_API_KEY from the environment. Prints no key, ever.
 */

/** Same .env.local reader every other tool in this directory uses. */
function loadEnv(): void {
  try {
    const raw = readFileSync(path.join(process.cwd(), ".env.local"), "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* rely on real env */
  }
}

interface ApiModel {
  id: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

function perMillion(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const perToken = Number(raw);
  if (!Number.isFinite(perToken)) return null;
  return Math.round(perToken * 1_000_000 * 1e6) / 1e6;
}

function fmt(n: number | null): string {
  return n === null ? "?" : `$${n}`;
}

async function main(): Promise<void> {
  loadEnv();
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.log(
      "OPENROUTER_API_KEY is not set — nothing to probe. This is not an error: a deployment with no key has no model, and every capability falls back deterministically."
    );
    return;
  }

  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) {
    console.error(`probe failed: HTTP ${response.status}`);
    process.exitCode = 1;
    return;
  }
  const payload = (await response.json()) as { data?: ApiModel[] };
  const live = payload.data ?? [];
  const byId = new Map(live.map((m) => [m.id, m]));

  console.log(`live catalogue: ${live.length} models`);
  console.log(`seeded catalogue: ${MODEL_CATALOGUE.length} models, prices probed ${MODEL_CATALOGUE_PROBED_AT}`);
  console.log("");

  let drift = 0;
  for (const seeded of MODEL_CATALOGUE) {
    const actual = byId.get(seeded.id);
    if (!actual) {
      drift += 1;
      console.log(`✗ ${seeded.id}: NOT IN THE LIVE CATALOGUE — this model has been withdrawn or renamed.`);
      continue;
    }
    const liveIn = perMillion(actual.pricing?.prompt);
    const liveOut = perMillion(actual.pricing?.completion);
    const liveStructured = (actual.supported_parameters ?? []).includes("structured_outputs");
    const expectedMode = liveStructured ? "json_schema" : "json_object";

    const notes: string[] = [];
    if (liveIn !== null && liveIn !== seeded.price_in_per_mtok) {
      notes.push(`price_in_per_mtok ${seeded.price_in_per_mtok} -> ${fmt(liveIn)}`);
    }
    if (liveOut !== null && liveOut !== seeded.price_out_per_mtok) {
      notes.push(`price_out_per_mtok ${seeded.price_out_per_mtok} -> ${fmt(liveOut)}`);
    }
    if (actual.context_length !== undefined && actual.context_length !== seeded.context) {
      notes.push(`context ${seeded.context} -> ${actual.context_length}`);
    }
    if (expectedMode !== seeded.mode) {
      notes.push(
        `mode ${seeded.mode} -> ${expectedMode} (structured_outputs is now ${liveStructured ? "supported" : "UNSUPPORTED"})`
      );
    }

    if (notes.length === 0) {
      console.log(`✓ ${seeded.id}: matches the seeded config`);
    } else {
      drift += 1;
      console.log(`✗ ${seeded.id}: ${notes.join("; ")}`);
    }
  }

  console.log("");
  if (drift === 0) {
    console.log("No drift. models.ts still describes the live catalogue accurately.");
  } else {
    console.log(
      `${drift} model(s) drifted. Edit MODEL_CATALOGUE in src/platform/ai/models.ts, update MODEL_CATALOGUE_PROBED_AT, and commit — every dollar cap is enforced against these numbers.`
    );
    process.exitCode = 1;
  }
}

void main();
