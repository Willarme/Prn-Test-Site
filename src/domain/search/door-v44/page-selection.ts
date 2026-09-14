import { z } from "zod";
import { doorV44Hash, isPlainDoorJson } from "./schema-engine";
import { doorPageIdentitySchema, doorPageReservationSchema } from "./page-version";
import { doorReleaseFenceSchema, doorReleasePolicySchema } from "./release-evidence";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = doorPageIdentitySchema.shape.page_id;
const count = z.number().int().min(0).max(2147483646);
const text = z.string().min(1).max(500).refine((v) => !!v.trim());
const at = z.string().datetime();
const path = z.string().regex(/^\/problems\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
/** Shared evidence fence shape; persisted guard and live provider observation must agree exactly. */
export const doorSelectionFenceSchema = doorReleaseFenceSchema;
export type DoorSelectionFence = z.infer<typeof doorSelectionFenceSchema>;
export const doorSelectionTargetSchema = z.object({ page_id: id, page_version: doorPageReservationSchema.shape.page_version, reservation_id: hash, input_sha256: hash,
  artifact_hash: hash, compile_receipt_sha256: hash, release_evaluation_sha256: hash, content_approval_sha256: hash, publish_action_sha256: hash }).strict();
export type DoorPageSelectionTarget = z.infer<typeof doorSelectionTargetSchema>;
export const doorSelectionGuardStateSchema = z.object({ fence: doorSelectionFenceSchema, policy_sha256: hash, release_policy: doorReleasePolicySchema,
  origin: z.string().max(2048).refine((v) => { try { const u = new URL(v); return u.origin === v && u.protocol === "https:"; } catch { return false; } }),
  index_policy: z.enum(["trial_noindex", "public_indexable"]), publish_enabled: z.boolean(), blocked_page_ids: z.array(id).max(1000),
  family_routes: z.array(z.object({ family_id: z.string().min(1).max(150), path: z.string().regex(/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/), label: text }).strict()).max(1000),
}).strict();
export type DoorPageSelectionGuardState = z.infer<typeof doorSelectionGuardStateSchema>;
const audit = z.object({ tenant_id: id, operation_id: id, actor: text, reason: text, at }).strict();
export const doorSelectionGuardCommandSchema = audit.extend({ expected_revision: count.max(2147483645), state: doorSelectionGuardStateSchema }).strict();
export type DoorPageSelectionGuardCommand = z.infer<typeof doorSelectionGuardCommandSchema>;
export const doorSelectionCommitSchema = audit.extend({ expected_revision: count.max(2147483645), fence: doorSelectionFenceSchema, action: z.enum(["publish", "rollback"]), entries: z.array(doorSelectionTargetSchema).max(1000) }).strict();
export type DoorPageSelectionCommit = z.infer<typeof doorSelectionCommitSchema>;
export const doorSelectionWithdrawSchema = audit.extend({ expected_revision: count.max(2147483645), expected_hold_revision: count, page_ids: z.array(id).min(1).max(1000) }).strict();
export type DoorPageSelectionWithdraw = z.infer<typeof doorSelectionWithdrawSchema>;
const binding = doorSelectionTargetSchema.pick({ page_id: true, page_version: true, input_sha256: true, artifact_hash: true }).extend({ canonical_path: path }).strict();
export const doorSelectedEntrySchema = doorSelectionTargetSchema.extend({ canonical_path: path, canonical_url: doorPageIdentitySchema.shape.canonical_url,
  family_id: z.string().min(1).max(150), family_path: z.string().regex(/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/), label: z.string().min(1).max(1000),
  related_page_ids: z.array(id).max(1000), related_bindings: z.array(binding).max(1000), robots: z.enum(["noindex,follow", "index,follow"]), valid_until: at, sitemap_eligible: z.boolean() }).strict();
export type DoorPageSelectedEntry = z.infer<typeof doorSelectedEntrySchema>;
export const doorSelectionSetSchema = audit.extend({ revision: count.min(1), previous_revision: count, guard_revision: count, action: z.enum(["publish", "rollback", "unpublish", "hold_withdrawal"]),
  request_sha256: hash, selection_sha256: hash, entries: z.array(doorSelectedEntrySchema).max(1000) }).strict();
export type DoorPageSelectionSet = z.infer<typeof doorSelectionSetSchema>;
export const doorSelectionGuardSchema = audit.extend({ revision: count.min(1), previous_revision: count, state: doorSelectionGuardStateSchema, request_sha256: hash, guard_sha256: hash }).strict();
export type DoorPageSelectionGuard = z.infer<typeof doorSelectionGuardSchema>;
export const doorServingSnapshotSchema = z.object({ tenant_id: id, revision: count, selection_sha256: hash.nullable(), guard_revision: count,
  fence: doorSelectionFenceSchema.nullable(), origin: doorSelectionGuardStateSchema.shape.origin.nullable(), index_policy: z.enum(["trial_noindex", "public_indexable"]).nullable(),
  entries: z.array(doorSelectedEntrySchema).max(1000), managed: z.array(z.object({page_id:id.nullable(),canonical_path:path,kind:z.enum(["catalog","frozen_control"])}).strict()).max(100000),
  as_of: at, guard_status:z.enum(["unconfigured","stale","current"])
}).strict();
export type DoorPageServingSnapshot = z.infer<typeof doorServingSnapshotSchema>;
export interface DoorPageSelectionStore {
  registerGuard(input: DoorPageSelectionGuardCommand): Promise<DoorPageSelectionGuard>;
  getGuard(tenantId: string): Promise<DoorPageSelectionGuard | null>;
  commitSelectionSet(input: DoorPageSelectionCommit): Promise<DoorPageSelectionSet>;
  withdrawSelectionPages(input: DoorPageSelectionWithdraw): Promise<DoorPageSelectionSet>;
  getSelectionSet(tenantId: string, revision: number): Promise<DoorPageSelectionSet | null>;
  getSelectionHead(tenantId: string): Promise<DoorPageSelectionSet | null>;
  getServingSnapshot(tenantId: string, observedFence: DoorSelectionFence | null): Promise<DoorPageServingSnapshot>;
}
export type DoorPageSelectionErrorCode = "SELECTION_INVALID" | "SELECTION_CONFLICT" | "SELECTION_CORRUPT" | "SELECTION_UNAVAILABLE" | "SELECTION_INELIGIBLE" | "SELECTION_HOLD" | "SELECTION_RELATED_REBUILD_REQUIRED";
export class DoorPageSelectionError extends Error { constructor(public readonly code: DoorPageSelectionErrorCode) { super(code); this.name = "DoorPageSelectionError"; } }
export function parseDoorSelection<T>(schema: z.ZodType<T>, raw: unknown, code: DoorPageSelectionErrorCode = "SELECTION_INVALID"): T {
  if (!isPlainDoorJson(raw)) throw new DoorPageSelectionError(code); const result = schema.safeParse(raw); if (!result.success) throw new DoorPageSelectionError(code); return result.data;
}
export function doorSelectionSetHash(value: Omit<DoorPageSelectionSet, "selection_sha256">): string { return doorV44Hash(value); }
export function doorSelectionGuardHash(value: Omit<DoorPageSelectionGuard, "guard_sha256">): string { return doorV44Hash(value); }
export function withdrawDoorSelectionClosure(entries: readonly DoorPageSelectedEntry[], initial: readonly string[]): DoorPageSelectedEntry[] {
  const removed = new Set(initial); let changed = true;
  while (changed) { changed = false; for (const row of entries) if (!removed.has(row.page_id) && row.related_page_ids.some((id) => removed.has(id))) { removed.add(row.page_id); changed = true; } }
  return entries.filter((row) => !removed.has(row.page_id));
}
