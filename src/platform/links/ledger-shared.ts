import { z } from "zod";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { requestScopedClient, requireServiceClient } from "@/platform/db/client";
import { runtimeStore } from "@/platform/stores/runtime";
import type { IssuedLink, KeepState, LinkLedger } from "./ledger";

const unavailable = () => new Error("Shared link history is unavailable.");
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const date = z.string().refine(value => Number.isFinite(Date.parse(value)));
const issuedSchema = z.object({ link_id: id, scope: z.enum(["keep", "ask", "media", "packet", "magic"]),
  token: z.string().min(1).max(4096), created_at: date, exp: date.nullable() });
const keepSchema = z.object({ email_id: id.nullable(), magic_id: id.nullable(), confirmed_at: date.nullable() });
export interface SharedLinkContext { requestId: string; tenantId: string; problemId: string }

/** Hosted capabilities must survive another invocation; never fall back to a local sidecar. */
export async function sharedLinkContext(requestId: string): Promise<SharedLinkContext | null> {
  id.parse(requestId);
  const store = runtimeStore();
  if (store.kind !== "supabase") {
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY ||
        process.env.K_SERVICE || process.env.NEXT_RUNTIME === "edge" ||
        process.env.AWS_EXECUTION_ENV?.startsWith("AWS_Lambda")) throw unavailable();
    return null;
  }
  try {
    const journey = await store.getJourney(requestId);
    if (!journey || journey.session.request_id !== requestId) throw unavailable();
    return { requestId, tenantId: journey.problem.tenant_id ?? DEFAULT_TENANT_ID, problemId: journey.problem.problem_id };
  } catch { throw unavailable(); }
}

function identity(context: SharedLinkContext) { return { p_request_id: context.requestId, p_tenant_id: context.tenantId }; }
function owned(row: unknown, context: SharedLinkContext): Record<string, unknown> {
  if (!row || typeof row !== "object") throw unavailable();
  const value = row as Record<string, unknown>;
  if (value.request_id !== context.requestId || value.tenant_id !== context.tenantId || value.problem_id !== context.problemId) throw unavailable();
  return value;
}
function issued(row: unknown, context: SharedLinkContext): IssuedLink {
  const parsed = issuedSchema.parse(owned(row, context));
  // Historical expired links remain listable. Bind their stored payload to
  // the row without treating a past expiration as permission to use the link.
  const payload = JSON.parse(Buffer.from(parsed.token.split(".")[0], "base64url").toString("utf8"));
  if (payload.r !== context.requestId || payload.id !== parsed.link_id || payload.s !== parsed.scope ||
      (payload.e === null ? parsed.exp !== null : typeof payload.e !== "string" || Date.parse(payload.e) !== Date.parse(parsed.exp ?? ""))) throw unavailable();
  return { ...parsed, created_at: new Date(parsed.created_at).toISOString(), exp: parsed.exp ? new Date(parsed.exp).toISOString() : null };
}

export async function readSharedLedger(context: SharedLinkContext): Promise<LinkLedger> {
  try {
    // Customer reads use request JWT/RLS; the established service fallback has explicit identity predicates.
    const db = requestScopedClient(context.requestId) ?? requireServiceClient();
    const rows: IssuedLink[] = []; const seen = new Set<string>();
    // PostgREST caps result sets; page explicitly so an old revocable link
    // cannot silently disappear after enough results-page visits.
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const page = await db.from("issued_request_links").select("*").eq("request_id", context.requestId)
        .eq("tenant_id", context.tenantId).order("created_at").order("link_id").range(offset, offset + pageSize - 1);
      if (page.error || !Array.isArray(page.data)) throw unavailable();
      for (const raw of page.data) {
        const row = issued(raw, context);
        if (seen.has(row.link_id)) throw unavailable();
        seen.add(row.link_id); rows.push(row);
      }
      if (page.data.length < pageSize) break;
    }
    const keep = await db.from("request_keep_state").select("*").eq("request_id", context.requestId)
      .eq("tenant_id", context.tenantId).maybeSingle();
    if (keep.error) throw unavailable();
    const state: KeepState | null = keep.data ? keepSchema.parse(owned(keep.data, context)) : null;
    return { request_id: context.requestId, links: rows, keep: state && { ...state,
      confirmed_at: state.confirmed_at ? new Date(state.confirmed_at).toISOString() : null } };
  } catch { throw unavailable(); }
}

/** Service-only RPCs resolve the real request/tenant, lock its intake row, and enforce CAS in SQL. */
export async function recordSharedLink(context: SharedLinkContext, link: IssuedLink): Promise<IssuedLink> {
  try {
    const { data, error } = await requireServiceClient().rpc("register_request_link", { ...identity(context), p_link: link });
    if (error) throw unavailable();
    return issued(data, context);
  } catch { throw unavailable(); }
}
export async function requestSharedKeep(context: SharedLinkContext, keep: { email_id: string | null; magic_id: string }): Promise<void> {
  try {
    const { error, data } = await requireServiceClient().rpc("register_request_keep", {
      ...identity(context), p_email_id: keep.email_id, p_magic_id: keep.magic_id,
    });
    // A stale concurrent submission must not overwrite the currently authoritative claim.
    if (error || data !== true) throw unavailable();
  } catch { throw unavailable(); }
}
export async function confirmSharedKeep(context: SharedLinkContext, magicId: string, at: string, owner: IssuedLink | null): Promise<boolean> {
  try {
    const { error, data } = await requireServiceClient().rpc("confirm_request_keep", {
      ...identity(context), p_magic_id: magicId, p_at: at, p_owner_link: owner,
    });
    if (error || typeof data !== "boolean") throw unavailable();
    return data;
  } catch { throw unavailable(); }
}
