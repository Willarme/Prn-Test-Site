import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCookie } from "@/platform/admin/auth";
import { resetAdminMutationLimitForTests } from "@/platform/admin/request";
import { readDevDb } from "@/platform/stores/dev-db";
import { doorPageRunStore } from "@/platform/search/door-page-run-store";
import { createDoorRun, advanceDoorRun, readDoorRun, type DoorRunDependencies } from "@/platform/admin/door-page-runs";
import { getDoorFixturePackage } from "@/platform/search/door-page-run-fixtures";
import type { DoorRunView } from "@/platform/admin/door-page-run-types";
import { POST as createPost } from "@/app/api/admin/page-runs/route";
import { POST as advancePost } from "@/app/api/admin/page-runs/[run_id]/advance/route";
import { GET as readGet } from "@/app/api/admin/page-runs/[run_id]/route";
import { GET as fixtureGet } from "@/app/api/admin/page-runs/fixtures/route";
import { GET as previewGet, HEAD as previewHead } from "@/app/admin/page-creator/runs/[run_id]/items/[fixture_id]/preview/route";
import { GET as imageGet } from "@/app/admin/page-creator/runs/[run_id]/items/[fixture_id]/preview/assets/[asset]/route";
import { GET as savedPreview } from "@/app/admin/page-creator/[page_id]/versions/[version]/preview/route";

const context = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => context.cookie ? { value: context.cookie } : undefined }) }));
const origin = "http://127.0.0.1:3099", password = "fixture-run-offline-password";
let root: string, dbPath: string;
const all = Array.from({ length: 11 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`);
function request(path: string, method = "GET", body?: unknown, key?: string) {
  return new Request(origin + path, { method, headers: { origin, "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function input(dry_run = true, opportunity_ids = all) { return { mode: "fixture" as const, dry_run, opportunity_ids, count: opportunity_ids.length, reason: "Exercise the saved fixture workflow without model calls" }; }
async function jsonRun(response: Response, status = 200): Promise<DoorRunView> {
  const body = await response.json(); expect({ status: response.status, error: body.error }).toEqual({ status, error: undefined });
  expect(response.headers.get("Cache-Control")).toContain("private, no-store"); expect(response.headers.get("X-Robots-Tag")).toContain("noindex"); return body.run;
}
beforeAll(() => { root = mkdtempSync(join(tmpdir(), "door-run-journey-")); });
beforeEach(() => {
  const id = randomUUID(); dbPath = join(root, id + ".json");
  vi.stubEnv("PRN_RUNTIME_STORE", "file"); vi.stubEnv("PRN_DEV_DB_PATH", dbPath);
  vi.stubEnv("PRN_DOOR_V44_ARTIFACT_ROOT", join(root, id, "artifacts")); vi.stubEnv("PRN_ADMIN_ORIGIN", origin); vi.stubEnv("ADMIN_PASSWORD", password);
  context.cookie = sessionCookie(password).value; resetAdminMutationLimitForTests();
});
afterAll(() => { vi.unstubAllEnvs(); const checked = resolve(root); if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.includes("door-run-journey-")) throw new Error("Unsafe test cleanup"); rmSync(checked, { recursive: true, force: true }); });

describe("actual offline creator journey", () => {
  it.each([true, false])("accounts for all eleven fixtures with dry_run=%s and no paid/QA/publication actions", async dry => {
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Unexpected network call"); });
    try {
      const catalog = await fixtureGet(request("/api/admin/page-runs/fixtures")); expect(catalog.status).toBe(200);
      expect((await catalog.json()).fixtures.map((f: { fixture_id: string }) => f.fixture_id)).toEqual(all);
      const key = randomUUID(), body = input(dry);
      let run = await jsonRun(await createPost(request("/api/admin/page-runs", "POST", body, key)), 202);
      expect(run.run_id).toBe(`run-${key}`); expect(run.items).toHaveLength(11); expect(run.terminal_count).toBe(0);
      const beforeReplay = readFileSync(dbPath);
      expect(await jsonRun(await createPost(request("/api/admin/page-runs", "POST", body, key)), 202)).toEqual(run);
      expect(readFileSync(dbPath)).toEqual(beforeReplay);
      expect((await createPost(request("/api/admin/page-runs", "POST", { ...body, reason: "A different command" }, key))).status).toBe(409);
      const params = { params: Promise.resolve({ run_id: run.run_id }) };
      const start = run.revision;
      run = await jsonRun(await advancePost(request("/api/admin/page-runs/advance", "POST", { expected_revision: start }), params));
      expect(run.items[0]).toMatchObject({ fixture_id: "F01", status: "BLOCKED", attempts: 1 }); expect(run.items[0].diagnostics.length).toBeGreaterThan(0);
      expect((await advancePost(request("/api/admin/page-runs/advance", "POST", { expected_revision: start }), params)).status).toBe(409);
      const control = JSON.stringify(run.items[0]);
      // New store instance and fresh status GET reconstruct progress from disk.
      expect((await doorPageRunStore().read("prn", run.run_id))?.items[0].status).toBe("BLOCKED");
      run = await jsonRun(await readGet(request("/api/admin/page-runs/" + run.run_id), params));
      for (let i = 1; i < 11; i++) run = await jsonRun(await advancePost(request("/api/admin/page-runs/advance", "POST", { expected_revision: run.revision }), params));
      expect(run).toMatchObject({ status: "COMPLETE", terminal_count: 11, model_calls: 0, cost_usd: 0, release_ready: false, resumable: false });
      expect(run.items.map(i => i.status)).toEqual(["BLOCKED", ...Array(10).fill("BUILT")]); expect(JSON.stringify(run.items[0])).toBe(control);
      expect(run.items.every(i => i.attempts === 1)).toBe(true);
      const beforeTerminal = readFileSync(dbPath);
      expect(await jsonRun(await advancePost(request("/api/admin/page-runs/advance", "POST", { expected_revision: run.revision }), params))).toEqual(run);
      expect(readFileSync(dbPath)).toEqual(beforeTerminal);
      const db = readDevDb(); expect(db.door_page_runs).toHaveLength(1);
      expect(db.door_page_selection_sets).toEqual([]); expect(db.published_page_ids).toEqual([]); expect(db.door_page_evidence).toEqual([]);
      if (dry) { expect(db.door_page_version_catalog).toEqual([]); expect(db.door_page_version_inputs).toEqual([]); }
      else { expect(db.door_page_version_catalog[0].versions).toHaveLength(10); expect(db.door_page_version_inputs).toHaveLength(10); expect(db.door_page_version_inputs.every(i => JSON.parse(JSON.parse(i.payload_json).model_provenance_json).status === "fixture_no_model_calls")).toBe(true); }
      const item = run.items[1]; expect(item.preview_href).toBeTruthy();
      if (dry) {
        const target = { params: Promise.resolve({ run_id: run.run_id, fixture_id: item.fixture_id }) };
        const preview = await previewGet(request(item.preview_href!), target); expect(preview.status).toBe(200);
        expect(preview.headers.get("X-PRN-Artifact-SHA256")).toBe(item.artifact_hash);
        expect(preview.headers.get("Content-Security-Policy")).toContain("form-action 'none'");
        const html = await preview.text(); expect(html).toContain("DRAFT — unsaved synthetic fixture preview.");
        const imageHref = /<img\b[^>]* src="([^"]+)"/.exec(html)?.[1]; expect(imageHref).toContain(item.preview_href! + "/assets/");
        const assetParams = { params: Promise.resolve({ run_id: run.run_id, fixture_id: item.fixture_id, asset: imageHref!.split("/").at(-1)! }) };
        const image = await imageGet(request(imageHref!), assetParams); expect(image.status).toBe(200); expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(10);
        expect(await (await previewHead(request(item.preview_href!, "HEAD"), target)).text()).toBe("");
        context.cookie = "";
        expect((await previewGet(request(item.preview_href!), target)).status).toBe(403);
        expect((await imageGet(request(imageHref!), assetParams)).status).toBe(403);
      } else {
        expect(item.version_href).toBe(`/admin/page-creator/${item.page_id}?version=1`);
        expect((await savedPreview(request(item.preview_href!), { params: Promise.resolve({ page_id: item.page_id, version: "1" }) })).status).toBe(200);
      }
      expect(readFileSync(dbPath)).toEqual(beforeTerminal); expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  }, 120000);

  it("recovers a saved build whose terminal write was lost, retaining its version, artifact and original execution timestamp", async () => {
    let now = "2026-09-14T03:00:00.000Z";
    const real = doorPageRunStore(), partial: Partial<DoorRunDependencies> = { now: () => now, store: () => real };
    const created = await createDoorRun(randomUUID(), input(false, ["F02"]), partial);
    const unavailable = { ...real, complete: vi.fn(async () => { throw new Error("Completion write interrupted"); }) };
    await expect(advanceDoorRun(created.run_id, created.revision, { ...partial, store: () => unavailable })).rejects.toMatchObject({ code: "RUN_DEPENDENCY_UNAVAILABLE", status: 503 });
    const interrupted = await real.read("prn", created.run_id), oldVersion = readDevDb().door_page_version_catalog[0].versions[0];
    expect(interrupted?.items[0].status).toBe("RUNNING"); expect(readDevDb().door_page_version_catalog[0].versions).toHaveLength(1);
    expect((await readDoorRun(created.run_id, partial)).resumable).toBe(false);
    now = "2026-09-14T03:02:01.000Z";
    const current = await readDoorRun(created.run_id, partial); expect(current.resumable).toBe(true);
    const resumed = await advanceDoorRun(created.run_id, current.revision, partial);
    expect(resumed).toMatchObject({ status: "COMPLETE", terminal_count: 1 }); expect(resumed.items[0].attempts).toBe(2);
    expect(readDevDb().door_page_version_catalog[0].versions).toEqual([oldVersion]);
    expect((await real.read("prn", created.run_id))?.items[0].execution_at).toBe("2026-09-14T03:00:00.000Z");
    expect(resumed.items[0].artifact_hash).toBe(oldVersion.metadata.receipt.artifact_hash);
  }, 60000);

  it("rejects live batches as a whole with all known missing integrations and no store/model calls", async () => {
    const store = vi.fn(() => { throw new Error("Must not reach storage"); }), execute = vi.fn();
    await expect(createDoorRun(randomUUID(), { ...input(), mode: "live", opportunity_ids: ["approved-one", "unsupported-two"], count: 2 }, { store, execute })).rejects.toMatchObject({ code: "LIVE_PREFLIGHT_BLOCKED", status: 422,
      details: { opportunities: [{ opportunity_id: "approved-one", code: "LIVE_OPPORTUNITY_ADMISSION_UNAVAILABLE" }, { opportunity_id: "unsupported-two", code: "LIVE_OPPORTUNITY_ADMISSION_UNAVAILABLE" }], model_calls: 0, cost_usd: 0 } });
    expect(store).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("retains readable history after a package update but refuses to advance changed inputs", async () => {
    const created = await createDoorRun(randomUUID(), input(true, ["F01"]));
    const pack = await getDoorFixturePackage(), changed = { ...pack, sha256: "0".repeat(64) };
    await expect(advanceDoorRun(created.run_id, created.revision, { fixturePackage: async () => changed })).rejects.toMatchObject({ code: "RUN_PACKAGE_CHANGED", status: 409 });
    expect(await readDoorRun(created.run_id)).toEqual(created);
  });
});
