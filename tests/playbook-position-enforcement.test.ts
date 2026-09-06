import { rememberOwner, ownerHeaders } from "./helpers/journey-auth";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import type { DoorAttribution } from "@/domain/intake/contracts";

/**
 * T1-15 FOLLOW-UP — the ACTIVE leak an adversarial review caught in the
 * first pass of this fix.
 *
 * The passive leak (the whole playbook graph embedded in page props) was
 * closed, but POST /api/intake/answer and POST /api/intake/media only
 * validated that a submitted step_id named SOME real step in the playbook —
 * not that it was the CUSTOMER'S actual current step. That meant every step
 * (and, transitively, every outcome) of a playbook was pullable one POST at
 * a time by guessing/enumerating step_ids, fully bypassing the walkthrough
 * order. Pre-fix, these same routes returned only `{ ok: true }`, so this
 * enumeration path is a regression T1-15's own change introduced, not a
 * pre-existing issue.
 *
 * The fix: both routes now replay the customer's SAVED diagnosis answers
 * server-side (resolveWalkthroughPosition, src/domain/intake/playbook.ts —
 * the exact same replay the page render uses) and reject any step_id that
 * isn't that resolved position, with 409 and an error body carrying no step
 * or outcome content.
 */

const PORT = 3465;
const BASE = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 100_000;
const STARTUP_TIMEOUT_MS = 120_000;

let server: ChildProcessWithoutNullStreams;
let dbDir: string;
let serverLog = "";

function attribution(): DoorAttribution {
  return {
    page_id: null,
    intent_cluster_id: null,
    search_opportunity_id: null,
    problem_family_hint: null,
    experiment_id: null,
    variant: null,
    referrer: null,
    landing_path: "/start",
  };
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/start`);
      if (res.ok) return;
      lastErr = new Error(`GET /start -> ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `dev server on ${BASE} never became ready: ${String(lastErr)}\n--- server output ---\n${serverLog.slice(-4000)}`
  );
}

async function createRequest(description: string): Promise<string> {
  const res = await fetch(`${BASE}/api/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description,
      disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: attribution(),
    }),
  });
  const body = await res.json();
  if (!body.request_id) {
    throw new Error(`intake did not create a request: ${res.status} ${JSON.stringify(body)}`);
  }
  rememberOwner(body.request_id, res);
  return body.request_id as string;
}

/** Raw response — text captured BEFORE any typed parsing, per the review's ask. */
async function postAnswerRaw(requestId: string, stepId: string, answer: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${BASE}/api/intake/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ownerHeaders(requestId) },
    body: JSON.stringify({ request_id: requestId, step: { step_id: stepId, answer } }),
  });
  return { status: res.status, text: await res.text() };
}

async function postMediaRaw(requestId: string, target: string): Promise<{ status: number; text: string }> {
  const form = new FormData();
  form.set("request_id", requestId);
  form.set("target", target);
  form.set("file", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "test.jpg");
  const res = await fetch(`${BASE}/api/intake/media`, { method: "POST", headers: ownerHeaders(requestId), body: form });
  return { status: res.status, text: await res.text() };
}

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "prn-position-enforce-"));
  const nextBin = require.resolve("next/dist/bin/next");
  server = spawn(process.execPath, [nextBin, "dev", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PRN_DEV_DB_PATH: join(dbDir, "dev-db.json"),
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    },
  });
  server.stdout.on("data", (d) => (serverLog += String(d)));
  server.stderr.on("data", (d) => (serverLog += String(d)));
  await waitForServer();
}, STARTUP_TIMEOUT_MS);

afterAll(async () => {
  if (server && !server.killed) server.kill();
  try {
    rmSync(dbDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe("step-jump / enumeration is rejected server-side (the inspector's exact repro)", () => {
  it(
    "a fresh request cannot pull a step three branches deep by POSTing its id directly — no step/outcome content leaks in the rejection",
    async () => {
      const id = await createRequest("The AC is blowing warm air, not cooling at all, since this morning");
      // Legitimate position is "filter" (the first step). "power_check" is
      // three branches away (filter -> outdoor_unit -> fan_moving -> power_check)
      // and has never been reached.
      const probe = await postAnswerRaw(id, "power_check", "any");
      expect(probe.status).toBe(409);
      // No leaked content of any kind in the rejection body.
      expect(probe.text).not.toContain("Snap a photo of it with the cover open"); // power_check's own instruction
      expect(probe.text).not.toContain("view"); // no `view` key at all
      expect(probe.text).not.toContain("branches");
      expect(probe.text).not.toContain("no power reaching the unit"); // fan_not_running outcome, reachable from power_check
    },
    20_000
  );

  it(
    "the same attack against the media route is rejected before any file is even written — no evidence_id, no view",
    async () => {
      const id = await createRequest("The AC is blowing warm air, not cooling at all, since this morning");
      const probe = await postMediaRaw(id, "step:power_check");
      expect(probe.status).toBe(409);
      expect(probe.text).not.toContain("evidence_id");
      expect(probe.text).not.toContain("view");
      expect(probe.text).not.toContain("Snap a photo of it with the cover open");
    },
    20_000
  );

  it(
    "an already-answered (past) step cannot be re-submitted once the walkthrough has moved on",
    async () => {
      const id = await createRequest("The AC is blowing warm air, not cooling at all, since this morning");
      const first = await postAnswerRaw(id, "filter", "3"); // legitimate: rating < 6 -> outdoor_unit
      expect(first.status).toBe(200);
      // Now try to re-answer "filter" — no longer the current step.
      const replay = await postAnswerRaw(id, "filter", "8");
      expect(replay.status).toBe(409);
    },
    20_000
  );

  it(
    "an in-order walk through every step still works end to end (the fix doesn't just reject everything)",
    async () => {
      const id = await createRequest("The AC is blowing warm air, not cooling at all, since this morning");
      const steps: Array<[string, string]> = [
        ["filter", "3"], // -> outdoor_unit
        ["outdoor_unit", "skipped photo"], // -> fan_moving
        ["fan_moving", "yes"], // -> fins_blocked
        ["fins_blocked", "Mostly clear"], // -> outcome needs_technician_cooling
      ];
      for (const [stepId, answer] of steps) {
        const res = await postAnswerRaw(id, stepId, answer);
        expect(res.status, `POST answer ${stepId}="${answer}"`).toBe(200);
      }
      const body = JSON.parse((await postAnswerRaw(id, "filter", "3")).text); // now rejected: walkthrough is past filter
      expect(body.error).toBeTruthy();
    },
    20_000
  );
});
