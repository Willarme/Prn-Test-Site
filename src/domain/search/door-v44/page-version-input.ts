import { createHash } from "node:crypto";
import { z } from "zod";
import type { DoorV44CompileReceipt, DoorV44CompilerContext } from "./compiler-types";
import type { DoorV44Diagnostic, DoorV44RichNode, DoorV44Spec } from "./types";
import { doorV44Hash, isPlainDoorJson, stableDoorJson } from "./schema-engine";
import { loadDoorV44Spec } from "./loader";
import { doorV44ReservedInputHashErrors } from "./build-provenance";
import { doorPageReservationSchema, type DoorPageVersionReservation } from "./page-version";

export const DOOR_PAGE_INPUT_MAX_BYTES = 8 * 1024 * 1024;
export const DOOR_PAGE_INPUT_PROVENANCE_TOKEN = "__DOOR_PAGE_INPUT_PROVENANCE_SHA256__";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,149}$/);
const str = z.string().max(1_000_000);
const short = z.string().min(1).max(500);
const date = z.string().datetime({ offset: true });
const ids = z.array(id).max(1000);
const strings = z.array(str).max(1000);
const status = z.enum(["VERIFIED_LIVE", "PREVIEW", "HIDDEN", "UNVERIFIED"]);
const kind = z.enum(["equipment", "appliance", "fixture", "object", "current_problem"]);
const prompt = z.object({ capability: short, name: short, version: short, hash }).strict();
const claim = z.object({ claim_id: id, source_ids: ids, content_hash: hash }).strict();
const subject = z.object({ subject_id: id, display_label: str, short_label: str, cta_label: str, second_person_label: str, possessive_label: str, plural_label: str, subject_kind: kind }).strict();
const rich: z.ZodType<DoorV44RichNode> = z.lazy(() => z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), value: str }).strict(), z.object({ type: z.literal("source_ref"), source_id: id, label: str }).strict(),
  z.object({ type: z.literal("fact_ref"), claim_id: id, label: str }).strict(), z.object({ type: z.literal("line_break") }).strict(),
  ...(["paragraph", "sentence", "strong", "emphasis", "ordered_list", "unordered_list", "list_item"] as const).map((type) => z.object({ type: z.literal(type), children: z.array(rich).min(1).max(1000) }).strict()),
]));
const visual = z.object({ id, asset_id: id, role: z.enum(["decision_observation", "safe_vs_sealed", "why_not_diy", "extent", "elapsed_time"]), claim_ids: ids,
  title: str, description: str, caption: z.array(rich).max(1000), alt: str, inline_hash: hash, raster_hash: hash,
  width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192), mime: z.enum(["image/png", "image/webp"]), authored_status: z.enum(["fixture", "reviewed"]), review_receipt: short.nullable(), plate_class: short }).strict();
const validation = z.object({
  schema_bundle: z.array(z.unknown()).min(1).max(100), mode: z.enum(["fixture", "live"]), tenant_id: id, content_baseline_id: z.literal("ac-v43"),
  versions: z.object({ template: short, schema: short, theme: short, taxonomy: short, source_bundle: short }).strict(), prompt_identities: z.array(prompt).max(100),
  origin: short, index_policy: z.enum(["trial_noindex", "staged_noindex", "public_indexable"]), approved_content_at: date.nullable(), evaluated_at: date,
  disclosure: z.object({ id: short, content_hash: short, purpose: str }).strict(),
  subjects: z.array(subject.extend({ allowed_pattern_ids: ids, allowed_family_ids: ids }).strict()).max(1000),
  action_patterns: z.array(z.object({ pattern_id: id, target: z.literal("#intake"), subject_kinds: z.array(kind).max(5) }).strict()).max(1000),
  sources: z.array(z.object({ source_id: id, content_hash: hash, reviewed: z.boolean(), expires_at: date.nullable(), claim_ids: ids }).strict()).max(1000), claims: z.array(claim).max(1000),
  pages: z.array(z.object({ page_id: id, tenant_id: id, canonical_path: short, family_id: id, live: z.boolean(), redirect_to: short.nullable() }).strict()).max(1000),
  families: z.array(z.object({ family_id: id, source_family_id: id, reviewed: z.boolean(), protocol_ids: ids, protocol_check_ids: ids, hazard_ids: ids, eval_receipt_ids: ids }).strict()).max(1000),
  eligibilities: z.array(z.object({ receipt_id: id, tenant_id: id, page_id: id, opportunity_id: id, canonical_intent_id: id, intent_cluster_id: id, family_id: id, primary_decision: str, primary_query: str }).strict()).max(1000),
  capabilities: z.array(z.object({ capability_id: id, live_status: status, verified_at: date.nullable(), expires_at: date.nullable(), production_receipt: short.nullable(), media_kinds: z.array(z.enum(["photo", "video", "audio"])).max(3) }).strict()).max(1000),
  visual_assets: z.array(visual.extend({ tenant_id: id }).strict()).max(1000), icon_ids: ids,
  input_hashes: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), hash),
}).strict();
/** Strict snapshot DTO. The existing canonical DoorSpec schemas still own the spec shape. */
export const doorPageCompilerContextSchema = z.object({
  validation, site: z.object({ name: short, current_year: z.number().int().min(2000).max(9999) }).strict(), disclosure_text: str.max(10000), disclosure_text_sha256: hash,
  source_records: z.array(z.object({ source_id: id, content_hash: hash, title: str, publisher: str, url: str, canonical_url: str, http_status: z.literal(200), redirect_to: z.null(), checked_at: date, expires_at: date }).strict()).max(1000),
  fact_records: z.array(z.object({ claim_id: id, content_hash: hash, permitted_labels: strings, publisher: str, geography: str, window: str, denominator: str, sample_size: str, observed_at: date, methodology_id: id }).strict()).max(1000),
  asset_records: z.array(z.object({ asset_id: id, inline_source: str, raster_base64: str, license_receipt: short, renderer_identity: short }).strict()).max(1000),
  visible_approvals: z.array(z.object({ component_id: short, content_hash: hash, approved_at: date }).strict()).max(1000),
  intent_review: z.object({ receipt_id: short, content_hash: hash }).strict(),
}).strict();
export const doorPageModelProvenanceSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_recorded") }).strict(),
  z.object({ status: z.literal("fixture_no_model_calls"), fixture_id: id }).strict(),
  z.object({ status: z.literal("recorded"), assignments: z.array(z.object({ capability: short, provider: short, model_id: short, catalogue_policy_version: short, run_id: id, record_sha256: hash }).strict()).min(1).max(100) }).strict(),
]);
export type DoorPageModelProvenance = z.infer<typeof doorPageModelProvenanceSchema>;
export type DoorPageInputErrorCode = "DOOR_INPUT_INVALID" | "DOOR_INPUT_CONFLICT" | "DOOR_INPUT_CORRUPT" | "DOOR_INPUT_UNAVAILABLE" | "DOOR_INPUT_RECEIPT_MISMATCH";
export class DoorPageVersionInputError extends Error { constructor(public readonly code: DoorPageInputErrorCode) { super(code); this.name = "DoorPageVersionInputError"; } }
export interface DoorPageCaptureInput { tenant_id: string; page_id: string; reservation_id: string; spec: unknown; context: DoorV44CompilerContext; model_provenance: DoorPageModelProvenance; actor: string; reason: string; at: string }
export interface DoorPageVersionInputAssignments { content_baseline_id: "ac-v43"; template_version: string; schema_version: string; theme_version: string; taxonomy_version: string; source_bundle_version: string; prompt_identities: DoorV44Spec["versions"]["prompt_identities"] }
export interface DoorPageVersionInputRecord {
  format: "door-page-version-input/1.0.0"; tenant_id: string; page_id: string; page_version: number; reservation_id: string;
  spec: DoorV44Spec; context: DoorV44CompilerContext; assignments: DoorPageVersionInputAssignments; model_provenance: DoorPageModelProvenance;
  input_sha256: string; spec_sha256: string; context_sha256: string; schema_sha256: string; source_records_sha256: string; fact_records_sha256: string; asset_records_sha256: string;
  actor: string; reason: string; captured_at: string;
}
export interface DoorPageVersionInputStore {
  captureInput(input: DoorPageCaptureInput): Promise<DoorPageVersionInputRecord>;
  getInput(tenantId: string, pageId: string, reservationId: string): Promise<DoorPageVersionInputRecord | null>;
  getVersionInput(tenantId: string, pageId: string, pageVersion: number): Promise<DoorPageVersionInputRecord | null>;
}
const scope = doorPageReservationSchema.pick({ tenant_id: true, page_id: true, reservation_id: true });
const audit = z.object({ actor: short.refine((v) => !!v.trim()), reason: short.refine((v) => !!v.trim()), captured_at: z.string().datetime() }).strict();
const wireSchema = scope.extend({ page_version: doorPageReservationSchema.shape.page_version, payload_json: z.string(), input_sha256: hash, spec_sha256: hash, context_sha256: hash, schema_sha256: hash,
  source_records_sha256: hash, fact_records_sha256: hash, asset_records_sha256: hash, ...audit.shape }).strict();
export type DoorPageVersionInputWire = z.infer<typeof wireSchema>;
const captureSchema = scope.extend({ spec: z.unknown(), context: doorPageCompilerContextSchema, model_provenance: doorPageModelProvenanceSchema, actor: audit.shape.actor, reason: audit.shape.reason, at: audit.shape.captured_at }).strict();
const rawHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const fail = (code: DoorPageInputErrorCode = "DOOR_INPUT_INVALID"): never => { throw new DoorPageVersionInputError(code); };
function boundedJson(value: unknown): string {
  let remaining = DOOR_PAGE_INPUT_MAX_BYTES;
  const spend = (n: number) => { remaining -= n; if (remaining < 0) fail(); };
  function visit(v: unknown): void {
    if (v === null || typeof v !== "object") { spend(Buffer.byteLength(JSON.stringify(v), "utf8")); return; }
    const values = Array.isArray(v) ? v : Object.entries(v);
    spend(2 + Math.max(0, values.length - 1));
    if (Array.isArray(v)) v.forEach(visit); else for (const [key, item] of Object.entries(v)) { spend(Buffer.byteLength(JSON.stringify(key), "utf8") + 1); visit(item); }
  }
  visit(value); return stableDoorJson(value);
}
export function parseDoorPageCaptureInput(raw: unknown): DoorPageCaptureInput {
  if (!isPlainDoorJson(raw)) fail();
  const serialized = boundedJson(raw);
  const parsed = captureSchema.safeParse(raw); if (!parsed.success) return fail();
  if (doorV44ReservedInputHashErrors(parsed.data.context.validation.input_hashes).length) fail();
  if (parsed.data.model_provenance.status === "fixture_no_model_calls" && parsed.data.context.validation.mode !== "fixture") fail();
  if (parsed.data.model_provenance.status === "recorded" && new Set(parsed.data.model_provenance.assignments.map((r) => r.capability + "/" + r.run_id)).size !== parsed.data.model_provenance.assignments.length) fail();
  // z.unknown retains references (spec/schema nodes). Detach the entire approved
  // JSON graph before any provider read/await can observe caller mutation.
  return JSON.parse(serialized) as DoorPageCaptureInput;
}

/** Internal wire strings preserve JavaScript number spelling through PostgreSQL JSONB parsing. */
export function prepareDoorPageVersionInput(raw: unknown, reservation: DoorPageVersionReservation): { record: DoorPageVersionInputRecord; wire: DoorPageVersionInputWire } {
  const input = parseDoorPageCaptureInput(raw);
  const loaded = loadDoorV44Spec(input.spec, input.context.validation); if (!loaded.ok) return fail();
  const spec = loaded.spec; const context = input.context;
  if (input.tenant_id !== reservation.tenant_id || input.page_id !== reservation.page_id || input.reservation_id !== reservation.reservation_id
    || spec.identity.tenant_id !== reservation.tenant_id || spec.identity.page_id !== reservation.page_id || spec.identity.page_version !== reservation.page_version
    || spec.identity.canonical_intent_id !== reservation.canonical_intent_id || spec.identity.canonical_path !== reservation.canonical_path
    || new URL(spec.identity.canonical_path, context.validation.origin).href !== reservation.canonical_url) fail("DOOR_INPUT_CONFLICT");
  const assignments: DoorPageVersionInputAssignments = { content_baseline_id: context.validation.content_baseline_id, template_version: spec.versions.template, schema_version: spec.schema_version,
    theme_version: spec.versions.theme, taxonomy_version: spec.versions.taxonomy, source_bundle_version: spec.versions.source_bundle, prompt_identities: spec.versions.prompt_identities };
  const contextParts = Object.fromEntries(Object.entries(context).map(([key, value]) => [key, stableDoorJson(value)]));
  const validationTemplate = stableDoorJson({ ...context.validation, input_hashes: { ...context.validation.input_hashes, build_provenance_sha256: DOOR_PAGE_INPUT_PROVENANCE_TOKEN } });
  if (validationTemplate.split(DOOR_PAGE_INPUT_PROVENANCE_TOKEN).length !== 2) fail();
  const schemaJson = stableDoorJson([...context.validation.schema_bundle].sort((a, b) => (a as { $id: string }).$id < (b as { $id: string }).$id ? -1 : 1));
  const payload = { format: "door-page-version-input/1.0.0", tenant_id: input.tenant_id, page_id: input.page_id, page_version: reservation.page_version, reservation_id: input.reservation_id,
    spec_json: stableDoorJson(spec), context_parts: contextParts, assignments_json: stableDoorJson(assignments), model_provenance_json: stableDoorJson(input.model_provenance), validation_template_json: validationTemplate, schema_json: schemaJson };
  const payload_json = stableDoorJson(payload);
  if (Buffer.byteLength(payload_json, "utf8") > DOOR_PAGE_INPUT_MAX_BYTES) fail();
  const hashes = { input_sha256: rawHash(payload_json), spec_sha256: loaded.input_hashes.spec_sha256, context_sha256: doorV44Hash(context), schema_sha256: loaded.input_hashes.schema_sha256,
    source_records_sha256: doorV44Hash(context.source_records), fact_records_sha256: doorV44Hash(context.fact_records), asset_records_sha256: doorV44Hash(context.asset_records) };
  if (rawHash(schemaJson) !== hashes.schema_sha256) fail();
  const rowScope = { tenant_id: input.tenant_id, page_id: input.page_id, page_version: reservation.page_version, reservation_id: input.reservation_id };
  const auditFields = { actor: input.actor, reason: input.reason, captured_at: input.at };
  return { wire: { ...rowScope, payload_json, ...hashes, ...auditFields }, record: { format: "door-page-version-input/1.0.0", ...rowScope, spec, context, assignments, model_provenance: input.model_provenance, ...hashes, ...auditFields } };
}
export function decodeDoorPageVersionInput(raw: unknown, reservation: DoorPageVersionReservation): DoorPageVersionInputRecord {
  try {
    // Wire payload may exceed the general one-string limit; decode it before plain-JSON validation.
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)
      || Object.getOwnPropertySymbols(raw).length || !Object.hasOwn(raw, "payload_json") || !isPlainDoorJson(Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(raw)).map(([key, desc]) => {
      if (!("value" in desc) || !desc.enumerable) fail("DOOR_INPUT_CORRUPT"); return [key, key === "payload_json" ? null : desc.value];
    })))) fail("DOOR_INPUT_CORRUPT");
    const wire = wireSchema.parse(raw); if (Buffer.byteLength(wire.payload_json, "utf8") > DOOR_PAGE_INPUT_MAX_BYTES) fail("DOOR_INPUT_CORRUPT");
    const payload = JSON.parse(wire.payload_json); if (rawHash(wire.payload_json) !== wire.input_sha256) fail("DOOR_INPUT_CORRUPT");
    const context = Object.fromEntries(Object.entries(payload.context_parts).map(([key, value]) => [key, JSON.parse(value as string)]));
    const rebuilt = prepareDoorPageVersionInput({ tenant_id: wire.tenant_id, page_id: wire.page_id, reservation_id: wire.reservation_id,
      spec: JSON.parse(payload.spec_json), context, model_provenance: JSON.parse(payload.model_provenance_json), actor: wire.actor, reason: wire.reason, at: wire.captured_at }, reservation);
    if (stableDoorJson(wire) !== stableDoorJson(rebuilt.wire)) fail("DOOR_INPUT_CORRUPT");
    return rebuilt.record;
  } catch { return fail("DOOR_INPUT_CORRUPT"); }
}
/** Semantic input association only; the caller separately verifies genuine artifact/provenance bytes. */
export function verifyDoorPageVersionInputReceipt(record: DoorPageVersionInputRecord, receipt: DoorV44CompileReceipt): { ok: boolean; errors: DoorV44Diagnostic[] } {
  try {
    const context = record.context; const proof = receipt.input_hashes.build_provenance_sha256;
    const injected = proof ? { ...context, validation: { ...context.validation, input_hashes: { ...context.validation.input_hashes, build_provenance_sha256: proof } } } : context;
    const { schema_bundle: _bundle, ...validationFields } = injected.validation; void _bundle;
    if (receipt.tenant_id !== record.tenant_id || receipt.page_id !== record.page_id || receipt.page_version !== record.page_version
      || receipt.canonical_intent_id !== record.spec.identity.canonical_intent_id || receipt.canonical_url !== new URL(record.spec.identity.canonical_path, context.validation.origin).href
      || receipt.input_hashes.spec_sha256 !== record.spec_sha256 || receipt.input_hashes.schema_sha256 !== record.schema_sha256
      || receipt.input_hashes.compiler_context_sha256 !== doorV44Hash(injected)
      || receipt.input_hashes.context_sha256 !== doorV44Hash({ ...validationFields, schema_sha256: record.schema_sha256 })
      || Object.entries(context.validation.input_hashes).some(([key, value]) => receipt.input_hashes[key] !== value)
      || (proof && (!/^[a-f0-9]{64}$/.test(proof) || receipt.input_hashes.context_before_provenance_sha256 !== record.context_sha256
        || receipt.input_hashes.source_records_sha256 !== record.source_records_sha256 || receipt.input_hashes.fact_records_sha256 !== record.fact_records_sha256 || receipt.input_hashes.asset_records_sha256 !== record.asset_records_sha256))) throw new Error();
    return { ok: true, errors: [] };
  } catch { return { ok: false, errors: [{ code: "DOOR_INPUT_RECEIPT_MISMATCH", pointer: "" }] }; }
}
