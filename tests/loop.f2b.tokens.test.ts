import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * SCOPED LINKS (track F2b) — what a token must and must not do.
 *
 * Spec §16.2 (BINDING): opaque signed tokens, no personal data in the URL,
 * never sequential, revocable from the homeowner's side; "a packet share link
 * cannot open Home Memory ... This is an eval assertion, not a design
 * intention." The cases below are that assertion.
 */
type Tokens = typeof import("@/platform/links/tokens");
type Runtime = typeof import("@/platform/stores/runtime");

let tokens: Tokens;
let runtime: Runtime;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "prn-f2b-tokens-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  process.env.PRN_RUNTIME_STORE = "file";
  process.env.LINK_SIGNING_SECRET = "f2b-test-secret-not-real-0123456789";
  tokens = await import("@/platform/links/tokens");
  runtime = await import("@/platform/stores/runtime");
  runtime.resetRuntimeStore();
  (await import("@/platform/stores/dev-db")).updateDevDb(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
  delete process.env.PRN_RUNTIME_STORE;
  delete process.env.LINK_SIGNING_SECRET;
  rmSync(dir, { recursive: true, force: true });
});

describe("signLink / verifyLink", () => {
  it("a signed link verifies with its scope, request_id, a random link_id, extras and an expiry", async () => {
    const token = tokens.signLink({
      scope: "keep",
      request_id: "rq_f2b_one",
      extra: { packet: "pk_1" },
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const v = await tokens.verifyLink(token);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.scope).toBe("keep");
    expect(v.request_id).toBe("rq_f2b_one");
    expect(v.link_id).toMatch(/^lk_/);
    expect(v.extra).toEqual({ packet: "pk_1" });
    expect(v.exp).not.toBeNull();
    const msLeft = Date.parse(v.exp!) - Date.now();
    expect(msLeft).toBeGreaterThan(89 * 24 * 3600 * 1000);
    expect(msLeft).toBeLessThanOrEqual(90 * 24 * 3600 * 1000);
  });

  it("two links for the same request are different tokens with different link ids (never sequential)", async () => {
    const a = tokens.signLink({ scope: "ask", request_id: "rq_f2b_two" });
    const b = tokens.signLink({ scope: "ask", request_id: "rq_f2b_two" });
    expect(a).not.toBe(b);
    const va = await tokens.verifyLink(a);
    const vb = await tokens.verifyLink(b);
    expect(va.ok && vb.ok && va.link_id !== vb.link_id).toBe(true);
  });

  it("the token carries no personal data: the payload is scope, ids, extras and expiry only", () => {
    const token = tokens.signLink({ scope: "media", request_id: "rq_f2b_three" });
    const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf-8"));
    expect(Object.keys(payload).sort()).toEqual(["e", "id", "r", "s", "v", "x"]);
  });

  it("refuses to mint a link that is already dead (ttl_days <= 0) or with an unknown scope", () => {
    expect(() => tokens.signLink({ scope: "keep", request_id: "rq_x", ttl_days: 0 })).toThrow();
    expect(() => tokens.signLink({ scope: "keep", request_id: "rq_x", ttl_days: -1 })).toThrow();
    expect(() =>
      tokens.signLink({ scope: "home" as unknown as "keep", request_id: "rq_x" })
    ).toThrow(/scope/);
  });
});

describe("what a token must NOT do", () => {
  it("tampering with the payload (changing the request_id) fails as bad_signature", async () => {
    const token = tokens.signLink({ scope: "keep", request_id: "rq_f2b_mine" });
    const [payloadB64, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    payload.r = "rq_f2b_someone_else";
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
    expect(await tokens.verifyLink(forged)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("tampering with the scope (packet -> keep) fails: a packet share link cannot open Home Memory", async () => {
    const token = tokens.signLink({ scope: "packet", request_id: "rq_f2b_scope" });
    const [payloadB64, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    payload.s = "keep";
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
    expect(await tokens.verifyLink(forged, "keep")).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("a valid token presented to a route expecting a different scope is refused (narrow permission)", async () => {
    const packet = tokens.signLink({ scope: "packet", request_id: "rq_f2b_narrow" });
    expect(await tokens.verifyLink(packet, "keep")).toEqual({ ok: false, reason: "bad_signature" });
    expect(await tokens.verifyLink(packet, "media")).toEqual({ ok: false, reason: "bad_signature" });
    expect((await tokens.verifyLink(packet, "packet")).ok).toBe(true);
  });

  it("a token signed under a different secret fails as bad_signature", async () => {
    const token = tokens.signLink({ scope: "keep", request_id: "rq_f2b_secret" });
    process.env.LINK_SIGNING_SECRET = "a-different-secret-entirely-9876543210";
    try {
      expect(await tokens.verifyLink(token)).toEqual({ ok: false, reason: "bad_signature" });
    } finally {
      process.env.LINK_SIGNING_SECRET = "f2b-test-secret-not-real-0123456789";
    }
  });

  it("garbage, an empty string, a missing signature and a non-JSON payload are all malformed", async () => {
    for (const bad of ["", "abc", "abc.", ".abc", "not base64!.sig", `${Buffer.from("[1,2]").toString("base64url")}.sig`]) {
      const v = await tokens.verifyLink(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toBe("malformed");
    }
  });

  it("an expired link fails as expired, and only after the signature check", async () => {
    const token = tokens.signLink({ scope: "ask", request_id: "rq_f2b_exp", ttl_days: 1 });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2 * 24 * 3600 * 1000);
    expect(await tokens.verifyLink(token)).toEqual({ ok: false, reason: "expired" });
    // Tampered AND expired reads as bad_signature: an unsigned payload has no say.
    const [payloadB64, sig] = token.split(".");
    const forged = `${payloadB64.slice(0, -2)}AA.${sig}`;
    const v = await tokens.verifyLink(forged);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(["bad_signature", "malformed"]).toContain(v.reason);
  });
});

describe("revocation — the link dies, the record lives (decision 8, A)", () => {
  it("revokeLink writes the ledger; the same token then fails as revoked; other links still open", async () => {
    const dead = tokens.signLink({ scope: "media", request_id: "rq_f2b_revoke" });
    const alive = tokens.signLink({ scope: "media", request_id: "rq_f2b_revoke" });
    const before = await tokens.verifyLink(dead);
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    await tokens.revokeLink(before.link_id, "rq_f2b_revoke");
    expect(await tokens.verifyLink(dead)).toEqual({ ok: false, reason: "revoked" });
    expect((await tokens.verifyLink(alive)).ok).toBe(true);

    // The ledger row is the whole mechanism: nothing was deleted anywhere.
    const db = JSON.parse(readFileSync(process.env.PRN_DEV_DB_PATH!, "utf-8"));
    const rows = db.link_revocations.filter((r: { link_id: string }) => r.link_id === before.link_id);
    expect(rows.length).toBe(1);
    expect(rows[0].request_id).toBe("rq_f2b_revoke");

    // Revoking twice is one dead link, not two ledger rows.
    await tokens.revokeLink(before.link_id, "rq_f2b_revoke");
    const again = JSON.parse(readFileSync(process.env.PRN_DEV_DB_PATH!, "utf-8"));
    expect(again.link_revocations.filter((r: { link_id: string }) => r.link_id === before.link_id).length).toBe(1);
  });

  it("decodeLink reads a revoked token without consulting the ledger (the pure half)", async () => {
    const token = tokens.signLink({ scope: "keep", request_id: "rq_f2b_decode" });
    const decoded = tokens.decodeLink(token);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    await tokens.revokeLink(decoded.link_id, "rq_f2b_decode");
    expect(tokens.decodeLink(token).ok).toBe(true);
    expect(await tokens.verifyLink(token)).toEqual({ ok: false, reason: "revoked" });
  });
});

describe("the dev secret", () => {
  it("without LINK_SIGNING_SECRET a 32-byte secret is generated once into data/runtime/link-secret.txt and reused", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "prn-f2b-secret-"));
    const realCwd = process.cwd();
    const previousDbPath = process.env.PRN_DEV_DB_PATH;
    process.env.PRN_DEV_DB_PATH = join(cwd, "data", "runtime", "dev-db.json");
    (await import("@/platform/stores/dev-db")).updateDevDb(() => {});
    delete process.env.LINK_SIGNING_SECRET;
    process.chdir(cwd);
    tokens.__resetLinkSecretForTests();
    try {
      const path = join(cwd, "data", "runtime", "link-secret.txt");
      expect(existsSync(path)).toBe(false);
      const token = tokens.signLink({ scope: "keep", request_id: "rq_f2b_dev" });
      expect(existsSync(path)).toBe(true);
      const first = readFileSync(path, "utf-8").trim();
      expect(first.length).toBeGreaterThanOrEqual(32);
      // A restart (fresh module cache) reads the same file back.
      tokens.__resetLinkSecretForTests();
      expect((await tokens.verifyLink(token)).ok).toBe(true);
      expect(readFileSync(path, "utf-8").trim()).toBe(first);
    } finally {
      process.chdir(realCwd);
      process.env.PRN_DEV_DB_PATH = previousDbPath;
      process.env.LINK_SIGNING_SECRET = "f2b-test-secret-not-real-0123456789";
      tokens.__resetLinkSecretForTests();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
