import { readDoorV44Artifact } from "@/domain/search/door-v44/artifact-store";
import { doorPageVersionMetadata, type DoorPageVersion, type DoorPageVersionStore } from "@/domain/search/door-v44/page-version";
import { stableDoorJson } from "@/domain/search/door-v44/schema-engine";

export class DoorPageArtifactError extends Error {
  constructor(readonly code: "RESERVATION_NOT_FOUND" | "RESERVATION_ARTIFACT_MISMATCH" | "ARTIFACT_UNAVAILABLE" | "VERSION_NOT_FOUND" | "VERSION_ARTIFACT_MISMATCH") {
    super(code);
  }
}

export interface RegisterDoorPageArtifactInput {
  tenant_id: string;
  page_id: string;
  operation_id: string;
  artifact_hash: string;
  actor: string;
  reason: string;
  at: string;
}

/**
 * Trusted candidate orchestration. Callers supply an artifact identity, never
 * receipt metadata. The owned artifact root is configuration, not an HTTP input.
 * A reservation must exist before compilation; failed builds keep their number.
 */
export async function registerDoorPageArtifact(
  store: DoorPageVersionStore,
  artifactRoot: string,
  input: RegisterDoorPageArtifactInput,
): Promise<DoorPageVersion> {
  // Copy before the first await so a caller cannot change the target mid-flight.
  const command = { ...input };
  const reservation = await store.getReservation(command.tenant_id, command.page_id, command.operation_id);
  if (!reservation) throw new DoorPageArtifactError("RESERVATION_NOT_FOUND");
  if (reservation.tenant_id !== command.tenant_id || reservation.page_id !== command.page_id || reservation.operation_id !== command.operation_id) {
    throw new DoorPageArtifactError("RESERVATION_ARTIFACT_MISMATCH");
  }
  const artifact = await readDoorV44Artifact(artifactRoot, command.artifact_hash);
  if (!artifact.ok) throw new DoorPageArtifactError("ARTIFACT_UNAVAILABLE");
  const receipt = artifact.compiled.receipt;
  if (receipt.tenant_id !== reservation.tenant_id || receipt.page_id !== reservation.page_id ||
      receipt.page_version !== reservation.page_version || receipt.canonical_intent_id !== reservation.canonical_intent_id ||
      receipt.canonical_url !== reservation.canonical_url) {
    throw new DoorPageArtifactError("RESERVATION_ARTIFACT_MISMATCH");
  }
  const metadata = doorPageVersionMetadata(artifact);
  const version = await store.registerVersion({
    tenant_id: command.tenant_id, page_id: command.page_id, reservation_id: reservation.reservation_id,
    metadata, actor: command.actor, reason: command.reason, at: command.at,
  });
  if (version.tenant_id !== command.tenant_id || version.page_id !== command.page_id ||
      version.page_version !== reservation.page_version || version.reservation_id !== reservation.reservation_id ||
      stableDoorJson(version.metadata) !== stableDoorJson(metadata)) throw new DoorPageArtifactError("VERSION_ARTIFACT_MISMATCH");
  return version;
}

/**
 * Candidate read, not public selection. Verify saved bytes on every read; a
 * missing/corrupt bundle cannot fall through to a mutable draft or other version.
 */
export async function readDoorPageVersionArtifact(
  store: DoorPageVersionStore,
  artifactRoot: string,
  tenantId: string,
  pageId: string,
  pageVersion: number,
) {
  const version = await store.getVersion(tenantId, pageId, pageVersion);
  if (!version) throw new DoorPageArtifactError("VERSION_NOT_FOUND");
  if (version.tenant_id !== tenantId || version.page_id !== pageId || version.page_version !== pageVersion ||
      version.metadata.receipt.tenant_id !== tenantId || version.metadata.receipt.page_id !== pageId ||
      version.metadata.receipt.page_version !== pageVersion) {
    throw new DoorPageArtifactError("VERSION_ARTIFACT_MISMATCH");
  }
  const artifact = await readDoorV44Artifact(artifactRoot, version.metadata.receipt.artifact_hash);
  if (!artifact.ok) throw new DoorPageArtifactError("ARTIFACT_UNAVAILABLE");
  if (stableDoorJson(doorPageVersionMetadata(artifact)) !== stableDoorJson(version.metadata)) {
    throw new DoorPageArtifactError("VERSION_ARTIFACT_MISMATCH");
  }
  return { version, compiled: artifact.compiled };
}
