import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";
import { doorPageVersionStore } from "@/platform/search/door-page-version-store";
import { doorPageVersionInputStore } from "@/platform/search/door-page-version-input-store";
import { buildSavedDoorPageVersion } from "@/platform/search/door-page-version-build-service";
import { readDoorPageVersionArtifact } from "@/platform/search/door-page-version-service";
import { readDevDb } from "@/platform/stores/dev-db";
import { resetRuntimeStore } from "@/platform/stores/runtime";
import { invalidateFeatureStates } from "@/platform/features/state";
import { serviceClientProvider, fileStoreForced } from "@/platform/db/client";
import { resetLoginAttempts } from "@/platform/admin/auth";
import { resetAdminMutationLimitForTests } from "@/platform/admin/request";
import { loadDoorCreatorDetail, loadDoorTemplateKitView } from "@/platform/admin/door-creator";
import Overview from "@/app/admin/page-creator/page";
import Detail from "@/app/admin/page-creator/[page_id]/page";
import Templates from "@/app/admin/templates/page";
import { POST as login, DELETE as logout } from "@/app/api/admin/login/route";
import { GET as previewGet } from "@/app/admin/page-creator/[page_id]/versions/[version]/preview/route";
import { GET as imageGet } from "@/app/admin/page-creator/[page_id]/versions/[version]/preview/assets/[asset]/route";
import { GET as documentGet } from "@/app/api/admin/template-kit/[document]/route";

// Only framework request/navigation context is mocked. Authentication, file
// adapters, loaders, compiler, artifact reads and route handlers are real.
const context = vi.hoisted(() => ({ cookie: "", origin: "https://owner-journey.invalid" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => name === "prn_admin" && context.cookie ? { value: context.cookie } : undefined }),
  headers: async () => new Headers({ host: new URL(context.origin).host }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const password = "synthetic-offline-journey-owner";
const audit = { actor: "system:synthetic-test", reason: "Offline connected owner read/review fixture", at: "2026-09-13T20:00:00.000Z" };
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
let root: string, artifactRoot: string;
async function frozenInventory(): Promise<Array<{ path: string; hash: string }>> {
  const base = resolve("content/door-template/v43"), files: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path); else if (entry.isFile()) files.push(path); else throw new Error("Unexpected frozen source kind");
    }
  }
  await walk(base); files.push(resolve("content/door-template/v44/inputs/sources/vault-approved-v43.html"));
  return Promise.all(files.sort().map(async path => ({ path: relative(process.cwd(), path), hash: digest(await readFile(path)) })));
}
function request(path: string, method = "GET", body?: unknown) {
  return new Request(new URL(path, context.origin), { method, headers: { host: new URL(context.origin).host, origin: context.origin,
    ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function privateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toContain("private, no-store");
  expect(response.headers.get("x-robots-tag")).toContain("noindex");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "door-owner-journey-")); artifactRoot = join(root, "artifacts");
  // Scoped to this test file and restored below; real default providers must
  // choose this isolated file store, even on a machine with vendor credentials.
  vi.stubEnv("PRN_RUNTIME_STORE", "file"); vi.stubEnv("PRN_DEV_DB_PATH", join(root, "records.json"));
  vi.stubEnv("PRN_DOOR_V44_ARTIFACT_ROOT", artifactRoot); vi.stubEnv("PRN_DOOR_V44_AUTHORITY_PATH", "");
  vi.stubEnv("ADMIN_PASSWORD", password); vi.stubEnv("PRN_ADMIN_ORIGIN", context.origin);
  resetRuntimeStore(); invalidateFeatureStates(); resetLoginAttempts(); resetAdminMutationLimitForTests();
});
afterAll(async () => {
  context.cookie = ""; resetRuntimeStore(); invalidateFeatureStates(); vi.unstubAllEnvs();
  resetLoginAttempts(); resetAdminMutationLimitForTests();
  const checked = resolve(root);
  if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.includes("door-owner-journey-")) throw new Error("Unsafe journey fixture cleanup");
  await rm(checked, { recursive: true, force: true });
});

describe("offline owner read/review journey with actual file stores", () => {
  it("connects saved F04 inputs to owner review, private HTML/image bytes and sign-out denial", async () => {
    expect(fileStoreForced()).toBe(true); expect(serviceClientProvider()).toBeNull();
    const frozenBefore = await frozenInventory(); expect(frozenBefore.length).toBeGreaterThan(20);
    const { spec, context: compilerContext } = await compilerFixture();
    spec.identity.tenant_id = "prn"; compilerContext.validation.tenant_id = "prn";
    for (const group of [compilerContext.validation.pages, compilerContext.validation.eligibilities, compilerContext.validation.visual_assets]) for (const row of group) row.tenant_id = "prn";
    const versions = doorPageVersionStore(), inputs = doorPageVersionInputStore(), operation_id = "owner-journey-f04";
    const reservation = await versions.reserveVersion({ tenant_id: "prn", page_id: spec.identity.page_id, canonical_intent_id: spec.identity.canonical_intent_id,
      canonical_url: new URL(spec.identity.canonical_path, compilerContext.validation.origin).href, operation_id, expected_latest_version: 0, ...audit });
    const saved = await inputs.captureInput({ tenant_id: "prn", page_id: reservation.page_id, reservation_id: reservation.reservation_id, spec, context: compilerContext,
      model_provenance: { status: "fixture_no_model_calls", fixture_id: "F04" }, ...audit });
    const command = { tenant_id: "prn", page_id: reservation.page_id, operation_id, expected_input_sha256: saved.input_sha256, ...audit };
    const built = await buildSavedDoorPageVersion(versions, inputs, artifactRoot, command);
    expect(built).toMatchObject({ artifact_read_verified: true, replayed: false, version: { page_version: 1, metadata: { receipt: { release_ready: false, mode: "fixture" } } } });
    const artifact = await readDoorPageVersionArtifact(versions, artifactRoot, "prn", reservation.page_id, 1);
    const recordsBeforeReview = await readFile(join(root, "records.json"));

    const signedIn = await login(request("/api/admin/login", "POST", { password }));
    expect(signedIn.status).toBe(200); context.cookie = signedIn.cookies.get("prn_admin")!.value; expect(context.cookie).toMatch(/^v3\.owner\./);
    const overview = renderToStaticMarkup(await Overview({}));
    const detailHref = `/admin/page-creator/${encodeURIComponent(reservation.page_id)}`;
    expect(overview).toContain(`href="${detailHref}"`); expect(overview).toContain("1 saved page identities");
    const detail = renderToStaticMarkup(await Detail({ params: Promise.resolve({ page_id: reservation.page_id }), searchParams: Promise.resolve({ version: "1" }) }));
    const view = await loadDoorCreatorDetail(reservation.page_id, "1");
    expect(view).toMatchObject({ status: "ready", selected: { page_version: 1 }, input: { status: "saved", model_status: "fixture_no_model_calls", input_sha256: saved.input_sha256 }, serving: { page_version: null } });
    expect(detail).toContain("Synthetic fixture record: no model calls"); expect(detail).toContain("No version currently eligible to serve");
    const previewHref = view.selected!.preview_href!; expect(previewHref).toBeTruthy(); expect(detail).toContain(`href="${previewHref}"`);
    const routeParams = { page_id: reservation.page_id, version: "1" };
    const preview = await previewGet(request(previewHref), { params: Promise.resolve(routeParams) });
    expect(preview.status).toBe(200); privateHeaders(preview); expect(preview.headers.get("x-prn-artifact-sha256")).toBe(built.version.metadata.receipt.artifact_hash);
    const html = await preview.text();
    expect(preview.headers.get("content-security-policy")).toContain("form-action 'none'");
    expect(preview.headers.get("content-security-policy")).toContain("script-src 'none'");
    // Independently reverse only the emitted private image URL mapping. The
    // remaining document must equal the byte-verified immutable HTML exactly.
    let originalUrls = html;
    for (const asset of artifact.compiled.assets) originalUrls = originalUrls.replaceAll(`${previewHref}/assets/${asset.path.split("/").at(-1)}`, asset.url);
    expect(originalUrls).toBe(artifact.compiled.html);
    const imageHref = /<img\b[^>]* src="([^"]+)"/.exec(html)?.[1];
    expect(imageHref).toMatch(new RegExp(`^${previewHref.replaceAll(".", "\\.")}/assets/[a-f0-9]{64}\\.(png|webp)$`));
    const assetName = imageHref!.split("/").at(-1)!;
    const savedAsset = artifact.compiled.assets.find(asset => asset.path.endsWith(`/${assetName}`))!; expect(savedAsset).toBeTruthy();
    const image = await imageGet(request(imageHref!), { params: Promise.resolve({ ...routeParams, asset: assetName }) });
    expect(image.status).toBe(200); privateHeaders(image);
    const imageBytes = Buffer.from(await image.arrayBuffer()); expect(imageBytes).toEqual(Buffer.from(savedAsset.base64, "base64")); expect(digest(imageBytes)).toBe(savedAsset.sha256);

    const templates = renderToStaticMarkup(await Templates()), kit = await loadDoorTemplateKitView();
    const document = kit.documents.find(doc => doc.id === "compatibility") ?? kit.documents[0];
    expect(templates).toContain(`href="${document.href}"`);
    const downloaded = await documentGet(request(document.href), { params: Promise.resolve({ document: document.id }) });
    expect(downloaded.status).toBe(200); privateHeaders(downloaded); expect(digest(await downloaded.text())).toBe(document.sha256);

    const signedOut = await logout(request("/api/admin/login", "DELETE")); expect(signedOut.status).toBe(200);
    expect(signedOut.cookies.get("prn_admin")?.maxAge).toBe(0); context.cookie = signedOut.cookies.get("prn_admin")!.value;
    const locked = renderToStaticMarkup(await Detail({ params: Promise.resolve(routeParams), searchParams: Promise.resolve({ version: "1" }) }));
    expect(locked).toContain('action="/api/admin/login"'); expect(locked).not.toContain(reservation.page_id); expect(locked).not.toContain(saved.input_sha256);
    const deniedPage = await previewGet(request(previewHref), { params: Promise.resolve(routeParams) });
    const deniedImage = await imageGet(request(imageHref!), { params: Promise.resolve({ ...routeParams, asset: assetName }) });
    expect(deniedPage.status).toBe(403); expect(deniedImage.status).toBe(403); privateHeaders(deniedPage); privateHeaders(deniedImage);
    expect(await deniedPage.text()).not.toContain(artifact.compiled.html); expect(Buffer.from(await deniedImage.arrayBuffer())).not.toEqual(imageBytes);
    const db = readDevDb(); expect(db.door_page_selection_sets).toEqual([]); expect(db.door_page_selection_guards).toEqual([]);
    expect(db.published_page_ids).toEqual([]); expect(db.door_page_evidence).toEqual([]);
    expect(db.door_page_version_catalog).toHaveLength(1); expect(db.door_page_version_catalog[0].versions).toHaveLength(1);
    expect(await readFile(join(root, "records.json"))).toEqual(recordsBeforeReview);
    expect(await frozenInventory()).toEqual(frozenBefore);
  });
});
