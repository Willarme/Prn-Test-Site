import { rememberOwner, ownerHeaders } from "./helpers/journey-auth";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { HVAC_COOLING_PLAYBOOK } from "@/domain/intake/playbooks/hvac-cooling";
import type { DoorAttribution } from "@/domain/intake/contracts";

/**
 * T1-15 — the playbook-graph browser exposure.
 *
 * `src/app/complete/[request_id]/page.tsx` hands the WHOLE diagnostic
 * playbook graph (every step, every outcome) into a "use client" component
 * (`DiagnoseWalkthrough`). Next.js serializes every client-component prop
 * into the page payload — the literal View-Source/DevTools leak this item
 * exists to close.
 *
 * This test proves that against the REAL payload of record: it boots the
 * actual Next.js server (in-process, via the programmatic `next` API — no
 * shell/CLI resolution needed, so it runs the same on Windows and POSIX),
 * drives a real customer journey through `POST /api/intake`, then fetches
 * the real `/complete/<request_id>` HTML and asserts on its raw text.
 *
 * Assertions are CONTENT-based: the actual sentences from another step's
 * `instruction` or an outcome's `likely_cause`, not a check for a prop name
 * or an array length. A rename or restructuring of the leak would still be
 * caught, because the assertion is "this exact sentence must not appear,"
 * not "there must be no field called `steps`."
 */

const PORT = 3463;
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

/**
 * `branches` must never appear in the payload at all — it IS the graph.
 * The page's raw HTML embeds the RSC flight payload inside
 * `<script>self.__next_f.push([1, "..."])</script>` — a JSON blob living
 * inside a JS STRING LITERAL, so its own quotes come back backslash-escaped
 * once more (`\"branches\":[...`), not as plain `"branches":[...`. A check
 * for only the unescaped form would silently miss a real leak sitting in
 * that (very common) shape — checking both is the actual proof, not shape.
 */
function assertNoBranchesLeak(html: string): void {
  expect(html).not.toContain('"branches"');
  expect(html).not.toContain('\\"branches\\"');
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

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "prn-playbook-exposure-"));
  const nextBin = require.resolve("next/dist/bin/next");
  server = spawn(process.execPath, [nextBin, "dev", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PRN_DEV_DB_PATH: join(dbDir, "dev-db.json"),
      // Guarantee the file-backed store regardless of the ambient shell env.
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    },
  });
  server.stdout.on("data", (d) => (serverLog += String(d)));
  server.stderr.on("data", (d) => (serverLog += String(d)));
  await waitForServer();
}, STARTUP_TIMEOUT_MS);

afterAll(async () => {
  if (server && !server.killed) {
    server.kill();
  }
  try {
    rmSync(dbDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe("playbook-graph browser exposure — real /complete payload", () => {
  it(
    "a fresh HVAC-cooling request sends the current step but never a distant step's instruction or any outcome's likely_cause",
    async () => {
      const requestId = await createRequest(
        "The AC is blowing warm air, not cooling at all, since this morning"
      );
      const res = await fetch(`${BASE}/complete/${requestId}`, { headers: ownerHeaders(requestId) });
      expect(res.status).toBe(200);
      const html = await res.text();

      // The walkthrough opens on "filter" (a rating step) — its own content
      // legitimately belongs in the payload.
      const currentStep = HVAC_COOLING_PLAYBOOK.diagnostic_steps.find((s) => s.step_id === "filter")!;
      expect(html).toContain("Find the panel that opens on your indoor unit");
      expect(currentStep.step_id).toBe("filter"); // sanity: this is really the first step

      // "power_check" sits three branches deep (filter -> outdoor_unit ->
      // fan_moving -> power_check). A fresh request has not reached it, so
      // its instruction must not be anywhere in the payload the browser gets.
      const farStep = HVAC_COOLING_PLAYBOOK.diagnostic_steps.find((s) => s.step_id === "power_check")!;
      expect(farStep.instruction).toMatch(/Photograph its closed exterior/);
      expect(html).not.toContain(farStep.instruction);

      // No outcome has been reached — none of their likely_cause text may
      // leak, no matter how the graph is passed to the client.
      expect(html).not.toContain("starves the system of air"); // dirty_filter
      expect(html).not.toContain("dumping heat outside"); // clogged_condenser
      expect(html).not.toContain("no power reaching the unit"); // fan_not_running
      expect(html).not.toContain("the likely suspects are refrigerant charge"); // needs_technician_cooling
      assertNoBranchesLeak(html);
    },
    20_000
  );

  it(
    "a fresh HVAC-no-power request sends the current choice step's own options but never a later step's instruction",
    async () => {
      const requestId = await createRequest("The AC won't turn on at all, no power, since yesterday");
      const res = await fetch(`${BASE}/complete/${requestId}`, { headers: ownerHeaders(requestId) });
      expect(res.status).toBe(200);
      const html = await res.text();

      // "thermostat" is the first step, a `choice` kind — its own options
      // are legitimate current-step content.
      expect(html).toContain("Display is blank");
      expect(html).toContain("On, and set correctly");

      // "drain_pan" is two branches deeper (thermostat -> breaker ->
      // drain_pan). Its instruction must not appear yet.
      expect(html).not.toContain("Many systems shut themselves off on purpose when that pan fills");

      // No outcome reached yet.
      expect(html).not.toContain("dead batteries or a tripped low-voltage fuse"); // thermostat_power
      expect(html).not.toContain("protecting against a real electrical fault"); // breaker_retrips
      assertNoBranchesLeak(html);
    },
    20_000
  );
});
