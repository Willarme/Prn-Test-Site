import { doorV44Hash, isPlainDoorJson, stableDoorJson } from "./schema-engine";

export const DOOR_V44_BUILD_PROVENANCE_KEY = "build_provenance_sha256";
/** Caller evidence keys remain allowed; identities produced by this pipeline are reserved. */
export const DOOR_V44_DERIVED_HASH_KEYS = [DOOR_V44_BUILD_PROVENANCE_KEY, "spec_sha256", "schema_sha256", "context_sha256",
  "compiler_context_sha256", "context_before_provenance_sha256", "source_records_sha256", "fact_records_sha256", "asset_records_sha256",
  "constants_sha256", "actions_sha256", "dom_sha256", "order_sha256",
  "wording_derivative_sha256", "wording_rules_sha256"] as const;
export interface DoorV44ObservedFile { path: string; bytes: number; sha256: string }
export interface DoorV44BuildProvenance {
  format: "door-v44-build-provenance/1.0.0";
  scope: "local_file_observation_before_and_after_compile";
  execution_attestation: false;
  inventory_policy: "v44_source_content_fixture_superset_and_installed_dependency_closure";
  input_mode: "fixture_f04" | "fixture_f08" | "fixture_corpus" | "explicit_json";
  inputs: { spec_sha256: string; context_before_provenance_sha256: string; source_records_sha256: string; fact_records_sha256: string; asset_records_sha256: string };
  preflight: { input_manifest_sha256: string; wording_manifest_sha256: string; wording_derivative_sha256: string; wording_rules_sha256: string };
  files: DoorV44ObservedFile[];
  packages: Array<{ name: string; version: string; path: string }>;
  runtime: { node_version: string; node_binary_sha256: string; platform: string; arch: string; versions: Array<{ name: string; version: string }>; sharp_versions: Array<{ name: string; version: string }> };
  limitations: ["NO_EXECUTION_SNAPSHOT_OR_ABA_PROTECTION", "NO_HOST_OR_OS_LIBRARY_ATTESTATION", "NO_SECOND_HOST_OR_CI_PROOF", "NO_BROWSER_FONT_OR_RELEASE_APPROVAL"];
}
type Diagnostic = { code: string; pointer: string };
export type DoorV44ProvenanceVerification = { ok: true; provenance: DoorV44BuildProvenance; sha256: string } | { ok: false; errors: Diagnostic[] };
const HASH = /^[a-f0-9]{64}$/;
const safePath = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 500
  && !/[\\:]/.test(value) && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  && value.split("/").every(part => part !== "" && part !== "." && part !== "..");
const short = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9@_.+/-]{1,150}$/.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && HASH.test(value);
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const sortedUnique = (values: string[]) => values.every((value, index) => index === 0 || values[index - 1] < value);

/** Validates a self-description, never establishes that a trusted process executed these bytes. */
export function verifyDoorV44BuildProvenance(value: unknown): DoorV44ProvenanceVerification {
  const fail = (): DoorV44ProvenanceVerification => ({ ok: false, errors: [{ code: "BUILD_PROVENANCE_INVALID", pointer: "" }] });
  try {
    if (!isPlainDoorJson(value) || !exact(value, ["format", "scope", "execution_attestation", "inventory_policy", "input_mode", "inputs", "preflight", "files", "packages", "runtime", "limitations"])) return fail();
    if (value.format !== "door-v44-build-provenance/1.0.0" || value.scope !== "local_file_observation_before_and_after_compile"
      || value.execution_attestation !== false || value.inventory_policy !== "v44_source_content_fixture_superset_and_installed_dependency_closure"
      || !["fixture_f04", "fixture_f08", "fixture_corpus", "explicit_json"].includes(value.input_mode as string)) return fail();
    if (!exact(value.inputs, ["spec_sha256", "context_before_provenance_sha256", "source_records_sha256", "fact_records_sha256", "asset_records_sha256"])
      || !Object.values(value.inputs).every(hash) || !exact(value.preflight, ["input_manifest_sha256", "wording_manifest_sha256", "wording_derivative_sha256", "wording_rules_sha256"])
      || !Object.values(value.preflight).every(hash)) return fail();
    if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > 10000 || !value.files.every(file => exact(file, ["path", "bytes", "sha256"])
      && safePath(file.path) && Number.isSafeInteger(file.bytes) && (file.bytes as number) >= 0 && hash(file.sha256))
      || !sortedUnique(value.files.map(file => file.path))) return fail();
    if (!Array.isArray(value.packages) || value.packages.length < 1 || value.packages.length > 300 || !value.packages.every(pkg => exact(pkg, ["name", "version", "path"])
      && short(pkg.name) && short(pkg.version) && safePath(pkg.path)) || !sortedUnique(value.packages.map(pkg => pkg.path))) return fail();
    if (!exact(value.runtime, ["node_version", "node_binary_sha256", "platform", "arch", "versions", "sharp_versions"])
      || !short(value.runtime.node_version) || !hash(value.runtime.node_binary_sha256) || !short(value.runtime.platform) || !short(value.runtime.arch)) return fail();
    for (const versions of [value.runtime.versions, value.runtime.sharp_versions]) {
      if (!Array.isArray(versions) || versions.length < 1 || versions.length > 100 || !versions.every(row => exact(row, ["name", "version"]) && short(row.name) && short(row.version))
        || !sortedUnique(versions.map(row => row.name))) return fail();
    }
    if (stableDoorJson(value.limitations) !== stableDoorJson(["NO_EXECUTION_SNAPSHOT_OR_ABA_PROTECTION", "NO_HOST_OR_OS_LIBRARY_ATTESTATION", "NO_SECOND_HOST_OR_CI_PROOF", "NO_BROWSER_FONT_OR_RELEASE_APPROVAL"])) return fail();
    const provenance = JSON.parse(stableDoorJson(value)) as DoorV44BuildProvenance;
    return { ok: true, provenance, sha256: doorV44Hash(provenance) };
  } catch { return fail(); }
}

/** Run before injection. Reserved values are rejected even when the claimed digest happens to match. */
export function doorV44ReservedInputHashErrors(inputHashes: unknown): Diagnostic[] {
  if (!isPlainDoorJson(inputHashes) || !inputHashes || typeof inputHashes !== "object" || Array.isArray(inputHashes)) return [{ code: "BUILD_INPUT_INVALID", pointer: "/validation/input_hashes" }];
  return DOOR_V44_DERIVED_HASH_KEYS.filter(key => Object.hasOwn(inputHashes, key)).map(key => ({ code: "BUILD_RESERVED_HASH", pointer: "/validation/input_hashes/" + key }));
}
