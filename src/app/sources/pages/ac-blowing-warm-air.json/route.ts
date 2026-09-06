import { publicSourceReview } from "@/platform/search/source-review-store";

export const dynamic = "force-dynamic";

export function GET(): Response {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  try { return Response.json(publicSourceReview(), { headers }); }
  catch { return Response.json({ error: "Reviewed source evidence unavailable." }, { status: 503, headers }); }
}
