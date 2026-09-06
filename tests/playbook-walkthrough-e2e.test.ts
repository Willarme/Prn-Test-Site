import { rememberOwner, ownerHeaders } from "./helpers/journey-auth";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import type { DoorAttribution } from "@/domain/intake/contracts";
import type { WalkthroughView } from "@/domain/intake/playbook";

/**
 * T1-15, step 4 — the guided-diagnosis UX walked end to end on two playbooks
 * with different input kinds, against the real server (same technique as
 * tests/playbook-exposure.test.ts: an in-process `next dev`, driven over real
 * HTTP, no mocked routes). This is the "scripted HTTP walk" the item's DoD
 * calls for in place of Playwright, which is not installed in this repo.
 *
 * Playbook A — HVAC cooling (rating, photo, yes_no, choice; multi-step path;
 * DIY-possible outcome with steps).
 * Playbook B — Electrical (yes_no, choice; safety_note on every step;
 * DIY-impossible outcome with an empty diy_steps list).
 *
 * Each walk checks, at every reload: the step counter, the "resumed" pill,
 * safety notes, and — reusing the same content-based leak assertions as
 * playbook-exposure.test.ts — that no other step or unreached outcome's text
 * is present at that point in the walk. This both proves the UX still works
 * and extends leak coverage past the very first render.
 *
 * The photo-kind step ("outdoor_unit") is exercised via the "Skip, I'll
 * describe it instead" path (a plain answer("skipped photo") call, exactly
 * what that button does), not a real binary upload: a real upload to a
 * step-photo target hits a PRE-EXISTING, out-of-scope Windows bug in
 * src/platform/adapters/media-storage.ts (a literal ":" from the
 * "step:<id>" target lands in a directory name, which mkdirSync rejects on
 * Windows) — reproduced against the real server, unrelated to T1-15 (it
 * pre-dates this fix and affects the old code identically), and flagged
 * separately rather than fixed here.
 */

const PORT = 3464;
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

async function getCompleteHtml(requestId: string): Promise<{ status: number; html: string }> {
  const res = await fetch(`${BASE}/complete/${requestId}`, { headers: ownerHeaders(requestId) });
  return { status: res.status, html: await res.text() };
}

/**
 * `branches` must never appear at all — checked on the RAW response text
 * (never only via typed `res.json()` destructuring, which would silently
 * ignore an unexpected extra field a caller doesn't happen to read) — and
 * in both its plain and RSC-escaped forms. The page's HTML embeds the RSC
 * flight payload inside a JS string literal
 * (`<script>self.__next_f.push([1,"..."])</script>`), so a real leak there
 * shows up backslash-escaped (`\"branches\":[...`) rather than as plain
 * `"branches":[...`; a check for only the unescaped form misses it
 * entirely. Plain JSON API responses (answer/media/walkthrough) have no
 * such extra escaping layer, so the plain form is the one that matters
 * there — this helper checks both everywhere, which is correct either way.
 */
function assertNoBranchesLeak(rawText: string): void {
  expect(rawText).not.toContain('"branches"');
  expect(rawText).not.toContain('\\"branches\\"');
}

interface AnswerResponse {
  ok: boolean;
  view?: WalkthroughView;
}

interface WalkthroughResetResponse {
  view: WalkthroughView;
}

/** Raw text captured FIRST (not only typed destructuring), then parsed. */
async function postAnswer(requestId: string, stepId: string, answer: string): Promise<AnswerResponse> {
  const res = await fetch(`${BASE}/api/intake/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ownerHeaders(requestId) },
    body: JSON.stringify({ request_id: requestId, step: { step_id: stepId, answer } }),
  });
  expect(res.status, `POST /api/intake/answer for ${stepId}="${answer}"`).toBe(200);
  const raw = await res.text();
  assertNoBranchesLeak(raw);
  return JSON.parse(raw);
}

async function startOver(requestId: string): Promise<WalkthroughResetResponse> {
  const res = await fetch(`${BASE}/api/intake/walkthrough?request_id=${encodeURIComponent(requestId)}`, { headers: ownerHeaders(requestId) });
  expect(res.status).toBe(200);
  const raw = await res.text();
  assertNoBranchesLeak(raw);
  return JSON.parse(raw);
}

/** Asserts the response moved to a step (not an outcome, not neither) and narrows to it. */
function expectStep(view: WalkthroughView | undefined): NonNullable<WalkthroughView["step"]> {
  expect(view, "expected a view in the response body").toBeDefined();
  expect(view!.step, "expected a current step, got null").not.toBeNull();
  return view!.step!;
}

/** Asserts the response reached an outcome (not a step) and narrows to it. */
function expectOutcome(view: WalkthroughView | undefined): NonNullable<WalkthroughView["outcome"]> {
  expect(view, "expected a view in the response body").toBeDefined();
  expect(view!.step, "expected the outcome view to carry no step").toBeNull();
  expect(view!.outcome, "expected a reached outcome, got null").not.toBeNull();
  return view!.outcome!;
}

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "prn-playbook-e2e-"));
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

describe("guided-diagnosis UX walked end to end — HVAC cooling (rating/photo/yes_no/choice)", () => {
  it(
    "filter(rating) -> outdoor_unit(photo, skipped) -> fan_moving(yes_no) -> fins_blocked(choice) -> outcome, with correct rendering at every reload",
    async () => {
      const id = await createRequest("The AC is blowing warm air, not cooling at all, since this morning");

      // --- initial load: step 1 of 5, no resumed pill ---
      let page = await getCompleteHtml(id);
      expect(page.status).toBe(200);
      expect(page.html).toContain("Step <!-- -->1<!-- --> of <!-- -->5");
      expect(page.html).not.toContain(">resumed<");
      assertNoBranchesLeak(page.html); // the graph shape itself must never appear

      // --- filter (rating) -> low rating takes the "outdoor_unit" branch ---
      let step = await postAnswer(id, "filter", "3");
      let stepView = expectStep(step.view);
      expect(stepView.step_id).toBe("outdoor_unit");
      expect(stepView.step_number).toBe(2);
      expect(stepView.total_steps).toBe(5);

      page = await getCompleteHtml(id);
      expect(page.html).toContain("Step <!-- -->2<!-- --> of <!-- -->5");
      expect(page.html).toContain(">resumed<"); // one answer is already on record
      // Step 1's own content must be gone now that step 2 is current.
      expect(page.html).not.toContain("Find the panel that opens on your indoor unit");
      // The safety note on the CURRENT step legitimately appears.
      expect(page.html).toContain("keep fingers and tools out of the fan grille");

      // --- outdoor_unit (photo) -> "Skip, I'll describe it instead" takes the "any" branch to fan_moving ---
      step = await postAnswer(id, "outdoor_unit", "skipped photo");
      stepView = expectStep(step.view);
      expect(stepView.step_id).toBe("fan_moving");

      // --- fan_moving (yes_no) -> "yes" takes the "fins_blocked" branch ---
      step = await postAnswer(id, "fan_moving", "yes");
      stepView = expectStep(step.view);
      expect(stepView.step_id).toBe("fins_blocked");
      expect(stepView.step_number).toBe(4);

      page = await getCompleteHtml(id);
      expect(page.html).toContain("Step <!-- -->4<!-- --> of <!-- -->5");
      // Neither earlier step's instruction should still be present.
      expect(page.html).not.toContain("Find the panel that opens on your indoor unit"); // filter
      expect(page.html).not.toContain("Go to the outdoor unit while the AC is running"); // outdoor_unit
      // No outcome reached yet.
      expect(page.html).not.toContain("starves the system of air");
      expect(page.html).not.toContain("dumping heat outside");

      // --- fins_blocked (choice) -> "Mostly clear" reaches the outcome ---
      step = await postAnswer(id, "fins_blocked", "Mostly clear");
      const outcomeView = expectOutcome(step.view);
      expect(outcomeView.outcome_id).toBe("needs_technician_cooling");

      page = await getCompleteHtml(id);
      expect(page.status).toBe(200);
      expect(page.html).toContain("Walkthrough complete");
      expect(page.html).toContain("The next step is a technician&#x27;s check");
      expect(page.html).toContain("A technician can verify airflow, power, refrigerant charge");
      // No other outcome's text may appear now that one is reached.
      expect(page.html).not.toContain("starves the system of air"); // dirty_filter
      expect(page.html).not.toContain("dumping heat outside"); // clogged_condenser
      expect(page.html).not.toContain("no power reaching the unit"); // fan_not_running
      assertNoBranchesLeak(page.html);

      // --- "Start over" — a read-only reset back to the first step ---
      const reset = await startOver(id);
      const resetStep = expectStep(reset.view);
      expect(resetStep.step_id).toBe("filter");
      expect(resetStep.step_number).toBe(1);
      // It does not erase the saved walkthrough: a fresh page load still
      // resumes at the outcome, exactly like the pre-fix client-only reset
      // never persisted anything either.
      page = await getCompleteHtml(id);
      expect(page.html).toContain("Walkthrough complete");
    },
    30_000
  );

  it(
    "the 'Skip, I'll describe it instead' path answers a photo step without a photo",
    async () => {
      const id = await createRequest("AC not cooling, blowing warm, started yesterday");
      await postAnswer(id, "filter", "2"); // low rating -> outdoor_unit (a photo step)
      const step = await postAnswer(id, "outdoor_unit", "skipped photo"); // the skip button's literal call
      expect(expectStep(step.view).step_id).toBe("fan_moving"); // same "any" branch a real photo takes
    },
    20_000
  );
});

describe("guided-diagnosis UX walked end to end — Electrical (yes_no/choice, safety notes throughout)", () => {
  it(
    "danger_signs(yes_no) -> gfci(choice) -> breaker_e(choice) -> a DIY-impossible outcome with no diy_steps",
    async () => {
      const id = await createRequest("The outlet in the kitchen has no power to it and nothing is tripped");

      // Campaign track P4 (2026-09-05), checklist F6 / merged spec §17.3: the
      // trial is one trade, so an electrical request gets the honest route-out
      // on /complete — no step text, no safety note, no graph — while the
      // walkthrough API itself keeps its T1-15 boundary and still works.
      let page = await getCompleteHtml(id);
      expect(page.status).toBe(200);
      expect(page.html).toContain("data-route-out");
      expect(page.html).toContain("electrician near me");
      expect(page.html).not.toContain("switch the breaker OFF, and contact an electrician promptly");
      expect(page.html).not.toContain(">resumed<");
      assertNoBranchesLeak(page.html);

      let step = await postAnswer(id, "danger_signs", "no");
      expect(expectStep(step.view).step_id).toBe("gfci");

      page = await getCompleteHtml(id);
      expect(page.html).toContain("data-route-out");
      expect(page.html).not.toContain("Do not press it with wet hands");

      step = await postAnswer(id, "gfci", "No GFCI nearby");
      expect(expectStep(step.view).step_id).toBe("breaker_e");

      step = await postAnswer(id, "breaker_e", "Nothing tripped");
      const outcomeView = expectOutcome(step.view);
      expect(outcomeView.outcome_id).toBe("needs_electrician");
      expect(outcomeView.diy_possible).toBe(false);
      expect(outcomeView.diy_steps).toEqual([]);

      page = await getCompleteHtml(id);
      // The route-out prints nothing of the graph: not the reached outcome,
      // and not any other.
      expect(page.html).toContain("data-route-out");
      expect(page.html).not.toContain("No GFCI, no tripped breaker — needs an electrician");
      expect(page.html).not.toContain("Straightforward electrician visit");
      expect(page.html).not.toContain("a connection is overheating"); // danger
      expect(page.html).not.toContain("GFCIs trip on moisture"); // gfci_fixed
      expect(page.html).not.toContain("A one-off trip can be an overload"); // breaker_fixed
      expect(page.html).not.toContain("protecting against a real electrical fault"); // retrip
      assertNoBranchesLeak(page.html);
    },
    30_000
  );
});

describe("guided-diagnosis UX — the GENERIC playbook (no walkthrough) never crashes the projection", () => {
  it(
    "renders the honest route-out (track P4, F6) instead of throwing, with the packet still reachable",
    async () => {
      const id = await createRequest("something strange happened in my house and I don't know what it is");
      const page = await getCompleteHtml(id);
      expect(page.status).toBe(200);
      expect(page.html).toContain("data-route-out");
      expect(page.html).toContain(`/results/${id}`);
    },
    20_000
  );
});
