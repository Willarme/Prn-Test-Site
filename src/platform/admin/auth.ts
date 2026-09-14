import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { cookies, headers } from "next/headers";

const COOKIE = "prn_admin";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const SCRYPT_SALT = "prn-admin-session-v3";
const MAX_PASSWORD_LENGTH = 1024;
type AccessKind = "owner" | "local-demo";
type Context = { headers: Headers; url?: string };

// Retain only the active owner key; forged cookies cannot grow a key cache
// or force scrypt once per request. Password rotation replaces this key.
let cachedOwnerKey: { password: string; key: Buffer } | undefined;
function ownerKey(password: string): Buffer {
  if (cachedOwnerKey?.password !== password) cachedOwnerKey = { password, key: scryptSync(password, SCRYPT_SALT, 32) };
  return cachedOwnerKey.key;
}

export function adminConfigured(): boolean {
  const password = process.env.ADMIN_PASSWORD ?? "";
  return password.length >= 8 && password.length <= MAX_PASSWORD_LENGTH;
}

function localConfigured(): boolean {
  const password = process.env.PRN_LOCAL_ADMIN_PASSWORD ?? "";
  const secret = process.env.PRN_LOCAL_ADMIN_SESSION_SECRET ?? "";
  const db = process.env.PRN_DEV_DB_PATH ?? "";
  if (process.env.NODE_ENV !== "development" || process.env.PRN_RUNTIME_STORE !== "file" ||
      process.env.PRN_CLIENT_DEMO || process.env.PRN_DEMO_PUBLIC_ORIGIN || process.env.PRN_ADMIN_ORIGIN || process.env.VERCEL ||
      !password || password.length > MAX_PASSWORD_LENGTH || !/^[A-Za-z0-9_-]{43,128}$/.test(secret) ||
      Buffer.from(secret, "base64url").length < 32 || !isAbsolute(db)) return false;
  const nested = relative(resolve(process.cwd(), "data", "runtime"), resolve(db));
  // Require a named subdirectory, not the shared default dev-db.json.
  return !nested.startsWith(`..${sep}`) && nested !== ".." && !isAbsolute(nested) && nested.split(sep).length >= 2;
}

function localContextAllowed(context: Context): boolean {
  try {
    const host = context.headers.get("host");
    const url = new URL(context.url ?? `http://${host ?? ""}`);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.username || url.password || (host !== null && host !== url.host)) return false;
    // A public proxy pointing to a loopback upstream is still public.
    if (context.headers.has("forwarded")) return false;
    const forwardedHost = context.headers.get("x-forwarded-host");
    const forwardedProto = context.headers.get("x-forwarded-proto");
    if ((forwardedHost !== null && forwardedHost !== url.host) ||
        (forwardedProto !== null && forwardedProto !== "http")) return false;
    // Next itself fills these on a direct local request. Permit only one
    // loopback address, never a public address or a visitor-supplied chain.
    for (const name of ["x-forwarded-for", "x-real-ip"]) {
      const ip = context.headers.get(name);
      if (ip !== null && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)) return false;
    }
    const origin = context.headers.get("origin");
    return origin === null || origin === url.origin;
  } catch { return false; }
}

async function currentContext(request?: Request): Promise<Context> {
  return request ?? { headers: new Headers(await headers()) };
}

export async function adminAccessKind(request?: Request): Promise<AccessKind | "unconfigured"> {
  if (localConfigured() && localContextAllowed(await currentContext(request))) return "local-demo";
  return adminConfigured() ? "owner" : "unconfigured";
}

function equalPassword(candidate: string, expected: string): boolean {
  const digest = (value: string) => createHmac("sha256", SCRYPT_SALT).update(value).digest();
  return timingSafeEqual(digest(candidate), digest(expected));
}

function passwordKind(candidate: string, request?: Request): AccessKind | null {
  if (!candidate || candidate.length > MAX_PASSWORD_LENGTH) return null;
  if (adminConfigured() && equalPassword(candidate, process.env.ADMIN_PASSWORD as string)) return "owner";
  if (request && localConfigured() && localContextAllowed(request) &&
      equalPassword(candidate, process.env.PRN_LOCAL_ADMIN_PASSWORD as string)) return "local-demo";
  return null;
}

export function passwordMatches(candidate: string, request?: Request): boolean {
  return passwordKind(candidate, request) !== null;
}

function keyFor(kind: AccessKind): Buffer {
  if (kind === "owner") return ownerKey(process.env.ADMIN_PASSWORD as string);
  // The known demo password is not its signing key. Rotating either value
  // invalidates local sessions, which remain unusable outside this runtime.
  return createHmac("sha256", Buffer.from(process.env.PRN_LOCAL_ADMIN_SESSION_SECRET as string, "base64url"))
    .update(`local-demo:${process.env.PRN_LOCAL_ADMIN_PASSWORD}`).digest();
}

export function sessionCookie(password: string, request?: Request): { name: string; value: string; maxAge: number } {
  const kind = passwordKind(password, request);
  if (!kind) throw new Error("Owner sign-in required");
  const payload = `v3.${kind}.${Date.now()}`;
  return { name: COOKIE, value: `${payload}.${createHmac("sha256", keyFor(kind)).update(payload).digest("hex")}`, maxAge: SESSION_MAX_AGE_SECONDS };
}

export const ADMIN_COOKIE_NAME = COOKIE;

export async function isAdminUnlocked(request?: Request): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw || raw.length > 104) return false;
  const match = /^v3\.(owner|local-demo)\.([1-9][0-9]{12})\.([a-f0-9]{64})$/.exec(raw);
  if (!match) return false;
  const [, kind, issuedRaw, mac] = match;
  const age = Date.now() - Number(issuedRaw);
  if (age < 0 || age >= SESSION_MAX_AGE_SECONDS * 1000) return false;
  if (kind === "owner" ? !adminConfigured() :
      !localConfigured() || !localContextAllowed(await currentContext(request))) return false;
  const expected = createHmac("sha256", keyFor(kind as AccessKind)).update(`v3.${kind}.${issuedRaw}`).digest();
  return timingSafeEqual(Buffer.from(mac, "hex"), expected);
}

export type AdminMode = "preview" | "locked" | "unlocked";
export async function adminMode(request?: Request): Promise<AdminMode> {
  if ((await adminAccessKind(request)) === "unconfigured") return "preview";
  return (await isAdminUnlocked(request)) ? "unlocked" : "locked";
}

// Constant-memory, global per-process admission: no visitor-controlled bucket.
// Multiple hosted instances additionally require shared ingress throttling.
let attempts = { count: 0, first: 0 };
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;
export function loginAllowed(key?: string): boolean {
  void key;
  const now = Date.now();
  if (now - attempts.first >= WINDOW_MS || now < attempts.first) attempts = { count: 0, first: now };
  attempts.count = Math.min(attempts.count + 1, MAX_ATTEMPTS + 1);
  return attempts.count <= MAX_ATTEMPTS;
}
export function resetLoginAttempts(key?: string): void {
  void key;
  attempts = { count: 0, first: 0 };
}
export function suggestPassword(): string { return randomBytes(18).toString("base64url"); }
