import { describe, expect, it, vi } from "vitest";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { PageSpec } from "@/domain/search/pages";
import { getV43DoorBinding, v43SpecFields } from "@/domain/search/door-template";
import { registryRowFor } from "@/domain/search/page-registry";
import { evaluateReleaseForPublish } from "@/domain/search/qa";
import { GET as pageSitemap } from "@/app/sitemap.xml/route";
import { GET as imageSitemap } from "@/app/image-sitemap.xml/route";
import { renderPublicSitemap, selectPublicSitemapEntries, type SitemapPublication } from "@/platform/pages/public-sitemaps";
import assets from "../config/ac-door-assets.json";

// These stores must never be consulted by the currently held sitemap routes.
vi.mock("@/platform/search/page-registry-store", () => ({ pageRegistryStore: () => { throw new Error("Unexpected registry read"); } }));
vi.mock("@/platform/stores/runtime", () => ({ runtimeStore: () => { throw new Error("Unexpected runtime read"); } }));

const origin = "https://preview.example";
function fixture(v43 = false): SitemapPublication {
  const spec = PageSpec.parse({ ...SAMPLE_PAGE_SPEC,
    ...(v43 ? { ...v43SpecFields(), door_template: getV43DoorBinding(), primary_query: "ac blowing warm air" } : {}),
    status: "QA_PASS", indexed: true, noindex_reason: null, qa: { state: "PASS", reasons: [] },
    updated_at: "2026-09-06T01:02:03Z",
  });
  const actual = evaluateReleaseForPublish(spec);
  return {
    spec,
    page: { ...registryRowFor(spec, spec.created_at), lifecycle_status: "PUBLISHED", published_at: "2026-09-06T10:00:00Z" },
    published: { page_id: spec.page_id, page_spec_id: spec.page_spec_id, canonical_path: spec.canonical_path },
    // Synthetic eligibility isolates membership tests; it does NOT establish a
    // real v43 PASS. The real current verdict is separately tested below.
    decision: { ...actual, release_eligible: true, qa: { ...actual.qa, state: "PASS", release_eligible: true } },
    renderer: { page_spec_id: spec.page_spec_id, canonical_path: spec.canonical_path, indexable: true },
  };
}

describe("held public sitemap routes", () => {
  it.each([pageSitemap, imageSitemap])("returns explicit held HTTP204 without consulting runtime stores", async (get) => {
    const response = get();
    expect(response.status).toBe(204);
    expect(response.headers.get("x-prn-publication-state")).toBe("held-noindex");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const body = await response.text();
    expect(body).toBe("");
  });
});

describe("exact publication sitemap selection", () => {
  it("uses content modification time, never publication or request time", () => {
    const item = fixture();
    expect(selectPublicSitemapEntries(origin, [item])).toEqual([{
      loc: origin + item.spec.canonical_path, lastmod: item.spec.updated_at, images: [],
    }]);
    item.spec.updated_at = null;
    expect(selectPublicSitemapEntries(origin, [item])[0].lastmod).toBe(item.spec.created_at);
  });
  it("binds v43 lastmod and image URLs to the reviewed content metadata", () => {
    const item = fixture(true);
    const entries = selectPublicSitemapEntries(origin, [item]);
    expect(entries).toHaveLength(1);
    expect(entries[0].lastmod).toBe(getV43DoorBinding().content_date);
    expect(entries[0].images).toEqual(assets.assets.map((asset) => origin + asset.png));
    expect(renderPublicSitemap(entries, "images")).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
    expect(renderPublicSitemap(entries, "images").match(/<image:loc>/g)).toHaveLength(3);
  });
  it("excludes the actual rejected v43 draft even if a publication record is inconsistent", () => {
    const item = fixture(true);
    item.decision = evaluateReleaseForPublish(item.spec);
    expect(item.decision.release_eligible).toBe(false);
    expect(selectPublicSitemapEntries(origin, [item])).toEqual([]);
  });
  it.each([
    ["staged registry", (item: SitemapPublication) => { item.page.lifecycle_status = "STAGED"; }],
    ["staged spec", (item: SitemapPublication) => { item.spec.status = "STAGED"; }],
    ["QA failure", (item: SitemapPublication) => { item.spec.qa.state = "FAIL"; }],
    ["release hold", (item: SitemapPublication) => { item.decision.release_eligible = false; }],
    ["stale QA", (item: SitemapPublication) => { item.decision.qa.page_spec_id = "old-version"; }],
    ["stale registry", (item: SitemapPublication) => { item.page.current_page_spec_id = "old-version"; }],
    ["stale publication", (item: SitemapPublication) => { item.published.page_spec_id = "old-version"; }],
    ["stale renderer", (item: SitemapPublication) => { item.renderer.page_spec_id = "old-version"; }],
    ["noindexed renderer", (item: SitemapPublication) => { item.renderer.indexable = false; }],
    ["noindexed spec", (item: SitemapPublication) => { item.spec.indexed = false; item.spec.noindex_reason = "held"; }],
    ["retired page", (item: SitemapPublication) => { item.page.retired_at = "2026-09-06T11:00:00Z"; }],
    ["redirect page", (item: SitemapPublication) => { item.page.redirect_to_path = "/problems/new"; }],
    ["off-origin canonical", (item: SitemapPublication) => { item.page.canonical_path = "https://outside.invalid/private"; }],
    ["malformed canonical", (item: SitemapPublication) => { item.page.canonical_path = "/problems/ac?token=secret"; }],
    ["private route", (item: SitemapPublication) => { item.page.canonical_path = item.spec.canonical_path = item.published.canonical_path = item.renderer.canonical_path = "/admin/pages"; }],
    ["unserved route", (item: SitemapPublication) => { item.renderer.canonical_path = "/problems/other"; }],
    ["missing publication date", (item: SitemapPublication) => { item.page.published_at = null; }],
    ["another tenant", (item: SitemapPublication) => { item.page.tenant_id = item.spec.tenant_id = "other"; }],
    ["invalid date", (item: SitemapPublication) => { item.spec.updated_at = "not-a-date"; }],
    ["unpublished content change", (item: SitemapPublication) => { item.spec.updated_at = "2026-09-07T01:00:00Z"; }],
    ["impossible content chronology", (item: SitemapPublication) => { item.spec.updated_at = "2020-01-01T01:00:00Z"; }],
  ] as const)("omits %s", (_label, mutate) => {
    const item = fixture(); mutate(item);
    expect(selectPublicSitemapEntries(origin, [item])).toEqual([]);
  });
  it("does not choose a winner among duplicate or conflicting versions", () => {
    const first = fixture(), second = fixture();
    second.spec.page_spec_id = "another-version";
    expect(selectPublicSitemapEntries(origin, [first, second])).toEqual([]);
    expect(selectPublicSitemapEntries(origin, [first, first])).toEqual([]);
  });
  it.each(["https://user:password@example.com", "javascript:alert(1)", "https://example.com/path", "https://example.com?token=secret"])("rejects unsafe serving origin %s", (unsafe) => {
    expect(() => selectPublicSitemapEntries(unsafe, [fixture()])).toThrow();
  });
  it("escapes XML values and omits image rows when no reviewed images exist", () => {
    expect(renderPublicSitemap([{ loc: "https://example.com/a?b=1&c=2", lastmod: "2026-09-06", images: [] }], "pages"))
      .toContain("https://example.com/a?b=1&amp;c=2");
    expect(() => renderPublicSitemap(selectPublicSitemapEntries(origin, [fixture()]), "images")).toThrow(/No eligible sitemap entries/);
  });
});
