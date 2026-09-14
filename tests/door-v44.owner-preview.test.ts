import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse, resolve, sep } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";
import { compileDoorV44Page } from "@/domain/search/door-v44/compiler";
import { writeDoorV44Artifact } from "@/domain/search/door-v44/artifact-store";
import { doorPageVersionStore } from "@/platform/search/door-page-version-store";
import { registerDoorPageArtifact } from "@/platform/search/door-page-version-service";
import { sessionCookie } from "@/platform/admin/auth";
import { readDevDb } from "@/platform/stores/dev-db";
import { doorCreatorPreviewHref } from "@/platform/admin/door-creator-preview";
import * as pageRoute from "@/app/admin/page-creator/[page_id]/versions/[version]/preview/route";
import * as assetRoute from "@/app/admin/page-creator/[page_id]/versions/[version]/preview/assets/[asset]/route";

const mocks = vi.hoisted(() => ({ cookie: "", provider: vi.fn((): unknown => null) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => mocks.cookie ? { value: mocks.cookie } : undefined }) }));
vi.mock("@/platform/db/client", () => ({ serviceClientProvider: mocks.provider }));

let root: string, artifactRoot: string;
const pageId = "fixture.f04", password = "synthetic-preview-owner-password";
const audit = { actor: "system:synthetic-preview", reason: "Nonpublic offline preview test only", at: "2026-09-13T20:00:00.000Z" };
async function build(version: number, tenant = "prn", id = pageId) {
  const fixture = await compilerFixture();
  const { spec, context } = JSON.parse(JSON.stringify(fixture).replaceAll('"fixture.tenant"', JSON.stringify(tenant)).replaceAll('"fixture.f04"', JSON.stringify(id))) as typeof fixture;
  spec.identity.page_version = version; spec.identity.page_id = id;
  const store = doorPageVersionStore(() => null), operation_id = `preview-${version}`;
  await store.reserveVersion({ tenant_id: tenant, page_id: id, canonical_intent_id: spec.identity.canonical_intent_id,
    canonical_url: new URL(spec.identity.canonical_path, spec.head.site.origin).href, operation_id, expected_latest_version: version - 1, ...audit });
  const compiled = await compileDoorV44Page(spec, context);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));
  const saved = await writeDoorV44Artifact(artifactRoot, compiled);
  if (!saved.ok) throw new Error(JSON.stringify(saved.errors));
  await registerDoorPageArtifact(store, artifactRoot, { tenant_id: tenant, page_id: id, operation_id, artifact_hash: saved.artifact_hash, ...audit });
  return saved;
}
let first: Awaited<ReturnType<typeof build>>, second: Awaited<ReturnType<typeof build>>;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "door-owner-preview-")); artifactRoot = join(root, "artifacts");
  vi.stubEnv("PRN_DEV_DB_PATH", join(root, "records.json")); vi.stubEnv("PRN_DOOR_V44_ARTIFACT_ROOT", artifactRoot);
  vi.stubEnv("ADMIN_PASSWORD", password);
  first = await build(1); second = await build(2); await build(1, "foreign", "foreign-only");
});
beforeEach(() => { mocks.cookie = sessionCookie(password).value; mocks.provider.mockClear(); vi.stubEnv("PRN_DOOR_V44_ARTIFACT_ROOT", artifactRoot); });
afterAll(() => {
  vi.unstubAllEnvs(); const checked = resolve(root);
  if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.includes("door-owner-preview-")) throw new Error("unsafe fixture cleanup");
  rmSync(checked, { recursive: true, force: true });
});
function request(method = "GET") { return new Request("https://owner.example/admin/page-creator/fixture.f04/versions/1/preview", { method }); }
function context(version = "1", page_id = pageId) { return { params: Promise.resolve({ page_id, version }) }; }
function assetContext(asset = first.compiled.assets[0].path.split("/").at(-1)!, version = "1") {
  return { params: Promise.resolve({ page_id: pageId, version, asset }) };
}
function privateHeaders(response: Response) {
  expect(response.headers.get("Cache-Control")).toContain("private, no-store");
  expect(response.headers.get("X-Robots-Tag")).toContain("noindex, nofollow");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Content-Security-Policy")).toContain("form-action 'none'");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
}
describe("authenticated exact immutable v44 owner previews (synthetic artifacts only)", () => {
  it("authenticates before resolving parameters or constructing the store on both routes", async () => {
    mocks.cookie = "";
    const forbidden = { get params(): Promise<{ page_id: string; version: string; asset: string }> { throw new Error("private params read"); } };
    for (const route of [pageRoute, assetRoute]) {
      const result = await route.GET(request(), forbidden); expect(result.status).toBe(403); privateHeaders(result);
      expect(await result.text()).not.toContain("private params");
    }
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("uses actual owner sessions and refuses forged credentials for assets too", async () => {
    mocks.cookie += "0";
    expect((await pageRoute.GET(request(), context())).status).toBe(403);
    expect((await assetRoute.GET(request(), assetContext())).status).toBe(403);
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("returns version one after version two exists, changing only governed image URL attributes", async () => {
    const response = await pageRoute.GET(request(), context()); expect(response.status).toBe(200); privateHeaders(response);
    expect(response.headers.get("X-PRN-Artifact-SHA256")).toBe(first.artifact_hash);
    expect(response.headers.get("X-PRN-Artifact-SHA256")).not.toBe(second.artifact_hash);
    expect(response.headers.get("X-PRN-Preview-Remapping")).toBe("version-bound-assets");
    let restored = await response.text();
    for (const asset of new Map(first.compiled.assets.map(row => [row.url, row])).values()) {
      const privateUrl = `${doorCreatorPreviewHref(pageId, 1)}/assets/${asset.path.split("/").at(-1)}`;
      expect(restored).toContain(`src="${privateUrl}"`);
      restored = restored.replaceAll(privateUrl, asset.url);
    }
    expect(restored).toBe(first.compiled.html);
    expect(readFileSync(join(first.directory, "index.html"), "utf8")).toBe(first.compiled.html);
    expect(readDevDb().published_page_ids).toEqual([]);
    expect(readDevDb().door_page_selection_sets).toEqual([]);
  });
  it("serves only an image in the exact verified artifact with identical bytes", async () => {
    const response = await assetRoute.GET(request(), assetContext()); expect(response.status).toBe(200); privateHeaders(response);
    const asset = first.compiled.assets[0]; expect(response.headers.get("Content-Type")).toBe(asset.mime);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(asset.base64, "base64"));
    expect((await assetRoute.GET(request(), assetContext("0".repeat(64) + ".png"))).status).toBe(404);
    expect((await assetRoute.GET(request(), assetContext(undefined, "3"))).status).toBe(404);
  });
  it("HEAD independently verifies authorization and exact artifact but returns no body", async () => {
    for (const response of [await pageRoute.HEAD(request("HEAD"), context()), await assetRoute.HEAD(request("HEAD"), assetContext())]) {
      expect(response.status).toBe(200); expect(await response.text()).toBe(""); privateHeaders(response);
    }
    mocks.cookie = ""; const denied = await assetRoute.HEAD(request("HEAD"), assetContext());
    expect(denied.status).toBe(403); expect(await denied.text()).toBe("");
  });
  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const)("refuses %s without reading params or storage", async method => {
    const forbidden = { get params(): Promise<{ page_id: string; version: string; asset: string }> { throw new Error("read params"); } };
    for (const route of [pageRoute, assetRoute]) {
      const response = await route[method](request(method), forbidden);
      expect(response.status).toBe(405); expect(response.headers.get("Allow")).toBe("GET, HEAD"); privateHeaders(response);
    }
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it.each(["0", "01", "-1", "1.0", "1e0", "2147483647", "../1", "%31"])("rejects malformed version %s before store access", async version => {
    expect((await pageRoute.GET(request(), context(version))).status).toBe(400); expect(mocks.provider).not.toHaveBeenCalled();
  });
  it.each(["..", "../x", "%2e%2e", "page/child", "page:other", ""])("rejects malformed page id %s", async id => {
    expect((await pageRoute.GET(request(), context("1", id))).status).toBe(400); expect(mocks.provider).not.toHaveBeenCalled();
  });
  it.each(["../index.html", "index.html", "a".repeat(64) + ".svg", "%2fsecret.png", "a".repeat(64) + ".png?x=1"])("rejects ungoverned asset name %s", async asset => {
    expect((await assetRoute.GET(request(), assetContext(asset))).status).toBe(400); expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("never falls back from an absent version or leaks another tenant's candidate", async () => {
    expect((await pageRoute.GET(request(), context("3"))).status).toBe(404);
    expect((await pageRoute.GET(request(), context("1", "foreign-only"))).status).toBe(404);
  });
  it.each(["", "relative/artifacts", parse(resolve(tmpdir())).root])("fails closed on unavailable root configuration %s", async configured => {
    vi.stubEnv("PRN_DOOR_V44_ARTIFACT_ROOT", configured);
    const response = await pageRoute.GET(request(), context()); expect(response.status).toBe(503); privateHeaders(response);
    expect(await response.json()).toEqual({ error: "Preview unavailable" }); expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("fails both reads when saved HTML is corrupt and does not expose storage details", async () => {
    const path = join(first.directory, "index.html"), original = readFileSync(path);
    try {
      writeFileSync(path, "corrupt private body");
      for (const response of [await pageRoute.GET(request(), context()), await assetRoute.GET(request(), assetContext())]) {
        expect(response.status).toBe(503); privateHeaders(response); expect(await response.json()).toEqual({ error: "Preview unavailable" });
      }
    } finally { writeFileSync(path, original); }
  });
  it("refuses missing or tampered image bytes even when the registered version is present", async () => {
    const path = join(first.directory, "assets", first.compiled.assets[0].path.split("/").at(-1)!), original = readFileSync(path);
    try {
      unlinkSync(path);
      expect((await assetRoute.GET(request(), assetContext())).status).toBe(503);
      writeFileSync(path, Buffer.from("invalid private image"));
      const response = await assetRoute.GET(request(), assetContext()); expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "Preview unavailable" });
    } finally { writeFileSync(path, original); }
  });
  it("bounds unexpected storage failures without reflecting exceptions or private paths", async () => {
    mocks.provider.mockImplementationOnce(() => { throw new Error("private storage details " + root); });
    const response = await pageRoute.GET(request(), context()); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Preview unavailable" }); privateHeaders(response);
  });
  it("reads the exact SQL version and reservation rather than a potentially truncated history", async () => {
    const store = doorPageVersionStore(() => null);
    const version = await store.getVersion("prn", pageId, 1), reservation = await store.getReservation("prn", pageId, "preview-1");
    const queried: string[] = [];
    mocks.provider.mockReturnValueOnce({ from(table: string) {
      queried.push(table); const filters = new Map<string, unknown>();
      const query = {
        select(_columns: string, options: { count: string }) { expect(options.count).toBe("exact"); return query; },
        eq(key: string, value: unknown) { filters.set(key, value); return query; },
        order() { return query; },
        async range(start: number, end: number) {
          expect([start, end]).toEqual([0, 1]);
          expect(filters).toEqual(new Map<string, unknown>([["tenant_id", "prn"], ["page_id", pageId], ["page_version", 1]]));
          // The unfiltered history represents more than a server's default row
          // limit. Only the exact filtered read returns the requested record.
          return filters.has("page_version") ? { data: [table === "door_page_version" ? version : reservation], count: 1, error: null }
            : { data: [], count: 1500, error: null };
        },
      }; return query;
    } });
    const response = await pageRoute.GET(request(), context()); expect(response.status).toBe(200);
    expect(response.headers.get("X-PRN-Artifact-SHA256")).toBe(first.artifact_hash);
    expect(queried.sort()).toEqual(["door_page_version", "door_page_version_reservation"]);
  });
});
