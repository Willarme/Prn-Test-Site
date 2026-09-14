import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { compileDoorV44Page } from "@/domain/search/door-v44/compiler";
import type { DoorV44CompileResult } from "@/domain/search/door-v44/compiler-types";
import { readDoorV44Artifact, writeDoorV44Artifact } from "@/domain/search/door-v44/artifact-store";
import { doorV44ArtifactHash } from "@/domain/search/door-v44/artifact-hash";
import { renderDoorV44Document } from "@/domain/search/door-v44/render";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";

vi.mock("node:fs/promises", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, link: vi.fn(original.link), rename: vi.fn(original.rename), open: vi.fn(original.open) };
});
type Candidate = Extract<DoorV44CompileResult, { ok: true }>;
let baseline: Candidate;
let changed: Candidate;
let root: string;
const copy = () => structuredClone(baseline);
const failIo = () => Promise.reject(Object.assign(new Error("synthetic interruption"), { code: "EIO" }));
const run = promisify(execFile);

beforeAll(async () => {
  const fixture = await compilerFixture();
  const result = await compileDoorV44Page(fixture.spec, fixture.context);
  if (!result.ok) throw new Error(JSON.stringify(result));
  baseline = result;
  fixture.context.site.current_year += 1;
  const second = await compileDoorV44Page(fixture.spec, fixture.context);
  if (!second.ok) throw new Error(JSON.stringify(second));
  changed = second;
});
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "door-v44-artifact-")); });
afterEach(async () => {
  vi.mocked(fs.link).mockClear(); vi.mocked(fs.rename).mockClear(); vi.mocked(fs.open).mockClear();
  // Each test owns exactly the directory returned by mkdtemp; never product/store data.
  if (!root.startsWith(join(tmpdir(), "door-v44-artifact-"))) throw new Error("Unexpected cleanup path");
  await rm(root, { recursive: true, force: true });
});

describe("immutable v44 candidate artifact storage", () => {
  it("creates missing owned root components without requiring a separately prepared directory", async () => {
    const nested = join(root, "owned", "nested");
    expect((await writeDoorV44Artifact(nested, copy())).ok).toBe(true);
    expect((await readDoorV44Artifact(nested, baseline.receipt.artifact_hash)).ok).toBe(true);
  });
  it("persists exact HTML, document, receipt and real raster bytes and reads the bound candidate", async () => {
    const result = await writeDoorV44Artifact(root, baseline);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(await readFile(join(result.directory, "index.html"), "utf8")).toBe(baseline.html);
    for (const asset of baseline.assets) {
      expect(await readFile(join(result.directory, "assets", asset.path.split("/").at(-1)!))).toEqual(Buffer.from(asset.base64, "base64"));
    }
    expect((await readdir(join(root, "bindings"))).length).toBe(1);
    expect(await readDoorV44Artifact(root, baseline.receipt.artifact_hash)).toEqual(result);
    expect(result.compiled.receipt.release_ready).toBe(false);
  });

  it("allows concurrent identical retries without changing the original completed files", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => writeDoorV44Artifact(root, copy())));
    expect(results.every(result => result.ok), JSON.stringify(results)).toBe(true);
    expect(await readdir(join(root, "bundles"))).toEqual([baseline.receipt.artifact_hash]);
    const path = join(root, "bundles", baseline.receipt.artifact_hash, "receipt.json");
    const before = await fs.stat(path);
    const stagedBefore = await readdir(join(root, "staging"));
    expect((await writeDoorV44Artifact(root, copy())).ok).toBe(true);
    expect((await fs.stat(path)).mtimeMs).toBe(before.mtimeMs);
    expect(await readdir(join(root, "staging"))).toEqual(stagedBefore);
  });

  it.each(["identical", "conflicting"])("creates exactly one version binding for %s independent Node processes", async mode => {
    const candidatePath = join(root, "candidate.json");
    await writeFile(candidatePath, JSON.stringify(baseline));
    const otherPath = join(root, "other.json");
    await writeFile(otherPath, JSON.stringify(mode === "identical" ? baseline : changed));
    const code = `const fs=require('node:fs');const store=require('./src/domain/search/door-v44/artifact-store.ts');store.writeDoorV44Artifact(process.argv[1],JSON.parse(fs.readFileSync(process.argv[2],'utf8'))).then(result=>{process.stdout.write(JSON.stringify({ok:result.ok,artifact_hash:result.artifact_hash,errors:result.errors}));});`;
    const processes = await Promise.all([candidatePath, otherPath].map(path => run(process.execPath, ["--import", "tsx", "--eval", code, root, path], { cwd: process.cwd() })));
    const results = processes.map(result => JSON.parse(result.stdout));
    expect(results.filter(result => result.ok)).toHaveLength(mode === "identical" ? 2 : 1);
    if (mode === "conflicting") expect(results.find(result => !result.ok).errors[0].code).toBe("ARTIFACT_VERSION_CONFLICT");
    expect(await readdir(join(root, "bindings"))).toHaveLength(1);
    expect((await readDoorV44Artifact(root, results.find(result => result.ok).artifact_hash)).ok).toBe(true);
  });

  it("refuses different artifacts for one tenant/page/version, including concurrent writers", async () => {
    const results = await Promise.all([writeDoorV44Artifact(root, copy()), writeDoorV44Artifact(root, structuredClone(changed))]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    const rejected = results.find(result => !result.ok)!;
    expect(rejected).toEqual({ ok: false, errors: [{ code: "ARTIFACT_VERSION_CONFLICT", pointer: "" }] });
    const selected = results.find(result => result.ok)!;
    if (!selected.ok) return;
    expect((await readDoorV44Artifact(root, selected.artifact_hash)).ok).toBe(true);
    const rejectedHash = selected.artifact_hash === baseline.receipt.artifact_hash ? changed.receipt.artifact_hash : baseline.receipt.artifact_hash;
    expect((await readDoorV44Artifact(root, rejectedHash)).ok).toBe(false);
  });

  it("isolates bindings between tenants and between page versions", async () => {
    expect((await writeDoorV44Artifact(root, copy())).ok).toBe(true);
    const tenantFixture = await compilerFixture();
    const replaceTenant = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (key === "tenant_id" && typeof child === "string") (value as Record<string, unknown>)[key] = "fixture.other-tenant";
        else replaceTenant(child);
      }
    };
    replaceTenant(tenantFixture);
    const otherTenant = await compileDoorV44Page(tenantFixture.spec, tenantFixture.context);
    expect(otherTenant.ok, JSON.stringify(otherTenant)).toBe(true);
    if (otherTenant.ok) expect((await writeDoorV44Artifact(root, otherTenant)).ok).toBe(true);
    // The hash includes rendered receipt identity. A second version needs its own compiler output.
    const fixture = await compilerFixture(); fixture.spec.identity.page_version = 2;
    const next = await compileDoorV44Page(fixture.spec, fixture.context);
    expect(next.ok, JSON.stringify(next)).toBe(true);
    if (next.ok) expect((await writeDoorV44Artifact(root, next)).ok).toBe(true);
    expect(await readdir(join(root, "bindings"))).toHaveLength(3);
  });

  it.each(["html", "document", "asset", "artifact_hash", "receipt_id", "tenant_id", "page_version"])("refuses forged %s before making directories", async part => {
    const candidate = copy();
    if (part === "html") candidate.html += "PRIVATE_MARKER";
    if (part === "document") candidate.document.title += "PRIVATE_MARKER";
    if (part === "asset") candidate.assets[0].base64 = Buffer.from("PRIVATE_MARKER").toString("base64");
    if (part === "artifact_hash") candidate.receipt.artifact_hash = "0".repeat(64);
    if (part === "receipt_id") candidate.receipt.receipt_id = "forged";
    if (part === "tenant_id") candidate.receipt.tenant_id = "forged.tenant";
    if (part === "page_version") candidate.receipt.page_version += 1;
    const result = await writeDoorV44Artifact(root, candidate);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_MARKER");
    expect(await readdir(root)).toEqual([]);
  });

  it.each(["index.html", "document.json", "receipt.json", "manifest.json", "assets.json", "raster"])("refuses tampered completed %s and never repairs it by overwrite", async filename => {
    const result = await writeDoorV44Artifact(root, copy());
    if (!result.ok) throw new Error(JSON.stringify(result));
    const path = filename === "raster" ? join(result.directory, "assets", baseline.assets[0].path.split("/").at(-1)!) : join(result.directory, filename);
    await writeFile(path, "CORRUPTED");
    expect((await readDoorV44Artifact(root, result.artifact_hash)).ok).toBe(false);
    expect((await writeDoorV44Artifact(root, copy())).ok).toBe(false);
    expect(await readFile(path, "utf8")).toBe("CORRUPTED");
  });

  it("refuses hash-consistent structured data that disagrees with visible FAQ content", async () => {
    const candidate = copy();
    const graph = candidate.document.structured_data[0]["@graph"] as Array<Record<string, unknown>>;
    const faq = graph.find(row => row["@type"] === "FAQPage")!;
    const questions = faq.mainEntity as Array<{ acceptedAnswer: { text: string } }>;
    questions[0].acceptedAnswer.text = "PRIVATE_MARKER disagrees with the visible answer";
    const rendered = renderDoorV44Document(candidate.document);
    if (!rendered.ok) throw new Error(JSON.stringify(rendered));
    candidate.html = rendered.html;
    candidate.receipt.html_hash = rendered.html_hash;
    candidate.receipt.semantic_hash = rendered.semantic_hash;
    candidate.receipt.artifact_hash = doorV44ArtifactHash(candidate.receipt, candidate.assets);
    const result = await writeDoorV44Artifact(root, candidate);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([{ code: "ARTIFACT_SEMANTIC_MISMATCH", pointer: "" }]);
    expect(await readdir(root)).toEqual([]);
  });

  it("keeps interrupted staging writes unselected and retries without deleting orphan history", async () => {
    vi.mocked(fs.rename).mockImplementationOnce(failIo);
    expect((await writeDoorV44Artifact(root, copy())).ok).toBe(false);
    const orphanNames = await readdir(join(root, "staging"));
    expect(orphanNames).toHaveLength(1);
    expect((await readDoorV44Artifact(root, baseline.receipt.artifact_hash)).ok).toBe(false);
    expect((await writeDoorV44Artifact(root, copy())).ok).toBe(true);
    expect(await readdir(join(root, "staging"))).toEqual(orphanNames);
  });

  it("does not select a partial staging directory after a file-write interruption", async () => {
    vi.mocked(fs.open).mockRejectedValueOnce(Object.assign(new Error("synthetic interruption"), { code: "EIO" }));
    expect((await writeDoorV44Artifact(root, copy())).ok).toBe(false);
    expect(await readdir(join(root, "staging"))).toHaveLength(1);
    expect(await readdir(join(root, "bundles"))).toEqual([]);
    expect((await readDoorV44Artifact(root, baseline.receipt.artifact_hash)).ok).toBe(false);
    expect((await writeDoorV44Artifact(root, copy())).ok).toBe(true);
  });

  it("recovers a complete bundle interrupted before the exclusive version binding", async () => {
    vi.mocked(fs.link).mockImplementationOnce(failIo);
    expect((await writeDoorV44Artifact(root, copy())).ok).toBe(false);
    expect(await readDoorV44Artifact(root, baseline.receipt.artifact_hash)).toEqual({ ok: false, errors: [{ code: "ARTIFACT_UNBOUND", pointer: "" }] });
    expect((await writeDoorV44Artifact(root, copy())).ok).toBe(true);
    expect((await readDoorV44Artifact(root, baseline.receipt.artifact_hash)).ok).toBe(true);
  });

  it("takes a private copy before caller mutations or getter execution can affect awaited writes", async () => {
    const candidate = copy();
    const pending = writeDoorV44Artifact(root, candidate);
    candidate.html = "MUTATED"; candidate.assets[0].base64 = ""; candidate.receipt.page_id = "different";
    expect((await pending).ok).toBe(true);
    const loaded = await readDoorV44Artifact(root, baseline.receipt.artifact_hash);
    expect(loaded.ok && loaded.compiled.html).toBe(baseline.html);
    const poisoned = copy(); const getter = vi.fn(() => "MUTATED");
    Object.defineProperty(poisoned, "html", { enumerable: true, get: getter });
    expect((await writeDoorV44Artifact(root, poisoned)).ok).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  it("does not replace an existing incomplete destination", async () => {
    await fs.mkdir(join(root, "bundles"));
    const incomplete = join(root, "bundles", baseline.receipt.artifact_hash);
    await fs.mkdir(incomplete);
    expect((await writeDoorV44Artifact(root, copy())).ok).toBe(false);
    expect(await readdir(incomplete)).toEqual([]);
    // A pre-existing destination is corruption, not an orphan in the private staging namespace.
  });

  it.each(["../outside", "a/b", "a\\b", "%2e%2e", "", "a\0b"])("refuses unsafe identity %j", async id => {
    const candidate = copy(); candidate.receipt.tenant_id = id;
    expect((await writeDoorV44Artifact(root, candidate)).ok).toBe(false);
    expect(await readdir(root)).toEqual([]);
  });

  it("refuses path escapes, symlink roots/directories/files and extra unmanifested files", async () => {
    expect((await writeDoorV44Artifact("relative-root", copy())).ok).toBe(false);
    expect((await readDoorV44Artifact(root, "../outside")).ok).toBe(false);
    const target = join(root, "target"); await fs.mkdir(target);
    const alias = join(root, "alias"); await symlink(target, alias, "junction");
    expect((await writeDoorV44Artifact(alias, copy())).ok).toBe(false);
    const result = await writeDoorV44Artifact(root, copy());
    if (!result.ok) throw new Error(JSON.stringify(result));
    const assetDirectory = join(result.directory, "assets");
    await fs.rename(assetDirectory, join(root, "saved-assets"));
    await symlink(join(root, "saved-assets"), assetDirectory, "junction");
    expect((await readDoorV44Artifact(root, result.artifact_hash)).ok).toBe(false);
    await unlink(assetDirectory); await fs.rename(join(root, "saved-assets"), assetDirectory);
    await writeFile(join(result.directory, "unmanifested.txt"), "extra");
    expect((await readDoorV44Artifact(root, result.artifact_hash)).ok).toBe(false);
    await unlink(join(result.directory, "unmanifested.txt"));
    const html = join(result.directory, "index.html");
    await unlink(html); await symlink(target, html, "junction");
    expect((await readDoorV44Artifact(root, result.artifact_hash)).ok).toBe(false);
  });
});
