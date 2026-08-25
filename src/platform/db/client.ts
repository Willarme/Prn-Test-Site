import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Platform database client seam (A00, approval condition d — 2026-08-24).
 *
 * "Service-role-only" is struck as settled doctrine: every A00 data-access
 * module ACCEPTS a client (or a provider of one) instead of importing the
 * service client directly, so a request-scoped (homeowner-authenticated)
 * Supabase client can be threaded through later without restructuring.
 * Nothing USES a request-scoped client yet — this is the seam, not the
 * feature. Elevated credentials remain for narrowly scoped internal
 * operations only.
 *
 * All platform writes through this seam are FAIL-SOFT by contract: a missing
 * table or unreachable Supabase must never break or alter the customer flow —
 * callers log the miss and proceed. See PLATFORM_MIGRATIONS_APPLIED below for
 * why that contract stays now that the tables exist.
 */
export type PlatformClientProvider = () => SupabaseClient | null;

/**
 * WHAT IS ACTUALLY IN THE DATABASE — recorded, dated, and re-verifiable.
 *
 * Until 2026-08-25 this file, and a dozen others, said the A00 migrations
 * (00006+) were "written but NOT applied". That was true when it was written and
 * it stopped being true, and a stale disclaimer is worse than no disclaimer: the
 * expected-outcome harness read those comments and reported three expectations
 * BLOCKED on a prerequisite that had already been met.
 *
 * Re-verify in one command, which is how this record was produced:
 *
 *     npm run db:migrate -- --status
 *
 * THE FAIL-SOFT CONTRACT DOES NOT RELAX. Every caller still logs a miss and
 * proceeds, because the tables existing is not the same as them being reachable:
 * a preview deploy with no keys, a local run with no .env.local, a network
 * partition and a revoked service role all still land on the same path. What
 * changed is what that path MEANS. It was the expected state; it is now
 * defence-in-depth, and a fail-soft message that fires in production is a
 * finding rather than the weather.
 */
export const PLATFORM_MIGRATIONS_APPLIED = {
  /** Every migration in supabase/migrations, 00001 through this one. */
  through: "00012_page_registry.sql",
  applied_on: "2026-08-25",
  verified_by:
    "npm run db:migrate -- --status — 12 of 12 reported [applied]; 40 public tables; row-level security ON for every one",
  /** Still true, and deliberately so — see above. */
  fail_soft_contract_remains: true,
} as const;

export function platformDbConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let cached: SupabaseClient | null = null;

/** Server-side service client, or null when no database is configured. */
export const serviceClientProvider: PlatformClientProvider = () => {
  if (!platformDbConfigured()) return null;
  if (!cached) {
    cached = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return cached;
};

/** Test seam: forces re-selection of the client. */
export function resetPlatformClient(): void {
  cached = null;
}
