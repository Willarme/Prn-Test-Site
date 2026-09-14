import { isAbsolute, join, parse, resolve } from "node:path";
import { z } from "zod";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { compileDoorV44Page } from "@/domain/search/door-v44/compiler";
import { readDoorV44Artifact, readDoorV44ArtifactByVersion, writeDoorV44Artifact, readDoorV44EvidenceJson, writeDoorV44EvidenceJson, type DoorV44ArtifactResult } from "@/domain/search/door-v44/artifact-store";
import { doorV44Hash, stableDoorJson } from "@/domain/search/door-v44/schema-engine";
import { doorPageReserveSchema, type DoorPageVersionStore } from "@/domain/search/door-v44/page-version";
import { prepareDoorPageVersionInput, verifyDoorPageVersionInputReceipt, type DoorPageVersionInputStore } from "@/domain/search/door-v44/page-version-input";
import { doorPageVersionStore } from "./door-page-version-store";
import { doorPageVersionInputStore } from "./door-page-version-input-store";
import { buildSavedDoorPageVersion, DoorPageSavedBuildError } from "./door-page-version-build-service";
import { readDoorPageVersionArtifact } from "./door-page-version-service";
import { DOOR_FIXTURE_IDS, assembleDoorFixture, doorFixtureIdentity, loadDoorFixturePackage, DoorFixturePackageError, type DoorFixtureId } from "./door-page-run-fixtures";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const doorFixtureExecutionSchema = doorPageReserveSchema.pick({ page_id: true, operation_id: true, actor: true, reason: true })
  .extend({ run_id: doorPageReserveSchema.shape.operation_id, fixture_id: z.enum(DOOR_FIXTURE_IDS), dry_run: z.boolean(), execution_at: doorPageReserveSchema.shape.at,
    package_sha256: hash, executor_sha256: hash }).strict();
export type DoorFixtureExecutionCommand = z.infer<typeof doorFixtureExecutionSchema>;
export interface DoorFixtureArtifactBinding { namespace: "saved" | "dry-run"; artifact_hash: string; tenant_id: "prn"; page_id: string; page_version: 1; run_id: string }
export interface DoorFixtureOutcome {
  status: "BUILT" | "BLOCKED" | "FAILED"; fixture_id: DoorFixtureId; diagnostics: Array<{ code: string; pointer: string }>;
  input_sha256: string | null; spec_sha256: string | null; reservation_id: string | null;
  artifact: DoorFixtureArtifactBinding | null; compile_receipt_sha256: string | null; html_hash: string | null; semantic_hash: string | null;
  control_report: null | { status: "BLOCKED_CONTROL_DERIVATIVE"; report_sha256: string; source_pin_hash: string; candidate_hash: string };
  cost_usd: "0"; model_calls: 0; release_ready: false;
}
export interface DoorFixtureExecutionDependencies {
  repositoryRoot?: string;
  artifactRoot?: string;
  versions?: DoorPageVersionStore;
  inputs?: DoorPageVersionInputStore;
}
/** Recoverable means the caller must retain/resume this item using its original
 * command. A storage exception is never proof that a write did not happen. */
export class DoorFixtureExecutionError extends Error {
  constructor(readonly code: "FIXTURE_COMMAND_INVALID" | "FIXTURE_PACKAGE_CHANGED" | "FIXTURE_STORAGE_UNAVAILABLE" | "FIXTURE_ARTIFACT_MISMATCH", readonly recoverable: boolean) { super(code); }
}
function ownedRoot(root?: string): string {
  const value = root ?? process.env.PRN_DOOR_V44_ARTIFACT_ROOT;
  if (!value || !isAbsolute(value) || resolve(value) === parse(resolve(value)).root) throw new DoorFixtureExecutionError("FIXTURE_STORAGE_UNAVAILABLE", true);
  return resolve(value);
}
function dryRoot(root: string, run_id: string) { return join(root, "dry-runs", doorV44Hash({ tenant_id: DEFAULT_TENANT_ID, run_id })); }
const base = (fixture_id: DoorFixtureId): DoorFixtureOutcome => ({ status: "FAILED", fixture_id, diagnostics: [], input_sha256: null, spec_sha256: null, reservation_id: null,
  artifact: null, compile_receipt_sha256: null, html_hash: null, semantic_hash: null, control_report: null, cost_usd: "0", model_calls: 0, release_ready: false });
function built(command: DoorFixtureExecutionCommand, verified: Extract<DoorV44ArtifactResult, { ok: true }>, input_sha256: string, reservation_id: string | null): DoorFixtureOutcome {
  const receipt = verified.compiled.receipt;
  if (receipt.tenant_id !== DEFAULT_TENANT_ID || receipt.page_id !== command.page_id || receipt.page_version !== 1 || receipt.mode !== "fixture" || receipt.release_ready !== false) throw new DoorFixtureExecutionError("FIXTURE_ARTIFACT_MISMATCH", false);
  return { ...base(command.fixture_id), status: "BUILT", input_sha256, reservation_id, spec_sha256: receipt.input_hashes.spec_sha256,
    artifact: { namespace: command.dry_run ? "dry-run" : "saved", artifact_hash: receipt.artifact_hash, tenant_id: DEFAULT_TENANT_ID, page_id: command.page_id, page_version: 1, run_id: command.run_id },
    compile_receipt_sha256: doorV44Hash(receipt), html_hash: receipt.html_hash, semantic_hash: receipt.semantic_hash };
}

/** Server-controlled synthetic corpus only: no browser-supplied specs/context,
 * model gateway, approval issuance or publication path. Full package preflight
 * precedes every write, and all retries retain the durable command audit fields. */
export async function executeDoorFixture(raw: DoorFixtureExecutionCommand, deps: DoorFixtureExecutionDependencies = {}): Promise<DoorFixtureOutcome> {
  const parsed = doorFixtureExecutionSchema.safeParse(raw);
  if (!parsed.success) throw new DoorFixtureExecutionError("FIXTURE_COMMAND_INVALID", false);
  const command = parsed.data, identity = doorFixtureIdentity(command.run_id, command.fixture_id);
  if (command.page_id !== identity.page_id || command.operation_id !== identity.operation_id) throw new DoorFixtureExecutionError("FIXTURE_COMMAND_INVALID", false);
  const loaded = await loadDoorFixturePackage(deps.repositoryRoot);
  if (loaded.sha256 !== command.package_sha256 || loaded.manifest.executor_sha256 !== command.executor_sha256) throw new DoorFixtureExecutionError("FIXTURE_PACKAGE_CHANGED", false);
  if (command.fixture_id === "F01") {
    const { diagnostics, status, report_sha256, source_pin_hash, candidate_hash } = loaded.blocked;
    return { ...base("F01"), status: "BLOCKED", diagnostics, control_report: { status, report_sha256, source_pin_hash, candidate_hash } };
  }
  const fixture = loaded.inputs.get(command.fixture_id);
  if (!fixture) throw new DoorFixturePackageError("FIXTURE_PACKAGE_INVALID");
  const input = assembleDoorFixture(fixture, command.run_id, command.fixture_id, loaded.sha256, loaded.manifest.executor_sha256);
  const audit = { actor: command.actor, reason: command.reason, at: command.execution_at };
  const reservation = { tenant_id: DEFAULT_TENANT_ID, page_id: identity.page_id, canonical_intent_id: identity.canonical_intent_id,
    canonical_url: new URL(identity.canonical_path, input.context.validation.origin).href, operation_id: identity.operation_id, expected_latest_version: 0, ...audit };
  let inputHash: string | null = null, specHash: string | null = null, reservationId: string | null = null;
  try {
    const root = ownedRoot(deps.artifactRoot);
    if (command.dry_run) {
      // Virtual reservation establishes identical immutable input identities
      // without constructing stores or reserving a page catalogue version.
      const virtual = { ...reservation, page_version: 1, canonical_path: identity.canonical_path, reserved_at: audit.at,
        reservation_id: doorV44Hash({ tenant_id: DEFAULT_TENANT_ID, page_id: identity.page_id, operation_id: identity.operation_id }) };
      const prepared = prepareDoorPageVersionInput({ tenant_id: DEFAULT_TENANT_ID, page_id: identity.page_id, reservation_id: virtual.reservation_id,
        ...input, model_provenance: { status: "fixture_no_model_calls", fixture_id: command.fixture_id }, ...audit }, virtual);
      const saved = prepared.record;
      inputHash = saved.input_sha256; specHash = saved.spec_sha256;
      const target = dryRoot(root, command.run_id);
      const storedInput = await writeDoorV44EvidenceJson(target, JSON.parse(prepared.wire.payload_json));
      if (storedInput.sha256 !== inputHash) throw new DoorFixtureExecutionError("FIXTURE_ARTIFACT_MISMATCH", false);
      let artifact = await readDoorV44ArtifactByVersion(target, DEFAULT_TENANT_ID, identity.page_id, 1);
      if (!artifact.ok) {
        if (artifact.errors.length !== 1 || artifact.errors[0].code !== "ARTIFACT_BINDING_NOT_FOUND") throw new DoorFixtureExecutionError("FIXTURE_STORAGE_UNAVAILABLE", true);
        const compiled = await compileDoorV44Page(saved.spec, saved.context);
        if (!compiled.ok) return { ...base(command.fixture_id), diagnostics: compiled.errors, input_sha256: inputHash, spec_sha256: specHash };
        artifact = await writeDoorV44Artifact(target, compiled);
        if (!artifact.ok) throw new DoorFixtureExecutionError("FIXTURE_STORAGE_UNAVAILABLE", true);
      }
      if (!verifyDoorPageVersionInputReceipt(saved, artifact.compiled.receipt).ok) throw new DoorFixtureExecutionError("FIXTURE_ARTIFACT_MISMATCH", false);
      return built(command, artifact, inputHash, null);
    }
    const versions = deps.versions ?? doorPageVersionStore(), inputs = deps.inputs ?? doorPageVersionInputStore();
    const reserved = await versions.reserveVersion(reservation); reservationId = reserved.reservation_id;
    const saved = await inputs.captureInput({ tenant_id: DEFAULT_TENANT_ID, page_id: identity.page_id, reservation_id: reservationId,
      ...input, model_provenance: { status: "fixture_no_model_calls", fixture_id: command.fixture_id }, ...audit });
    inputHash = saved.input_sha256; specHash = saved.spec_sha256;
    const result = await buildSavedDoorPageVersion(versions, inputs, root, { tenant_id: DEFAULT_TENANT_ID, page_id: identity.page_id,
      operation_id: identity.operation_id, expected_input_sha256: inputHash, ...audit });
    const exact = await readDoorPageVersionArtifact(versions, root, DEFAULT_TENANT_ID, identity.page_id, result.version.page_version);
    const artifact = await readDoorV44Artifact(root, exact.compiled.receipt.artifact_hash);
    if (!artifact.ok) throw new DoorFixtureExecutionError("FIXTURE_STORAGE_UNAVAILABLE", true);
    return built(command, artifact, inputHash, reservationId);
  } catch (error) {
    if (error instanceof DoorPageSavedBuildError && error.code === "SAVED_BUILD_COMPILE_FAILED") return { ...base(command.fixture_id), diagnostics: error.diagnostics, input_sha256: inputHash, spec_sha256: specHash, reservation_id: reservationId };
    if (error instanceof DoorFixtureExecutionError) throw error;
    throw new DoorFixtureExecutionError("FIXTURE_STORAGE_UNAVAILABLE", true);
  }
}

/** Called only after owner authentication and loading the persisted run/item.
 * No package/current-source requirement: a saved dry artifact remains reviewable
 * after an executor update, but must retain its exact run/page/version binding. */
export interface DoorFixtureDryReadCommand {
  run_id: string; fixture_id: DoorFixtureId; page_id: string; artifact_hash: string;
  input_sha256: string; spec_sha256: string; compile_receipt_sha256: string; html_hash: string; semantic_hash: string; package_sha256: string; executor_sha256: string;
}
export async function readDoorFixtureRunArtifact(command: DoorFixtureDryReadCommand, artifactRoot?: string) {
  try {
    const identity = doorFixtureIdentity(command.run_id, command.fixture_id);
    if (command.page_id !== identity.page_id || [command.artifact_hash, command.input_sha256, command.spec_sha256, command.compile_receipt_sha256, command.html_hash, command.semantic_hash, command.package_sha256, command.executor_sha256].some(h => !hash.safeParse(h).success)) throw new DoorFixtureExecutionError("FIXTURE_ARTIFACT_MISMATCH", false);
    const target = dryRoot(ownedRoot(artifactRoot), command.run_id);
    const artifact = await readDoorV44Artifact(target, command.artifact_hash);
    if (!artifact.ok) throw new DoorFixtureExecutionError("FIXTURE_STORAGE_UNAVAILABLE", true);
    const r = artifact.compiled.receipt;
    if (r.tenant_id !== DEFAULT_TENANT_ID || r.page_id !== command.page_id || r.page_version !== 1 || r.canonical_intent_id !== identity.canonical_intent_id || r.mode !== "fixture" || r.release_ready !== false
      || r.input_hashes.spec_sha256 !== command.spec_sha256 || doorV44Hash(r) !== command.compile_receipt_sha256 || r.html_hash !== command.html_hash || r.semantic_hash !== command.semantic_hash
      || r.input_hashes.fixture_package_sha256 !== command.package_sha256 || r.input_hashes.fixture_executor_sha256 !== command.executor_sha256) throw new DoorFixtureExecutionError("FIXTURE_ARTIFACT_MISMATCH", false);
    const payload = await readDoorV44EvidenceJson(target, command.input_sha256) as Record<string, unknown>;
    const spec = JSON.parse(payload.spec_json as string), context = Object.fromEntries(Object.entries(payload.context_parts as Record<string, string>).map(([key, value]) => [key, JSON.parse(value)]));
    // Reconstruction-only audit fields are excluded from the canonical payload;
    // this validates stored bytes without creating or claiming a new audit act.
    const audit = { actor: "system:fixture-preview-verification", reason: "Read-only input hash reconstruction", at: "2000-01-01T00:00:00.000Z" };
    const reservation = { tenant_id: DEFAULT_TENANT_ID, ...identity, canonical_url: r.canonical_url, page_version: 1, expected_latest_version: 0,
      reservation_id: doorV44Hash({ tenant_id: DEFAULT_TENANT_ID, page_id: identity.page_id, operation_id: identity.operation_id }), ...audit, reserved_at: audit.at };
    const prepared = prepareDoorPageVersionInput({ tenant_id: DEFAULT_TENANT_ID, page_id: identity.page_id, reservation_id: reservation.reservation_id,
      spec, context, model_provenance: JSON.parse(payload.model_provenance_json as string), ...audit }, reservation);
    if (prepared.wire.payload_json !== stableDoorJson(payload) || prepared.record.input_sha256 !== command.input_sha256
      || prepared.record.model_provenance.status !== "fixture_no_model_calls" || !verifyDoorPageVersionInputReceipt(prepared.record, r).ok) throw new DoorFixtureExecutionError("FIXTURE_ARTIFACT_MISMATCH", false);
    return artifact;
  } catch (error) { if (error instanceof DoorFixtureExecutionError) throw error; throw new DoorFixtureExecutionError("FIXTURE_ARTIFACT_MISMATCH", false); }
}
