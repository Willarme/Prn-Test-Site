import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileDoorV44Page } from "@/domain/search/door-v44/compiler";
import { readDoorV44Artifact, writeDoorV44Artifact } from "@/domain/search/door-v44/artifact-store";
import { doorV44ArtifactFeaturesAllow, doorV44ArtifactResponse, doorV44SelectionResponse, verifyDoorV44ServingSnapshot, type DoorV44PublicArtifact, type DoorV44PublicContext } from "@/platform/pages/door-v44-public-response";
import type { DoorPageServingSnapshot } from "@/domain/search/door-v44/page-selection";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";
import { featureSnapshot } from "./helpers/feature-snapshot";
import { selectIssueLibrary, type IssueLibraryInput } from "@/platform/search/issue-library";
import { PageSpec, IntentPage } from "@/domain/search/pages";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";

let artifact: DoorV44PublicArtifact;
let root: string;
const context = (): DoorV44PublicContext => {
  const features = featureSnapshot({}, "LIVE");
  features.tenant_id = artifact.compiled.receipt.tenant_id;
  features.rows = new Map([...features.rows].map(([id, row]) => [id, { ...row, tenant_id: features.tenant_id }]));
  return { origin: new URL(artifact.compiled.receipt.canonical_url).origin, features };
};
const request = (path = artifact.compiled.receipt.canonical_url, method = "GET") => new Request(path, { method });
const response = (req = request(), candidate = artifact, ctx = context()) => doorV44ArtifactResponse(req, candidate, ctx);
function privateHeaders(result: Response) {
  expect(result.headers.get("cache-control")).toContain("no-store");
  expect(result.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(result.headers.get("x-content-type-options")).toBe("nosniff");
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "door-v44-public-response-"));
  const fixture = await compilerFixture();
  fixture.spec.release.index_policy = "trial_noindex";
  fixture.context.validation.index_policy = "trial_noindex";
  const compiled = await compileDoorV44Page(fixture.spec, fixture.context);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled));
  const written = await writeDoorV44Artifact(root, compiled);
  if (!written.ok) throw new Error(JSON.stringify(written));
  const read = await readDoorV44Artifact(root, compiled.receipt.artifact_hash);
  if (!read.ok) throw new Error(JSON.stringify(read));
  artifact = read;
});

/** Synthetic selected metadata tests this consumer, not the independent release gate. */
function selectionSnapshot(): DoorPageServingSnapshot {
  const r = artifact.compiled.receipt;
  return { tenant_id: r.tenant_id, revision: 1, guard_revision: 1, selection_sha256: "a".repeat(64),
    fence: { revision: 1, dependency_revision: 1, hold_revision: 1, dependencies_sha256: "a".repeat(64), environment_sha256: "b".repeat(64), holds_sha256: "c".repeat(64) },
    origin: context().origin, index_policy: "trial_noindex", as_of: new Date().toISOString(), guard_status: "current",
    managed: [{ page_id: r.page_id, canonical_path: new URL(r.canonical_url).pathname, kind: "catalog" }],
    entries: [{ page_id: r.page_id, page_version: r.page_version, reservation_id: "a".repeat(64), input_sha256: "b".repeat(64),
      artifact_hash: r.artifact_hash, compile_receipt_sha256: doorV44Hash(r), release_evaluation_sha256: "c".repeat(64),
      content_approval_sha256: "d".repeat(64), publish_action_sha256: "e".repeat(64), canonical_path: new URL(r.canonical_url).pathname,
      canonical_url: r.canonical_url, family_id: "cooling", family_path: "/cooling", label: "Synthetic fixture", related_page_ids: [], related_bindings: [],
      robots: "noindex,follow", valid_until: new Date(Date.now() + 60_000).toISOString(), sitemap_eligible: false }] };
}

describe("one verified selected membership set", () => {
  it("directory and family membership use the verified selected artifact label", async () => {
    const selected = await verifyDoorV44ServingSnapshot(selectionSnapshot(), context(), async () => artifact);
    const families = selectIssueLibrary({ snapshot: selected.context.features, selection: selected, corpus: { pages: [], specs: [] }, published: new Set(), fixed: [], seo_doors_enabled: false });
    expect(families[0].path).toBe("/cooling");
    expect(families[0].doors).toEqual([{ id: selected.entries[0].entry.page_id, path: selected.entries[0].entry.canonical_path, label: selected.entries[0].entry.label, kind: "selected_artifact" }]);
  });
  it("a managed tombstone suppresses a previously valid legacy directory version", async () => {
    const selected = await verifyDoorV44ServingSnapshot({ ...selectionSnapshot(), entries: [] }, context(), async () => artifact);
    const path = selected.snapshot.managed[0].canonical_path, tenant = selected.context.features.tenant_id;
    const spec = PageSpec.parse({ ...structuredClone(SAMPLE_PAGE_SPEC), tenant_id: tenant, page_id: "fixture_legacy", page_spec_id: "fixture_legacy_v1", canonical_path: path,
      status: "QA_PASS", qa: { state: "PASS", reasons: [] }, internal_links: [{ label: "Cooling", path: "/cooling" }] });
    const page = IntentPage.parse({ page_id: spec.page_id, schema_version: "1.0.0", tenant_id: tenant, canonical_path: path, current_page_spec_id: spec.page_spec_id,
      lifecycle_status: "PUBLISHED", published_at: "2026-09-13T00:00:00Z", retired_at: null, redirect_to_path: null, created_at: "2026-09-12T00:00:00Z" });
    const input: IssueLibraryInput = { snapshot: selected.context.features, corpus: { pages: [page], specs: [spec] }, published: new Set([spec.page_id]), fixed: [], seo_doors_enabled: true };
    expect(selectIssueLibrary(input).flatMap(row => row.doors).map(row => row.path)).toContain(path);
    expect(selectIssueLibrary({ ...input, selection: selected })).toEqual([]);
  });
  it("shares exact selected bytes between document and asset dispatch", async () => {
    const selected = await verifyDoorV44ServingSnapshot(selectionSnapshot(), context(), async () => artifact);
    expect(selected.entries).toHaveLength(1);
    expect(await doorV44SelectionResponse(request(), selected)!.text()).toBe(artifact.compiled.html);
    expect(doorV44SelectionResponse(request(artifact.compiled.assets[0].url), selected)?.status).toBe(200);
  });
  it.each(["reserved", "stale", "expired", "artifact-corrupt", "metadata-substituted"])("retains managed identity and refuses %s", async state => {
    const snapshot = selectionSnapshot();
    if (state === "reserved") snapshot.entries = [];
    if (state === "stale") snapshot.guard_status = "stale";
    if (state === "expired") snapshot.entries[0].valid_until = "2000-01-01T00:00:00.000Z";
    if (state === "metadata-substituted") snapshot.entries[0].compile_receipt_sha256 = "0".repeat(64);
    const selected = await verifyDoorV44ServingSnapshot(snapshot, context(), async () => state === "artifact-corrupt" ? { ok: false, errors: [{ code: "ARTIFACT_CORRUPT", pointer: "" }] } : artifact);
    expect(selected.entries).toEqual([]);
    expect(doorV44SelectionResponse(request(), selected)?.status).toBe(404);
    expect(doorV44SelectionResponse(request(artifact.compiled.assets[0].url), selected)?.status).toBe(404);
  });
  it("leaves definitively unmanaged legacy and the fixed AC route to their existing handlers", async () => {
    const snapshot = selectionSnapshot(); snapshot.guard_status = "unconfigured"; snapshot.entries = [];
    const selected = await verifyDoorV44ServingSnapshot(snapshot, context(), async () => artifact);
    expect(doorV44SelectionResponse(request(context().origin + "/problems/unmanaged-legacy"), selected)).toBeNull();
    expect(doorV44SelectionResponse(request(context().origin + "/problems/ac-blowing-warm-air"), selected)).toBeNull();
    expect(doorV44SelectionResponse(request(artifact.compiled.receipt.canonical_url, "POST"), selected)?.status).toBe(405);
  });
  it("never reads an artifact when current origin or feature authority disagrees", async () => {
    const read = vi.fn(async () => artifact), ctx = context(); ctx.features.verified = false;
    expect((await verifyDoorV44ServingSnapshot(selectionSnapshot(), ctx, read)).entries).toEqual([]);
    expect((await verifyDoorV44ServingSnapshot(selectionSnapshot(), { ...context(), origin: "https://other.example" }, read)).entries).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
  it("withdraws a page whose RELATED target cannot be served", async () => {
    const snapshot = selectionSnapshot(); snapshot.entries[0].related_page_ids = ["missing-target"];
    const selected = await verifyDoorV44ServingSnapshot(snapshot, context(), async () => artifact);
    expect(selected.entries).toEqual([]);
    expect(doorV44SelectionResponse(request(), selected)?.status).toBe(404);
  });
  it("rejects duplicate selected identities before allowing ambiguous membership", async () => {
    const snapshot = selectionSnapshot(); snapshot.entries.push(structuredClone(snapshot.entries[0]));
    await expect(verifyDoorV44ServingSnapshot(snapshot, context(), async () => artifact)).rejects.toThrow("Conflicting selection");
  });
});
afterAll(async () => {
  const checked = resolve(root);
  if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.includes("door-v44-public-response-")) throw new Error("Unsafe test cleanup");
  await rm(checked, { recursive: true, force: true });
});

describe("raw selected-artifact HTTP response", () => {
  it("returns the complete saved document without a Next layout or request-time changes", async () => {
    const result = response(request(artifact.compiled.receipt.canonical_url + "?error=consent&untrusted=anything"));
    expect(result.status).toBe(200);
    expect(await result.text()).toBe(artifact.compiled.html);
    expect(result.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(result.headers.get("content-length")).toBe(String(Buffer.byteLength(artifact.compiled.html)));
    expect(result.headers.get("etag")).toBe('"' + artifact.compiled.receipt.html_hash + '"');
    privateHeaders(result);
  });
  it("serves exact raster bytes only when this artifact references the requested path", async () => {
    for (const asset of artifact.compiled.assets) {
      const result = response(request(asset.url));
      expect(result.status).toBe(200);
      expect(Buffer.from(await result.arrayBuffer())).toEqual(Buffer.from(asset.base64, "base64"));
      expect(result.headers.get("content-type")).toBe(asset.mime);
      privateHeaders(result);
    }
    const result = response(request(context().origin + "/media/door-v44/" + "0".repeat(64) + ".png"));
    expect(result.status).toBe(404); privateHeaders(result);
  });
  it.each(["html", "asset"])("HEAD verifies %s and returns matching headers without bytes", async kind => {
    const url = kind === "html" ? artifact.compiled.receipt.canonical_url : artifact.compiled.assets[0].url;
    const get = response(request(url)), head = response(request(url, "HEAD"));
    expect(head.status).toBe(200); expect(await head.text()).toBe("");
    expect([...head.headers]).toEqual([...get.headers]);
  });
  it.each(["POST", "PUT", "DELETE"])("refuses %s with method and privacy headers", method => {
    const result = response(request(artifact.compiled.receipt.canonical_url, method));
    expect(result.status).toBe(405); expect(result.headers.get("allow")).toBe("GET, HEAD"); privateHeaders(result);
  });
  it("refuses foreign request origins even when forwarded headers claim the configured origin", () => {
    const req = new Request("https://foreign.example" + new URL(artifact.compiled.receipt.canonical_url).pathname,
      { headers: { "x-forwarded-host": new URL(context().origin).host } });
    expect(response(req).status).toBe(404);
    expect(response(request(), artifact, { ...context(), origin: "https://other.example" }).status).toBe(404);
  });
  it("refuses missing or credential-bearing origin configuration", () => {
    for (const origin of ["", "https://owner:private@example.com", context().origin + "/"]) {
      const result = response(request(), artifact, { ...context(), origin });
      expect(result.status).toBe(503); privateHeaders(result);
    }
  });
  it("refuses a different path and malformed encoding without leaking a document", async () => {
    for (const path of ["/problems/unknown", "/media/door-v44/%E0%A4%A"]) {
      const result = response(request(context().origin + path));
      expect(result.status).not.toBe(200); expect(await result.text()).not.toContain(artifact.compiled.document.title); privateHeaders(result);
    }
  });
  it.each(["html", "asset"])("detects %s bytes changed after verification", kind => {
    const changed = structuredClone(artifact);
    if (kind === "html") changed.compiled.html += "<!-- changed -->";
    else changed.compiled.assets[0].base64 = Buffer.from("changed").toString("base64");
    const result = response(request(kind === "html" ? artifact.compiled.receipt.canonical_url : artifact.compiled.assets[0].url), changed);
    expect(result.status).toBe(503); privateHeaders(result);
  });
});

describe("current emitted feature compatibility", () => {
  it.each(["door_pages", "intake", "explainers"])("cuts HTML and assets when %s is hidden", id => {
    const ctx = context(); ctx.features.rows = new Map(ctx.features.rows).set(id, { ...ctx.features.rows.get(id)!, state: "HIDDEN" });
    expect(doorV44ArtifactFeaturesAllow(artifact, ctx)).toBe(false);
    for (const url of [artifact.compiled.receipt.canonical_url, artifact.compiled.assets[0].url]) {
      const result = response(request(url), artifact, ctx); expect(result.status).toBe(404); privateHeaders(result);
    }
  });
  it("fails closed on unreadable or foreign feature state", () => {
    const ctx = context(); ctx.features.verified = false;
    expect(doorV44ArtifactFeaturesAllow(artifact, ctx)).toBe(false);
    expect(doorV44ArtifactFeaturesAllow(artifact, { ...context(), features: { ...context().features, tenant_id: "foreign" } })).toBe(false);
  });
  it.each(["/ask", "/%61sk", "/account/home-memory"])("checks emitted functional links %s", href => {
    const changed = structuredClone(artifact), ctx = context();
    changed.compiled.document.body.push({ tag: "a", attrs: { href }, children: ["Functional action"] });
    ctx.features.rows = new Map(ctx.features.rows).set("ask", { ...ctx.features.rows.get("ask")!, state: "HIDDEN" })
      .set("home_memory", { ...ctx.features.rows.get("home_memory")!, state: "PREVIEW" });
    expect(doorV44ArtifactFeaturesAllow(changed, ctx)).toBe(false);
  });
  it("permits product marketing PREVIEW without permitting its functional account action", () => {
    const changed = structuredClone(artifact), ctx = context();
    changed.compiled.document.body.push({ tag: "a", attrs: { href: "/pages/home-memory" }, children: ["Home Memory preview"] });
    ctx.features.rows = new Map(ctx.features.rows).set("home_memory", { ...ctx.features.rows.get("home_memory")!, state: "PREVIEW" });
    expect(doorV44ArtifactFeaturesAllow(changed, ctx)).toBe(true);
  });
  it("refuses emitted hidden-feature submit overrides and external form destinations", () => {
    for (const attrs of [{ formaction: "/api/ask" }, { action: "https://foreign.example/collect" }] as Array<Record<string, string>>) {
      const changed = structuredClone(artifact), ctx = context();
      ctx.features.rows = new Map(ctx.features.rows).set("ask", { ...ctx.features.rows.get("ask")!, state: "HIDDEN" });
      changed.compiled.document.body.push({ tag: "button", attrs, children: ["Submit"] });
      expect(doorV44ArtifactFeaturesAllow(changed, ctx)).toBe(false);
    }
  });
});
