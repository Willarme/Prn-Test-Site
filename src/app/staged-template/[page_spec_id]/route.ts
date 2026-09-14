import { allStagedSpecs } from "@/platform/admin/data";
import { renderV43DoorPage } from "@/platform/pages/v43-door-renderer";
import { guardAdminRead } from "@/platform/admin/request";

export const dynamic = "force-dynamic";

function privatePreview(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

/** Authenticated preview of a frozen v43 specification, not a v44 run preview. */
export async function GET(request: Request, context: { params: Promise<{ page_spec_id: string }> }): Promise<Response> {
  try {
    const refusal = await guardAdminRead(request);
    if (refusal) return privatePreview(refusal);
    const { page_spec_id } = await context.params;
    if (typeof page_spec_id !== "string" || !page_spec_id.length || page_spec_id.length > 200
      || [...page_spec_id].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
      return privatePreview(new Response("Draft not found", { status: 404 }));
    }
    const spec = (await allStagedSpecs()).find(s => s.page_spec_id === page_spec_id);
    if (!spec?.door_template) return privatePreview(new Response("Draft not found", { status: 404 }));
    try {
      return privatePreview(new Response(renderV43DoorPage(spec, new URL(request.url).origin), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }));
    } catch {
      return privatePreview(new Response("The reviewed template could not be verified. This draft cannot be rendered.", { status: 409 }));
    }
  } catch {
    return privatePreview(new Response("The preview could not be loaded. Try again later.", { status: 503 }));
  }
}
