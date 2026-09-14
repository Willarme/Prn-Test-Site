import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/** Independent source pin. Never regenerate this from a candidate during verification. */
export const DOOR_V44_INPUT_MANIFEST_SHA256 = "ebf7e00c4524979c0038135decf23faf8d9bdd7bbcd5fd46dc3a201da9ea4a1c";
export const DOOR_V44_INPUT_MANIFEST_PATH = "content/door-template/v44/inputs/manifest.json";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const containsControl = (value: string) => [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const relativePath = z.string().max(500).refine((value) =>
  value.length > 0 && !value.includes("\\") && !value.includes(":") &&
  value.split("/").every((part) => part !== "" && part !== "." && part !== "..") &&
  !containsControl(value));
const diagnosticSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  pointer: z.string().regex(/^(?:\/(?:[^~/]|~[01])*)*$/),
}).strict();
const fileSchema = z.object({
  path: relativePath,
  role: z.enum(["protected_baseline", "protected_dependency", "source_evidence", "quarantined_evidence"]),
  origin: z.string().min(1).max(500).refine((value) => !containsControl(value) && !/[A-Za-z]:[\\/]|\/Users\//.test(value)),
  bytes: z.number().int().nonnegative().max(8_000_000),
  lf_bytes: z.number().int().nonnegative().max(8_000_000),
  crlf_bytes: z.number().int().nonnegative().max(8_000_000),
  raw_sha256: hash,
  lf_sha256: hash,
  crlf_sha256: hash,
  known_controls: z.array(z.object({ byte_offset: z.number().int().nonnegative(), code: z.number().int().min(0).max(127) }).strict()).max(100),
  known_lf_controls: z.array(z.object({ byte_offset: z.number().int().nonnegative(), code: z.number().int().min(0).max(127) }).strict()).max(100),
  known_crlf_controls: z.array(z.object({ byte_offset: z.number().int().nonnegative(), code: z.number().int().min(0).max(127) }).strict()).max(100),
}).strict().refine((file) => file.role === "quarantined_evidence" || (file.known_controls.length === 0 && file.known_lf_controls.length === 0 && file.known_crlf_controls.length === 0));
const manifestSchema = z.object({
  manifest_version: z.literal("door-v44-inputs/1.0.0"),
  content_baseline_id: z.literal("ac-v43"),
  template_version: z.literal("door-v44.0.0"),
  schema_version: z.literal("doorspec/2.0.0"),
  raw_identity_policy: z.literal("recorded_raw_or_uniform_lf_or_uniform_crlf"),
  runtime: z.object({ node_version: z.string().regex(/^v\d+\.\d+\.\d+$/) }).strict(),
  files: z.array(fileSchema).min(1).max(500),
  twins: z.array(z.object({ id: z.string().regex(/^[a-z_]+$/), left: relativePath, right: relativePath.nullable(), status: z.enum(["lf_equal_known_raw_encodings", "unavailable"]) }).strict()).max(20),
  limitations: z.array(diagnosticSchema).max(50),
}).strict();

export type DoorV44InputManifest = z.infer<typeof manifestSchema>;
export type DoorV44InputDiagnostic = z.infer<typeof diagnosticSchema>;
export interface DoorV44InputResult {
  /** Only immutable input identities and supplied runtime are verified by this boolean. */
  ok: boolean;
  scope: "immutable_input_identity_only";
  release_ready: false;
  clean_wording_available: boolean;
  manifest_sha256: string | null;
  files: Array<{ path: string; raw_sha256: string; lf_sha256: string; raw_equal: boolean; raw_approved: boolean; lf_equal: boolean; representation: "recorded_raw" | "recorded_lf" | "recorded_crlf" | "unrecognized"; quarantined: boolean }>;
  twins: DoorV44InputManifest["twins"];
  diagnostics: DoorV44InputDiagnostic[];
  limitations: DoorV44InputDiagnostic[];
}

export function doorV44InputHashes(bytes: Uint8Array): { raw_sha256: string; lf_sha256: string } {
  const raw = Buffer.from(bytes);
  // Normalize bytes, not decoded text: invalid UTF-8 must never acquire a repaired identity.
  const lf: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 13 && raw[i + 1] === 10) continue;
    lf.push(raw[i]);
  }
  return {
    raw_sha256: createHash("sha256").update(raw).digest("hex"),
    lf_sha256: createHash("sha256").update(Buffer.from(lf)).digest("hex"),
  };
}

const pointerFor = (parts: Array<string | number>) => parts.map((part) => "/" + String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("");
const inside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
};

/** Reads only explicitly supplied root-relative files. No writes, environment, clock or network. */
export async function verifyDoorV44Inputs(options: {
  root: string;
  manifestPath: string;
  expectedManifestSha256: string;
  runtime: { node_version: string };
}): Promise<DoorV44InputResult> {
  const result: DoorV44InputResult = {
    ok: false, scope: "immutable_input_identity_only", release_ready: false, clean_wording_available: false,
    manifest_sha256: null, files: [], twins: [], diagnostics: [], limitations: [],
  };
  const fail = (code: string, pointer: string) => { result.diagnostics.push({ code, pointer }); };
  let root: string;
  try { root = await realpath(options.root); } catch { fail("INPUT_ROOT_UNAVAILABLE", ""); return result; }
  const safeRead = async (name: string, pointer: string, limit: number): Promise<Buffer | null> => {
    if (!relativePath.safeParse(name).success) { fail("INPUT_PATH_INVALID", pointer); return null; }
    try {
      const target = await realpath(path.resolve(root, name));
      if (!inside(root, target)) { fail("INPUT_PATH_ESCAPE", pointer); return null; }
      const metadata = await stat(target);
      if (!metadata.isFile() || metadata.size > limit) { fail("INPUT_FILE_SIZE", pointer); return null; }
      const bytes = await readFile(target);
      if (bytes.length > limit) { fail("INPUT_FILE_SIZE", pointer); return null; }
      return bytes;
    } catch { fail("INPUT_FILE_UNAVAILABLE", pointer); return null; }
  };
  const bytes = await safeRead(options.manifestPath, "/manifest", 1_000_000);
  if (!bytes) return result;
  result.manifest_sha256 = doorV44InputHashes(bytes).raw_sha256;
  if (!hash.safeParse(options.expectedManifestSha256).success || result.manifest_sha256 !== options.expectedManifestSha256) {
    fail("INPUT_MANIFEST_HASH", "/manifest"); return result;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); }
  catch { fail("INPUT_MANIFEST_JSON", "/manifest"); return result; }
  const validated = manifestSchema.safeParse(parsed);
  if (!validated.success) {
    for (const issue of validated.error.issues) fail("INPUT_MANIFEST_SHAPE", pointerFor(issue.path));
    result.diagnostics.sort((a, b) => a.pointer.localeCompare(b.pointer, "en") || a.code.localeCompare(b.code, "en"));
    return result;
  }
  const manifest = validated.data;
  result.twins = manifest.twins;
  result.limitations = manifest.limitations;
  if (options.runtime.node_version !== manifest.runtime.node_version) fail("INPUT_NODE_VERSION", "/runtime/node_version");
  const seen = new Set<string>();
  for (const [index, file] of manifest.files.entries()) {
    const pointer = `/files/${index}`;
    const key = file.path.toLowerCase();
    if (seen.has(key)) { fail("INPUT_DUPLICATE_PATH", `${pointer}/path`); continue; }
    seen.add(key);
    const input = await safeRead(file.path, `${pointer}/path`, 8_000_000);
    if (!input) continue;
    const hashes = doorV44InputHashes(input);
    const raw_equal = hashes.raw_sha256 === file.raw_sha256;
    const recorded_lf = hashes.raw_sha256 === file.lf_sha256;
    const recorded_crlf = hashes.raw_sha256 === file.crlf_sha256;
    const raw_approved = raw_equal || recorded_lf || recorded_crlf;
    const lf_equal = hashes.lf_sha256 === file.lf_sha256;
    result.files.push({ path: file.path, ...hashes, raw_equal, raw_approved, lf_equal,
      representation: raw_equal ? "recorded_raw" : recorded_lf ? "recorded_lf" : recorded_crlf ? "recorded_crlf" : "unrecognized", quarantined: file.role === "quarantined_evidence" });
    const expectedBytes = raw_equal ? file.bytes : recorded_lf ? file.lf_bytes : recorded_crlf ? file.crlf_bytes : file.bytes;
    if (input.length !== expectedBytes) fail("INPUT_BYTE_LENGTH", `${pointer}/bytes`);
    if (!raw_approved) fail("INPUT_RAW_HASH", `${pointer}/raw_sha256`);
    if (!lf_equal) fail("INPUT_LF_HASH", `${pointer}/lf_sha256`);
    try { new TextDecoder("utf-8", { fatal: true }).decode(input); }
    catch { fail("INPUT_UTF8", pointer); }
    if (input.subarray(0, 3).equals(Buffer.from([239, 187, 191]))) fail("INPUT_BOM", pointer);
    const controls: Array<{ byte_offset: number; code: number }> = [];
    for (const [byte_offset, code] of input.entries()) {
      if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) controls.push({ byte_offset, code });
    }
    const expectedControls = raw_equal ? file.known_controls : recorded_lf ? file.known_lf_controls : recorded_crlf ? file.known_crlf_controls : file.known_controls;
    if (JSON.stringify(controls) !== JSON.stringify(expectedControls)) fail("INPUT_CONTROL_CHARACTER", pointer);
  }
  for (const [index, twin] of manifest.twins.entries()) {
    const left = result.files.find((file) => file.path === twin.left);
    if (!left) { fail("INPUT_TWIN_SOURCE_UNAVAILABLE", `/twins/${index}/left`); continue; }
    if (twin.status === "unavailable") {
      if (twin.right !== null) fail("INPUT_TWIN_STATUS", `/twins/${index}/right`);
      continue;
    }
    const right = result.files.find((file) => file.path === twin.right);
    if (!right || left.lf_sha256 !== right.lf_sha256) fail("INPUT_TWIN_IDENTITY", `/twins/${index}`);
  }
  result.diagnostics.sort((a, b) => a.pointer.localeCompare(b.pointer, "en") || a.code.localeCompare(b.code, "en"));
  result.ok = result.diagnostics.length === 0;
  // This unit has no independently verified clean WORDING twin or release/compiler evidence.
  return result;
}
