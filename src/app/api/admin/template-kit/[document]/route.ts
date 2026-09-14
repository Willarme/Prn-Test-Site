import { guardAdminRead } from "@/platform/admin/request";
import { doorTemplateDocument } from "@/platform/admin/door-creator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Referrer-Policy": "no-referrer" };
async function respond(request: Request, context: { params: Promise<{ document: string }> }): Promise<Response> {
  try {
    const denied = await guardAdminRead(request);
    if (denied) { for (const [key, value] of Object.entries(headers)) denied.headers.set(key, value); return new Response(request.method === "HEAD" ? null : denied.body, { status: denied.status, headers: denied.headers }); }
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
    const { document } = await context.params;
    const doc = doorTemplateDocument(document);
    if (!doc) return new Response(request.method === "HEAD" ? null : "Document not found", { status: 404, headers });
    return new Response(request.method === "HEAD" ? null : doc.body, { headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${doc.filename}"`, "X-Content-SHA256": doc.sha256 } });
  } catch { return new Response(request.method === "HEAD" ? null : "The template document could not be loaded.", { status: 503, headers }); }
}
export const GET = respond;
export const HEAD = respond;
export const POST = respond;
export const PUT = respond;
export const PATCH = respond;
export const DELETE = respond;
export const OPTIONS = respond;
