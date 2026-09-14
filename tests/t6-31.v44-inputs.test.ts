import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { DOOR_V44_INPUT_MANIFEST_PATH, DOOR_V44_INPUT_MANIFEST_SHA256, doorV44InputHashes, verifyDoorV44Inputs, type DoorV44InputManifest } from "../src/domain/search/door-v44/input-integrity";

const repo = path.resolve(import.meta.dirname, "..");
const manifestPath = DOOR_V44_INPUT_MANIFEST_PATH;
const referencePath = "content/door-template/v43/reference/approved-v43.html";
let manifest: DoorV44InputManifest;
let protectedBefore: Map<string, string>;
let scratch: string;
let root: string;
const originalRequire = createRequire(import.meta.url);
const verify = (workspace = root, pin = DOOR_V44_INPUT_MANIFEST_SHA256) => verifyDoorV44Inputs({ root: workspace, manifestPath, expectedManifestSha256: pin, runtime: { node_version: "v24.14.1" } });
const codes = (result: Awaited<ReturnType<typeof verify>>) => result.diagnostics.map((item) => item.code);

async function protectedHashes() {
  const map = new Map<string, string>();
  async function walk(directory: string): Promise<void> {
    for (const item of await readdir(path.join(repo, directory), { withFileTypes: true })) {
      const name = directory + "/" + item.name;
      if (item.isDirectory()) await walk(name);
      else map.set(name, doorV44InputHashes(await readFile(path.join(repo, name))).raw_sha256);
    }
  }
  await walk("content/door-template/v43");
  await walk("content/door-template/amendments");
  const assetConfig = "config/ac-door-copy-amendment-assets.json";
  map.set(assetConfig, doorV44InputHashes(await readFile(path.join(repo, assetConfig))).raw_sha256);
  return map;
}

beforeAll(async () => {
  manifest = JSON.parse(await readFile(path.join(repo, manifestPath), "utf8"));
  protectedBefore = await protectedHashes();
  scratch = await mkdtemp(path.join(os.tmpdir(), "door-v44-input-tests-"));
});
beforeEach(async () => {
  root = await mkdtemp(path.join(scratch, "case-"));
  for (const name of [manifestPath, ...manifest.files.map((file) => file.path)]) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await copyFile(path.join(repo, name), path.join(root, name));
  }
});
afterEach(async () => {
  // Each deletion is confined to the test-owned absolute scratch child.
  expect(path.dirname(root)).toBe(scratch);
  await rm(root, { recursive: true, force: true });
});
afterAll(async () => {
  expect(await protectedHashes()).toEqual(protectedBefore);
  expect(path.dirname(scratch)).toBe(os.tmpdir());
  expect(path.basename(scratch)).toMatch(/^door-v44-input-tests-/);
  await rm(scratch, { recursive: true, force: true });
});

describe("v44 immutable inputs (no render or release acceptance)", () => {
  it("verifies all actual pins, remains deterministic, and reports known unavailable evidence", async () => {
    const first = await verify();
    expect(first.ok).toBe(true);
    expect(await verify()).toEqual(first);
    expect(first.files).toHaveLength(manifest.files.length);
    expect(first.files.every((file) => file.raw_equal && file.lf_equal)).toBe(true);
    expect(first).toMatchObject({ release_ready: false, clean_wording_available: false, scope: "immutable_input_identity_only" });
    expect(first.limitations.map((item) => item.code)).toEqual(expect.arrayContaining([
      "WORDING_CONTROL_CHARACTERS_QUARANTINED", "WORDING_WORKSPACE_TWIN_UNAVAILABLE", "VALIDATOR_WORKSPACE_TWIN_UNAVAILABLE", "SECOND_HOST_EVIDENCE_UNAVAILABLE",
    ]));
    expect(first.files.filter((file) => file.quarantined).map((file) => file.path)).toEqual(["content/door-template/v44/inputs/sources/vault-WORDING.md"]);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toMatch(/[A-Z]:[\\/]|@(?!type)/);
  });

  it("uses independent approved raw and LF identities, not hashes of a generated candidate", async () => {
    const original = await readFile(path.join(root, referencePath));
    expect(doorV44InputHashes(original)).toEqual({
      raw_sha256: "cfb4a1b532f06a50040459a6de173e33e96aee8913c3d02884f4a8b85b69044a",
      lf_sha256: "756fb95907fd3fb21f7bc9a86e854d0e90f8ef35455776b83a17b4935f8d8843",
    });
    const vault = await readFile(path.join(root, "content/door-template/v44/inputs/sources/vault-approved-v43.html"));
    expect(doorV44InputHashes(vault).raw_sha256).toBe(doorV44InputHashes(original).lf_sha256);
  });

  it.each([
    ["visible text", "What is your AC doing right now?", "What is your AC doing right now!"],
    ["CSS", "letter-spacing:.07em!important", "letter-spacing:.08em!important"],
    ["section ID", 'id="related"', 'id="relateX"'],
    ["attribute", 'lang="en"', 'lang="es"'],
  ])("rejects a one-byte %s mutation", async (_label, from, to) => {
    const source = await readFile(path.join(root, referencePath), "utf8");
    expect(source).toContain(from);
    expect(Buffer.byteLength(from)).toBe(Buffer.byteLength(to));
    await writeFile(path.join(root, referencePath), source.replace(from, to));
    const result = await verify();
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(expect.arrayContaining(["INPUT_RAW_HASH", "INPUT_LF_HASH"]));
  });

  it("accepts only the separately recorded LF checkout representation and still records actual raw identity", async () => {
    const source = await readFile(path.join(root, referencePath), "utf8");
    await writeFile(path.join(root, referencePath), source.replace(/\r\n/g, "\n"));
    const result = await verify();
    expect(result.ok).toBe(true);
    expect(result.files.find((file) => file.path === referencePath)).toMatchObject({ raw_equal: false, raw_approved: true, lf_equal: true, representation: "recorded_lf" });
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["LF", "CRLF"])("verifies all inputs relocated with known %s checkout bytes, including quarantined controls at their pinned offsets", async (encoding) => {
    for (const file of manifest.files) {
      const bytes = await readFile(path.join(root, file.path));
      const lf = bytes.toString("utf8").replace(/\r\n/g, "\n");
      await writeFile(path.join(root, file.path), encoding === "LF" ? lf : lf.replace(/\n/g, "\r\n"));
    }
    const result = await verify();
    expect(result.ok).toBe(true);
    expect(result.files.every((file) => file.raw_approved && file.lf_equal)).toBe(true);
    expect(result.files.find((file) => file.path.endsWith("vault-WORDING.md"))).toMatchObject({ quarantined: true });
    if (encoding === "LF") expect(result.files.find((file) => file.path.endsWith("vault-WORDING.md"))).toMatchObject({ raw_equal: false, representation: "recorded_lf" });
    expect(result.clean_wording_available).toBe(false);
    expect(result.release_ready).toBe(false);
  });

  it.each(["mixed", "partly_crlf"])("rejects %s encodings even when LF semantics match", async (encoding) => {
    const file = encoding === "mixed" ? referencePath : "content/door-template/v44/inputs/sources/vault-approved-v43.html";
    const source = await readFile(path.join(root, file), "utf8");
    await writeFile(path.join(root, file), encoding === "mixed" ? source.replace("\r\n", "\n") : source.replace("\n", "\r\n"));
    const result = await verify();
    expect(result.ok).toBe(false);
    expect(result.files.find((item) => item.path === file)).toMatchObject({ raw_equal: false, raw_approved: false, lf_equal: true, representation: "unrecognized" });
    expect(codes(result)).toContain("INPUT_RAW_HASH");
  });

  it("does not normalize lone CR or a UTF-8 BOM", () => {
    expect(doorV44InputHashes(Buffer.from("a\r\nb")).lf_sha256).toBe(doorV44InputHashes(Buffer.from("a\nb")).raw_sha256);
    expect(doorV44InputHashes(Buffer.from("a\rb")).lf_sha256).not.toBe(doorV44InputHashes(Buffer.from("a\nb")).lf_sha256);
    expect(doorV44InputHashes(Buffer.from("\ufeffa\nb")).lf_sha256).not.toBe(doorV44InputHashes(Buffer.from("a\nb")).lf_sha256);
  });

  it.each([["backspace", [8], "INPUT_CONTROL_CHARACTER"], ["NUL", [0], "INPUT_CONTROL_CHARACTER"], ["DEL", [127], "INPUT_CONTROL_CHARACTER"], ["invalid UTF-8", [255], "INPUT_UTF8"], ["BOM", [239, 187, 191], "INPUT_BOM"]] as const)("rejects introduced %s without echoing source text", async (_label, prefix, code) => {
    const source = await readFile(path.join(root, referencePath));
    await writeFile(path.join(root, referencePath), Buffer.concat([Buffer.from(prefix), source]));
    const result = await verify();
    expect(codes(result)).toContain(code);
    expect(result.diagnostics.every((item) => Object.keys(item).sort().join(",") === "code,pointer")).toBe(true);
  });

  it("preserves four inherited WORDING backspaces as quarantined evidence and rejects silent repair", async () => {
    const file = manifest.files.find((item) => item.role === "quarantined_evidence")!;
    expect(file.known_controls).toEqual([267675, 267839, 271662, 271702].map((byte_offset) => ({ byte_offset, code: 8 })));
    const bytes = await readFile(path.join(root, file.path));
    for (const control of file.known_controls) expect(bytes[control.byte_offset]).toBe(8);
    await writeFile(path.join(root, file.path), Buffer.from([...bytes].filter((byte) => byte !== 8)));
    expect(codes(await verify())).toEqual(expect.arrayContaining(["INPUT_RAW_HASH", "INPUT_CONTROL_CHARACTER"]));
  });

  it("refuses a source plus manifest repin against the independent manifest constant", async () => {
    const bytes = Buffer.from("tampered candidate");
    await writeFile(path.join(root, referencePath), bytes);
    const candidate = structuredClone(manifest);
    Object.assign(candidate.files.find((item) => item.path === referencePath)!, doorV44InputHashes(bytes), { bytes: bytes.length });
    await writeFile(path.join(root, manifestPath), JSON.stringify(candidate));
    const result = await verify();
    expect(codes(result)).toEqual(["INPUT_MANIFEST_HASH"]);
    expect(result.files).toEqual([]);
  });

  it("fails closed for missing files and an unproven Node version", async () => {
    await rm(path.join(root, referencePath));
    const result = await verifyDoorV44Inputs({ root, manifestPath, expectedManifestSha256: DOOR_V44_INPUT_MANIFEST_SHA256, runtime: { node_version: "v22.17.0" } });
    expect(codes(result)).toEqual(expect.arrayContaining(["INPUT_FILE_UNAVAILABLE", "INPUT_NODE_VERSION"]));
    expect(result.ok).toBe(false);
  });

  it("rejects explicit manifest traversal without exposing a private path", async () => {
    const result = await verifyDoorV44Inputs({ root, manifestPath: "../private-input.json", expectedManifestSha256: DOOR_V44_INPUT_MANIFEST_SHA256, runtime: { node_version: "v24.14.1" } });
    expect(codes(result)).toEqual(["INPUT_PATH_INVALID"]);
    expect(JSON.stringify(result)).not.toContain("private-input");
  });

  it("rejects a symlinked input directory outside the explicitly supplied root", async () => {
    const directory = "content/door-template/v44/inputs/sources";
    const target = path.join(root, directory);
    await rm(target, { recursive: true });
    await symlink(path.join(repo, directory), target, "junction");
    expect(codes(await verify())).toContain("INPUT_PATH_ESCAPE");
    await rm(target); // Remove the junction, never its target.
  });

  it("rejects malformed manifests even with an explicitly supplied matching test pin", async () => {
    const bytes = Buffer.from(JSON.stringify({ ...manifest, files: [{ ...manifest.files[0], path: "../escaped", unexpected: true }] }));
    await writeFile(path.join(root, manifestPath), bytes);
    const result = await verify(root, doorV44InputHashes(bytes).raw_sha256);
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("INPUT_MANIFEST_SHAPE");
  });

  it("rejects duplicate file identities with an explicit synthetic manifest pin", async () => {
    const bytes = Buffer.from(JSON.stringify({ ...manifest, files: [...manifest.files, manifest.files[0]] }));
    await writeFile(path.join(root, manifestPath), bytes);
    expect(codes(await verify(root, doorV44InputHashes(bytes).raw_sha256))).toContain("INPUT_DUPLICATE_PATH");
  });

  it("CLI exits 0 only for identity, 1 for tamper, and 2 for unsafe receipt destinations", async () => {
    const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", path.join(repo, "tools/door-v44/inputs.ts"), "--root", root, ...args], { cwd: repo, encoding: "utf8", timeout: 20000 });
    const clean = run();
    expect(clean.status, clean.stderr).toBe(0);
    expect(JSON.parse(clean.stdout)).toMatchObject({ ok: true, release_ready: false, clean_wording_available: false });
    await mkdir(path.join(root, "artifacts/door-v44/input-contracts"), { recursive: true });
    const receipt = "artifacts/door-v44/input-contracts/input-test.json";
    expect(run("--output", receipt).status).toBe(0);
    const saved = await readFile(path.join(root, receipt));
    expect(run("--output", receipt).status).toBe(2);
    expect(await readFile(path.join(root, receipt))).toEqual(saved);
    expect(run("--root", root).status).toBe(2); // Duplicate named arguments are ambiguous.
    expect(run("--output", manifestPath).status).toBe(2);
    expect(await readFile(path.join(root, manifestPath))).toEqual(await readFile(path.join(repo, manifestPath)));
    await writeFile(path.join(root, referencePath), "changed");
    const tampered = run();
    expect(tampered.status, tampered.stderr).toBe(1);
    expect(JSON.parse(tampered.stdout).ok).toBe(false);
  });

  it("re-runs the original seven fidelity scenarios with the unchanged original functions on an isolated copy", async () => {
    const kit = path.join(root, "content/door-template/v43");
    const { build } = originalRequire(path.join(kit, "build.js")) as { build: (spec: string, order: string, options: { dateModified: string }) => { html: string; dateModified: string } };
    const { compareV43 } = originalRequire(path.join(kit, "tools/fidelity-v43.js")) as { compareV43: (source: string, html: string, date: string) => { pass: boolean } };
    const source = await readFile(path.join(root, referencePath), "utf8");
    const result = build(path.join(kit, "spec/ac-blowing-warm-air"), path.join(kit, "TEMPLATE_SECTION_ORDER.json"), { dateModified: "2026-09-05" });
    expect(result.dateModified).toBe("2026-09-05");
    expect(compareV43(source, result.html, result.dateModified).pass).toBe(true);
    expect(compareV43(source.replace(/\r?\n/g, "\r\n"), result.html, result.dateModified).pass).toBe(true);
    for (const [from, to] of [
      ["What is your AC doing right now?", "What is the problem?"],
      ["letter-spacing:.07em!important", "letter-spacing:.08em!important"],
      ['id="related"', 'id="related-changed"'],
      ['"dateModified": "2026-09-05"', '"dateModified": "2099-01-01"'],
    ]) {
      expect(result.html).toContain(from);
      expect(compareV43(source, result.html.replace(from, to), result.dateModified).pass).toBe(false);
    }
    expect(() => compareV43(source.replace("<html", "<HTML"), result.html, result.dateModified)).toThrow(/reference changed/);
    // build() returns a string; no output file or frozen input is modified.
    expect((await verify()).ok).toBe(true);
  });

  it("pins every protected file independently of the manifest's claimed file list", () => {
    const listed = new Map(manifest.files.map((file) => [file.path, file.raw_sha256]));
    for (const [name, hash] of protectedBefore) expect(listed.get(name), name).toBe(hash);
    expect(protectedBefore.size).toBeGreaterThan(50);
  });
});
