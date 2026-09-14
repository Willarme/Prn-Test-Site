import { NextResponse, type NextRequest } from "next/server";
import { requiredFeaturesForPath } from "@/platform/features/registry";

/**
 * The frozen source remains byte-identical in public/feature, but every public
 * entry reaches the receipt-aware preview adapter. Middleware precedes public
 * file serving. Decode before checking the boundary because Next's public-file
 * resolver also accepts percent-encoded path prefixes. All other requests pass
 * through unchanged, including admin/SEO routes owned elsewhere.
 */
const PREVIEWS: Record<string, string> = {
  "One Connected Home.dc.html": "overview",
  "Dashboard v3.dc.html": "dashboard",
  "Trust Network v3.dc.html": "trust-network",
  "Home Memory v2.dc.html": "home-memory",
  "SmartQuote v3.dc.html": "smartquote",
  "Provider OS v2.dc.html": "provider-os",
};

export async function middleware(request: NextRequest): Promise<Response> {
  let pathname: string;
  try { pathname = decodeURIComponent(request.nextUrl.pathname); }
  catch { return new NextResponse("not found", { status: 404, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" } }); }
  if ((pathname.startsWith("/problems/") && pathname.replace(/\/+$/, "") !== "/problems/ac-blowing-warm-air") || pathname.startsWith("/media/door-v44/")) {
    const { doorV44RuntimeResponse } = await import("@/platform/pages/door-v44-runtime-public");
    const selected = await doorV44RuntimeResponse(request);
    if (selected) return selected;
  }
  if (pathname !== "/feature" && !pathname.startsWith("/feature/")) {
    // Most assets, admin paths and unclassified routes never load the store.
    if (!requiredFeaturesForPath(request.nextUrl.pathname).length) return NextResponse.next();
    const { featureRouteRefusal } = await import("@/platform/features/state");
    try {
      const refusal = await featureRouteRefusal(pathname, { api: pathname.startsWith("/api/") || !["GET", "HEAD"].includes(request.method) });
      return refusal ?? NextResponse.next();
    } catch {
      return new NextResponse("not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
    }
  }
  const file = pathname.slice("/feature/".length);
  const destination = Object.hasOwn(PREVIEWS, file) ? PREVIEWS[file] :
    /^(?:support\.js|vendor\/(?:react|react-dom|babel)\.js)$/.test(file) ? file : null;
  if (!destination) return new NextResponse("not found", { status: 404 });
  if (!["GET", "HEAD"].includes(request.method)) {
    return new NextResponse(null, { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
  }
  const url = request.nextUrl.clone();
  url.pathname = `/pages/${destination}`;
  return NextResponse.redirect(url, 307);
}

export const config = { matcher: ["/:path*"], runtime: "nodejs" };
