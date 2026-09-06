import { NextResponse, type NextRequest } from "next/server";

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

export function middleware(request: NextRequest): NextResponse {
  let pathname: string;
  try { pathname = decodeURIComponent(request.nextUrl.pathname); }
  catch { return NextResponse.next(); }
  if (pathname !== "/feature" && !pathname.startsWith("/feature/")) return NextResponse.next();
  const file = pathname.slice("/feature/".length);
  const destination = Object.hasOwn(PREVIEWS, file) ? PREVIEWS[file] :
    /^(?:support\.js|vendor\/(?:react|react-dom|babel)\.js)$/.test(file) ? file : null;
  if (!destination) return new NextResponse("not found", { status: 404 });
  const url = request.nextUrl.clone();
  url.pathname = `/pages/${destination}`;
  return NextResponse.redirect(url, 307);
}

export const config = { matcher: ["/:path*"] };
