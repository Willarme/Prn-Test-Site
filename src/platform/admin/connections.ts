import { runtimeStore } from "@/platform/stores/runtime";
import { fileStoreForced, serviceConfigured, serviceClientProvider, requestScopedConfigured } from "@/platform/db/client";
import { aiProviderConfigured } from "@/platform/ai/client";
import { seoProviderConfigured } from "@/platform/adapters/seo-provider";

/** Presence and mode only. Never serialize a URL, address, token or service key. */
export function connectionReadiness() {
  const local = !serviceConfigured();
  return {
    storage: local ? "local" as const : "database" as const,
    file_override: fileStoreForced(),
    supabase_credentials: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    request_scope: requestScopedConfigured(),
    request_scope_credentials: Boolean(process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_JWT_SECRET),
    openrouter: aiProviderConfigured(),
    email: process.env.EMAIL_MODE !== "live" ? "preview" as const : process.env.RESEND_API_KEY ? "configured" as const : "unconfigured" as const,
    search: seoProviderConfigured(),
    search_console: Boolean(process.env.GSC_OAUTH_REFRESH_TOKEN && process.env.GSC_PROPERTY_URL),
  };
}

export interface ConnectionCheck { name: string; status: "pass" | "unavailable" | "skipped"; detail: string }
export interface ConnectionReport { checked_at: string; mode: "local" | "database"; checks: ConnectionCheck[] }

/** An owner-triggered read, with no provider messages or record bodies in the response. */
export async function checkConnections(): Promise<ConnectionReport> {
  const readiness = connectionReadiness();
  const checks: ConnectionCheck[] = [];
  if (readiness.storage === "local") {
    try {
      await runtimeStore().totals();
      checks.push({ name: "Local request store", status: "pass", detail: "The active file runtime completed a read. This does not verify writes or backups. No trial database was contacted." });
    } catch {
      checks.push({ name: "Local request store", status: "unavailable", detail: "The runtime records could not be verified. Repair the store before trusting its counts." });
    }
    checks.push({ name: "Supabase", status: "skipped", detail: readiness.file_override
      ? "The file-store override is active. Database credentials, when present, are deliberately unused."
      : "The runtime uses its file fallback because server database credentials are absent. No database check was attempted." });
  } else {
    let client;
    try { client = serviceClientProvider(); }
    catch { /* Configuration can be present but invalid; report no raw error. */ }
    if (!client) checks.push({ name: "Supabase", status: "unavailable", detail: "The server database connection could not be initialized. Configuration presence is not connection evidence." });
    else {
      // The customer loop uses migration 00020 as well as the original admin
      // tables. A readable packet table alone must not hide missing receipts,
      // feedback, saved-home claims or email-preview storage.
      const tables = [
        "intake_session", "job_packet", "admin_audit", "agent_run_ledger", "approval_item",
        "link_revocations", "keep_claims", "magic_links", "ask_answers", "feedback",
        "email_outbox", "job_addresses", "signups", "issued_request_links", "request_keep_state",
      ] as const;
      const results = await Promise.all(tables.map(async table => {
        try {
          const { error, status } = await client.from(table).select("*", { head: true }).limit(1).retry(false).abortSignal(AbortSignal.timeout(8_000));
          // postgrest-js maps a bodyless 404 to 204/error:null for compatibility.
          // A HEAD SELECT needs an actual 200/206, including for an empty table;
          // error:null alone can wrongly certify a missing table as readable.
          const readable = !error && (status === 200 || status === 206);
          return { name: table, status: readable ? "pass" as const : "unavailable" as const, detail: readable ? "The server connection can read this table. No records were returned. This does not verify writes or row isolation." : "This table could not be read with the configured server connection. Check its migration, API exposure and access grants." };
        } catch { return { name: table, status: "unavailable" as const, detail: "The check failed or exceeded its eight-second deadline." }; }
      }));
      checks.push(...results);
      checks.push({ name: "Customer row isolation", status: readiness.request_scope ? "skipped" : "unavailable", detail: readiness.request_scope ? "Request-scoped credentials are present. This read-only check does not prove row-level isolation between customers." : "Request-scoped credentials are missing. The existing customer read adapter can fall back to elevated server access." });
    }
  }
  checks.push({ name: "AI and email", status: "skipped", detail: "This check makes no paid AI calls and sends no messages. Inspect agent receipts for observed model activity." });
  return { checked_at: new Date().toISOString(), mode: readiness.storage, checks };
}
