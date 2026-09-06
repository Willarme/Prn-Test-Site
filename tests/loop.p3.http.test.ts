import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import type { DoorAttribution } from "@/domain/intake/contracts";

/**
 * TRACK P3 — the link pages over real HTTP (an in-process `next dev`, the
 * same technique as tests/playbook-walkthrough-e2e.test.ts), on the file
 * store, in email preview mode, with no model key so intake takes the
 * deterministic path and spends nothing.
 *
 * The keep flow end to end: sign, GET 200 with the record pre-loaded, POST
 * the claim, the mail preview, the magic link consumed, the redirect
 * target, the second visit refused, the kept state, the links page and its
 * gate. Then the ask page and its thank-you, the media gallery, a
 * switched-off link, and /p.
 */
const PORT = 3163;
const BASE = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 150_000;

type Ledger = typeof import("@/platform/links/ledger");
type Tokens = typeof import("@/platform/links/tokens");
type Runtime = typeof import("@/platform/stores/runtime");

let server: ChildProcessWithoutNullStreams;
let dbDir: string;
let serverLog = "";
let ledger: Ledger;
let tokens: Tokens;
let runtime: Runtime;

function attribution(): DoorAttribution {
  return {
    page_id: null,
    intent_cluster_id: null,
    search_opportunity_id: null,
    problem_family_hint: "hvac-cooling",
    experiment_id: null,
    variant: null,
    referrer: null,
    landing_path: "/problems/ac-blowing-warm-air",
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
  throw new Error(`dev server never became ready: ${String(lastErr)}\n${serverLog.slice(-4000)}`);
}

async function createRequest(description: string): Promise<string> {
  const res = await fetch(`${BASE}/api/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash, attribution: attribution() }),
  });
  const body = (await res.json()) as { request_id: string | null };
  if (!body.request_id) throw new Error(`intake did not create a request: ${res.status} ${JSON.stringify(body)}`);
  return body.request_id;
}

async function get(path: string): Promise<{ status: number; html: string; location: string | null }> {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
  return { status: res.status, html: await res.text(), location: res.headers.get("location") };
}

async function postForm(path: string, fields: Record<string, string>): Promise<{ status: number; location: string | null }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  return { status: res.status, location: res.headers.get("location") };
}

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "prn-p3-http-"));
  process.env.PRN_DEV_DB_PATH = join(dbDir, "dev-db.json");
  process.env.PRN_RUNTIME_STORE = "file";
  process.env.LINK_SIGNING_SECRET = "isolated-p3-http-fixture-key-0123456789";
  runtime = await import("@/platform/stores/runtime");
  runtime.resetRuntimeStore();
  ledger = await import("@/platform/links/ledger");
  tokens = await import("@/platform/links/tokens");

  const nextBin = require.resolve("next/dist/bin/next");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PRN_DEV_DB_PATH: process.env.PRN_DEV_DB_PATH,
    PRN_RUNTIME_STORE: "file",
    NEXT_DIST_DIR: ".next-p3-test",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    // No model key: intake takes the deterministic path and the test spends nothing.
    OPENROUTER_API_KEY: "",
    EMAIL_MODE: "preview",
    LINK_SIGNING_SECRET: "isolated-p3-http-fixture-key-0123456789",
  };
  server = spawn(process.execPath, [nextBin, "dev", "-p", String(PORT)], { cwd: process.cwd(), env });
  server.stdout.on("data", (d) => (serverLog += String(d)));
  server.stderr.on("data", (d) => (serverLog += String(d)));
  await waitForServer();
}, 180_000);

afterAll(async () => {
  if (server?.pid) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else server.kill();
  }
  delete process.env.PRN_DEV_DB_PATH;
  delete process.env.PRN_RUNTIME_STORE;
  try {
    rmSync(dbDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe("the keep flow, end to end", () => {
  it(
    "sign → GET /keep 200 pre-loaded → POST claim → /mail preview → /claim consumed → redirect → second visit refused → kept state → /links",
    async () => {
      const requestId = await createRequest("The AC runs but the air out of the vents is warm since yesterday afternoon");
      const keep = ledger.issueLink({ scope: "keep", request_id: requestId });

      // The record, pre-loaded, with the one field.
      const page = await get(`/keep/${keep.token}`);
      expect(page.status).toBe(200);
      expect(page.html).toContain("Your AC, already on file.");
      expect(page.html).toContain("warm since yesterday afternoon");
      expect(page.html).toContain("Your most expensive asset has amnesia.");
      expect(page.html).toContain("Keep this");
      expect(page.html).toContain('name="contact"');

      // The claim: preview mode lands on the stored message.
      const claim = await postForm("/api/keep", { token: keep.token, contact: "jo@example.com" });
      expect(claim.status).toBe(303);
      expect(claim.location).toMatch(/^\/mail\/em_/);

      const mail = await get(claim.location!);
      expect(mail.status).toBe(200);
      expect(mail.html).toContain("PREVIEW — not sent");
      expect(mail.html).toContain("jo@example.com");
      const mailPath = new URL(claim.location!, BASE).pathname;
      expect((await get(mailPath)).status).toBe(404);
      const packetProof = ledger.issueLink({ scope: "packet", request_id: requestId });
      expect((await get(`${mailPath}?k=${encodeURIComponent(packetProof.token)}`)).status).toBe(404);
      const magicToken = mail.html.match(/\/claim\/([A-Za-z0-9_.-]+)/)![1]!;
      // link_base is the request origin (routine decision 9); Next reports it as localhost or 127.0.0.1.
      expect(mail.html).toMatch(new RegExp(`href="http://(127\\.0\\.0\\.1|localhost):${PORT}/claim/${magicToken}"`));
      expect(mail.html).toContain(`/links/${requestId}?k=`);

      // Pending state on the keep page: the link went out, one tap keeps it.
      const pending = await get(`/keep/${keep.token}`);
      expect(pending.html).toContain("A link went to j***@example.com");
      expect(pending.html).toContain("Open the message");

      // The magic link: consumed, then back to the exact results state.
      const tap = await get(`/claim/${magicToken}`);
      expect([303, 307]).toContain(tap.status);
      expect(tap.location).toContain(`/results/${requestId}?kept=1&k=`);
      const results = await get(tap.location!);
      expect(results.status).toBe(200);

      // Second visit: the link was already used.
      const again = await get(`/claim/${magicToken}`);
      expect(again.status).toBe(200);
      expect(again.html).toContain("This link was already used.");

      // The keep page now shows the kept state, with the links page reachable.
      const kept = await get(`/keep/${keep.token}`);
      expect(kept.html).toContain("Your AC&#x27;s record is kept.");
      expect(kept.html).toContain("Linked to j***@example.com");
      expect(kept.html).toContain(`/links/${requestId}?k=`);
      expect(ledger.readKeepState(requestId)?.confirmed_at).not.toBeNull();

      // /links: gated without proof, listing with the keep token.
      const gated = await get(`/links/${requestId}`);
      expect(gated.status).toBe(200);
      expect(gated.html).toContain("Open this from your results page.");
      expect(gated.html).not.toContain("Switch off");
      const listing = await get(`/links/${requestId}?k=${encodeURIComponent(keep.token)}`);
      expect(listing.html).toContain("Links you shared");
      expect(listing.html).toContain("Home Memory claim link");
      expect(listing.html).toContain("Switch off");
    },
    120_000
  );
});

describe("the ask page", () => {
  it("shows the friend one sentence and one question; the answer lands and the thank-you renders", async () => {
    const requestId = await createRequest("Warm air from every vent since this morning, the outdoor fan runs");
    const ask = ledger.issueLink({ scope: "ask", request_id: requestId });
    const page = await get(`/ask/${ask.token}`);
    expect(page.status).toBe(200);
    expect(page.html).toContain("A friend of yours has this problem:");
    expect(page.html).toContain("Warm air from every vent since this morning");
    expect(page.html).toContain("Who would you call for this?");
    expect(page.html).toContain("Send this name");
    // The friend sees no photos, no address field, no contact.
    expect(page.html).not.toContain("/media/");

    const sent = await postForm("/api/ask", { token: ask.token, friend_name: "Renee", provider_name: "Vance Water Heater", reason: "used him twice" });
    expect(sent.status).toBe(303);
    const thanks = await get(sent.location!);
    expect(thanks.html).toContain("Sent.");
    expect(thanks.html).toContain("Your neighbourhood already did the research.");
    const answers = await runtime.runtimeStore().listAskAnswers(requestId);
    expect(answers.map((a) => a.provider_name)).toEqual(["Vance Water Heater"]);
  }, 120_000);
});

describe("the provider media link, /p, and a switched-off link", () => {
  it("the gallery renders for a media token; a revoked token and a wrong-scope token get the plain switched-off page; /p redirects", async () => {
    const requestId = await createRequest("Air is barely cool and the unit outside is loud since last week");
    const media = ledger.issueLink({ scope: "media", request_id: requestId });
    const gallery = await get(`/media/${media.token}`);
    expect(gallery.status).toBe(200);
    expect(gallery.html).toContain("Photos and video for this job");
    expect(gallery.html).toContain("barely cool");

    const keep = ledger.issueLink({ scope: "keep", request_id: requestId });
    const wrongScope = await get(`/media/${keep.token}`);
    expect(wrongScope.status).toBe(200);
    expect(wrongScope.html).toContain("This link has been switched off.");

    await tokens.revokeLink(media.link_id, requestId);
    const revoked = await get(`/media/${media.token}`);
    expect(revoked.html).toContain("This link has been switched off.");

    const share = ledger.issueLink({ scope: "packet", request_id: requestId });
    const p = await get(`/p/${share.token}`);
    expect(p.status).toBe(303);
    expect(p.location).toBe(`/packet/${requestId}?share=${encodeURIComponent(share.token)}`);
    const off = await get(`/p/${keep.token}`);
    expect(off.status).toBe(303);
    expect(off.location).toBe("/link-off?reason=off");
    const offPage = await get("/link-off?reason=expired");
    expect(offPage.html).toContain("This link has expired.");
  }, 120_000);
});
