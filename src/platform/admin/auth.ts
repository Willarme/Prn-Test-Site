import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Owner admin access (Admin/Company OS Lite, #14A §17).
 *
 * The admin surface reads real customer journeys, so READ is gated, not just
 * the buttons: every /admin page calls adminGate() and renders nothing else
 * until an owner session exists.
 *
 * Session cookie = issuedAt + HMAC(key, issuedAt), where key is derived from
 * ADMIN_PASSWORD with scrypt. So the cookie is not password-equivalent (it
 * cannot be brute-forced back to the password at commodity speed), it expires
 * server-side, and rotating ADMIN_PASSWORD invalidates every outstanding
 * session.
 */
const COOKIE = "prn_admin";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const SCRYPT_SALT = "prn-admin-session-v2";

function sessionKey(password: string): Buffer {
  return scryptSync(password, SCRYPT_SALT, 32);
}

function sign(issuedAt: number, password: string): string {
  return createHmac("sha256", sessionKey(password)).update(String(issuedAt)).digest("hex");
}

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 8);
}

export function passwordMatches(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!adminConfigured() || candidate.length === 0) return false;
  // Compare fixed-width digests so length differences do not leak via timing.
  const a = createHmac("sha256", SCRYPT_SALT).update(candidate).digest();
  const b = createHmac("sha256", SCRYPT_SALT).update(expected).digest();
  return timingSafeEqual(a, b);
}

export function sessionCookie(password: string): { name: string; value: string; maxAge: number } {
  const issuedAt = Date.now();
  return {
    name: COOKIE,
    value: `${issuedAt}.${sign(issuedAt, password)}`,
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export const ADMIN_COOKIE_NAME = COOKIE;

export async function isAdminUnlocked(): Promise<boolean> {
  if (!adminConfigured()) return false;
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  const [issuedRaw, mac] = raw.split(".");
  const issuedAt = Number(issuedRaw);
  if (!Number.isFinite(issuedAt) || !mac) return false;
  // Server-side expiry: a captured cookie stops working even if the client
  // ignores maxAge.
  if (Date.now() - issuedAt > SESSION_MAX_AGE_SECONDS * 1000) return false;
  const expected = sign(issuedAt, process.env.ADMIN_PASSWORD as string);
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export type AdminMode = "preview" | "locked" | "unlocked";

export async function adminMode(): Promise<AdminMode> {
  if (!adminConfigured()) return "preview";
  return (await isAdminUnlocked()) ? "unlocked" : "locked";
}

/** Simple in-memory throttle for sign-in attempts (per server instance). */
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function loginAllowed(key: string): boolean {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return true;
  }
  rec.count += 1;
  return rec.count <= MAX_ATTEMPTS;
}

export function resetLoginAttempts(key: string): void {
  attempts.delete(key);
}

/** Random value used only to make the setup instructions concrete. */
export function suggestPassword(): string {
  return randomBytes(9).toString("base64url");
}
