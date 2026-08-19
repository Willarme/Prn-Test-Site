import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Owner admin access (Admin/Company OS Lite, #14A §17).
 *
 * - When ADMIN_PASSWORD is NOT configured (fresh staging), the dashboard is
 *   READ-ONLY "preview mode": everything is visible (all data is fixture,
 *   the site is noindex/robots-blocked), every mutation is refused.
 * - When ADMIN_PASSWORD is configured, the owner signs in once; a session
 *   cookie unlocks mutations (publish, policy edits). Cookie holds a hash,
 *   never the password. Set it in Vercel → Project → Settings → Environment
 *   Variables (OWNER_TODO).
 */
const COOKIE = "prn_admin";

function tokenFor(password: string): string {
  return createHash("sha256").update(`prn-admin:${password}`).digest("hex");
}

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 8);
}

export function passwordMatches(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!adminConfigured() || candidate.length === 0) return false;
  const a = Buffer.from(tokenFor(candidate));
  const b = Buffer.from(tokenFor(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function isAdminUnlocked(): Promise<boolean> {
  if (!adminConfigured()) return false;
  const jar = await cookies();
  const value = jar.get(COOKIE)?.value;
  if (!value) return false;
  const expected = tokenFor(process.env.ADMIN_PASSWORD ?? "");
  return value.length === expected.length && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

export function sessionCookie(password: string): { name: string; value: string; maxAge: number } {
  return { name: COOKIE, value: tokenFor(password), maxAge: 60 * 60 * 12 };
}

export type AdminMode = "preview" | "locked" | "unlocked";

export async function adminMode(): Promise<AdminMode> {
  if (!adminConfigured()) return "preview";
  return (await isAdminUnlocked()) ? "unlocked" : "locked";
}
