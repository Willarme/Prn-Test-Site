import { IntentPage, PageSpec } from "@/domain/search/pages";
import type { ReleaseDecision } from "@/domain/search/qa";
import assetReceipt from "../../../config/ac-door-assets.json";

export type SitemapKind = "pages" | "images";

/** Server-owned evidence for one exact publication, never a request payload.
 * The current publish store's page-ID-only read cannot supply this contract.
 * A production adapter must join the exact published version to the registry,
 * a freshly evaluated existing release gate, and the route that actually serves
 * that version. A matching QA spec ID alone is not proof against a mutated or
 * cached payload; the adapter must use one consistent server-owned snapshot.
 */
export interface SitemapPublication {
  page: IntentPage;
  spec: PageSpec;
  published: { page_id: string; page_spec_id: string; canonical_path: string };
  decision: ReleaseDecision;
  renderer: { page_spec_id: string; canonical_path: string; indexable: boolean };
}

export interface PublicSitemapEntry {
  loc: string;
  lastmod: string;
  images: string[];
}

function servingOrigin(origin: string): string {
  const url = new URL(origin);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("A credential-free HTTP serving origin is required.");
  }
  return url.origin;
}

function canonicalPath(path: string): boolean {
  // Restrict publication to the actual problem-door route family. Other route
  // families need their own reviewed public renderer before this can expand.
  return /^\/problems\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path);
}

/** Pure preparation for production membership. It does not publish a page or
 * discover readiness from a page ID, cached PASS, URL list, or environment flag.
 * Conflicting candidates are all omitted: array order must never pick a winner.
 */
export function selectPublicSitemapEntries(
  origin: string,
  publications: readonly SitemapPublication[],
): PublicSitemapEntry[] {
  const base = servingOrigin(origin);
  const counts = (key: (item: SitemapPublication) => string) => {
    const values = new Map<string, number>();
    for (const item of publications) values.set(key(item), (values.get(key(item)) ?? 0) + 1);
    return values;
  };
  const pageCounts = counts((item) => item.page.page_id);
  const pathCounts = counts((item) => item.page.canonical_path);
  const specCounts = counts((item) => item.spec.page_spec_id);
  const entries: PublicSitemapEntry[] = [];
  for (const candidate of publications) {
    const parsedPage = IntentPage.safeParse(candidate.page);
    const parsedSpec = PageSpec.safeParse(candidate.spec);
    if (!parsedPage.success || !parsedSpec.success) continue;
    const page = parsedPage.data, spec = parsedSpec.data;
    if (pageCounts.get(page.page_id) !== 1 || pathCounts.get(page.canonical_path) !== 1 ||
        specCounts.get(spec.page_spec_id) !== 1) continue;
    if (page.lifecycle_status !== "PUBLISHED" || !page.published_at || page.retired_at || page.redirect_to_path ||
        !["QA_PASS", "PUBLISHED"].includes(spec.status) || !canonicalPath(page.canonical_path) ||
        page.page_id !== spec.page_id || page.current_page_spec_id !== spec.page_spec_id ||
        page.canonical_path !== spec.canonical_path || (page.tenant_id ?? "prn") !== "prn" || (spec.tenant_id ?? "prn") !== "prn") continue;
    if (candidate.published.page_id !== page.page_id || candidate.published.page_spec_id !== spec.page_spec_id ||
        candidate.published.canonical_path !== page.canonical_path ||
        candidate.renderer.page_spec_id !== spec.page_spec_id || candidate.renderer.canonical_path !== page.canonical_path ||
        !candidate.renderer.indexable || !spec.indexed || spec.noindex_reason !== null) continue;
    if (spec.qa.state !== "PASS" || spec.qa.ai_critic?.status === "FAIL" || !candidate.decision.release_eligible ||
        candidate.decision.qa.page_spec_id !== spec.page_spec_id || candidate.decision.qa.state !== "PASS" ||
        !candidate.decision.qa.release_eligible) continue;

    // Frozen v43 dates describe the reviewed content version. Publishing,
    // deployment, filesystem checkout, and request time are not content edits.
    const lastmod = spec.door_template?.content_date ?? spec.updated_at ?? spec.created_at;
    const publishedAt = Date.parse(page.published_at), createdAt = Date.parse(spec.created_at);
    if (createdAt > publishedAt || Date.parse(page.created_at) > publishedAt ||
        (spec.updated_at && (Date.parse(spec.updated_at) < createdAt || Date.parse(spec.updated_at) > publishedAt)) ||
        !Number.isFinite(Date.parse(lastmod)) || Date.parse(lastmod) > publishedAt) continue;
    const images = spec.door_template ? assetReceipt.assets.filter((asset) =>
      spec.door_template!.visual_assets.some((reviewed) => reviewed.raster_path === asset.png &&
        reviewed.width === asset.width && reviewed.height === asset.height),
    ).map((asset) => new URL(asset.png, base).href) : [];
    entries.push({ loc: new URL(page.canonical_path, base).href, lastmod, images: [...new Set(images)] });
  }
  return entries.sort((a, b) => a.loc.localeCompare(b.loc));
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function renderPublicSitemap(entries: readonly PublicSitemapEntry[], kind: SitemapKind): string {
  const rows = entries.filter((entry) => kind === "pages" || entry.images.length > 0).map((entry) =>
    "  <url><loc>" + xml(entry.loc) + "</loc><lastmod>" + xml(entry.lastmod) + "</lastmod>" +
    (kind === "images" ? entry.images.map((image) => "<image:image><image:loc>" + xml(image) + "</image:loc></image:image>").join("") : "") + "</url>",
  );
  if (!rows.length) throw new Error("No eligible sitemap entries; return a held/empty HTTP response, not schema-invalid XML.");
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' +
    (kind === "images" ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : "") + ">\n" +
    rows.join("\n") + (rows.length ? "\n" : "") + "</urlset>\n";
}

/** robots.ts disallows all crawling and the real problem route hardcodes
 * noindex. There is currently no eligible publication set to serialize.
 * Both official sitemap XSDs require entries; HTTP 204 avoids claiming that an
 * empty urlset or index is a valid production sitemap.
 * https://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd
 * https://www.sitemaps.org/schemas/sitemap/0.9/siteindex.xsd
 * Keep this independent of runtime stores and deployment environment flags.
 * Production activation still requires the exact-version adapter described
 * above plus the separately reviewed indexability/launch change.
 */
export function previewSitemapResponse(): Response {
  return new Response(null, { status: 204, headers: {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "X-PRN-Publication-State": "held-noindex",
  } });
}
