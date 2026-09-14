import { z } from "zod";
import type { DoorV44ArtifactResult } from "./artifact-store";
import { doorV44Hash, isPlainDoorJson } from "./schema-engine";
import { verifyDoorV44SemanticContract } from "./semantic-contract";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(500).refine((v) => v.trim().length > 0);
const at = z.string().datetime();
const count = z.number().int().min(0).max(2147483646);
export const doorPageIdentitySchema = z.object({ tenant_id: id, page_id: id, canonical_intent_id: id,
  canonical_url: z.string().max(2048).refine((v) => { try { const u = new URL(v); return /^https?:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[1-9][0-9]{0,4})?\/problems\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) && u.href === v; } catch { return false; } }),
}).strict();
export const doorPageReserveSchema = doorPageIdentitySchema.extend({ operation_id: id, expected_latest_version: count.max(2147483645), actor: text, reason: text, at });
export const doorPageReservationSchema = doorPageIdentitySchema.extend({ reservation_id: hash, canonical_path: z.string(), page_version: count.min(1), operation_id: id, expected_latest_version: count, actor: text, reason: text, reserved_at: at }).strict();
const receipt = z.object({
  receipt_id: z.string(), compiler_version: z.literal("door-v44-compiler/1.0.0"), content_baseline_id: z.literal("ac-v43"), tenant_id: id, page_id: id, page_version: count.min(1), canonical_intent_id: id,
  input_hashes: z.record(hash), html_hash: hash, semantic_hash: hash, artifact_hash: hash, canonical_url: doorPageIdentitySchema.shape.canonical_url,
  robots: z.enum(["noindex,nofollow", "noindex,follow", "index,follow"]), date_modified: at.nullable(),
  visible_components: z.array(z.object({ component_id: z.string(), content_hash: hash }).strict()),
  source_ids: z.array(z.string()), claim_ids: z.array(z.string()), section_order: z.array(z.string()), derived_counts: z.record(count), rendered_capability_ids: z.array(z.string()),
  constants: z.array(z.object({ key: z.string(), value: z.string() }).strict()), mode: z.enum(["fixture", "live"]), release_ready: z.literal(false), pending_checks: z.array(z.string()),
  wording_findings: z.array(z.object({ code: z.string(), pointer: z.string(), severity: z.enum(["blocker", "review"]) }).strict()),
}).strict();
export const doorPageMetadataSchema = z.object({ receipt, receipt_sha256: hash, provenance_status: z.enum(["unattested", "observed_local"]), build_provenance_sha256: hash.nullable() }).strict().superRefine((v, c) => {
  if (doorV44Hash(v.receipt) !== v.receipt_sha256 || (v.provenance_status === "unattested" ? v.build_provenance_sha256 !== null || v.receipt.input_hashes.build_provenance_sha256 !== undefined : v.build_provenance_sha256 !== v.receipt.input_hashes.build_provenance_sha256)) c.addIssue({ code: "custom", message: "metadata hash mismatch" });
});
export const doorPageRegisterSchema = z.object({ tenant_id: id, page_id: id, reservation_id: hash, metadata: doorPageMetadataSchema, actor: text, reason: text, at }).strict();
export const doorPageVersionSchema = doorPageRegisterSchema.omit({ at: true }).extend({ page_version: count.min(1), registered_at: at }).strict();
export type DoorPageIdentity = z.infer<typeof doorPageIdentitySchema>;
export type DoorPageReserveInput = z.infer<typeof doorPageReserveSchema>;
export type DoorPageVersionReservation = z.infer<typeof doorPageReservationSchema>;
export type DoorPageVersionMetadata = z.infer<typeof doorPageMetadataSchema>;
export type DoorPageRegisterInput = z.infer<typeof doorPageRegisterSchema>;
export type DoorPageVersion = z.infer<typeof doorPageVersionSchema>;
export type DoorPageVersionErrorCode = "DOOR_VERSION_INVALID" | "DOOR_VERSION_CONFLICT" | "DOOR_VERSION_CORRUPT" | "DOOR_VERSION_UNAVAILABLE";
export class DoorPageVersionError extends Error { constructor(public readonly code: DoorPageVersionErrorCode) { super(code); this.name = "DoorPageVersionError"; } }
export function parseDoorVersion<T>(schema: z.ZodType<T>, value: unknown, code: DoorPageVersionErrorCode = "DOOR_VERSION_INVALID"): T {
  if (!isPlainDoorJson(value)) throw new DoorPageVersionError(code);
  const result = schema.safeParse(value); if (!result.success) throw new DoorPageVersionError(code); return result.data;
}
/** Caller obtains this result through the artifact store; this helper never records a local directory. */
export function doorPageVersionMetadata(verified: Extract<DoorV44ArtifactResult, { ok: true }>): DoorPageVersionMetadata {
  if (!verifyDoorV44SemanticContract(verified.compiled).ok || verified.artifact_hash !== verified.compiled.receipt.artifact_hash) throw new DoorPageVersionError("DOOR_VERSION_INVALID");
  return parseDoorVersion(doorPageMetadataSchema, { receipt: verified.compiled.receipt, receipt_sha256: doorV44Hash(verified.compiled.receipt), provenance_status: verified.provenance_status, build_provenance_sha256: verified.build_provenance ? doorV44Hash(verified.build_provenance) : null });
}
export interface DoorPageVersionStore {
  reserveVersion(input: DoorPageReserveInput): Promise<DoorPageVersionReservation>;
  getReservation(tenantId: string, pageId: string, operationId: string): Promise<DoorPageVersionReservation | null>;
  registerVersion(input: DoorPageRegisterInput): Promise<DoorPageVersion>;
  getVersion(tenantId: string, pageId: string, pageVersion: number): Promise<DoorPageVersion | null>;
  listVersions(tenantId: string, pageId: string): Promise<DoorPageVersion[]>;
}
export const doorPageCatalogSchema = z.object({ schema_version: z.literal(1), identities: z.array(doorPageIdentitySchema.extend({ canonical_path: z.string(), latest_version: count.min(1) }).strict()), reservations: z.array(doorPageReservationSchema), versions: z.array(doorPageVersionSchema) }).strict();
export type DoorPageVersionCatalog = z.infer<typeof doorPageCatalogSchema>;
