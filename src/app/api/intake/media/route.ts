import { NextResponse } from "next/server";
import { z } from "zod";
import { flagEnabled } from "@/platform/flags";
import { MEDIA_ALLOWLIST, localMediaFile } from "@/platform/adapters/media-storage";
import { attachMedia } from "@/platform/intake/media";
import { ownerAllowed } from "@/platform/links/owner";

/**
 * Photo/video upload for a journey. Private storage only; the response never
 * contains a public URL.
 *
 * TRANSPORT ONLY since 2026-09-05 (campaign track F1): the validation, the
 * photo cap, the step authorization, the evidence write, the label read and the
 * packet regeneration all live in `platform/intake/media.ts::attachMedia`, so
 * the door page's multipart adapter reaches the identical path. The request and
 * response shapes here are unchanged.
 */
const Meta = z.object({
  request_id: z.string().min(1),
  /** Required field this satisfies, or a diagnostic step id prefixed "step:". */
  target: z.string().min(1),
});

export async function POST(request: Request): Promise<NextResponse> {
  if (!flagEnabled("intake_shell_enabled"))
    return NextResponse.json({ error: "not enabled" }, { status: 404 });
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
  const meta = Meta.safeParse({ request_id: form.get("request_id"), target: form.get("target") });
  const file = form.get("file");
  if (!meta.success || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing request, target or file" }, { status: 400 });
  }
  const k = form.get("k");
  if (!(await ownerAllowed(meta.data.request_id, typeof k === "string" ? k : undefined))) {
    return NextResponse.json({ error: "Unknown request" }, { status: 404 });
  }

  const result = await attachMedia({
    request_id: meta.data.request_id,
    target: meta.data.target,
    file,
    source: "walkthrough",
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        ...(result.photos !== undefined ? { photos: result.photos } : {}),
        ...(result.max_photos !== undefined ? { max_photos: result.max_photos } : {}),
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
      },
      { status: result.status }
    );
  }
  return NextResponse.json({
    ok: true,
    evidence_id: result.evidence_id,
    ...(result.view ? { view: result.view } : {}),
  });
}

/** Local-dev only: serve a privately stored file back to the same app. */
export async function GET(request: Request): Promise<Response> {
  const ref = new URL(request.url).searchParams.get("ref");
  if (!ref || !ref.startsWith("local/")) return new Response("not found", { status: 404 });
  const requestId = ref.split("/")[1];
  if (!requestId || !(await ownerAllowed(requestId, new URL(request.url).searchParams.get("k") ?? undefined))) return new Response("not found", { status: 404 });
  const data = localMediaFile(ref);
  if (!data) return new Response("not found", { status: 404 });
  const ext = ref.split(".").pop() ?? "";
  const mime = Object.entries(MEDIA_ALLOWLIST).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": mime, "Cache-Control": "private, no-store" },
  });
}
