import { previewSitemapResponse } from "@/platform/pages/public-sitemaps";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return previewSitemapResponse();
}
