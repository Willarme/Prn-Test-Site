import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/staged-template/[page_spec_id]/route";
import StagedDoorPage, { generateMetadata, dynamic } from "@/app/staged/[slug]/page";
import { compilePageSpec } from "@/domain/search/factory";
import type { SearchOpportunity } from "@/domain/search/contracts";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { renderV43DoorPage } from "@/platform/pages/v43-door-renderer";

const seams = vi.hoisted(() => ({ auth: vi.fn(), specs: vi.fn() }));
vi.mock("@/platform/admin/auth", () => ({ isAdminUnlocked: seams.auth }));
vi.mock("@/platform/admin/data", () => ({ allStagedSpecs: seams.specs }));
vi.mock("next/navigation", async importOriginal => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/platform/pages/v43-door-renderer", async importOriginal => {
  const actual = await importOriginal<typeof import("@/platform/pages/v43-door-renderer")>();
  return { ...actual, renderV43DoorPage: vi.fn(actual.renderV43DoorPage) };
});

const spec = compilePageSpec({
  search_opportunity_id: "so_private_preview_test", keyword: "ac blowing warm air", intent_type: "problem",
  problem_family_hint: "hvac", geography: { mode: "national", country: "US" }, intent_cluster_id: null,
} as SearchOpportunity, { now: () => "2026-09-06T00:00:00Z" });
const request = () => new Request("https://preview.example/staged-template/" + spec.page_spec_id);
const context = (page_spec_id = spec.page_spec_id) => ({ params: Promise.resolve({ page_spec_id }) });
const stagedContext = () => ({ params: Promise.resolve({ slug: "ac-blowing-warm-air" }) });

function privateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}

beforeEach(() => {
  vi.clearAllMocks();
  seams.auth.mockResolvedValue(true);
  seams.specs.mockResolvedValue([structuredClone(spec)]);
});

describe("authenticated creator preview groundwork", () => {
  it("denies anonymous callers before touching params, specifications or the renderer", async () => {
    seams.auth.mockResolvedValue(false);
    let reads = 0;
    const input = { get params(): Promise<{ page_spec_id: string }> { reads++; throw new Error("PRIVATE PARAMETER"); } };
    const response = await GET(request(), input);
    expect(response.status).toBe(403);
    privateHeaders(response);
    expect(await response.json()).toEqual({ error: "Owner sign-in required" });
    expect(reads).toBe(0);
    expect(seams.specs).not.toHaveBeenCalled();
    expect(renderV43DoorPage).not.toHaveBeenCalled();
    expect(seams.auth).toHaveBeenCalledWith(expect.any(Request));
  });

  it("renders the real verified v43 compiler output for an authenticated owner", async () => {
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    privateHeaders(response);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain('id="common-causes"');
    expect(html).toContain('id="sources-and-review"');
    expect(html).toContain('name="search_opportunity_id" value="so_private_preview_test"');
    expect(html).toContain('content="noindex,nofollow"');
    expect(renderV43DoorPage).toHaveBeenCalledOnce();
    expect(seams.auth.mock.invocationCallOrder[0]).toBeLessThan(seams.specs.mock.invocationCallOrder[0]);
  });

  it("rechecks authentication after a successful read instead of reusing its authorization", async () => {
    expect((await GET(request(), context())).status).toBe(200);
    seams.auth.mockResolvedValue(false);
    const response = await GET(request(), context());
    expect(response.status).toBe(403); privateHeaders(response);
    expect(seams.specs).toHaveBeenCalledOnce();
  });

  it.each(["", "x".repeat(201), "private\nidentity"])("refuses an invalid ID before reading the corpus: %s", async id => {
    const response = await GET(request(), context(id));
    expect(response.status).toBe(404); privateHeaders(response);
    expect(await response.text()).toBe("Draft not found");
    expect(seams.specs).not.toHaveBeenCalled();
  });

  it("does not expose unknown or non-v43 specifications through this renderer", async () => {
    for (const rows of [[], [SAMPLE_PAGE_SPEC]]) {
      seams.specs.mockResolvedValue(rows);
      const response = await GET(request(), context(rows[0]?.page_spec_id ?? "missing"));
      expect(response.status).toBe(404); privateHeaders(response);
      expect(await response.text()).toBe("Draft not found");
    }
    expect(renderV43DoorPage).not.toHaveBeenCalled();
  });

  it("returns bounded private failure when actual frozen-binding verification fails", async () => {
    const changed = structuredClone(spec);
    changed.door_template!.rendered_sha256 = "0".repeat(64);
    seams.specs.mockResolvedValue([changed]);
    const response = await GET(request(), context());
    expect(response.status).toBe(409); privateHeaders(response);
    expect(await response.text()).toBe("The reviewed template could not be verified. This draft cannot be rendered.");
  });

  it.each(["auth", "specs", "params"])("bounds %s failures without revealing backend details", async phase => {
    let input = context();
    if (phase === "auth") seams.auth.mockRejectedValue(new Error("PRIVATE AUTH DETAIL"));
    if (phase === "specs") seams.specs.mockRejectedValue(new Error("PRIVATE STORAGE DETAIL"));
    if (phase === "params") input = { get params(): Promise<{ page_spec_id: string }> { throw new Error("PRIVATE PARAMETER DETAIL"); } };
    const response = await GET(request(), input);
    expect(response.status).toBe(503); privateHeaders(response);
    expect(await response.text()).toBe("The preview could not be loaded. Try again later.");
    expect(renderV43DoorPage).not.toHaveBeenCalled();
    if (phase !== "specs") expect(seams.specs).not.toHaveBeenCalled();
  });
});

describe("staged page and metadata share the owner-only boundary", () => {
  it.each([false, "unavailable"])("exposes neither draft metadata nor body when authentication is %s", async state => {
    if (state === false) seams.auth.mockResolvedValue(false);
    else seams.auth.mockRejectedValue(new Error("PRIVATE AUTH DETAIL"));
    let reads = 0;
    const input = { get params(): Promise<{ slug: string }> { reads++; throw new Error("PRIVATE SLUG"); } };
    await expect(generateMetadata(input)).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    await expect(StagedDoorPage(input)).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(reads).toBe(0); expect(seams.specs).not.toHaveBeenCalled();
    expect(dynamic).toBe("force-dynamic");
  });

  it("retains the owner's draft metadata and redirects bound v43 pages to their authenticated preview", async () => {
    const metadata = await generateMetadata(stagedContext());
    expect(metadata).toMatchObject({ title: spec.title, description: spec.meta_description, robots: { index: false, follow: false } });
    await expect(StagedDoorPage(stagedContext())).rejects.toMatchObject({
      digest: `NEXT_REDIRECT;replace;/staged-template/${encodeURIComponent(spec.page_spec_id)};307;`,
    });
  });

  it("preserves nonretired legacy staged rendering for signed-in owners", async () => {
    const legacy = { ...structuredClone(SAMPLE_PAGE_SPEC), canonical_path: "/problems/private-owner-test" };
    seams.specs.mockResolvedValue([legacy]);
    const output = await StagedDoorPage({ params: Promise.resolve({ slug: "private-owner-test" }) });
    const html = renderToStaticMarkup(output);
    expect(html.length).toBeGreaterThan(1000);
    expect(html).toContain(renderToStaticMarkup(createElement("span", null, legacy.hero.headline)).slice(6, -7));
    expect(html).toContain("Staged preview — not published, not indexed, pending QA + owner approval");
    expect(seams.auth.mock.invocationCallOrder[0]).toBeLessThan(seams.specs.mock.invocationCallOrder[0]);
  });
});
