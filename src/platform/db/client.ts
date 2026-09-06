import { createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The Supabase client seam (A00 approval condition d, 2026-08-24 — extended by
 * T1-33's request-scoped client, merged 2026-08-30).
 *
 * "Service-role-only" is struck as settled doctrine. This is the ONE place in
 * the repo that constructs a Supabase client — every store/adapter that used
 * to call `createClient(...)` inline goes through here, so there is one seam,
 * not several competing ones (docs/security/SERVICE-KEY-AUDIT.md enumerates
 * every call site this replaced).
 *
 * Two client kinds:
 *
 *  - serviceClient() / serviceClientProvider — the elevated, service-role
 *    client. RLS is deny-all by default, so this bypasses row scoping
 *    entirely; reserved for narrowly scoped internal operations (admin
 *    reads/writes, telemetry, config) with a written justification per call
 *    site.
 *  - requestScopedClient(requestId) — the default path for customer-facing
 *    reads. Signs a short-lived JWT carrying the caller's own request_id as a
 *    claim and authenticates as Supabase's standard `authenticated` role over
 *    the ANON key, so Postgres RLS (not application code) enforces that the
 *    caller only ever sees rows tagged with that same request_id
 *    (supabase/migrations/00019_request_scoped_read_seam.sql). There is no
 *    homeowner login yet, so "request-scoped" is scoped to the existing
 *    capability-URL identity (the crypto-random request_id itself, #14A /
 *    D-23) — the same seam a real homeowner login reuses later by adding an
 *    owner-id claim, not a second client type.
 *
 * Both are FAIL-SOFT to null when their required env vars are absent, so an
 * environment that only ever configured SUPABASE_URL + SERVICE_ROLE_KEY
 * (today's actual deploy) keeps working unchanged — callers fall back to
 * serviceClient() until SUPABASE_ANON_KEY + SUPABASE_JWT_SECRET are also set
 * and migration 00019 is applied.
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

/**
 * THE FILE-STORE OVERRIDE (campaign track F2b, 2026-09-05).
 *
 * `PRN_RUNTIME_STORE=file` forces every backend chooser that consults this
 * module — the runtime store, the media store, the policy store, the quality
 * guard's client provider — onto the local file backend REGARDLESS of the
 * Supabase env. Why: .env.local on a developer machine carries the trial
 * project's service key, so a bare `npm run dev` or a test run would otherwise
 * write demo journeys, test photos and fixture votes into the REAL trial
 * database. Local demos and tests must never write into the trial project;
 * `npm run dev:file` (scripts/dev-file.mjs) sets this for you.
 *
 * It is an override, not a default: absent or any other value, behaviour is
 * exactly what it was.
 */
export function fileStoreForced(): boolean {
  return process.env.PRN_RUNTIME_STORE === "file";
}

export function serviceConfigured(): boolean {
  if (fileStoreForced()) return false;
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** The chain's original name for the same predicate — kept so neither caller set churns. */
export function platformDbConfigured(): boolean {
  return serviceConfigured();
}

export function requestScopedConfigured(): boolean {
  // Same override as serviceConfigured(): with the file store forced, no
  // Supabase client of any kind is ever constructed.
  if (fileStoreForced()) return false;
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_JWT_SECRET
  );
}

let cachedService: SupabaseClient | null = null;

/** Elevated, service-role client — internal operations only. Null if unconfigured. */
export function serviceClient(): SupabaseClient | null {
  if (!serviceConfigured()) return null;
  if (!cachedService) {
    cachedService = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return cachedService;
}

/** Server-side service client, or null when no database is configured (the chain's shape). */
export const serviceClientProvider: PlatformClientProvider = () => serviceClient();

function base64url(input: Buffer | string): string {
  return (typeof input === "string" ? Buffer.from(input) : input).toString("base64url");
}

/**
 * Signs a minimal HS256 JWT carrying `request_id`, valid for the standard
 * Supabase `authenticated` role. This project never verifies the token
 * itself — Supabase's PostgREST layer does, against SUPABASE_JWT_SECRET —
 * so this only needs to construct a well-formed token, not validate one.
 */
export function signRequestScopedToken(
  requestId: string,
  secret: string,
  ttlSeconds = 300
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    role: "authenticated",
    aud: "authenticated",
    request_id: requestId,
    iat: now,
    exp: now + ttlSeconds,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

/**
 * Request-scoped client for customer-facing reads. Returns null when
 * SUPABASE_ANON_KEY or SUPABASE_JWT_SECRET are not configured — callers
 * MUST fall back to serviceClient() in that case (see runtime.ts), never
 * throw, so a deploy that hasn't added the new env vars yet keeps serving
 * customers exactly as it does today.
 */
export function requestScopedClient(requestId: string): SupabaseClient | null {
  if (!requestScopedConfigured()) return null;
  const token = signRequestScopedToken(requestId, process.env.SUPABASE_JWT_SECRET as string);
  return createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_ANON_KEY as string,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }
  );
}

/** Test seam: forces re-selection of the cached service client. */
export function resetServiceClient(): void {
  cachedService = null;
}

/** The chain's original name for the same test seam — kept for its callers. */
export function resetPlatformClient(): void {
  resetServiceClient();
}

/** serviceClient(), asserted non-null — for call sites gated by serviceConfigured() already. */
export function requireServiceClient(): SupabaseClient {
  const db = serviceClient();
  if (!db) throw new Error("Supabase service client requested but not configured");
  return db;
}
