import { randomUUID } from "node:crypto";
import { z } from "zod";
import { IsoDateTime } from "@/domain/shared/primitives";
import { AgentId } from "@/platform/agents/contracts";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";

/**
 * Agent Run Ledger (A00 spec §4) — one APPEND-ONLY record per agent run, the
 * mechanism that makes machine labor auditable: what ran, what triggered it,
 * what it touched (by ID only), what handled it, what it cost.
 *
 * Discipline mirrors the existing consent ledger: rows are never mutated
 * after write. Customer data is referenced by ID ONLY — raw evidence, free
 * text, and PII must never be copied into this store.
 *
 * Persistence: designed for the `agent_run_ledger` Supabase table
 * (supabase/migrations/00006_agent_run_ledger.sql — written, NOT yet applied;
 * application is a separate human-coordinated step). Until the table exists,
 * every write is FAIL-SOFT: the in-process buffer records the run, the
 * database miss is logged, and the wrapped call proceeds exactly as before.
 *
 * Relationship to the existing door-slice `AgentRun` (platform/agents/
 * contracts.ts + stores/interfaces.ts): that is the discovery job-run record
 * with idempotency semantics, kept as-is for its existing readers. THIS is
 * the platform-wide audit ledger per the A00 contract; reconciling the two
 * shapes is flagged for the owners (see the A00 build report), not blended
 * here.
 */

export const AgentRunTrigger = z.enum(["request", "job", "schedule", "admin_action"]);
export type AgentRunTrigger = z.infer<typeof AgentRunTrigger>;

export const AgentRunRecord = z.object({
  run_id: z.string().min(1),
  agent_id: AgentId,
  /** Reserved — white-label approval condition (a), 2026-08-24. Default "prn"; NO tenant logic exists. */
  tenant_id: z.string().min(1).optional(),
  trigger: AgentRunTrigger,
  /** e.g. request_id, problem_record_id — never raw PII inline. */
  input_ids: z.array(z.string()),
  capabilities_used: z.array(z.string()),
  /** "deterministic-stand-in" today; a real vendor name once a model is wired. */
  tool_provider: z.string().optional(),
  tool_model_version: z.string().optional(),
  /** Shape varies per agent — IDs and small labels only, never PII. */
  outputs_summary: z.unknown(),
  decisions: z.array(z.string()).optional(),
  /** TEST-labeled once real cost data exists (hard canon rule 4). 0 for the deterministic path. */
  cost_usd: z.number().optional(),
  latency_ms: z.number().optional(),
  confidence: z.number().optional(),
  eval_score: z.number().optional(),
  actions_taken: z.array(z.string()).optional(),
  errors: z.array(z.string()).optional(),
  human_correction: z.string().optional(),
  /** Append-only — never updated in place. */
  created_at: IsoDateTime,
});
export type AgentRunRecord = z.infer<typeof AgentRunRecord>;

export type AgentRunInput = Omit<AgentRunRecord, "run_id" | "created_at" | "tenant_id"> & {
  tenant_id?: string;
};

/** Bounded in-process buffer — admin/test read model; not the durable store. */
const BUFFER_MAX = 200;
const buffer: AgentRunRecord[] = [];

/** Log a persistence miss once per process, not once per call. */
let missLogged = false;
function logMiss(reason: string): void {
  if (missLogged) return;
  missLogged = true;
  console.warn(
    `[a00-run-ledger] durable write unavailable (${reason}) — runs are buffered in-process only. ` +
      "Apply supabase/migrations/00006_agent_run_ledger.sql to enable persistence."
  );
}

/**
 * Append one run record. NEVER throws and never blocks the caller's outcome:
 * a missing table or unreachable database is logged and the call proceeds.
 * Accepts an injectable client provider (RLS seam, approval condition d).
 */
export async function recordAgentRun(
  input: AgentRunInput,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<AgentRunRecord> {
  const record: AgentRunRecord = AgentRunRecord.parse({
    ...input,
    run_id: `ar_${randomUUID()}`,
    tenant_id: input.tenant_id ?? "prn",
    created_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  });
  buffer.push(record);
  if (buffer.length > BUFFER_MAX) buffer.splice(0, buffer.length - BUFFER_MAX);

  try {
    const client = clientProvider();
    if (!client) {
      logMiss("no database configured");
      return record;
    }
    const { error } = await client.from("agent_run_ledger").insert({
      run_id: record.run_id,
      agent_id: record.agent_id,
      tenant_id: record.tenant_id,
      trigger_kind: record.trigger,
      input_ids: record.input_ids,
      capabilities_used: record.capabilities_used,
      tool_provider: record.tool_provider ?? null,
      tool_model_version: record.tool_model_version ?? null,
      outputs_summary: record.outputs_summary ?? null,
      decisions: record.decisions ?? null,
      cost_usd: record.cost_usd ?? null,
      latency_ms: record.latency_ms ?? null,
      confidence: record.confidence ?? null,
      eval_score: record.eval_score ?? null,
      actions_taken: record.actions_taken ?? null,
      errors: record.errors ?? null,
      human_correction: record.human_correction ?? null,
      created_at: record.created_at,
    });
    if (error) logMiss(error.message);
  } catch (err) {
    logMiss(err instanceof Error ? err.message : String(err));
  }
  return record;
}

/** Recent runs from the in-process buffer (newest last). Admin-gated readers only. */
export function recentAgentRuns(): readonly AgentRunRecord[] {
  return buffer;
}

/** Test seam. */
export function resetAgentRunLedgerForTests(): void {
  buffer.length = 0;
  missLogged = false;
}
