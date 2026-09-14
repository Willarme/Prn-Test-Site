import { z } from "zod";
import { readDoorV44ArtifactByVersion, writeDoorV44Artifact } from "@/domain/search/door-v44/artifact-store";
import { compileDoorV44Page } from "@/domain/search/door-v44/compiler";
import { doorPageReserveSchema, parseDoorVersion, type DoorPageVersionStore } from "@/domain/search/door-v44/page-version";
import { prepareDoorPageVersionInput, verifyDoorPageVersionInputReceipt, type DoorPageVersionInputStore } from "@/domain/search/door-v44/page-version-input";
import { stableDoorJson } from "@/domain/search/door-v44/schema-engine";
import type { DoorV44Diagnostic } from "@/domain/search/door-v44/types";
import { readDoorPageVersionArtifact, registerDoorPageArtifact } from "./door-page-version-service";

export const doorPageBuildSavedSchema = doorPageReserveSchema.pick({ tenant_id: true, page_id: true, operation_id: true, actor: true, reason: true, at: true })
  .extend({ expected_input_sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type DoorPageBuildSavedInput = z.infer<typeof doorPageBuildSavedSchema>;
export class DoorPageSavedBuildError extends Error {
  constructor(readonly code: "SAVED_BUILD_RESERVATION_MISSING" | "SAVED_BUILD_INPUT_MISSING" | "SAVED_BUILD_INPUT_MISMATCH" | "SAVED_BUILD_RETRY_CONFLICT" |
    "SAVED_BUILD_COMPILE_FAILED" | "SAVED_BUILD_ARTIFACT_UNAVAILABLE", readonly diagnostics: DoorV44Diagnostic[] = []) { super(code); }
}

/**
 * Compile only the immutable governed input saved before this attempt. This is
 * candidate preparation: no writer, critic, approval or publication is implied.
 * Stores and the private artifact root are trusted server configuration.
 */
export async function buildSavedDoorPageVersion(
  versions: DoorPageVersionStore, inputs: DoorPageVersionInputStore, artifactRoot: string, raw: DoorPageBuildSavedInput,
) {
  const command = parseDoorVersion(doorPageBuildSavedSchema, raw);
  const reservation = await versions.getReservation(command.tenant_id, command.page_id, command.operation_id);
  if (!reservation) throw new DoorPageSavedBuildError("SAVED_BUILD_RESERVATION_MISSING");
  if (reservation.tenant_id !== command.tenant_id || reservation.page_id !== command.page_id || reservation.operation_id !== command.operation_id) {
    throw new DoorPageSavedBuildError("SAVED_BUILD_INPUT_MISMATCH");
  }
  const saved = await inputs.getInput(command.tenant_id, command.page_id, reservation.reservation_id);
  if (!saved) throw new DoorPageSavedBuildError("SAVED_BUILD_INPUT_MISSING");
  // Reconstruct all hashes and copy parsed data before subsequent asynchronous IO.
  const { record } = prepareDoorPageVersionInput({ tenant_id: saved.tenant_id, page_id: saved.page_id, reservation_id: saved.reservation_id,
    spec: saved.spec, context: saved.context, model_provenance: saved.model_provenance, actor: saved.actor, reason: saved.reason, at: saved.captured_at }, reservation);
  if (stableDoorJson(record) !== stableDoorJson(saved) || record.input_sha256 !== command.expected_input_sha256) {
    throw new DoorPageSavedBuildError("SAVED_BUILD_INPUT_MISMATCH");
  }
  const existing = await versions.getVersion(command.tenant_id, command.page_id, reservation.page_version);
  if (existing) {
    if (existing.actor !== command.actor || existing.reason !== command.reason || existing.registered_at !== command.at || existing.reservation_id !== reservation.reservation_id) {
      throw new DoorPageSavedBuildError("SAVED_BUILD_RETRY_CONFLICT");
    }
    const verified = await readDoorPageVersionArtifact(versions, artifactRoot, command.tenant_id, command.page_id, reservation.page_version);
    if (!verifyDoorPageVersionInputReceipt(record, verified.compiled.receipt).ok) throw new DoorPageSavedBuildError("SAVED_BUILD_INPUT_MISMATCH");
    return { version: verified.version, input_sha256: record.input_sha256, artifact_read_verified: true as const, replayed: true, recovered: false };
  }
  // A prior process can have written an immutable bundle before catalogue commit.
  // Recover its exact bytes instead of compiling current code over that version.
  let artifact = await readDoorV44ArtifactByVersion(artifactRoot, command.tenant_id, command.page_id, reservation.page_version);
  const recovered = artifact.ok;
  if (!artifact.ok) {
    if (artifact.errors.length !== 1 || artifact.errors[0].code !== "ARTIFACT_BINDING_NOT_FOUND") {
      throw new DoorPageSavedBuildError("SAVED_BUILD_ARTIFACT_UNAVAILABLE", artifact.errors);
    }
    const compiled = await compileDoorV44Page(record.spec, record.context);
    if (!compiled.ok) throw new DoorPageSavedBuildError("SAVED_BUILD_COMPILE_FAILED", compiled.errors);
    if (!verifyDoorPageVersionInputReceipt(record, compiled.receipt).ok) throw new DoorPageSavedBuildError("SAVED_BUILD_INPUT_MISMATCH");
    artifact = await writeDoorV44Artifact(artifactRoot, compiled);
    if (!artifact.ok) throw new DoorPageSavedBuildError("SAVED_BUILD_ARTIFACT_UNAVAILABLE", artifact.errors);
  }
  if (!verifyDoorPageVersionInputReceipt(record, artifact.compiled.receipt).ok) throw new DoorPageSavedBuildError("SAVED_BUILD_INPUT_MISMATCH");
  const version = await registerDoorPageArtifact(versions, artifactRoot, { tenant_id: command.tenant_id, page_id: command.page_id, operation_id: command.operation_id,
    artifact_hash: artifact.artifact_hash, actor: command.actor, reason: command.reason, at: command.at });
  return { version, input_sha256: record.input_sha256, artifact_read_verified: true as const, replayed: false, recovered };
}
