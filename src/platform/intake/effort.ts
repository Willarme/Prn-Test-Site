import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { QUESTION_COSTS, READINESS_POLICY_VERSION } from "@/domain/intake/readiness";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { requestScopedClient, requireServiceClient } from "@/platform/db/client";
import { withFileLock, writeFileAtomic } from "@/platform/stores/atomic-file";
import { runtimeStore } from "@/platform/stores/runtime";

/** Server-authored effort, not an authorization token or a packet access gate. */
export const EFFORT_POLICY_VERSION = READINESS_POLICY_VERSION;
export const MAX_INTAKE_EFFORT = 20;
const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_.:-]+$/);
const selectionSchema = z.object({
  question_id: identifier,
  fills_fields: z.array(identifier).max(50),
  already_populated_fields: z.array(identifier).max(50),
  policy_version: identifier,
}).strict();
export type EffortSelectionDecision = z.infer<typeof selectionSchema>;
export type EffortQuestionType = keyof typeof QUESTION_COSTS;
export interface EffortIdentity { request_id: string; tenant_id: string }
export interface AppendIntakeEffortInput extends EffortIdentity {
  operation_id: string;
  kind: "opening" | "answer" | "skip" | "retry" | "media";
  question_id: string;
  question_type: EffortQuestionType;
  /** Server-only sum of canonical costs for an atomic grouped submission. */
  units?: number;
  requirement_ids?: string[];
  decision_reason?: string;
  selection_decisions?: EffortSelectionDecision[];
}
export interface FinishIntakeEffortInput extends EffortIdentity {
  operation_id: string;
  reason?: "homeowner_finish" | "effort_limit" | "ready" | "safety_stop";
}
export interface RecordIntakeSelectionInput extends EffortIdentity {
  operation_id: string;
  question_id: string;
  selection_decisions: EffortSelectionDecision[];
}
const operationSchema = z.object({
  operation_id: identifier,
  kind: z.enum(["opening", "answer", "skip", "retry", "media", "finish", "selection"]),
  question_id: identifier.nullable(),
  question_type: z.enum(["closed_choice", "confirm", "media", "short_text", "free_text"]).nullable(),
  units: z.number().int().min(0).max(MAX_INTAKE_EFFORT),
  requirement_ids: z.array(identifier).max(50),
  decision_reason: z.string().max(240).nullable(),
  selection_decisions: z.array(selectionSchema).max(50),
  finish_reason: z.enum(["homeowner_finish", "effort_limit", "ready", "safety_stop"]).nullable(),
  policy_version: z.literal(EFFORT_POLICY_VERSION),
}).strict().superRefine((op, ctx) => {
  const invalid = op.kind === "finish" ? op.units !== 0 || op.question_id !== null || op.question_type !== null || op.finish_reason === null
    : op.kind === "selection" ? op.units !== 0 || op.question_id === null || op.question_type !== null || op.finish_reason !== null
    : op.units < 1 || op.question_id === null || op.question_type === null || op.finish_reason !== null;
  if (invalid) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid effort operation" });
  }
});
export type EffortOperation = z.infer<typeof operationSchema>;
const attemptSchema = z.object({
  operation: operationSchema,
  occurred_at: z.string().datetime(),
  charged_units: z.number().int().min(0).max(MAX_INTAKE_EFFORT),
  accepted: z.boolean(),
  rejection_reason: z.enum(["effort_limit", "finished"]).nullable(),
}).strict();
export type EffortAttempt = z.infer<typeof attemptSchema>;
const ledgerSchema = z.object({
  request_id: identifier, tenant_id: identifier, problem_id: identifier,
  policy_version: z.literal(EFFORT_POLICY_VERSION),
  effort_spent: z.number().int().min(0).max(MAX_INTAKE_EFFORT),
  max_effort: z.literal(MAX_INTAKE_EFFORT),
  finished_at: z.string().datetime().nullable(),
  finish_reason: z.enum(["homeowner_finish", "effort_limit", "ready", "safety_stop"]).nullable(),
  attempts: z.array(attemptSchema),
}).strict();
export type EffortLedger = z.infer<typeof ledgerSchema>;
export interface EffortResult {
  accepted: boolean;
  duplicate: boolean;
  reason: "effort_limit" | "finished" | null;
  ledger: EffortLedger;
}

function validateLedger(value: unknown, identity: EffortIdentity, problemId: string): EffortLedger {
  const parsed = ledgerSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid intake effort ledger");
  const ledger = parsed.data;
  if (ledger.request_id !== identity.request_id || ledger.tenant_id !== identity.tenant_id || ledger.problem_id !== problemId ||
    new Set(ledger.attempts.map(a => a.operation.operation_id)).size !== ledger.attempts.length) throw new Error("Invalid intake effort ledger");
  // Cached totals and finish fields are claims, not authority. Replay array
  // order using the same admission rule before reads, duplicates or mutations.
  // Receipt timestamps need not increase when clocks move or callers contend.
  let spent = 0;
  let finishedAt: string | null = null;
  let finishReason: EffortLedger["finish_reason"] = null;
  for (const attempt of ledger.attempts) {
    const op = attempt.operation;
    const reason = op.kind === "finish" || op.kind === "selection" ? null : finishedAt !== null ? "finished"
      : spent + op.units > MAX_INTAKE_EFFORT ? "effort_limit" : null;
    const charged = reason === null ? op.units : 0;
    if (attempt.accepted !== (reason === null) || attempt.rejection_reason !== reason || attempt.charged_units !== charged) {
      throw new Error("Invalid intake effort ledger");
    }
    spent += charged;
    if (op.kind === "finish" && finishedAt === null) {
      finishedAt = attempt.occurred_at; finishReason = op.finish_reason;
    }
  }
  if (ledger.effort_spent !== spent || ledger.finished_at !== finishedAt || ledger.finish_reason !== finishReason) {
    throw new Error("Invalid intake effort ledger");
  }
  return ledger;
}
function location(identity: EffortIdentity): string {
  const root = process.env.PRN_DEV_DB_PATH ? dirname(process.env.PRN_DEV_DB_PATH) : join(process.cwd(), "data", "runtime");
  const hash = createHash("sha256").update(JSON.stringify([identity.tenant_id, identity.request_id])).digest("hex");
  return join(root, "intake-effort", `${hash}.json`);
}
function blank(identity: EffortIdentity, problemId: string): EffortLedger {
  return { ...identity, problem_id: problemId, policy_version: EFFORT_POLICY_VERSION, effort_spent: 0,
    max_effort: MAX_INTAKE_EFFORT, finished_at: null, finish_reason: null, attempts: [] };
}
async function context(identity: EffortIdentity) {
  identifier.parse(identity.request_id); identifier.parse(identity.tenant_id);
  const store = runtimeStore();
  const journey = await store.getJourney(identity.request_id);
  if (!journey || journey.session.request_id !== identity.request_id ||
    (journey.problem.tenant_id ?? DEFAULT_TENANT_ID) !== identity.tenant_id) throw new Error("Intake effort request ownership mismatch");
  return { store, problemId: journey.problem.problem_id };
}
function fileRead(identity: EffortIdentity, problemId: string): EffortLedger {
  const file = location(identity);
  return existsSync(file) ? validateLedger(JSON.parse(readFileSync(file, "utf8")), identity, problemId) : blank(identity, problemId);
}
export async function readIntakeEffort(identity: EffortIdentity): Promise<EffortLedger> {
  const { store, problemId } = await context(identity);
  if (store.kind === "file") return withFileLock(location(identity), () => fileRead(identity, problemId));
  const db = requestScopedClient(identity.request_id) ?? requireServiceClient();
  const { data, error } = await db.from("intake_effort_ledger").select("ledger")
    .eq("request_id", identity.request_id).eq("tenant_id", identity.tenant_id).maybeSingle();
  if (error) throw new Error(`Intake effort read unavailable: ${error.message}`);
  return data ? validateLedger(data.ledger, identity, problemId) : blank(identity, problemId);
}

async function append(identity: EffortIdentity, operation: EffortOperation): Promise<EffortResult> {
  const { store, problemId } = await context(identity);
  if (store.kind === "supabase") {
    // Costs and selections are server-authored. Unlike scoped reads, mutation
    // uses the service-only RPC; authenticated clients have no write grant.
    const { data, error } = await requireServiceClient().rpc("record_intake_effort", {
      p_request_id: identity.request_id, p_tenant_id: identity.tenant_id, p_operation: operation,
    });
    if (error) throw new Error(`Intake effort write unavailable: ${error.message}`);
    const result = z.object({ accepted: z.boolean(), duplicate: z.boolean(),
      reason: z.enum(["effort_limit", "finished"]).nullable(), ledger: z.unknown() }).strict().parse(data);
    return { ...result, ledger: validateLedger(result.ledger, identity, problemId) };
  }
  return withFileLock(location(identity), () => {
    const ledger = fileRead(identity, problemId);
    const prior = ledger.attempts.find(a => a.operation.operation_id === operation.operation_id);
    if (prior) {
      if (JSON.stringify(prior.operation) !== JSON.stringify(operation)) throw new Error("Effort operation id already used with different input");
      return { accepted: prior.accepted, duplicate: true, reason: prior.rejection_reason, ledger };
    }
    const reason = operation.kind === "finish" || operation.kind === "selection" ? null : ledger.finished_at ? "finished"
      : ledger.effort_spent + operation.units > MAX_INTAKE_EFFORT ? "effort_limit" : null;
    const at = new Date().toISOString();
    const charged = reason ? 0 : operation.units;
    ledger.effort_spent += charged;
    ledger.attempts.push({ operation, occurred_at: at, charged_units: charged, accepted: reason === null, rejection_reason: reason });
    if (operation.kind === "finish" && !ledger.finished_at) {
      ledger.finished_at = at; ledger.finish_reason = operation.finish_reason;
    }
    writeFileAtomic(location(identity), JSON.stringify(validateLedger(ledger, identity, problemId)));
    return { accepted: reason === null, duplicate: false, reason, ledger };
  });
}

/** Call after authenticating the request, before attempting the charged action.
 * A distinct retry or skip is a distinct operation; never refund failed media.
 * If admission fails, offer the existing packet/finish path without more work. */
export async function appendIntakeEffort(input: AppendIntakeEffortInput): Promise<EffortResult> {
  const operation = operationSchema.parse({
    operation_id: input.operation_id, kind: input.kind, question_id: input.question_id, question_type: input.question_type,
    units: input.units ?? QUESTION_COSTS[input.question_type], requirement_ids: input.requirement_ids ?? [],
    decision_reason: input.decision_reason ?? null, selection_decisions: input.selection_decisions ?? [],
    finish_reason: null, policy_version: EFFORT_POLICY_VERSION,
  });
  return append({ request_id: input.request_id, tenant_id: input.tenant_id }, operation);
}

/** Finishing is never charged or refused because the effort allowance is used. */
export async function finishIntakeEffort(input: FinishIntakeEffortInput): Promise<EffortResult> {
  return append({ request_id: input.request_id, tenant_id: input.tenant_id }, operationSchema.parse({
    operation_id: input.operation_id, kind: "finish", question_id: null, question_type: null, units: 0,
    requirement_ids: [], decision_reason: null, selection_decisions: [],
    finish_reason: input.reason ?? "homeowner_finish", policy_version: EFFORT_POLICY_VERSION,
  }));
}

/** Save the actual emitted selector decision without charging a page view.
 * The server derives a stable operation id from decision + preceding state. */
export async function recordIntakeSelection(input: RecordIntakeSelectionInput): Promise<EffortResult> {
  return append({ request_id: input.request_id, tenant_id: input.tenant_id }, operationSchema.parse({
    operation_id: input.operation_id, kind: "selection", question_id: input.question_id, question_type: null, units: 0,
    requirement_ids: [], decision_reason: null, selection_decisions: input.selection_decisions,
    finish_reason: null, policy_version: EFFORT_POLICY_VERSION,
  }));
}
