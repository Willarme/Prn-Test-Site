import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DoorV44CompilerContext } from "../../src/domain/search/door-v44/compiler-types";
import { DOOR_V44_DERIVED_HASH_KEYS, doorV44ReservedInputHashErrors, verifyDoorV44BuildProvenance, type DoorV44BuildProvenance, type DoorV44ObservedFile } from "../../src/domain/search/door-v44/build-provenance";
import { doorV44Hash, isPlainDoorJson } from "../../src/domain/search/door-v44/schema-engine";
import { DOOR_V44_INPUT_MANIFEST_PATH, DOOR_V44_INPUT_MANIFEST_SHA256, verifyDoorV44Inputs } from "../../src/domain/search/door-v44/input-integrity";
import { DOOR_V44_WORDING_DERIVATIVE_SHA256, DOOR_V44_WORDING_MANIFEST_SHA256, DOOR_V44_WORDING_RULES_SHA256, verifyDoorV44WordingDerivative } from "../../src/domain/search/door-v44/wording";

export class DoorV44ProvenanceError extends Error {
  constructor(readonly code: string) { super(code); }
}
function fail(code: string): never { throw new DoorV44ProvenanceError(code); }
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const versions = (rows: Record<string, string | undefined>) => Object.entries(rows).filter((row): row is [string, string] => typeof row[1] === "string")
  .map(([name, version]) => ({ name, version })).sort((a, b) => order(a.name, b.name));

/** This CLI deliberately supports one local launcher, without ambient loader/config overrides. */
export function assertDoorV44BuildInvocation(): void {
  if (JSON.stringify(process.execArgv) !== JSON.stringify(["--import", "tsx"])
    || ["NODE_OPTIONS", "NODE_PATH", "TSX_TSCONFIG_PATH", "ESBUILD_BINARY_PATH", "SHARP_FORCE_GLOBAL_LIBVIPS", "SHARP_DIST_BASE_URL"].some(key => !!process.env[key])) fail("BUILD_INVOCATION_UNSUPPORTED");
}

async function fileIdentity(path: string, name: string): Promise<DoorV44ObservedFile> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > 256 * 1024 * 1024) fail("BUILD_FILE_UNSAFE");
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  const after = await lstat(path);
  if (bytes !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || before.dev !== after.dev || after.isSymbolicLink()) fail("BUILD_SOURCE_DRIFT");
  return { path: name, bytes, sha256: hash.digest("hex") };
}
async function safeFile(root: string, name: string): Promise<string> {
  const target = resolve(root, name);
  const rel = relative(root, target);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep)) fail("BUILD_FILE_UNSAFE");
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) fail("BUILD_FILE_UNSAFE");
  }
  return target;
}
async function filesIn(root: string, name: string, packageTree = false): Promise<string[]> {
  const path = await safeFile(root, name);
  const info = await lstat(path);
  if (info.isFile()) return [name];
  if (!info.isDirectory()) fail("BUILD_FILE_UNSAFE");
  const result: string[] = [];
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => order(a.name, b.name))) {
    if (packageTree && entry.name === "node_modules") continue; // Traversed by actual package resolution below.
    if (entry.isSymbolicLink()) fail("BUILD_FILE_UNSAFE");
    result.push(...await filesIn(root, name + "/" + entry.name, packageTree));
    if (result.length > 10000) fail("BUILD_INVENTORY_LIMIT");
  }
  return result;
}
async function parsed(path: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path)));
  if (!isPlainDoorJson(value) || !value || Array.isArray(value) || typeof value !== "object") fail("BUILD_INPUT_INVALID");
  return value as Record<string, unknown>;
}
async function installedPackages(root: string): Promise<DoorV44BuildProvenance["packages"]> {
  const lock = await parsed(await safeFile(root, "package-lock.json"));
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object") fail("BUILD_TOOLCHAIN_INVALID");
  const result = new Map<string, DoorV44BuildProvenance["packages"][number]>();
  async function visit(name: string, from: string, optional = false): Promise<void> {
    if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name)) fail("BUILD_TOOLCHAIN_INVALID");
    const lookup = createRequire(join(from, "package.json")).resolve.paths(name + "/package.json") ?? [];
    let location: string | undefined;
    for (const base of lookup) {
      const rel = relative(root, base);
      if (isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep)) continue;
      const candidate = join(base, name, "package.json");
      try { await lstat(candidate); location = candidate; break; } catch (error) { if (!missing(error)) throw error; }
    }
    if (!location) { if (optional) return; fail("BUILD_DEPENDENCY_MISSING"); }
    const packagePath = relative(root, dirname(location)).split(sep).join("/");
    await safeFile(root, packagePath + "/package.json");
    if (result.has(packagePath)) return;
    const pkg = await parsed(location);
    const pinned = (lock.packages as Record<string, { version?: unknown }>)[packagePath];
    if (pkg.name !== name || typeof pkg.version !== "string" || !pinned || pinned.version !== pkg.version) fail("BUILD_TOOLCHAIN_LOCK_MISMATCH");
    result.set(packagePath, { name, version: pkg.version, path: packagePath });
    if (result.size > 300) fail("BUILD_INVENTORY_LIMIT");
    for (const [field, optionalDependency] of [["dependencies", false], ["optionalDependencies", true]] as const) {
      if (pkg[field] !== undefined && (!pkg[field] || typeof pkg[field] !== "object" || Array.isArray(pkg[field]))) fail("BUILD_TOOLCHAIN_INVALID");
      for (const dependency of Object.keys((pkg[field] ?? {}) as object).sort()) await visit(dependency, dirname(location), optionalDependency);
    }
  }
  for (const name of ["ajv", "sharp", "tsx", "typescript", "zod"]) await visit(name, root);
  return [...result.values()].sort((a, b) => order(a.path, b.path));
}

export type DoorV44ProvenanceInputs = { spec: unknown; context: DoorV44CompilerContext; input_mode: DoorV44BuildProvenance["input_mode"] };
/** Reads explicit local bytes only. The returned hashes are observations, not approval or a loader trace. */
export async function collectDoorV44BuildProvenance(repositoryRoot: string, input: DoorV44ProvenanceInputs): Promise<DoorV44BuildProvenance> {
  if (!isPlainDoorJson(input.spec) || !isPlainDoorJson(input.context) || !input.context?.validation
    || doorV44ReservedInputHashErrors(input.context.validation.input_hashes).length) fail("BUILD_RESERVED_OR_INVALID_INPUT");
  const root = await realpath(repositoryRoot);
  const integrity = await verifyDoorV44Inputs({ root, manifestPath: DOOR_V44_INPUT_MANIFEST_PATH, expectedManifestSha256: DOOR_V44_INPUT_MANIFEST_SHA256, runtime: { node_version: process.version } });
  if (!integrity.ok) fail("BUILD_INPUT_PREFLIGHT_FAILED");
  const wordingPaths = ["content/door-template/v44/inputs/sources/vault-WORDING.md", "content/door-template/v44/wording/sources/WORDING.mechanical.md", "content/door-template/v44/wording/manifest.json", "content/door-template/v44/wording/rules.json"];
  const [source, derivative, manifest, rules] = await Promise.all(wordingPaths.map(async path => readFile(await safeFile(root, path))));
  if (!verifyDoorV44WordingDerivative({ source, derivative, manifest, rules }).ok) fail("BUILD_WORDING_PREFLIGHT_FAILED");
  const packages = await installedPackages(root);
  const names = new Set(integrity.files.map(file => file.path));
  for (const directory of ["src/domain/search/door-v44", "tools/door-v44", "content/door-template/v44", "tests/fixtures/door-v44"])
    for (const file of await filesIn(root, directory)) names.add(file);
  for (const pkg of packages) for (const file of await filesIn(root, pkg.path, true)) names.add(file);
  for (const file of ["package.json", "package-lock.json", "tsconfig.json"]) names.add(file);
  if (names.size > 10000) fail("BUILD_INVENTORY_LIMIT");
  const files: DoorV44ObservedFile[] = [];
  for (const name of [...names].sort()) files.push(await fileIdentity(await safeFile(root, name), name));
  const localRequire = createRequire(join(root, "package.json"));
  const sharp = localRequire("sharp") as { versions: Record<string, string> };
  const provenance: DoorV44BuildProvenance = {
    format: "door-v44-build-provenance/1.0.0", scope: "local_file_observation_before_and_after_compile", execution_attestation: false,
    inventory_policy: "v44_source_content_fixture_superset_and_installed_dependency_closure", input_mode: input.input_mode,
    inputs: { spec_sha256: doorV44Hash(input.spec), context_before_provenance_sha256: doorV44Hash(input.context),
      source_records_sha256: doorV44Hash(input.context.source_records), fact_records_sha256: doorV44Hash(input.context.fact_records), asset_records_sha256: doorV44Hash(input.context.asset_records) },
    preflight: { input_manifest_sha256: DOOR_V44_INPUT_MANIFEST_SHA256, wording_manifest_sha256: DOOR_V44_WORDING_MANIFEST_SHA256,
      wording_derivative_sha256: DOOR_V44_WORDING_DERIVATIVE_SHA256, wording_rules_sha256: DOOR_V44_WORDING_RULES_SHA256 },
    files, packages, runtime: { node_version: process.version, node_binary_sha256: (await fileIdentity(process.execPath, "node")).sha256,
      platform: process.platform, arch: process.arch, versions: versions(process.versions), sharp_versions: versions(sharp.versions) },
    limitations: ["NO_EXECUTION_SNAPSHOT_OR_ABA_PROTECTION", "NO_HOST_OR_OS_LIBRARY_ATTESTATION", "NO_SECOND_HOST_OR_CI_PROOF", "NO_BROWSER_FONT_OR_RELEASE_APPROVAL"],
  };
  const verified = verifyDoorV44BuildProvenance(provenance);
  if (!verified.ok) fail("BUILD_PROVENANCE_INVALID");
  return verified.provenance;
}

/** Recollection catches ordinary additions/removals/changes too; ABA and loaded-module identity remain unproven. */
export async function verifyDoorV44BuildProvenanceUnchanged(root: string, input: DoorV44ProvenanceInputs, before: DoorV44BuildProvenance): Promise<void> {
  const after = await collectDoorV44BuildProvenance(root, input);
  if (doorV44Hash(before) !== doorV44Hash(after)) fail("BUILD_SOURCE_DRIFT");
}

export function injectDoorV44BuildProvenance(context: DoorV44CompilerContext, provenance: DoorV44BuildProvenance): DoorV44CompilerContext {
  if (!isPlainDoorJson(context) || doorV44ReservedInputHashErrors(context?.validation?.input_hashes).length) fail("BUILD_RESERVED_OR_INVALID_INPUT");
  const verified = verifyDoorV44BuildProvenance(provenance);
  if (!verified.ok || doorV44Hash(context) !== verified.provenance.inputs.context_before_provenance_sha256
    || doorV44Hash(context.source_records) !== verified.provenance.inputs.source_records_sha256
    || doorV44Hash(context.fact_records) !== verified.provenance.inputs.fact_records_sha256
    || doorV44Hash(context.asset_records) !== verified.provenance.inputs.asset_records_sha256) fail("BUILD_PROVENANCE_INPUT_MISMATCH");
  return { ...context, validation: { ...context.validation, input_hashes: { ...context.validation.input_hashes, [DOOR_V44_DERIVED_HASH_KEYS[0]]: verified.sha256 } } };
}
