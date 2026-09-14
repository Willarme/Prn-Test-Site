import { randomUUID } from "node:crypto";
import { z } from "zod";
import { doorPageIdentitySchema, type DoorPageVersionStore } from "@/domain/search/door-v44/page-version";
import { verifyDoorPageVersionInputReceipt, type DoorPageVersionInputStore } from "@/domain/search/door-v44/page-version-input";
import { issueDoorEvidenceReceipt, type DoorEvidenceReceipt, type DoorPageEvidenceStore } from "@/domain/search/door-v44/release-evidence";
import { isPlainDoorJson, stableDoorJson } from "@/domain/search/door-v44/schema-engine";
import type { DoorEvidenceExecutionAuthority } from "./door-page-critic";
import { readDoorPageVersionArtifact } from "./door-page-version-service";

const schema = z.object({ tenant_id: doorPageIdentitySchema.shape.tenant_id, page_id: doorPageIdentitySchema.shape.page_id,
  page_version: z.number().int().min(1).max(2147483646), expected_input_sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
/** This producer proves only stored bytes, semantic consistency and captured input
 * association. It never issues a visual/hosted check matrix or a release approval. */
export async function recordDoorPageArtifactIntegrity(command: z.infer<typeof schema>, authority: DoorEvidenceExecutionAuthority,
  deps: { versions: DoorPageVersionStore; inputs: DoorPageVersionInputStore; evidence: DoorPageEvidenceStore; artifactRoot: string; now?: () => Date }): Promise<DoorEvidenceReceipt> {
  if (!isPlainDoorJson(command) || !isPlainDoorJson(authority)
    || Object.keys(authority).sort().join(",") !== "dependencies,environment,expires_at,producer") throw new Error("DOOR_ARTIFACT_EVIDENCE_INVALID");
  const c = schema.parse(command), context = JSON.parse(stableDoorJson(authority)) as DoorEvidenceExecutionAuthority;
  const now = deps.now ?? (() => new Date()); const started_at = now().toISOString();
  const [{version,compiled},input] = await Promise.all([readDoorPageVersionArtifact(deps.versions,deps.artifactRoot,c.tenant_id,c.page_id,c.page_version),deps.inputs.getVersionInput(c.tenant_id,c.page_id,c.page_version)]);
  if (!input || input.input_sha256 !== c.expected_input_sha256 || input.reservation_id !== version.reservation_id || input.tenant_id !== c.tenant_id || input.page_id !== c.page_id
    || input.page_version !== c.page_version || !verifyDoorPageVersionInputReceipt(input,compiled.receipt).ok) throw new Error("DOOR_ARTIFACT_EVIDENCE_BINDING_INVALID");
  const receipt = issueDoorEvidenceReceipt({ format:"door-v44-evidence/1.0.0",kind:"artifact_integrity",
    subject:{tenant_id:c.tenant_id,page_id:c.page_id,page_version:c.page_version,reservation_id:input.reservation_id,input_sha256:input.input_sha256,artifact_hash:compiled.receipt.artifact_hash,compile_receipt_sha256:version.metadata.receipt_sha256},
    environment:context.environment,dependencies:context.dependencies,expires_at:context.expires_at,
    producer:{...context.producer,run_id:"artifact_"+randomUUID()},started_at,finished_at:now().toISOString(),verdict:"PASS",findings:[],attachments:[],
    output:{artifact_read_verified:true,semantic_verified:true,input_verified:true} });
  return deps.evidence.appendReceipt(receipt);
}
