import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { compileDoorV44Page } from "@/domain/search/door-v44/compiler";
import type { DoorV44CompileResult } from "@/domain/search/door-v44/compiler-types";
import { readDoorV44ArtifactByVersion, writeDoorV44Artifact } from "@/domain/search/door-v44/artifact-store";
import { doorV44Hash, stableDoorJson } from "@/domain/search/door-v44/schema-engine";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
let baseline: Extract<DoorV44CompileResult, { ok: true }>;
let root: string;
const identity = () => ({ tenant_id: baseline.receipt.tenant_id, page_id: baseline.receipt.page_id, page_version: baseline.receipt.page_version });
const bindingPath = () => join(root, "bindings", doorV44Hash(identity()) + ".json");
const read = () => readDoorV44ArtifactByVersion(root, identity().tenant_id, identity().page_id, identity().page_version);
const refusal = (code: string) => ({ ok: false, errors: [{ code, pointer: "" }] });
async function store() { const result = await writeDoorV44Artifact(root, baseline); if (!result.ok) throw new Error(JSON.stringify(result)); return result; }

beforeAll(async () => {
  const fixture = await compilerFixture();
  const compiled = await compileDoorV44Page(fixture.spec, fixture.context);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled));
  baseline = compiled;
});
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "door-v44-binding-read-")); });
afterEach(async () => {
  vi.mocked(fs.open).mockClear();
  const checked = resolve(root);
  if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.includes("door-v44-binding-read-")) throw new Error("Unsafe test cleanup");
  await rm(checked, { recursive: true, force: true });
});

describe("exact immutable artifact recovery by version", () => {
  it("distinguishes a missing binding and leaves the empty root untouched", async () => {
    expect(await read()).toEqual(refusal("ARTIFACT_BINDING_NOT_FOUND"));
    expect(await readdir(root)).toEqual([]);
    expect(await readDoorV44ArtifactByVersion(join(root, "not-created"), identity().tenant_id, identity().page_id, 1))
      .toEqual(refusal("ARTIFACT_BINDING_NOT_FOUND"));
  });

  it("recovers a fully written artifact before any catalogue registration", async () => {
    const stored = await store();
    expect(await read()).toEqual(stored);
    expect((await read()).ok).toBe(true);
    expect(await readFile(join(stored.directory, "index.html"), "utf8")).toBe(baseline.html);
  });

  it.each(["tenant", "page", "version"])("does not scan or fall back when the requested %s differs", async field => {
    await store();
    expect(await readDoorV44ArtifactByVersion(root, field === "tenant" ? "other" : identity().tenant_id,
      field === "page" ? "other" : identity().page_id, field === "version" ? 2 : 1)).toEqual(refusal("ARTIFACT_BINDING_NOT_FOUND"));
  });

  it.each(["malformed", "wrong-identity", "extra-field", "missing-bundle", "manifest-mismatch"])("refuses %s instead of authorizing another compile", async mutation => {
    await store();
    const binding = JSON.parse(await readFile(bindingPath(), "utf8"));
    if (mutation === "wrong-identity") binding.tenant_id = "other";
    if (mutation === "extra-field") binding.ignored = true;
    if (mutation === "missing-bundle") binding.artifact_hash = "0".repeat(64);
    if (mutation === "manifest-mismatch") binding.manifest_hash = "0".repeat(64);
    await writeFile(bindingPath(), mutation === "malformed" ? "{" : stableDoorJson(binding));
    expect(await read()).toEqual(refusal("ARTIFACT_CORRUPT"));
  });

  it("re-verifies saved HTML before accepting recovery", async () => {
    const stored = await store();
    await writeFile(join(stored.directory, "index.html"), baseline.html + "<!-- changed -->");
    expect(await read()).toEqual(refusal("ARTIFACT_HASH_MISMATCH"));
  });

  it("rejects a requested binding that points to another identity's otherwise valid bundle", async () => {
    await store();
    const foreignIdentity = { ...identity(), tenant_id: "other-tenant" };
    const binding = JSON.parse(await readFile(bindingPath(), "utf8"));
    await writeFile(join(root, "bindings", doorV44Hash(foreignIdentity) + ".json"), stableDoorJson({ ...binding, ...foreignIdentity }));
    expect(await readDoorV44ArtifactByVersion(root, foreignIdentity.tenant_id, foreignIdentity.page_id, foreignIdentity.page_version))
      .toEqual(refusal("ARTIFACT_VERSION_CONFLICT"));
  });

  it("does not mistake an inaccessible binding for an absent binding", async () => {
    await store();
    vi.mocked(fs.open).mockRejectedValueOnce(Object.assign(new Error("private fixture detail"), { code: "EACCES" }));
    expect(await read()).toEqual(refusal("ARTIFACT_IO"));
  });

  it("rejects a symlinked binding directory", async () => {
    const destination = join(root, "actual-bindings");
    await mkdir(destination);
    await symlink(destination, join(root, "bindings"), "junction");
    expect(await read()).toEqual(refusal("ARTIFACT_UNSAFE_PATH"));
  });

  it.each([["../other", "page", 1], ["tenant", "../other", 1], ["tenant", "page", 0], ["tenant", "page", 1.5]] as const)("rejects unsafe identity %s/%s/%s before IO", async (tenant, page, version) => {
      expect(await readDoorV44ArtifactByVersion(root, tenant, page, version)).toEqual(refusal("ARTIFACT_INPUT_INVALID"));
      expect(await readdir(root)).toEqual([]);
  });

  it("rejects an unowned relative root", async () => {
    expect(await readDoorV44ArtifactByVersion("relative", identity().tenant_id, identity().page_id, 1)).toEqual(refusal("ARTIFACT_UNSAFE_PATH"));
  });
});
