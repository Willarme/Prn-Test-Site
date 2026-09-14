import { z } from "zod";
import { guardAdminRead, guardAdminMutation } from "@/platform/admin/request";
import { readAdminJson } from "@/platform/admin/body";
import { createDoorRun, advanceDoorRun, readDoorRun, doorRunCatalog, DoorRunServiceError } from "@/platform/admin/door-page-runs";

export const doorRunCreateSchema = z.object({
  mode: z.enum(["fixture", "live"]), dry_run: z.boolean(),
  opportunity_ids: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)).min(1).max(11),
  count: z.number().int().min(1).max(11), reason: z.string().trim().min(3).max(240),
}).strict().refine(v => v.count === v.opportunity_ids.length && new Set(v.opportunity_ids).size === v.count)
  .refine(v => v.mode !== "fixture" || v.opportunity_ids.every(id => /^F(?:0[1-9]|1[01])$/.test(id)));
const advanceSchema = z.object({ expected_revision: z.number().int().nonnegative().max(2147483646) }).strict();
const keySchema = z.string().uuid();
const runSchema = z.string().regex(/^run-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
function wrap(request: Request, response: Response) {
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers: response.headers });
}
function error(code: string, status: number, details?: unknown) { return Response.json({ error: code, ...(details ? { details } : {}) }, { status }); }
type Params = () => Promise<{ run_id: string }>;
/** Authentication precedes parameters, body parsing, package IO and stores. */
export async function serveDoorRuns(request: Request, operation: "create" | "read" | "advance" | "fixtures", params?: Params): Promise<Response> {
  try {
    const mutation = operation === "create" || operation === "advance";
    const denial = mutation && request.method === "POST" ? await guardAdminMutation(request) : await guardAdminRead(request);
    if (denial) return wrap(request, denial);
    if (mutation ? request.method !== "POST" : !["GET", "HEAD"].includes(request.method)) {
      const denied = error("METHOD_NOT_ALLOWED", 405); denied.headers.set("Allow", mutation ? "POST" : "GET, HEAD"); return wrap(request, denied);
    }
    if (operation === "fixtures") return wrap(request, Response.json(await doorRunCatalog()));
    if (operation === "create") {
      const key = keySchema.safeParse(request.headers.get("idempotency-key"));
      if (!key.success) return wrap(request, error("IDEMPOTENCY_KEY_INVALID", 400));
      const body = await readAdminJson(request, doorRunCreateSchema, 8192);
      if (!body.ok) return wrap(request, body.response);
      return wrap(request, Response.json({ run: await createDoorRun(key.data.toLowerCase(), body.data) }, { status: 202 }));
    }
    const raw = await params?.(); const parsed = runSchema.safeParse(raw?.run_id);
    if (!parsed.success) return wrap(request, error("RUN_NOT_FOUND", 404));
    if (operation === "read") return wrap(request, Response.json({ run: await readDoorRun(parsed.data) }));
    const body = await readAdminJson(request, advanceSchema, 1024);
    if (!body.ok) return wrap(request, body.response);
    return wrap(request, Response.json({ run: await advanceDoorRun(parsed.data, body.data.expected_revision) }));
  } catch (caught) {
    return wrap(request, caught instanceof DoorRunServiceError ? error(caught.code, caught.status, caught.details) : error("RUN_DEPENDENCY_UNAVAILABLE", 503));
  }
}
