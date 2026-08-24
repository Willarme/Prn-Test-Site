/**
 * A00 Durable Workflow Orchestrator — INTERFACE ONLY, DELIBERATELY DEFERRED
 * (spec §3, §9 step 9, §10).
 *
 * Multi-step agent work that can wait, retry, resume, and roll back with
 * idempotent side effects, instead of living inside one fragile page
 * request. NO Wave-0/1 agent needs wait/retry/approval state yet — the
 * static-first trial agents (A01/A02) complete within one request/response —
 * so building an engine now would be over-building before a real use case
 * exists. This file defines what a future implementation must satisfy so the
 * first multi-step agent has something to build against; NOTHING implements
 * or calls it.
 *
 * Coordination note (spec §10): the guided-diagnosis playbook
 * client-exposure issue (the full 19-step graph is currently serialized into
 * the browser page) is a durable-workflow-shaped problem — the canon-
 * intended fix is a server-side graph serving only the next 1–3 steps.
 * Whoever implements this interface must coordinate with that fix (it
 * belongs to A01/A02), not ignore it.
 */

/** Marker so a test can assert the deferral is explicit, not forgotten. */
export const WORKFLOW_ORCHESTRATOR_STATUS = "DEFERRED_INTERFACE_ONLY" as const;

export type WorkflowStepStatus =
  | "pending"
  | "running"
  | "waiting" // parked on an external event / human approval / timer
  | "completed"
  | "failed"
  | "compensated"; // rolled back via its compensation handler

export interface WorkflowStepDefinition<Input = unknown, Output = unknown> {
  step_id: string;
  /** Steps run through the same governed door as everything else. */
  capability: string;
  /** Pure derivation of the step input from accumulated workflow state. */
  input: (state: Readonly<Record<string, unknown>>) => Input;
  /** Idempotency: re-running a completed step must be a no-op. */
  idempotency_key: (input: Input) => string;
  /** Optional compensation (rollback) if a later step fails permanently. */
  compensate?: (output: Output) => Promise<void>;
  max_retries?: number;
}

export interface WorkflowDefinition {
  workflow_id: string;
  version: string;
  /** The agent this workflow belongs to — registry/kill-switch rules apply per step. */
  agent_id: string;
  steps: readonly WorkflowStepDefinition[];
}

export interface WorkflowRunState {
  workflow_run_id: string;
  workflow_id: string;
  version: string;
  agent_id: string;
  /** Reserved — white-label approval condition (a); default "prn". */
  tenant_id?: string;
  status: WorkflowStepStatus;
  current_step_id: string | null;
  /** Accumulated step outputs by step_id — IDs and summaries, never raw PII. */
  state: Record<string, unknown>;
  /** Every transition appends to the Agent Run Ledger — nothing silent. */
  agent_run_ids: string[];
  started_at: string;
  updated_at: string;
}

/**
 * The contract a future engine must satisfy. Implementations must:
 *  - check the kill switch before EVERY step, not just at start;
 *  - write one AgentRunRecord per step execution;
 *  - survive process death (durable state, resumable by workflow_run_id);
 *  - never double-execute a step whose idempotency key already completed.
 */
export interface WorkflowOrchestrator {
  start(definition: WorkflowDefinition, initialState: Record<string, unknown>): Promise<WorkflowRunState>;
  resume(workflowRunId: string): Promise<WorkflowRunState>;
  /** Park a run until an external signal (e.g. an Approval Center decision). */
  signal(workflowRunId: string, signal: string, payload?: unknown): Promise<WorkflowRunState>;
  status(workflowRunId: string): Promise<WorkflowRunState | null>;
  cancel(workflowRunId: string, by: string, reason: string): Promise<WorkflowRunState | null>;
}
