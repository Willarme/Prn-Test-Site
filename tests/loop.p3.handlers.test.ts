import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import type { DoorAttribution } from "@/domain/intake/contracts";

/**
 * TRACK P3 — the scoped-link handlers, called directly on a temp file store.
 *
 * What is pinned here, per the campaign brief's test list:
 *   - the keep claim writes its rows and its message, and the magic link is
 *     single use at the store level;
 *   - the ask handler writes the friend's one name and refuses a wrong-scope
 *     token;
 *   - the media bytes route serves a stripped JPEG to a media token and to
 *     the record's own keep token, and refuses a wrong-scope token, a revoked
 *     token and a foreign evidence id;
 *   - /p refuses an expired token and a wrong-scope token, and redirects a
 *     packet token to the packet with ?share=;
 *   - the outbox never touches the network in preview mode, and does exactly
 *     one POST to Resend in live mode;
 *   - revoking flips verifyLink, through the owner gate.
 *
 * The page renders (RSC) are covered over real HTTP in loop.p3.http.test.ts.
 */
type Media = typeof import("@/platform/intake/media");
type Tokens = typeof import("@/platform/links/tokens");
type Ledger = typeof import("@/platform/links/ledger");
type Email = typeof import("@/platform/email/send");
type Runtime = typeof import("@/platform/stores/runtime");
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

let dir: string;
let media: Media;
let tokens: Tokens;
let ledger: Ledger;
let email: Email;
let runtime: Runtime;
let intakePost: (req: Request) => Promise<Response>;
let keepPost: (req: Request) => Promise<Response>;
let askPost: (req: Request) => Promise<Response>;
let revokePost: (req: Request) => Promise<Response>;
let mediaGet: Handler;
let pGet: Handler;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "prn-p3-handlers-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  process.env.PRN_RUNTIME_STORE = "file";
  delete process.env.EMAIL_MODE;
  delete process.env.LINK_SIGNING_SECRET;
  vi.stubGlobal("fetch", () => { throw new Error("Network forbidden in isolated P3 handler tests"); });
  runtime = await import("@/platform/stores/runtime");
  runtime.resetRuntimeStore();
  media = await import("@/platform/intake/media");
  tokens = await import("@/platform/links/tokens");
  ledger = await import("@/platform/links/ledger");
  email = await import("@/platform/email/send");
  ({ POST: intakePost } = await import("@/app/api/intake/route"));
  ({ POST: keepPost } = await import("@/app/api/keep/route"));
  ({ POST: askPost } = await import("@/app/api/ask/route"));
  ({ POST: revokePost } = await import("@/app/api/links/revoke/route"));
  ({ GET: mediaGet } = (await import("@/app/media/[token]/[evidence_id]/route")) as unknown as { GET: Handler });
  ({ GET: pGet } = (await import("@/app/p/[token]/route")) as unknown as { GET: Handler });
});

afterEach(() => {
  media.__setLabelReaderForTests(undefined);
  email.__setFetchForTests(null);
  delete process.env.EMAIL_MODE;
});

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.PRN_DEV_DB_PATH;
  delete process.env.PRN_RUNTIME_STORE;
  rmSync(dir, { recursive: true, force: true });
});

// --- fixtures ---------------------------------------------------------------

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

async function newRequest(description = "The AC runs but the air out of the vents is warm since yesterday afternoon"): Promise<string> {
  const res = await intakePost(
    new Request("http://localhost/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash, attribution: attribution() }),
    })
  );
  const body = (await res.json()) as { request_id: string | null };
  if (!body.request_id) throw new Error(`intake did not start: ${res.status}`);
  return body.request_id;
}

function segment(marker: number, payload: Buffer): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
}
const GPS_SENTINEL = "PRN-FAKE-GPS-40.0000N-085.0000W";
/** A structurally valid JPEG carrying an Exif APP1 with a GPS-looking payload. */
function jpegWithExif(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.concat([Buffer.from("JFIF\0", "latin1"), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])])),
    segment(0xe1, Buffer.concat([Buffer.from("Exif\0\0II*\0\x08\0\0\0", "latin1"), Buffer.from(`GPSLatitude ${GPS_SENTINEL}`, "latin1")])),
    segment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
    segment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
    segment(0xc4, Buffer.concat([Buffer.from([0]), Buffer.alloc(16, 0), Buffer.from([0])])),
    segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

async function attachPhoto(requestId: string): Promise<string> {
  media.__setLabelReaderForTests(async () => ({ ok: true, readable: false, fields: {}, confidence: {}, run_id: null }));
  const bytes = jpegWithExif();
  const result = await media.attachMedia({
    request_id: requestId,
    target: "door_photo",
    file: new File([new Uint8Array(bytes)], "label.jpg", { type: "image/jpeg" }),
    source: "door_form",
  });
  if (!result.ok) throw new Error(`attachMedia refused: ${result.error}`);
  return result.evidence_id;
}

function form(fields: Record<string, string>, path: string): Request {
  const body = new URLSearchParams(fields);
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

function json(fields: Record<string, unknown>, path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
}

function ctx(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

// --- the outbox --------------------------------------------------------------

describe("email module: send()", () => {
  it("preview mode stores the message and never touches the network", async () => {
    let touched = 0;
    email.__setFetchForTests(async () => {
      touched += 1;
      throw new Error("the network was touched in preview mode");
    });
    const result = await email.send({ to: "someone@example.com", subject: "Hello", text: "A line.\nhttp://localhost/x" });
    expect(result.mode).toBe("preview");
    expect(result.sent).toBe(false);
    expect(touched).toBe(0);
    const stored = await runtime.runtimeStore().getEmail(result.email_id);
    expect(stored?.sent_at).toBeNull();
    expect(stored?.mode).toBe("preview");
    expect(stored?.html).toContain('<a href="http://localhost/x">');
  });

  it("live mode POSTs once to Resend with the key as a bearer and marks the row sent", async () => {
    process.env.EMAIL_MODE = "live";
    const prevKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "re_test_key";
    const calls: { url: string; auth: string | null; body: string }[] = [];
    email.__setFetchForTests(async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), auth: headers.get("authorization"), body: String(init?.body) });
      return Response.json({ id: "re_123" });
    });
    try {
      const result = await email.send({ to: "someone@example.com", subject: "Hello", text: "Body" });
      expect(result.mode).toBe("live");
      expect(result.sent).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe("https://api.resend.com/emails");
      expect(calls[0]!.auth).toBe("Bearer re_test_key");
      expect(JSON.parse(calls[0]!.body).from).toBe(email.EMAIL_FROM);
      const stored = await runtime.runtimeStore().getEmail(result.email_id);
      expect(stored?.sent_at).not.toBeNull();
      expect(stored?.provider_id).toBe("re_123");
    } finally {
      if (prevKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prevKey;
    }
  });

  it("a live send that Resend refuses leaves the row unsent and says why, without throwing", async () => {
    process.env.EMAIL_MODE = "live";
    const prevKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "re_test_key";
    email.__setFetchForTests(async () => new Response("bad from", { status: 422 }));
    try {
      const result = await email.send({ to: "someone@example.com", subject: "Hello", text: "Body" });
      expect(result.sent).toBe(false);
      expect(result.mode === "live" && !result.sent ? result.error : "").toMatch(/422/);
      const stored = await runtime.runtimeStore().getEmail(result.email_id);
      expect(stored?.sent_at).toBeNull();
    } finally {
      if (prevKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prevKey;
    }
  });

  it("sendSms stores an SMS-shaped preview row addressed to the phone", async () => {
    const result = await email.sendSms({ to: "3175550100", text: "tap http://localhost/claim/x" });
    const stored = await runtime.runtimeStore().getEmail(result.email_id);
    expect(stored?.to).toBe("3175550100");
    expect(stored?.mode).toBe("preview");
    expect(email.isSmsMessage(stored!)).toBe(true);
  });
});

// --- keep --------------------------------------------------------------------

describe("POST /api/keep — the one-field claim", () => {
  it("writes the magic link, the claim and the message; the magic link is single use", async () => {
    const requestId = await newRequest();
    const { token } = ledger.issueLink({ scope: "keep", request_id: requestId });

    const res = await keepPost(form({ token, contact: "Jo.Homeowner@example.com" }, "/api/keep"));
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location).toMatch(/^\/mail\/em_/);
    const emailId = new URL(location, "http://localhost").pathname.split("/mail/")[1]!;

    const store = runtime.runtimeStore();
    const claim = await store.getKeepClaim(requestId);
    expect(claim?.contact).toBe("jo.homeowner@example.com");
    expect(claim?.contact_kind).toBe("email");

    const message = await store.getEmail(emailId);
    expect(message?.to).toBe("jo.homeowner@example.com");
    expect(message?.mode).toBe("preview");
    expect(message?.sent_at).toBeNull();
    const claimUrl = message!.text.match(/http:\/\/localhost\/claim\/(\S+)/)![1]!;
    const magic = tokens.decodeLink(claimUrl);
    expect(magic.ok && magic.scope).toBe("magic");
    expect(magic.ok && magic.request_id).toBe(requestId);
    // No personal data in any URL the message carries (§16.2).
    expect(message!.text).not.toContain("jo.homeowner");

    const magicId = (magic as { extra: Record<string, string> }).extra.magic_id;
    expect(magicId).toBe(claim!.magic_link_id);
    const first = await store.consumeMagicLink(magicId, new Date().toISOString());
    expect(first?.contact).toBe("jo.homeowner@example.com");
    const second = await store.consumeMagicLink(magicId, new Date().toISOString());
    expect(second).toBeNull();

    expect(ledger.readKeepState(requestId)?.email_id).toBe(emailId);
    expect(ledger.readKeepState(requestId)?.confirmed_at).toBeNull();
  });

  it("a phone number gets an SMS-shaped preview message and the same magic link", async () => {
    const requestId = await newRequest();
    const { token } = ledger.issueLink({ scope: "keep", request_id: requestId });
    const res = await keepPost(json({ token, contact: "(317) 555-0100" }, "/api/keep"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email_id: string; mode: string };
    expect(body.email_id).toMatch(/^sm_/);
    const message = await runtime.runtimeStore().getEmail(body.email_id);
    expect(message?.to).toBe("3175550100");
    expect(message?.text).toContain("/claim/");
  });

  it("refuses a contact that is neither email nor phone, and a token of the wrong scope", async () => {
    const requestId = await newRequest();
    const { token } = ledger.issueLink({ scope: "keep", request_id: requestId });
    const bad = await keepPost(form({ token, contact: "hello there" }, "/api/keep"));
    expect(bad.status).toBe(303);
    expect(bad.headers.get("location")).toBe(`/keep/${encodeURIComponent(token)}?error=contact`);
    expect(await runtime.runtimeStore().getKeepClaim(requestId)).toBeNull();

    const askToken = tokens.signLink({ scope: "ask", request_id: requestId });
    const wrong = await keepPost(json({ token: askToken, contact: "a@example.com" }, "/api/keep"));
    expect(wrong.status).toBe(403);
    expect(await runtime.runtimeStore().getKeepClaim(requestId)).toBeNull();
  });
});

// --- ask ---------------------------------------------------------------------

describe("POST /api/ask — the friend's one name", () => {
  it("writes the answer and sends the friend to the thank-you state", async () => {
    const requestId = await newRequest();
    const { token } = ledger.issueLink({ scope: "ask", request_id: requestId });
    const res = await askPost(
      form({ token, friend_name: "Renee", provider_name: "Vance Water Heater", provider_contact: "317-555-0199", reason: "used him twice" }, "/api/ask")
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/ask/${encodeURIComponent(token)}?thanks=1`);
    const answers = await runtime.runtimeStore().listAskAnswers(requestId);
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({
      friend_name: "Renee",
      provider_name: "Vance Water Heater",
      provider_contact: "317-555-0199",
      reason: "used him twice",
      friend_contact: null,
    });
  });

  it("a missing name or provider goes back with the field named; a keep token cannot answer an ask", async () => {
    const requestId = await newRequest();
    const { token } = ledger.issueLink({ scope: "ask", request_id: requestId });
    const noName = await askPost(form({ token, provider_name: "Somebody" }, "/api/ask"));
    expect(noName.headers.get("location")).toContain("?error=name");
    const noProvider = await askPost(form({ token, friend_name: "Renee" }, "/api/ask"));
    expect(noProvider.headers.get("location")).toContain("?error=provider");

    const keepToken = tokens.signLink({ scope: "keep", request_id: requestId });
    const wrong = await askPost(json({ token: keepToken, friend_name: "Renee", provider_name: "X" }, "/api/ask"));
    expect(wrong.status).toBe(403);
    expect(await runtime.runtimeStore().listAskAnswers(requestId)).toHaveLength(0);
  });
});

// --- media bytes -------------------------------------------------------------

describe("GET /media/<token>/<evidence_id> — the bytes, stripped", () => {
  it("serves a JPEG to a media token with its Exif gone, private and uncached", async () => {
    const requestId = await newRequest();
    const evidenceId = await attachPhoto(requestId);
    const { token } = ledger.issueLink({ scope: "media", request_id: requestId });
    const res = await mediaGet(new Request(`http://localhost/media/${token}/${evidenceId}`), ctx({ token, evidence_id: evidenceId }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(bytes.indexOf(Buffer.from(GPS_SENTINEL, "latin1"))).toBe(-1);
    expect(bytes.indexOf(Buffer.from("Exif\0", "latin1"))).toBe(-1);
  });

  it("the record's own keep token opens the bytes too; an ask token and a packet token do not", async () => {
    const requestId = await newRequest();
    const evidenceId = await attachPhoto(requestId);
    const keep = ledger.issueLink({ scope: "keep", request_id: requestId }).token;
    const ok = await mediaGet(new Request("http://localhost/x"), ctx({ token: keep, evidence_id: evidenceId }));
    expect(ok.status).toBe(200);
    for (const scope of ["ask", "packet"] as const) {
      const t = tokens.signLink({ scope, request_id: requestId });
      const refused = await mediaGet(new Request("http://localhost/x"), ctx({ token: t, evidence_id: evidenceId }));
      expect(refused.status, scope).toBe(404);
    }
  });

  it("a revoked media token, a forged token and a foreign evidence id all get 404", async () => {
    const requestId = await newRequest();
    const evidenceId = await attachPhoto(requestId);
    const other = await newRequest("Warm air from every vent since this morning, fan runs");
    const otherEvidence = await attachPhoto(other);

    const issued = ledger.issueLink({ scope: "media", request_id: requestId });
    await tokens.revokeLink(issued.link_id, requestId);
    const revoked = await mediaGet(new Request("http://localhost/x"), ctx({ token: issued.token, evidence_id: evidenceId }));
    expect(revoked.status).toBe(404);

    const live = ledger.issueLink({ scope: "media", request_id: requestId }).token;
    const forged = `${live.slice(0, -4)}AAAA`;
    expect((await mediaGet(new Request("http://localhost/x"), ctx({ token: forged, evidence_id: evidenceId }))).status).toBe(404);
    expect((await mediaGet(new Request("http://localhost/x"), ctx({ token: live, evidence_id: otherEvidence }))).status).toBe(404);
  });
});

// --- /p ----------------------------------------------------------------------

describe("GET /p/<token> — the packet share link", () => {
  it("a packet token redirects to the packet with ?share=; expired and wrong-scope tokens go to the switched-off page", async () => {
    const requestId = await newRequest();
    const { token } = ledger.issueLink({ scope: "packet", request_id: requestId });
    const ok = await pGet(new Request("http://localhost/x"), ctx({ token }));
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe(`/packet/${requestId}?share=${encodeURIComponent(token)}`);

    const expiring = tokens.signLink({ scope: "packet", request_id: requestId, ttl_days: 1e-8 });
    await new Promise((r) => setTimeout(r, 20));
    const expired = await pGet(new Request("http://localhost/x"), ctx({ token: expiring }));
    expect(expired.status).toBe(303);
    expect(expired.headers.get("location")).toBe("/link-off?reason=expired");

    const keep = tokens.signLink({ scope: "keep", request_id: requestId });
    const wrong = await pGet(new Request("http://localhost/x"), ctx({ token: keep }));
    expect(wrong.headers.get("location")).toBe("/link-off?reason=off");
  });
});

// --- revoke ------------------------------------------------------------------

describe("POST /api/links/revoke — the switch", () => {
  it("with the keep token as proof, revoking flips verifyLink; the ledger and the record stay", async () => {
    const requestId = await newRequest();
    const keep = ledger.issueLink({ scope: "keep", request_id: requestId });
    const share = ledger.issueLink({ scope: "media", request_id: requestId });
    expect((await tokens.verifyLink(share.token, "media")).ok).toBe(true);

    const res = await revokePost(json({ link_id: share.link_id, request_id: requestId, k: keep.token }, "/api/links/revoke"));
    expect(res.status).toBe(200);
    const after = await tokens.verifyLink(share.token, "media");
    expect(after.ok).toBe(false);
    expect(!after.ok && after.reason).toBe("revoked");
    // The link is still listed (the record of it lives), the keep link still opens.
    expect(ledger.listIssuedLinks(requestId).some((l) => l.link_id === share.link_id)).toBe(true);
    expect((await tokens.verifyLink(keep.token, "keep")).ok).toBe(true);
    expect(await runtime.runtimeStore().getJourney(requestId)).not.toBeNull();
  });

  it("no proof: 403 and the link keeps opening; a link from another request: 404", async () => {
    const requestId = await newRequest();
    const other = await newRequest("Warm air from every vent since this morning, fan runs");
    const share = ledger.issueLink({ scope: "packet", request_id: requestId });
    const keep = ledger.issueLink({ scope: "keep", request_id: requestId });
    const otherKeep = ledger.issueLink({ scope: "keep", request_id: other });

    const noProof = await revokePost(json({ link_id: share.link_id, request_id: requestId }, "/api/links/revoke"));
    expect(noProof.status).toBe(403);
    const wrongProof = await revokePost(json({ link_id: share.link_id, request_id: requestId, k: otherKeep.token }, "/api/links/revoke"));
    expect(wrongProof.status).toBe(403);
    const foreign = await revokePost(json({ link_id: share.link_id, request_id: other, k: otherKeep.token }, "/api/links/revoke"));
    expect(foreign.status).toBe(404);
    expect((await tokens.verifyLink(share.token, "packet")).ok).toBe(true);

    const form303 = await revokePost(form({ link_id: share.link_id, request_id: requestId, k: keep.token }, "/api/links/revoke"));
    expect(form303.status).toBe(303);
    expect(form303.headers.get("location")).toContain(`/links/${requestId}?k=`);
    expect(form303.headers.get("location")).toContain(`&off=${encodeURIComponent(share.link_id)}`);
  });
});
