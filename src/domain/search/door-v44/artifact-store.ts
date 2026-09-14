import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import type { DoorV44CompileResult } from "./compiler-types";
import { doorV44ArtifactHash } from "./artifact-hash";
import { renderDoorV44Document } from "./render";
import { verifyDoorV44SemanticContract } from "./semantic-contract";
import { doorV44Hash, isPlainDoorJson, stableDoorJson } from "./schema-engine";
import { DOOR_V44_BUILD_PROVENANCE_KEY, verifyDoorV44BuildProvenance, type DoorV44BuildProvenance } from "./build-provenance";

type Candidate = Extract<DoorV44CompileResult, { ok: true }>;
export type DoorV44ArtifactResult = {
  ok: true; artifact_hash: string; directory: string; compiled: Candidate;
  provenance_status: "unattested" | "observed_local"; build_provenance?: DoorV44BuildProvenance;
} | { ok: false; errors: Array<{ code: string; pointer: string }> };

/** Private, immutable evidence bodies. These are never part of the public asset
 * allow-list. Capture canonical bytes before I/O and verify a replay in place. */
export async function writeDoorV44EvidenceJson(root: string, value: unknown): Promise<{ sha256: string; bytes: number }> {
  if (!isPlainDoorJson(value)) refuse("ARTIFACT_INPUT_INVALID");
  const bytes = Buffer.from(stableDoorJson(value), "utf8");
  if (bytes.length > MAX_FILE) refuse("ARTIFACT_INPUT_INVALID");
  const sha256 = digest(bytes), directoryPath = join(rootPath(root), "evidence");
  await directory(directoryPath, true);
  const path = join(directoryPath, sha256 + ".json");
  const temporary = join(directoryPath, ".pending-" + randomUUID());
  let created = false;
  try {
    const file = await open(temporary, "wx", 0o600); created = true;
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    // A crash can leave a private pending file, never a partial canonical file.
    // Linking publishes only complete bytes and cannot replace an earlier record.
    try { await link(temporary, path); } catch (error) { if (errorCode(error) !== "EEXIST") throw error; }
    const saved = await readBytes(path);
    if (!saved.equals(bytes)) refuse("ARTIFACT_CORRUPT");
    return { sha256, bytes: saved.length };
  } finally {
    if (created) await unlink(temporary).catch(error => { if (errorCode(error) !== "ENOENT") throw error; });
  }
}

export async function readDoorV44EvidenceJson(root: string, sha256: string): Promise<unknown> {
  if (!HASH.test(sha256)) refuse("ARTIFACT_INPUT_INVALID");
  const bytes = await readBytes(join(rootPath(root), "evidence", sha256 + ".json"));
  if (digest(bytes) !== sha256) refuse("ARTIFACT_CORRUPT");
  return json(bytes);
}
type Binding = { tenant_id: string; page_id: string; page_version: number; artifact_hash: string; manifest_hash: string };
type Manifest = {
  format: "door-v44-artifact/1.0.0"; artifact_hash: string;
  files: Array<{ path: string; sha256: string; bytes: number }>;
};
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MAX_FILE = 32 * 1024 * 1024;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
class Refusal extends Error { constructor(readonly code: string) { super(code); } }
function refuse(code: string): never { throw new Refusal(code); }
const failure = (error: unknown): DoorV44ArtifactResult => ({ ok: false, errors: [{ code: error instanceof Refusal ? error.code : "ARTIFACT_IO", pointer: "" }] });
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

/** Reject existing symlinks at every component; this store requires an owned, nonshared root. */
async function directory(path: string, create = false): Promise<void> {
  const parent = dirname(path);
  if (parent !== path) await directory(parent, create);
  const stat = await lstat(path).catch(async error => {
    if (!create || errorCode(error) !== "ENOENT") throw error;
    await mkdir(path).catch(collision => { if (errorCode(collision) !== "EEXIST") throw collision; });
    return lstat(path);
  });
  if (stat.isSymbolicLink() || !stat.isDirectory()) refuse("ARTIFACT_UNSAFE_PATH");
}
function rootPath(root: string): string {
  if (typeof root !== "string" || !isAbsolute(root) || root.includes("\0")) refuse("ARTIFACT_UNSAFE_PATH");
  const path = resolve(root);
  if (path === parse(path).root) refuse("ARTIFACT_UNSAFE_PATH");
  return path;
}
async function readBytes(path: string): Promise<Buffer> {
  await directory(dirname(path));
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile()) refuse("ARTIFACT_UNSAFE_PATH");
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_FILE || stat.ino !== before.ino || stat.dev !== before.dev) refuse("ARTIFACT_CORRUPT");
    const bytes = await file.readFile();
    if (bytes.length !== stat.size) refuse("ARTIFACT_CORRUPT");
    return bytes;
  } finally { await file.close(); }
}
async function writeBytes(path: string, bytes: Buffer): Promise<void> {
  await directory(dirname(path));
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
function json(bytes: Buffer): unknown {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isPlainDoorJson(value)) refuse("ARTIFACT_CORRUPT");
    return value;
  } catch { return refuse("ARTIFACT_CORRUPT"); }
}
function assetFile(path: string): string {
  if (typeof path !== "string" || !/^\/media\/door-v44\/[a-f0-9]{64}\.(png|webp)$/.test(path)) refuse("ARTIFACT_UNSAFE_PATH");
  return "assets/" + path.slice("/media/door-v44/".length);
}

/** Synchronous private copy precedes every await, including directory creation. */
function copyCandidate(value: Candidate): Candidate {
  const ancestors = new Set<object>();
  let remaining = 200000;
  function copy(current: unknown, depth: number): unknown {
    if (--remaining < 0 || depth > 64) refuse("ARTIFACT_INPUT_INVALID");
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "number" && Number.isFinite(current)) return current;
    if (typeof current === "string" && current.length <= MAX_FILE) return current;
    if (typeof current !== "object" || current === null || ancestors.has(current)) refuse("ARTIFACT_INPUT_INVALID");
    const array = Array.isArray(current);
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null && !(array && prototype === Array.prototype)) refuse("ARTIFACT_INPUT_INVALID");
    if (Object.getOwnPropertySymbols(current).length) refuse("ARTIFACT_INPUT_INVALID");
    ancestors.add(current);
    const result: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(current))) {
      if (array && key === "length") continue;
      if (!("value" in descriptor) || !descriptor.enumerable
        || ["__proto__", "constructor", "prototype"].includes(key) || (array && !/^(0|[1-9]\d*)$/.test(key))) refuse("ARTIFACT_INPUT_INVALID");
      result[key] = copy(descriptor.value, depth + 1);
    }
    ancestors.delete(current);
    if (array && Object.keys(result).length !== current.length) refuse("ARTIFACT_INPUT_INVALID");
    return array ? Object.values(result) : result;
  }
  const encoded = stableDoorJson(copy(value, 0));
  if (encoded.length > 64 * 1024 * 1024) refuse("ARTIFACT_INPUT_INVALID");
  return JSON.parse(encoded) as Candidate;
}
function plan(candidate: Candidate, suppliedProvenance?: unknown) {
  const { receipt, document, html, assets } = candidate;
  if (candidate.ok !== true || !receipt || !document || typeof html !== "string" || !Array.isArray(assets)
    || typeof receipt.tenant_id !== "string" || !ID.test(receipt.tenant_id) || typeof receipt.page_id !== "string" || !ID.test(receipt.page_id)
    || typeof receipt.canonical_intent_id !== "string" || !ID.test(receipt.canonical_intent_id)
    || !Number.isSafeInteger(receipt.page_version) || receipt.page_version < 1
    || !HASH.test(receipt.artifact_hash) || receipt.release_ready !== false) refuse("ARTIFACT_INPUT_INVALID");
  const rendered = renderDoorV44Document(document);
  if (!rendered.ok || rendered.html !== html || rendered.html_hash !== receipt.html_hash || rendered.semantic_hash !== receipt.semantic_hash
    || document.receipt_id !== receipt.receipt_id || document.canonical_url !== receipt.canonical_url
    || document.robots !== receipt.robots || document.date_modified !== receipt.date_modified) refuse("ARTIFACT_HASH_MISMATCH");
  if (receipt.receipt_id !== "d44_" + doorV44Hash({ inputs: receipt.input_hashes, compiler: receipt.compiler_version })) refuse("ARTIFACT_HASH_MISMATCH");
  const files = new Map<string, Buffer>();
  const put = (path: string, bytes: Buffer) => {
    if (bytes.length > MAX_FILE) refuse("ARTIFACT_INPUT_INVALID");
    const previous = files.get(path);
    if (previous && !previous.equals(bytes)) refuse("ARTIFACT_HASH_MISMATCH");
    files.set(path, bytes);
  };
  let provenance: DoorV44BuildProvenance | undefined;
  const provenanceHash = receipt.input_hashes[DOOR_V44_BUILD_PROVENANCE_KEY];
  if (provenanceHash !== undefined || suppliedProvenance !== undefined) {
    const verified = verifyDoorV44BuildProvenance(suppliedProvenance);
    if (!verified.ok || verified.sha256 !== provenanceHash || verified.provenance.inputs.spec_sha256 !== receipt.input_hashes.spec_sha256
      || verified.provenance.inputs.context_before_provenance_sha256 !== receipt.input_hashes.context_before_provenance_sha256
      || verified.provenance.inputs.source_records_sha256 !== receipt.input_hashes.source_records_sha256
      || verified.provenance.inputs.fact_records_sha256 !== receipt.input_hashes.fact_records_sha256
      || verified.provenance.inputs.asset_records_sha256 !== receipt.input_hashes.asset_records_sha256
      || (receipt.mode === "live" && verified.provenance.input_mode !== "explicit_json")) refuse("ARTIFACT_PROVENANCE_MISMATCH");
    provenance = verified.provenance;
    put("build-provenance.json", Buffer.from(stableDoorJson(provenance)));
  }
  const assetIds = new Set<string>();
  for (const asset of assets) {
    if (!ID.test(asset.asset_id) || assetIds.has(asset.asset_id) || typeof asset.base64 !== "string"
      || !HASH.test(asset.sha256) || !["image/png", "image/webp"].includes(asset.mime)) refuse("ARTIFACT_INPUT_INVALID");
    assetIds.add(asset.asset_id);
    const path = assetFile(asset.path);
    const bytes = Buffer.from(asset.base64, "base64");
    if (!bytes.length || bytes.toString("base64") !== asset.base64 || digest(bytes) !== asset.sha256
      || asset.path !== `/media/door-v44/${asset.sha256}.${asset.mime === "image/png" ? "png" : "webp"}`
      || asset.url !== new URL(asset.path, document.canonical_url).href) refuse("ARTIFACT_HASH_MISMATCH");
    put(path, bytes);
  }
  const artifact = doorV44ArtifactHash(receipt, assets);
  if (artifact !== receipt.artifact_hash) refuse("ARTIFACT_HASH_MISMATCH");
  if (!verifyDoorV44SemanticContract(candidate).ok) refuse("ARTIFACT_SEMANTIC_MISMATCH");
  put("index.html", Buffer.from(html));
  put("document.json", Buffer.from(stableDoorJson(document)));
  put("receipt.json", Buffer.from(stableDoorJson(receipt)));
  put("assets.json", Buffer.from(stableDoorJson(assets.map(({ base64: _base64, ...asset }) => asset))));
  const manifest: Manifest = { format: "door-v44-artifact/1.0.0", artifact_hash: artifact,
    files: [...files].map(([path, bytes]) => ({ path, sha256: digest(bytes), bytes: bytes.length })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
  const binding: Binding = { tenant_id: receipt.tenant_id, page_id: receipt.page_id, page_version: receipt.page_version,
    artifact_hash: artifact, manifest_hash: doorV44Hash(manifest) };
  const bindingName = doorV44Hash({ tenant_id: binding.tenant_id, page_id: binding.page_id, page_version: binding.page_version }) + ".json";
  put("manifest.json", Buffer.from(stableDoorJson(manifest)));
  put("binding.json", Buffer.from(stableDoorJson(binding)));
  return { files, binding, bindingName, artifact, provenance };
}
async function inventory(path: string, prefix = ""): Promise<string[]> {
  await directory(path);
  const result: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) refuse("ARTIFACT_UNSAFE_PATH");
    if (entry.isDirectory()) {
      if (prefix || entry.name !== "assets") refuse("ARTIFACT_CORRUPT");
      result.push(...await inventory(join(path, entry.name), prefix + entry.name + "/"));
    }
    else if (entry.isFile()) result.push(prefix + entry.name);
    else refuse("ARTIFACT_UNSAFE_PATH");
  }
  return result.sort();
}
async function verifyBundle(path: string, expected?: ReturnType<typeof plan>): Promise<{ candidate: Candidate; planned: ReturnType<typeof plan> }> {
  const document = json(await readBytes(join(path, "document.json")));
  const receipt = json(await readBytes(join(path, "receipt.json")));
  const metadata = json(await readBytes(join(path, "assets.json"))) as Omit<Candidate["assets"][number], "base64">[];
  if (!Array.isArray(metadata) || metadata.length > 100) refuse("ARTIFACT_CORRUPT");
  const assets: Candidate["assets"] = [];
  for (const asset of metadata) assets.push({ ...asset, base64: (await readBytes(join(path, assetFile(asset.path)))).toString("base64") });
  const candidate = { ok: true, document, receipt, assets, html: (await readBytes(join(path, "index.html"))).toString("utf8") } as Candidate;
  let provenance: unknown;
  try { provenance = json(await readBytes(join(path, "build-provenance.json"))); }
  catch (error) { if (!missingProvenance(error)) throw error; }
  const planned = plan(candidate, provenance);
  const names = await inventory(path);
  if (stableDoorJson(names) !== stableDoorJson([...planned.files.keys()].sort())) refuse("ARTIFACT_CORRUPT");
  for (const [name, bytes] of planned.files) {
    if (!(await readBytes(join(path, name))).equals(bytes)) refuse("ARTIFACT_CORRUPT");
    if (expected && !expected.files.get(name)?.equals(bytes)) refuse("ARTIFACT_CONFLICT");
  }
  if (expected && expected.files.size !== planned.files.size) refuse("ARTIFACT_CONFLICT");
  return { candidate, planned };
}
function missingProvenance(error: unknown): boolean { return errorCode(error) === "ENOENT"; }
function provenanceResult(planned: ReturnType<typeof plan>): { provenance_status: "unattested" | "observed_local"; build_provenance?: DoorV44BuildProvenance } {
  return planned.provenance ? { provenance_status: "observed_local", build_provenance: planned.provenance } : { provenance_status: "unattested" };
}
async function bindVersion(root: string, destination: string, planned: ReturnType<typeof plan>): Promise<void> {
  const bindingPath = join(root, "bindings", planned.bindingName);
  // Hard-link publication is an atomic create-if-absent of already complete bytes.
  try { await link(join(destination, "binding.json"), bindingPath); }
  catch (error) { if (errorCode(error) !== "EEXIST") throw error; }
  if (!(await readBytes(bindingPath)).equals(planned.files.get("binding.json")!)) refuse("ARTIFACT_VERSION_CONFLICT");
}

/** Candidate persistence only: no publication, lifecycle advancement or public asset exposure. */
export async function writeDoorV44Artifact(root: string, compiled: Candidate, provenance?: unknown): Promise<DoorV44ArtifactResult> {
  try {
    const candidate = copyCandidate(compiled);
    const planned = plan(candidate, provenance);
    const ownedRoot = rootPath(root);
    await directory(ownedRoot, true);
    for (const name of ["bundles", "staging", "bindings"]) await directory(join(ownedRoot, name), true);
    const destination = join(ownedRoot, "bundles", planned.artifact);
    const existing = await lstat(destination).then(() => true, error => { if (errorCode(error) === "ENOENT") return false; throw error; });
    if (existing) {
      await verifyBundle(destination, planned);
      await bindVersion(ownedRoot, destination, planned);
      return { ok: true, artifact_hash: planned.artifact, directory: destination, compiled: candidate, ...provenanceResult(planned) };
    }
    const staging = join(ownedRoot, "staging", randomUUID());
    await mkdir(staging, { mode: 0o700 });
    await directory(staging);
    await directory(join(staging, "assets"), true);
    for (const [name, bytes] of planned.files) await writeBytes(join(staging, name), bytes);
    await verifyBundle(staging, planned);
    try {
      const exists = await lstat(destination).then(() => true, error => { if (errorCode(error) === "ENOENT") return false; throw error; });
      if (exists) await verifyBundle(destination, planned);
      else await rename(staging, destination);
    }
    catch (error) {
      if (!["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(errorCode(error) ?? "")) throw error;
      await verifyBundle(destination, planned);
    }
    await bindVersion(ownedRoot, destination, planned);
    return { ok: true, artifact_hash: planned.artifact, directory: destination, compiled: candidate, ...provenanceResult(planned) };
  } catch (error) { return failure(error); }
}

/** Reads select only fully verified bundles with their matching immutable version binding. */
export async function readDoorV44Artifact(root: string, artifactHash: string): Promise<DoorV44ArtifactResult> {
  try {
    if (typeof artifactHash !== "string" || !HASH.test(artifactHash)) refuse("ARTIFACT_UNSAFE_PATH");
    const ownedRoot = rootPath(root);
    const path = join(ownedRoot, "bundles", artifactHash);
    const { candidate, planned } = await verifyBundle(path);
    if (planned.artifact !== artifactHash) refuse("ARTIFACT_HASH_MISMATCH");
    let binding: Buffer;
    try { binding = await readBytes(join(ownedRoot, "bindings", planned.bindingName)); }
    catch (error) { if (errorCode(error) === "ENOENT") refuse("ARTIFACT_UNBOUND"); throw error; }
    if (!binding.equals(planned.files.get("binding.json")!)) refuse("ARTIFACT_VERSION_CONFLICT");
    return { ok: true, artifact_hash: artifactHash, directory: path, compiled: candidate, ...provenanceResult(planned) };
  } catch (error) { return failure(errorCode(error) === "ENOENT" ? new Refusal("ARTIFACT_NOT_FOUND") : error); }
}

/** Exact recovery lookup. Only an absent binding permits a first build; an invalid
 * binding or unavailable bound bundle must never fall through to recompilation. */
export async function readDoorV44ArtifactByVersion(root: string, tenantId: string, pageId: string, pageVersion: number): Promise<DoorV44ArtifactResult> {
  try {
    if (typeof tenantId !== "string" || !ID.test(tenantId) || typeof pageId !== "string" || !ID.test(pageId)
      || !Number.isSafeInteger(pageVersion) || pageVersion < 1) refuse("ARTIFACT_INPUT_INVALID");
    const ownedRoot = rootPath(root);
    const identity = { tenant_id: tenantId, page_id: pageId, page_version: pageVersion };
    const path = join(ownedRoot, "bindings", doorV44Hash(identity) + ".json");
    let bytes: Buffer;
    try { bytes = await readBytes(path); }
    catch (error) { if (errorCode(error) === "ENOENT") refuse("ARTIFACT_BINDING_NOT_FOUND"); throw error; }
    const value = json(bytes);
    if (!value || typeof value !== "object" || Array.isArray(value)) refuse("ARTIFACT_CORRUPT");
    const binding = value as Partial<Binding>;
    if (typeof binding.artifact_hash !== "string" || !HASH.test(binding.artifact_hash)
      || typeof binding.manifest_hash !== "string" || !HASH.test(binding.manifest_hash)
      || !bytes.equals(Buffer.from(stableDoorJson({ ...identity, artifact_hash: binding.artifact_hash, manifest_hash: binding.manifest_hash })))) refuse("ARTIFACT_CORRUPT");
    const verified = await readDoorV44Artifact(ownedRoot, binding.artifact_hash);
    if (!verified.ok) {
      if (verified.errors.some(error => error.code === "ARTIFACT_NOT_FOUND")) refuse("ARTIFACT_CORRUPT");
      return verified;
    }
    const receipt = verified.compiled.receipt;
    if (receipt.tenant_id !== tenantId || receipt.page_id !== pageId || receipt.page_version !== pageVersion) refuse("ARTIFACT_VERSION_CONFLICT");
    return verified;
  } catch (error) { return failure(error); }
}
