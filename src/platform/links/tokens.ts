import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runtimeStore } from "@/platform/stores/runtime";
import { withFileLock, writeFileAtomic } from "@/platform/stores/atomic-file";

/**
 * SCOPED LINKS — the signed, revocable capability tokens behind /keep, /ask,
 * /media, /p and /claim (campaign track F2b, 2026-09-05).
 *
 * WHAT A LINK MUST GUARANTEE (PRN Master Build Spec MERGED §16.2, BINDING;
 * Unique Links and Feedback Popup decisions §1; DECISIONS FOR MELISSA 7 and 8,
 * recommendation A on both):
 *
 *   - It carries PERMISSION to open a record we already hold, never the
 *     record's contents and never personal data. The payload below is a
 *     scope, a request id, a random link id, an expiry and an optional bag of
 *     opaque extras; nothing a homeowner typed goes in a URL.
 *   - It is long, unguessable and never sequential: 16 random bytes of link
 *     id plus a 32-byte HMAC-SHA256 signature over the payload.
 *   - It is NARROW. A token minted for one scope verifies only for that scope
 *     (the caller says which scope it expects); a packet share link cannot
 *     open Home Memory, a media link cannot answer an ask. That is an eval
 *     assertion in tests/loop.f2b.tokens.test.ts, not a design intention.
 *   - It is REVOCABLE from the homeowner's side, and revoking it kills the
 *     link and only the link: the revocation ledger in the runtime store
 *     gains a row, the record it pointed at is untouched (decision 8, A;
 *     §11.4). Anything already opened cannot be recalled — the share moment
 *     says so in one sentence (P3's copy).
 *   - It EXPIRES. Default 90 days, per link; `ttl_days: 0` or a negative
 *     number is refused rather than minting a token that is already dead.
 *
 * FORMAT. `<base64url(payload JSON)>.<base64url(HMAC-SHA256)>`. The payload is
 * versioned (`v: 1`) so a future change to the shape can be told apart from a
 * forgery. Signature comparison is constant-time.
 *
 * THE SECRET. `LINK_SIGNING_SECRET` is required in production or on Vercel.
 * In local development, a random 32-byte dev secret is generated ONCE into data/runtime/link-secret.txt
 * (gitignored with the rest of data/runtime/) and reused, so a link minted by
 * one local dev server still opens after a restart. Rotating the secret
 * invalidates every link signed under the old one — that is the intended
 * emergency lever, and it is why the secret is a file and not a constant.
 */
export type LinkScope = "keep" | "ask" | "media" | "packet" | "magic";

const LINK_SCOPES: readonly LinkScope[] = ["keep", "ask", "media", "packet", "magic"];

/** DEFAULT pending Melissa: no decision names a link lifetime; 90 days is the F2b default. */
export const DEFAULT_TTL_DAYS = 90;

interface Payload {
  v: 1;
  /** The random link id — what the revocation ledger keys on. */
  id: string;
  s: LinkScope;
  /** request_id */
  r: string;
  /** extras, opaque to this module */
  x: Record<string, string>;
  /** expiry, ISO 8601 (null = never; not minted by signLink, accepted on verify) */
  e: string | null;
}

export type VerifiedLink = {
  ok: true;
  scope: LinkScope;
  request_id: string;
  link_id: string;
  extra: Record<string, string>;
  exp: string | null;
};

export type VerifyFailure = {
  ok: false;
  reason: "malformed" | "bad_signature" | "expired" | "revoked";
};

function secretPath(): string {
  if (process.env.PRN_DEV_DB_PATH) return join(dirname(process.env.PRN_DEV_DB_PATH), "link-secret.txt");
  return join(process.cwd(), "data", "runtime", "link-secret.txt");
}

let cachedDevSecret: Buffer | null = null;

/**
 * The signing key. Production must use an explicitly configured stable key;
 * it must never depend on a writable deployment directory or a cached dev key.
 * Only local development may use the once-generated dev secret.
 */
function signingSecret(): Buffer {
  const fromEnv = process.env.LINK_SIGNING_SECRET;
  if (fromEnv && fromEnv.length > 0) return Buffer.from(fromEnv, "utf-8");
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    throw Object.assign(new Error("Link signing is not configured."), { code: "LINK_SIGNING_NOT_CONFIGURED" });
  }
  if (cachedDevSecret) return cachedDevSecret;
  const path = secretPath();
  cachedDevSecret = withFileLock(path, () => {
    try {
      const existing = readFileSync(path, "utf-8").trim();
      if (existing.length < 32) throw new Error("Link signing state is invalid; restore the existing secret.");
      return Buffer.from(existing, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const fresh = randomBytes(32).toString("base64url");
    writeFileAtomic(path, `${fresh}\n`);
    return Buffer.from(fresh, "utf-8");
  });
  return cachedDevSecret;
}

/** Test seam: forget the cached dev secret (after a test swaps cwd or the env). */
export function __resetLinkSecretForTests(): void {
  cachedDevSecret = null;
}

function sign(payloadB64: string): string {
  return createHmac("sha256", signingSecret()).update(payloadB64).digest("base64url");
}

function isPayload(value: unknown): value is Payload {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  if (p.v !== 1) return false;
  if (typeof p.id !== "string" || p.id.length === 0) return false;
  if (typeof p.s !== "string" || !(LINK_SCOPES as readonly string[]).includes(p.s)) return false;
  if (typeof p.r !== "string" || p.r.length === 0) return false;
  if (!p.x || typeof p.x !== "object" || Array.isArray(p.x)) return false;
  for (const v of Object.values(p.x as Record<string, unknown>)) {
    if (typeof v !== "string") return false;
  }
  if (p.e !== null && typeof p.e !== "string") return false;
  return true;
}

/**
 * Mint a token. Opaque base64url; carries a random link_id. The extras are
 * copied verbatim and must already be free of personal data — this module
 * cannot know what a caller's string means, so the rule is enforced where
 * the caller builds it.
 */
export function signLink(input: {
  scope: LinkScope;
  request_id: string;
  ttl_days?: number;
  extra?: Record<string, string>;
}): string {
  if (!(LINK_SCOPES as readonly string[]).includes(input.scope)) {
    throw new Error(`signLink: unknown scope "${input.scope}"`);
  }
  if (!input.request_id) throw new Error("signLink: request_id is required");
  const ttl = input.ttl_days ?? DEFAULT_TTL_DAYS;
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new Error("signLink: ttl_days must be a positive number of days");
  }
  const payload: Payload = {
    v: 1,
    id: `lk_${randomBytes(16).toString("base64url")}`,
    s: input.scope,
    r: input.request_id,
    x: { ...(input.extra ?? {}) },
    e: new Date(Date.now() + ttl * 24 * 60 * 60 * 1000).toISOString(),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

/**
 * Decode and check a token WITHOUT consulting the revocation ledger — the
 * pure half of verifyLink, exported so a caller that only needs to know what
 * a token says (never whether it still opens) can avoid a store read.
 */
export function decodeLink(token: string): VerifiedLink | VerifyFailure {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
    return { ok: false, reason: "malformed" };
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [payloadB64, sigB64] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(payloadB64) || !/^[A-Za-z0-9_-]+$/.test(sigB64)) {
    return { ok: false, reason: "malformed" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isPayload(parsed)) return { ok: false, reason: "malformed" };

  // Signature before anything else the payload claims: an unsigned payload
  // has no say over expiry or scope.
  const expected = Buffer.from(sign(payloadB64), "utf-8");
  const given = Buffer.from(sigB64, "utf-8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad_signature" };
  }

  if (parsed.e !== null) {
    const exp = Date.parse(parsed.e);
    if (Number.isNaN(exp)) return { ok: false, reason: "malformed" };
    if (exp <= Date.now()) return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    scope: parsed.s,
    request_id: parsed.r,
    link_id: parsed.id,
    extra: { ...parsed.x },
    exp: parsed.e,
  };
}

/**
 * Verify a token: signature, then expiry, then the store's revocation ledger.
 * `expected_scope`, when given, is checked too — a token that verifies but
 * was minted for a different job is reported as `bad_signature`, because to
 * the route that received it, it is not a valid token for that route. There
 * is deliberately no fifth reason: a caller that wants to distinguish "wrong
 * scope" from "forged" can call decodeLink and compare, but a homeowner-facing
 * route has nothing different to say in the two cases.
 *
 * A store failure while checking revocation THROWS rather than answering: a
 * link that cannot be checked is not known to be open, and a route that
 * catches the error can fail soft in its own words.
 */
export async function verifyLink(
  token: string,
  expected_scope?: LinkScope
): Promise<VerifiedLink | VerifyFailure> {
  const decoded = decodeLink(token);
  if (!decoded.ok) return decoded;
  if (expected_scope && decoded.scope !== expected_scope) {
    return { ok: false, reason: "bad_signature" };
  }
  if (await runtimeStore().isLinkRevoked(decoded.link_id)) {
    return { ok: false, reason: "revoked" };
  }
  return decoded;
}

/** HTTP surfaces can show a retry state without mistaking a storage fault for a revoked link. */
export async function verifyLinkForRoute(token: string, expected_scope?: LinkScope): Promise<VerifiedLink | VerifyFailure | { ok: false; reason: "unavailable" }> {
  try { return await verifyLink(token, expected_scope); }
  catch { return { ok: false, reason: "unavailable" }; }
}

/**
 * Kill a link. The ledger gains a row; nothing else changes (decision 8, A).
 * Idempotent from the homeowner's point of view: revoking twice is one dead
 * link, and the file store simply appends the second row to the ledger.
 */
export async function revokeLink(link_id: string, request_id: string): Promise<void> {
  if (!link_id || !request_id) throw new Error("revokeLink: link_id and request_id are required");
  const store = runtimeStore();
  if (await store.isLinkRevoked(link_id)) return;
  await store.revokeLink(link_id, request_id, new Date().toISOString());
}
