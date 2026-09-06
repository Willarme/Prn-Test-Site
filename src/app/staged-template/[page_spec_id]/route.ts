import { allStagedSpecs } from "@/platform/admin/data";
import { renderV43DoorPage } from "@/platform/pages/v43-door-renderer";

export const dynamic = "force-dynamic";

/** Public draft preview, matching /staged's existing access boundary. Never publishes. */
export async function GET(request: Request, { params }: { params: Promise<{ page_spec_id: string }> }): Promise<Response> {
  const { page_spec_id } = await params;
  const spec = (await allStagedSpecs()).find(s => s.page_spec_id === page_spec_id);
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (!spec?.door_template) return new Response("Draft not found", { status: 404, headers });
  try {
    return new Response(renderV43DoorPage(spec, new URL(request.url).origin), { headers });
  } catch (error) {
    console.error("[v43-template] Verified preview could not render:",
      error instanceof Error ? (error.name === "ZodError" ? "Invalid frozen PageSpec" : error.message) : "Unknown render failure");
    return new Response("The reviewed template could not be verified. This draft cannot be rendered.", { status: 409, headers });
  }
}
