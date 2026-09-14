import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOOR_V44_BUILD_PROVENANCE_KEY, DOOR_V44_DERIVED_HASH_KEYS, doorV44ReservedInputHashErrors, verifyDoorV44BuildProvenance, type DoorV44BuildProvenance } from "@/domain/search/door-v44/build-provenance";
import { compileDoorV44Page } from "@/domain/search/door-v44/compiler";
import type { DoorV44CompileResult } from "@/domain/search/door-v44/compiler-types";
import { readDoorV44Artifact, writeDoorV44Artifact } from "@/domain/search/door-v44/artifact-store";
import { doorV44Hash, stableDoorJson } from "@/domain/search/door-v44/schema-engine";
import { collectDoorV44BuildProvenance, injectDoorV44BuildProvenance } from "../tools/door-v44/provenance";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";

const run = promisify(execFile);
type Candidate = Extract<DoorV44CompileResult, { ok: true }>;
let temporary: string;
let fixture: Awaited<ReturnType<typeof compilerFixture>>;
let proof: DoorV44BuildProvenance;
let compiled: Candidate;
const input = () => ({ ...fixture, input_mode: "fixture_f04" as const });
const owned = (name: string) => join(temporary, name);
beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), "door-v44-provenance-"));
  fixture = await compilerFixture();
  proof = await collectDoorV44BuildProvenance(process.cwd(), input());
  const result = await compileDoorV44Page(fixture.spec, injectDoorV44BuildProvenance(fixture.context, proof));
  if (!result.ok) throw new Error(JSON.stringify(result));
  compiled = result;
}, 20000);
afterAll(async () => {
  if (!temporary?.startsWith(join(tmpdir(), "door-v44-provenance-"))) throw new Error("Unsafe test cleanup path");
  await rm(temporary, { recursive: true, force: true });
});

describe("observed local build provenance, not execution or release attestation", () => {
  it("pins actual implementation, constants, WORDING, baseline and installed native/runtime bytes", async () => {
    expect(verifyDoorV44BuildProvenance(proof).ok).toBe(true);
    for (const path of ["src/domain/search/door-v44/compiler.ts", "src/domain/search/door-v44/render.ts", "tools/door-v44/build.ts",
      "tools/door-v44/provenance.ts", "content/door-template/v44/contracts/template-constants.json", "content/door-template/v44/wording/rules.json",
      "content/door-template/v44/wording/sources/WORDING.mechanical.md", "package-lock.json", "node_modules/ajv/package.json"]) {
      const bytes = await readFile(resolve(path));
      expect(proof.files.find(file => file.path === path)).toEqual({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    expect(proof.files.some(file => /node_modules\/@img\/sharp-.+\.(node|dll)$/.test(file.path))).toBe(true);
    expect(proof.files.some(file => /node_modules\/@esbuild\/.+\.exe$/.test(file.path))).toBe(process.platform === "win32");
    expect(proof.runtime.node_version).toBe(process.version);
    expect(proof.runtime.node_binary_sha256).toBe(createHash("sha256").update(await readFile(process.execPath)).digest("hex"));
    expect(proof.runtime.sharp_versions.some(row => row.name === "vips")).toBe(true);
    expect(proof.execution_attestation).toBe(false);
    expect(proof.limitations).toContain("NO_SECOND_HOST_OR_CI_PROOF");
    expect(stableDoorJson(proof)).not.toContain(process.cwd());
    expect(Object.keys(proof)).not.toContain("created_at");
    expect(Object.keys(proof)).not.toContain("artifact_hash");
  });
  it.each([...DOOR_V44_DERIVED_HASH_KEYS])("rejects caller-supplied reserved hash %s without silently replacing it", key => {
    const context = structuredClone(fixture.context);
    context.validation.input_hashes[key] = "0".repeat(64);
    expect(doorV44ReservedInputHashErrors(context.validation.input_hashes)).toContainEqual({ code: "BUILD_RESERVED_HASH", pointer: "/validation/input_hashes/" + key });
    expect(() => injectDoorV44BuildProvenance(context, proof)).toThrow("BUILD_RESERVED_OR_INVALID_INPUT");
  });
  it("binds exact parsed inputs and refuses injection into a different context", () => {
    expect(proof.inputs.spec_sha256).toBe(doorV44Hash(fixture.spec));
    expect(proof.inputs.context_before_provenance_sha256).toBe(doorV44Hash(fixture.context));
    const context = structuredClone(fixture.context); context.site.current_year++;
    expect(() => injectDoorV44BuildProvenance(context, proof)).toThrow("BUILD_PROVENANCE_INPUT_MISMATCH");
    expect(fixture.context.validation.input_hashes).not.toHaveProperty(DOOR_V44_BUILD_PROVENANCE_KEY);
  });
  it.each(["extra", "absolute_path", "duplicate_file", "unsorted_file", "attestation", "getter", "missing_limit"])("rejects malformed provenance %s without evaluating accessors", mutation => {
    const value = structuredClone(proof);
    let reads = 0;
    if (mutation === "extra") Object.assign(value, { created_at: "PRIVATE" });
    if (mutation === "absolute_path") value.files[0].path = "C:/PRIVATE/file";
    if (mutation === "duplicate_file") value.files.push(value.files[0]);
    if (mutation === "unsorted_file") value.files.reverse();
    if (mutation === "attestation") Object.assign(value, { execution_attestation: true });
    if (mutation === "getter") Object.defineProperty(value, "runtime", { enumerable: true, get: () => { reads++; throw new Error("PRIVATE"); } });
    if (mutation === "missing_limit") value.limitations.pop();
    expect(verifyDoorV44BuildProvenance(value)).toEqual({ ok: false, errors: [{ code: "BUILD_PROVENANCE_INVALID", pointer: "" }] });
    expect(reads).toBe(0);
  });
  it("writes an immutable sidecar included in the manifest and reads the hash-bound proof", async () => {
    const root = owned("bound");
    const result = await writeDoorV44Artifact(root, compiled, proof);
    expect(result.ok, JSON.stringify(result)).toBe(true); if (!result.ok) return;
    expect(result.provenance_status).toBe("observed_local");
    expect(result.compiled.receipt.input_hashes.build_provenance_sha256).toBe(doorV44Hash(proof));
    expect(JSON.parse(await readFile(join(result.directory, "build-provenance.json"), "utf8"))).toEqual(proof);
    const manifest = JSON.parse(await readFile(join(result.directory, "manifest.json"), "utf8"));
    expect(manifest.files).toContainEqual({ path: "build-provenance.json", bytes: Buffer.byteLength(stableDoorJson(proof)), sha256: doorV44Hash(proof) });
    expect(await readDoorV44Artifact(root, compiled.receipt.artifact_hash)).toEqual(result);
    expect(await writeDoorV44Artifact(root, compiled, proof)).toEqual(result);
  });
  it("keeps compiler-only candidates explicitly unattested", async () => {
    const result = await compileDoorV44Page(fixture.spec, fixture.context);
    expect(result.ok).toBe(true); if (!result.ok) return;
    const stored = await writeDoorV44Artifact(owned("unattested"), result);
    expect(stored.ok).toBe(true); if (!stored.ok) return;
    expect(stored.provenance_status).toBe("unattested");
    expect(stored).not.toHaveProperty("build_provenance");
    expect(await readdir(stored.directory)).not.toContain("build-provenance.json");
    expect((await writeDoorV44Artifact(owned("unbound-proof"), result, proof)).ok).toBe(false);
  });
  it.each(["missing", "changed", "foreign_spec"])("refuses a %s sidecar before writing", async mutation => {
    const changed = structuredClone(proof);
    if (mutation === "changed") changed.runtime.node_binary_sha256 = "1".repeat(64);
    if (mutation === "foreign_spec") changed.inputs.spec_sha256 = "2".repeat(64);
    const result = await writeDoorV44Artifact(owned("reject-" + mutation), compiled, mutation === "missing" ? undefined : changed);
    expect(result).toEqual({ ok: false, errors: [{ code: "ARTIFACT_PROVENANCE_MISMATCH", pointer: "" }] });
  });
  it.each(["changed", "deleted"])("rejects %s persisted sidecar on readback", async mutation => {
    const root = owned("tamper-" + mutation);
    const stored = await writeDoorV44Artifact(root, compiled, proof);
    expect(stored.ok).toBe(true); if (!stored.ok) return;
    const path = join(stored.directory, "build-provenance.json");
    if (mutation === "deleted") await unlink(path);
    else { const changed = structuredClone(proof); changed.runtime.node_binary_sha256 = "f".repeat(64); await writeFile(path, stableDoorJson(changed)); }
    expect(await readDoorV44Artifact(root, compiled.receipt.artifact_hash)).toEqual({ ok: false, errors: [{ code: "ARTIFACT_PROVENANCE_MISMATCH", pointer: "" }] });
  });
  it("refuses a hash-consistent proof for another spec", async () => {
    const foreign = structuredClone(proof); foreign.inputs.spec_sha256 = "a".repeat(64);
    const result = await compileDoorV44Page(fixture.spec, injectDoorV44BuildProvenance(fixture.context, foreign));
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(await writeDoorV44Artifact(owned("foreign-bound"), result, foreign)).toEqual({ ok: false, errors: [{ code: "ARTIFACT_PROVENANCE_MISMATCH", pointer: "" }] });
  });
  it.each([false, true])("refuses direct compilation with a foreign-context proof (supplied derived hash: %s)", async supplyDerived => {
    const context = structuredClone(fixture.context);
    context.site.current_year++;
    context.validation.input_hashes.build_provenance_sha256 = doorV44Hash(proof);
    if (supplyDerived) context.validation.input_hashes.context_before_provenance_sha256 = proof.inputs.context_before_provenance_sha256;
    const result = await compileDoorV44Page(fixture.spec, context);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.receipt.input_hashes.context_before_provenance_sha256).not.toBe(proof.inputs.context_before_provenance_sha256);
    expect(await writeDoorV44Artifact(owned("foreign-context"), result, proof)).toEqual({ ok: false, errors: [{ code: "ARTIFACT_PROVENANCE_MISMATCH", pointer: "" }] });
  });
  it.each(["source_records_sha256", "fact_records_sha256", "asset_records_sha256"] as const)("rejects contradictory %s at injection and direct-compile/store boundaries", async key => {
    const contradictory = structuredClone(proof); contradictory.inputs[key] = "0".repeat(64);
    expect(() => injectDoorV44BuildProvenance(fixture.context, contradictory)).toThrow("BUILD_PROVENANCE_INPUT_MISMATCH");
    const context = structuredClone(fixture.context);
    context.validation.input_hashes.build_provenance_sha256 = doorV44Hash(contradictory);
    const result = await compileDoorV44Page(fixture.spec, context);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.receipt.input_hashes.context_before_provenance_sha256).toBe(proof.inputs.context_before_provenance_sha256);
    expect(result.receipt.input_hashes[key]).toBe(proof.inputs[key]);
    expect(await writeDoorV44Artifact(owned("contradictory-" + key), result, contradictory)).toEqual({ ok: false, errors: [{ code: "ARTIFACT_PROVENANCE_MISMATCH", pointer: "" }] });
  });
  it("privately snapshots the sidecar before the first I/O await", async () => {
    const candidateProof = structuredClone(proof);
    const pending = writeDoorV44Artifact(owned("private-copy"), compiled, candidateProof);
    candidateProof.files[0].sha256 = "b".repeat(64);
    const result = await pending;
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.build_provenance).toEqual(proof);
    expect((await readDoorV44Artifact(owned("private-copy"), compiled.receipt.artifact_hash))).toEqual(result);
  });
  it("detects real source drift and failed WORDING/immutable-input preflights in a disposable copied source tree", async () => {
    const root = owned("source-copy");
    // Copy bytes, never hard-link: destructive mutations remain solely in this test-owned directory.
    for (const file of proof.files) { const target = join(root, file.path); await mkdir(dirname(target), { recursive: true }); await copyFile(resolve(file.path), target); }
    const inputPath = owned("input.json"); const proofPath = owned("proof.json");
    await writeFile(inputPath, stableDoorJson(input())); await writeFile(proofPath, stableDoorJson(proof));
    // Native DLLs loaded from the copied installation must be released before Windows cleanup.
    const check = async (operation: "drift" | "collect") => {
      const code = "const fs=require('node:fs');const p=require('./tools/door-v44/provenance.ts');const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const before=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));"
        + "(process.argv[4]==='drift'?p.verifyDoorV44BuildProvenanceUnchanged(process.argv[1],input,before):p.collectDoorV44BuildProvenance(process.argv[1],input)).then(()=>console.log(JSON.stringify({code:'UNEXPECTED_SUCCESS'}))).catch(error=>console.log(JSON.stringify({code:error.code})));";
      const result = await run(process.execPath, ["--import", "tsx", "--eval", code, root, inputPath, proofPath, operation], { cwd: process.cwd(), timeout: 60000 });
      return JSON.parse(result.stdout).code;
    };
    const renderer = join(root, "src/domain/search/door-v44/render.ts");
    const original = await readFile(renderer);
    await writeFile(renderer, Buffer.concat([original, Buffer.from("\n// synthetic drift\n")]));
    expect(await check("drift")).toBe("BUILD_SOURCE_DRIFT");
    await writeFile(renderer, original);
    const wording = join(root, "content/door-template/v44/wording/sources/WORDING.mechanical.md");
    const originalWording = await readFile(wording);
    await writeFile(wording, Buffer.concat([originalWording, Buffer.from("\nsynthetic corruption\n")]));
    expect(await check("collect")).toBe("BUILD_WORDING_PREFLIGHT_FAILED");
    await writeFile(wording, originalWording);
    await writeFile(join(root, "package-lock.json"), "{}\n");
    expect(await check("collect")).toBe("BUILD_INPUT_PREFLIGHT_FAILED");
  }, 60000); // Bounded copied dependency/native-byte I/O, including full-suite disk contention.
  it("fresh canonical CLI processes reproduce provenance, HTML, semantic and artifact hashes", async () => {
    const results = await Promise.all(["fresh-a", "fresh-b"].map(name => run(process.execPath, ["--import", "tsx", "tools/door-v44/build.ts", "--fixture", "f04", "--root", owned(name)],
      { cwd: process.cwd(), timeout: 60000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: "" } })));
    const [a, b] = results.map(result => JSON.parse(result.stdout));
    expect(a.ok, JSON.stringify(a)).toBe(true); expect(b.ok, JSON.stringify(b)).toBe(true);
    expect(a.provenance_status).toBe("observed_local"); expect(a.execution_attestation).toBe(false);
    expect(a.receipt).toEqual(b.receipt);
    expect(await readFile(join(a.directory, "index.html"))).toEqual(await readFile(join(b.directory, "index.html")));
    expect(await readFile(join(a.directory, "build-provenance.json"))).toEqual(await readFile(join(b.directory, "build-provenance.json")));
    expect(a.release_ready).toBe(false); expect(a.publication).toBe("NOT_ATTEMPTED");
  }, 60000); // Two fresh processes each perform independent before/after raw-byte inventories.
  it("rejects an ambient custom Node loader option before artifact persistence", async () => {
    try {
      await run(process.execPath, ["--import", "tsx", "tools/door-v44/build.ts", "--fixture", "f04", "--root", owned("ambient")],
        { cwd: process.cwd(), timeout: 20000, env: { ...process.env, NODE_OPTIONS: "--no-warnings" } });
      throw new Error("CLI unexpectedly accepted ambient options");
    } catch (error) {
      expect(JSON.parse((error as { stdout: string }).stdout).errors).toEqual([{ code: "BUILD_INVOCATION_UNSUPPORTED", pointer: "" }]);
    }
  });
});
