import { serveDoorCreatorPreview } from "@/platform/admin/door-creator-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ page_id: string; version: string }> };
export function GET(request: Request, context: Context) {
  return serveDoorCreatorPreview(request, () => context.params, "html");
}
export const HEAD = GET;
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;
