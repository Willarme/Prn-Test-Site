import { z } from "zod";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { doorV44Hash, isPlainDoorJson, stableDoorJson } from "./schema-engine";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const at = z.string().datetime().refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v.slice(0, 10));
const text = z.string().min(1).max(500).refine(v => v.trim().length > 0 && !Array.from(v).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127));
const tenant = z.literal(DEFAULT_TENANT_ID);
export const doorPageFixtureIdSchema = z.enum(["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "F09", "F10", "F11"]);
export type DoorPageFixtureId = z.infer<typeof doorPageFixtureIdSchema>;
export const doorPageRunItemAssignmentSchema = z.object({ item_id: id, fixture_id: doorPageFixtureIdSchema, page_id: id, operation_id: id }).strict();
export type DoorPageRunItemAssignment = z.infer<typeof doorPageRunItemAssignmentSchema>;

/** Identity is separate from mutable execution state and never aliases a real page. */
export function doorPageRunItems(tenantId: string, runId: string, fixtureIds: readonly DoorPageFixtureId[] = doorPageFixtureIdSchema.options): DoorPageRunItemAssignment[] {
  parseDoorPageRun(tenant, tenantId); parseDoorPageRun(id, runId);
  const ids = parseDoorPageRun(z.array(doorPageFixtureIdSchema).min(1).max(11), fixtureIds);
  if (new Set(ids).size !== ids.length || ids.some((f, n) => n > 0 && f <= ids[n - 1])) throw new DoorPageRunError("DOOR_RUN_INVALID");
  const prefix = "fixture_" + doorV44Hash({ tenant_id: tenantId, run_id: runId }).slice(0, 24);
  return ids.map(fixture_id => { const page_id = `${prefix}_${fixture_id.toLowerCase()}`; return { item_id: fixture_id, fixture_id, page_id, operation_id: page_id + "_v1" }; });
}
export const doorPageRunCreateSchema = z.object({ tenant_id: tenant, run_id: id, idempotency_key: id, request_sha256: hash,
  actor: text, reason: text, created_at: at, mode: z.literal("fixture"), dry_run: z.boolean(), package_sha256: hash, executor_version: id, executor_sha256: hash,
  environment: z.object({ kind: z.enum(["local", "trial"]), commit_sha: z.string().regex(/^[a-f0-9]{40}$/).nullable() }).strict(),
  items: z.array(doorPageRunItemAssignmentSchema).min(1).max(11),
}).strict();
export type DoorPageRunCreate = z.infer<typeof doorPageRunCreateSchema>;
/** Pins the original creation independently from the normalized user request. */
export function doorPageRunCreationHash(input: DoorPageRunCreate): string {
  return doorV44Hash(input);
}
export const doorPageRunOutcomeSchema = z.object({ status: z.enum(["BUILT", "BLOCKED", "FAILED"]), fixture_id: doorPageFixtureIdSchema,
  diagnostics: z.array(z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/), pointer: z.string().max(500).regex(/^(?:\/[A-Za-z0-9_~./-]*)?$/) }).strict()).max(100),
  input_sha256: hash.nullable(), spec_sha256: hash.nullable(), html_hash: hash.nullable(), semantic_hash: hash.nullable(), compile_receipt_sha256: hash.nullable(), reservation_id: hash.nullable(),
  artifact: z.object({ namespace: z.enum(["saved", "dry-run"]), artifact_hash: hash, tenant_id: tenant, page_id: id, page_version: z.literal(1), run_id: id }).strict().nullable(),
  control_report: z.object({ report_sha256: hash, source_pin_hash: hash, candidate_hash: hash, status: z.literal("BLOCKED_CONTROL_DERIVATIVE") }).strict().nullable(),
  model_calls: z.literal(0), cost_usd: z.literal("0"), release_ready: z.literal(false),
}).strict();
export type DoorPageRunOutcome = z.infer<typeof doorPageRunOutcomeSchema>;
const attempt = z.object({ attempt_id: id, claimed_at: at, lease_expires_at: at }).strict();
export const doorPageRunItemSchema = doorPageRunItemAssignmentSchema.extend({ ordinal: z.number().int().min(1).max(11), status: z.enum(["PENDING", "RUNNING", "BUILT", "BLOCKED", "FAILED"]),
  execution_at: at.nullable(), attempts: z.array(attempt).max(20), completed_at: at.nullable(), outcome: doorPageRunOutcomeSchema.nullable() }).strict();
export type DoorPageRunItem = z.infer<typeof doorPageRunItemSchema>;
export const doorPageRunSchema = doorPageRunCreateSchema.omit({ items: true }).extend({ format: z.literal("door-page-run/1.0.0"), revision: z.number().int().min(1).max(232),
  updated_at: at, status: z.enum(["PENDING", "RUNNING", "COMPLETED"]), items: z.array(doorPageRunItemSchema).min(1).max(11), creation_sha256: hash, state_sha256: hash }).strict();
export type DoorPageRun = z.infer<typeof doorPageRunSchema>;
export const doorPageRunClaimSchema = z.object({ tenant_id: tenant, run_id: id, expected_revision: z.number().int().min(1).max(231), attempt_id: id, at, lease_expires_at: at }).strict();
export type DoorPageRunClaim = z.infer<typeof doorPageRunClaimSchema>;
export const doorPageRunCompleteSchema = doorPageRunClaimSchema.omit({ lease_expires_at: true }).extend({ item_id: id, outcome: doorPageRunOutcomeSchema }).strict();
export type DoorPageRunComplete = z.infer<typeof doorPageRunCompleteSchema>;
export interface DoorPageRunStore {
  create(input: DoorPageRunCreate): Promise<DoorPageRun>;
  read(tenantId: string, runId: string): Promise<DoorPageRun | null>;
  claimNext(input: DoorPageRunClaim): Promise<DoorPageRun>;
  complete(input: DoorPageRunComplete): Promise<DoorPageRun>;
}
export type DoorPageRunErrorCode = "DOOR_RUN_INVALID" | "DOOR_RUN_CONFLICT" | "DOOR_RUN_CORRUPT" | "DOOR_RUN_UNAVAILABLE" | "DOOR_RUN_NOT_FOUND";
export class DoorPageRunError extends Error { constructor(public readonly code: DoorPageRunErrorCode) { super(code); this.name = "DoorPageRunError"; } }
export function parseDoorPageRun<T>(schema: z.ZodType<T>, raw: unknown, code: DoorPageRunErrorCode = "DOOR_RUN_INVALID"): T {
  if (!isPlainDoorJson(raw) || Buffer.byteLength(stableDoorJson(raw), "utf8") > 512 * 1024) throw new DoorPageRunError(code);
  const parsed = schema.safeParse(raw); if (!parsed.success) throw new DoorPageRunError(code);
  return JSON.parse(stableDoorJson(parsed.data)) as T;
}
export function doorPageRunCreation(run: DoorPageRun): DoorPageRunCreate {
  const { format: _f, revision: _r, updated_at: _u, status: _s, state_sha256: _h, creation_sha256: _c, items, ...creation } = run; void _f; void _r; void _u; void _s; void _h; void _c;
  return { ...creation, items: items.map(({ item_id, fixture_id, page_id, operation_id }) => ({ item_id, fixture_id, page_id, operation_id })) };
}
export function verifyDoorPageRun(raw: unknown): DoorPageRun {
  const run = parseDoorPageRun(doorPageRunSchema, raw, "DOOR_RUN_CORRUPT");
  const fail = () => { throw new DoorPageRunError("DOOR_RUN_CORRUPT"); };
  const creation = doorPageRunCreation(run), { state_sha256, ...body } = run;
  let assignments: DoorPageRunItemAssignment[];
  try { assignments = doorPageRunItems(run.tenant_id, run.run_id, run.items.map(i => i.fixture_id)); } catch { return fail(); }
  if (doorV44Hash(body) !== state_sha256 || doorPageRunCreationHash(creation) !== run.creation_sha256
    || doorV44Hash(creation.items) !== doorV44Hash(assignments)
    || Date.parse(run.updated_at) < Date.parse(run.created_at)) fail();
  let revision = 1, encounteredOpen = false; const attempts = new Set<string>();
  for (const [index, item] of run.items.entries()) {
    if (item.ordinal !== index + 1 || (encounteredOpen && item.status !== "PENDING")) fail();
    if (["PENDING", "RUNNING"].includes(item.status)) encounteredOpen = true;
    if (item.status === "PENDING" ? item.attempts.length || item.execution_at !== null || item.completed_at !== null || item.outcome !== null
      : !item.attempts.length || item.execution_at !== item.attempts[0].claimed_at) fail();
    for (const [n, a] of item.attempts.entries()) {
      if (attempts.has(a.attempt_id) || Date.parse(a.claimed_at) < Date.parse(run.created_at) || Date.parse(a.claimed_at) > Date.parse(run.updated_at)
        || Date.parse(a.lease_expires_at) <= Date.parse(a.claimed_at) || Date.parse(a.lease_expires_at) - Date.parse(a.claimed_at) > 1800000
        || (n > 0 && Date.parse(a.claimed_at) < Date.parse(item.attempts[n - 1].lease_expires_at))) fail();
      attempts.add(a.attempt_id); revision++;
    }
    if (item.status === "RUNNING" && (item.completed_at !== null || item.outcome !== null)) fail();
    if (!["PENDING", "RUNNING"].includes(item.status)) {
      revision++; const o = item.outcome, last = item.attempts.at(-1)!;
      if (!o || o.status !== item.status || o.fixture_id !== item.fixture_id || !item.completed_at || Date.parse(item.completed_at) < Date.parse(last.claimed_at)
        || Date.parse(item.completed_at) >= Date.parse(last.lease_expires_at) || Date.parse(item.completed_at) > Date.parse(run.updated_at)) fail();
      if (o) verifyDoorPageRunOutcome(run, item, o, "DOOR_RUN_CORRUPT");
    }
  }
  const expected = run.items.every(i => !["PENDING", "RUNNING"].includes(i.status)) ? "COMPLETED" : revision === 1 ? "PENDING" : "RUNNING";
  if (run.revision !== revision || run.status !== expected) fail();
  return run;
}
export function verifyDoorPageRunOutcome(run: Pick<DoorPageRun, "tenant_id" | "run_id" | "dry_run">, item: DoorPageRunItemAssignment, outcome: DoorPageRunOutcome, code: DoorPageRunErrorCode = "DOOR_RUN_INVALID"): void {
  const a = outcome.artifact;
  if (outcome.fixture_id !== item.fixture_id || (outcome.status === "BUILT" ? !a || !outcome.input_sha256 || !outcome.spec_sha256 || !outcome.html_hash || !outcome.semantic_hash || !outcome.compile_receipt_sha256 : a !== null)
    || (a && (a.page_id !== item.page_id || a.tenant_id !== run.tenant_id || a.run_id !== run.run_id || a.namespace !== (run.dry_run ? "dry-run" : "saved")))
    || (outcome.control_report !== null && (item.fixture_id !== "F01" || outcome.status !== "BLOCKED"))
    || (run.dry_run ? outcome.reservation_id !== null : outcome.status === "BUILT" && !outcome.reservation_id)) throw new DoorPageRunError(code);
}
export function sealDoorPageRun(input: Omit<DoorPageRun, "state_sha256">): DoorPageRun { return verifyDoorPageRun({ ...input, state_sha256: doorV44Hash(input) }); }
