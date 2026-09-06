import { publicCapabilityManifest } from "@/platform/pages/public-capability-manifest";

export const dynamic = "force-dynamic";

export function GET(): Response {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  try {
    return Response.json(publicCapabilityManifest(), { headers });
  } catch {
    return Response.json({ error: "Reviewed capability manifest unavailable." }, { status: 503, headers });
  }
}
