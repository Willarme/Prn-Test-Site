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
 * All platform writes through this seam are FAIL-SOFT by contract: the A00
 * migrations (00006+) are written but NOT applied to the live database, so a
 * missing table or unreachable Supabase must never break or alter the
 * customer flow — callers log the miss and proceed.
 */
export type PlatformClientProvider = () => SupabaseClient | null;

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
