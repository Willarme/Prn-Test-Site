import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as compiler from "@/domain/search/door-v44/compiler";
import { writeDoorV44Artifact } from "@/domain/search/door-v44/artifact-store";
import type { DoorPageVersionStore } from "@/domain/search/door-v44/page-version";
import type { DoorPageVersionInputStore } from "@/domain/search/door-v44/page-version-input";
import { doorPageVersionStore } from "@/platform/search/door-page-version-store";
import { doorPageVersionInputStore } from "@/platform/search/door-page-version-input-store";
import { buildSavedDoorPageVersion } from "@/platform/search/door-page-version-build-service";
import { readDevDb } from "@/platform/stores/dev-db";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";

let root: string, versions: DoorPageVersionStore, inputs: DoorPageVersionInputStore;
const audit = { actor: "system:synthetic-test", reason: "Build immutable saved fixture", at: "2026-09-13T20:00:00.000Z" };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "door-saved-build-"));
  vi.stubEnv("PRN_DEV_DB_PATH", join(root, "records.json"));
  versions = doorPageVersionStore(() => null); inputs = doorPageVersionInputStore(() => null);
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  const checked = resolve(root);
  if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.includes("door-saved-build-")) throw new Error("unsafe fixture cleanup");
  rmSync(checked, { recursive: true, force: true });
});
async function prepare(broken = false) {
  const { spec, context } = await compilerFixture();
  if (broken) context.asset_records = [];
  const operation_id = "synthetic-saved-build";
  const reservation = await versions.reserveVersion({ tenant_id: spec.identity.tenant_id, page_id: spec.identity.page_id,
    canonical_intent_id: spec.identity.canonical_intent_id, canonical_url: new URL(spec.identity.canonical_path, context.validation.origin).href,
    operation_id, expected_latest_version: 0, ...audit });
  const saved = await inputs.captureInput({ tenant_id: reservation.tenant_id, page_id: reservation.page_id, reservation_id: reservation.reservation_id,
    spec, context, model_provenance: { status: "fixture_no_model_calls", fixture_id: "F04" }, ...audit });
  const command = { tenant_id: reservation.tenant_id, page_id: reservation.page_id, operation_id, expected_input_sha256: saved.input_sha256, ...audit };
  return { saved, spec, context, command, reservation, artifactRoot: join(root, "artifacts") };
}

describe("build from saved governed inputs", () => {
  it("compiles persisted inputs, retains assignments and never publishes", async () => {
    const f = await prepare();
    f.context.site.name = "changed after capture";
    const result = await buildSavedDoorPageVersion(versions, inputs, f.artifactRoot, f.command);
    expect(result).toMatchObject({ input_sha256: f.saved.input_sha256, artifact_read_verified: true, replayed: false, recovered: false,
      version: { page_version: 1, metadata: { provenance_status: "unattested", receipt: { release_ready: false, mode: "fixture" } } } });
    expect(await inputs.getVersionInput(f.command.tenant_id, f.command.page_id, 1)).toMatchObject({ assignments: f.saved.assignments, context: { site: { name: f.saved.context.site.name } } });
    expect(readDevDb().published_page_ids).toEqual([]);
    expect(readDevDb().intent_pages).toEqual([]);
  });

  it("replays verified existing bytes without recompiling even if today's compiler fails", async () => {
    const f = await prepare();
    const first = await buildSavedDoorPageVersion(versions, inputs, f.artifactRoot, f.command);
    const compile = vi.spyOn(compiler, "compileDoorV44Page").mockRejectedValue(new Error("must not compile"));
    const retry = await buildSavedDoorPageVersion(versions, inputs, f.artifactRoot, f.command);
    expect(retry).toEqual({ ...first, replayed: true }); expect(compile).not.toHaveBeenCalled();
    expect(await versions.listVersions(f.command.tenant_id, f.command.page_id)).toHaveLength(1);
    expect(readDevDb().admin_audit.filter(row => row.action === "door_page_version_registered")).toHaveLength(1);
  });

  it("recovers an interrupted write by exact immutable binding before invoking today's compiler", async () => {
    const f = await prepare();
    const compiled = await compiler.compileDoorV44Page(f.saved.spec, f.saved.context);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));
    expect((await writeDoorV44Artifact(f.artifactRoot, compiled)).ok).toBe(true);
    const compile = vi.spyOn(compiler, "compileDoorV44Page").mockRejectedValue(new Error("must not compile"));
    const recovered = await buildSavedDoorPageVersion(versions, inputs, f.artifactRoot, f.command);
    expect(recovered).toMatchObject({ recovered: true, replayed: false, version: { metadata: { receipt: { artifact_hash: compiled.receipt.artifact_hash } } } });
    expect(compile).not.toHaveBeenCalled();
  });

  it("refuses missing saved input without compiling or registering", async () => {
    const f = await prepare();
    const missing = { ...inputs, getInput: async () => null };
    const compile = vi.spyOn(compiler, "compileDoorV44Page");
    await expect(buildSavedDoorPageVersion(versions, missing, f.artifactRoot, f.command)).rejects.toMatchObject({ code: "SAVED_BUILD_INPUT_MISSING" });
    expect(compile).not.toHaveBeenCalled(); expect(await versions.listVersions(f.command.tenant_id, f.command.page_id)).toEqual([]);
  });

  it("requires the exact saved input hash even before any artifact exists", async () => {
    const f = await prepare();
    const compile = vi.spyOn(compiler, "compileDoorV44Page");
    await expect(buildSavedDoorPageVersion(versions, inputs, f.artifactRoot, { ...f.command, expected_input_sha256: "0".repeat(64) }))
      .rejects.toMatchObject({ code: "SAVED_BUILD_INPUT_MISMATCH" });
    expect(compile).not.toHaveBeenCalled();
  });

  it("refuses changed retry audit identity instead of recording another operation", async () => {
    const f = await prepare(); await buildSavedDoorPageVersion(versions, inputs, f.artifactRoot, f.command);
    await expect(buildSavedDoorPageVersion(versions, inputs, f.artifactRoot, { ...f.command, actor: "different-actor" }))
      .rejects.toMatchObject({ code: "SAVED_BUILD_RETRY_CONFLICT" });
  });

  it("does not rebuild a corrupt registered artifact", async () => {
    const f = await prepare(); const built = await buildSavedDoorPageVersion(versions, inputs, f.artifactRoot, f.command);
    const html = join(f.artifactRoot, "bundles", built.version.metadata.receipt.artifact_hash, "index.html");
    writeFileSync(html, readFileSync(html, "utf8") + "<!-- corruption -->");
    const compile = vi.spyOn(compiler, "compileDoorV44Page");
    await expect(buildSavedDoorPageVersion(versions, inputs, f.artifactRoot, f.command)).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
    expect(compile).not.toHaveBeenCalled();
  });

  it("retains the reserved number and captured inputs after a real compiler refusal", async () => {
    const f = await prepare(true);
    await expect(buildSavedDoorPageVersion(versions, inputs, f.artifactRoot, f.command)).rejects.toMatchObject({ code: "SAVED_BUILD_COMPILE_FAILED" });
    expect(await versions.listVersions(f.command.tenant_id, f.command.page_id)).toEqual([]);
    expect(await inputs.getInput(f.command.tenant_id, f.command.page_id, f.reservation.reservation_id)).toEqual(f.saved);
    expect(await versions.getReservation(f.command.tenant_id, f.command.page_id, f.command.operation_id)).toEqual(f.reservation);
  });

  it("concurrent identical builds converge on one artifact, version and registration audit", async () => {
    const f = await prepare();
    const results = await Promise.all([buildSavedDoorPageVersion(versions, inputs, f.artifactRoot, f.command), buildSavedDoorPageVersion(versions, inputs, f.artifactRoot, f.command)]);
    expect(results[0].version).toEqual(results[1].version);
    expect(await versions.listVersions(f.command.tenant_id, f.command.page_id)).toHaveLength(1);
    expect(readDevDb().admin_audit.filter(row => row.action === "door_page_version_registered")).toHaveLength(1);
  });
});
