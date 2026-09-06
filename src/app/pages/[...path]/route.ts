import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { wirePreviewFeedback } from "@/platform/pages/preview-feedback";
import { rewriteInterPageLinks } from "@/platform/pages/inter-page-links";
import { addPreviewChrome } from "@/platform/pages/preview-chrome";

/**
 * MELISSA'S PRODUCT PREVIEW PAGES, SERVED VERBATIM.
 *
 * Six Claude Design concept previews (the vote block at the bottom of each is
 * the thing the trial is actually measuring) plus the runtime they need. Their
 * wording is APPROVED AND FROZEN. The adapter rewrites inter-page links and
 * connects feedback controls to confirmed persistence, including visible
 * retry states; it leaves the artwork and marketing copy intact.
 * The files link to each other by FILENAME
 * ("Dashboard v3.dc.html") and a filename is not a URL on this site.
 *
 * WHERE THE FILES LIVE. `public/feature/` — where they were already placed, and
 * the only copy. They are NOT duplicated into `content/pages/`: two copies of a
 * frozen document is two documents that can drift, and the one that drifts is
 * always the one nobody is looking at. Reported as a deviation from the brief's
 * assumed path rather than papered over.
 *
 * WHY A ROUTE AND NOT JUST THE STATIC PATH. Next already serves these at
 * `/feature/<filename>.dc.html`, links and all, so nothing is broken today.
 * What that cannot give is a clean shareable URL per concept — and the vote
 * block records `page`, so the URL a person was on when they voted is part of
 * the record. `/pages/dashboard` is that URL.
 */

const ROOT = join(process.cwd(), "public", "feature");

/** Route slug → the approved file, exactly as named. */
const PAGES: Record<string, string> = {
  overview: "One Connected Home.dc.html",
  dashboard: "Dashboard v3.dc.html",
  "trust-network": "Trust Network v3.dc.html",
  smartquote: "SmartQuote v3.dc.html",
  "home-memory": "Home Memory v2.dc.html",
  "provider-os": "Provider OS v2.dc.html",
};

/** The vendored runtime the pages import by relative path. */
const VENDOR: Record<string, string> = {
  "react.js": "react.js",
  "react-dom.js": "react-dom.js",
  "babel.js": "babel.js",
};

function notFound(): Response {
  return new Response("not found", { status: 404 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const { path } = await params;
  const segments = (path ?? []).filter((s) => s.length > 0 && !s.includes(".."));

  if (segments.length === 1 && segments[0] === "support.js") {
    return serveScript(join(ROOT, "support.js"));
  }
  if (segments.length === 2 && segments[0] === "vendor") {
    const file = VENDOR[segments[1]!];
    if (!file) return notFound();
    return serveScript(join(ROOT, "vendor", file));
  }
  if (segments.length === 1) {
    const file = PAGES[segments[0]!];
    if (!file) return notFound();
    let html: string;
    try {
      html = await readFile(join(ROOT, file), "utf-8");
    } catch {
      return notFound();
    }
    const wired = rewriteInterPageLinks(wirePreviewFeedback(html, file.replace(/\.dc\.html$/, "")));
    return new Response(addPreviewChrome(wired, segments[0]!), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
  return notFound();
}

async function serveScript(path: string): Promise<Response> {
  let body: Buffer;
  try {
    body = await readFile(path);
  } catch {
    return notFound();
  }
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      // Byte-identical vendored runtime; re-fetching 3 MB of Babel on every
      // page hop is the only thing that would make these previews feel slow.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
