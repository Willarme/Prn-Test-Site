import { MEDIA_ALLOWLIST, localMediaFile, mediaStore } from "@/platform/adapters/media-storage";
import { loadJourneyContext } from "@/platform/intake/complete";
import { stripImageMetadata } from "@/platform/media/exif";
import { verifyLinkForRoute as verifyLink } from "@/platform/links/tokens";

/**
 * /media/<token>/<evidence_id> — THE BYTES (track P3).
 *
 * Serves one photo or video from the journey behind the token. Two scopes
 * open it, both read-only and both bound to the same request: "media" (the
 * provider link) and "keep" (the homeowner's own record page rendering its
 * thumbnails). Any other scope, a revoked link, an expired one, a forged
 * one, or an evidence id from some other journey: 404, with nothing in the
 * body that says which.
 *
 * DECISION 7'S CONDITION. Every JPEG passes through stripImageMetadata
 * before a byte leaves: GPS, timestamp, device, embedded thumbnail, XMP, all
 * gone. A JPEG the stripper cannot walk cleanly is refused rather than
 * served, because a file whose segments could not be enumerated is a file
 * whose metadata could not be proven gone (src/platform/media/exif.ts). PNG
 * and WebP pass through as the stripper documents (phones write JPEG).
 *
 * Cache-Control: private, no-store. Nothing between the store and the
 * viewer keeps a copy.
 */
export const dynamic = "force-dynamic";

const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MEDIA_ALLOWLIST).map(([mime, ext]) => [ext, mime])
);

function notFound(): Response {
  return new Response("not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

async function readBytes(storageRef: string): Promise<Buffer | null> {
  const local = localMediaFile(storageRef);
  if (local) return local;
  // Supabase-backed media: a short-lived signed URL, fetched server-side so
  // the viewer never sees the bucket and the strip still happens here.
  const url = await mediaStore().signedUrl(storageRef, 60);
  if (!url || !/^https?:\/\//.test(url)) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; evidence_id: string }> }
): Promise<Response> {
  const { token, evidence_id } = await params;
  const link = await verifyLink(token);
  if (!link.ok || (link.scope !== "media" && link.scope !== "keep")) return notFound();

  const ctx = await loadJourneyContext(link.request_id);
  if (!ctx) return notFound();
  const evidence = ctx.allEvidence.find(
    (e) => e.evidence_id === evidence_id && (e.kind === "photo" || e.kind === "video")
  );
  if (!evidence) return notFound();

  const raw = await readBytes(evidence.content);
  if (!raw) return notFound();

  const ext = evidence.content.split(".").pop()?.toLowerCase() ?? "";
  const mime = evidence.mime ?? EXT_TO_MIME[ext] ?? "application/octet-stream";

  let bytes = raw;
  if (evidence.kind === "photo") {
    const stripped = stripImageMetadata(raw, mime);
    if (!stripped.ok) return notFound();
    bytes = stripped.bytes;
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename="${evidence.evidence_id}.${ext || "bin"}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
