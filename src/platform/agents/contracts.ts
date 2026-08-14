import { z } from "zod";
import { Cadence, Id, IsoDateTime, UsdAmount } from "@/domain/shared/primitives";

/**
 * Agent stages normalized from #14A §12 / kit 07_TRIAL_AGENTS.md. An agent is
 * a governed responsibility boundary using shared capabilities — never a
 * separate app, and never "one LLM call per agent" (#23 §2).
 */
export const AgentStage = z.enum([
  "LIVE",
  "TEST_ONLY",
  "LITE_LIVE",
  "INTERFACE_DATA_NOW",
  "FIELDS_NOW",
  "MINIMAL_LIVE",
  "SKELETON_LIVE",
  "HARNESS_NOW",
  "LATER",
]);
export type AgentStage = z.infer<typeof AgentStage>;

export const AgentId = z.string().regex(/^A\d{2}$/);

export const AgentDefinition = z.object({
  agent_id: AgentId,
  name: z.string().min(1),
  stage: AgentStage,
  mandate: z.string().min(1),
});
export type AgentDefinition = z.infer<typeof AgentDefinition>;

/**
 * Database-backed schedule state (#23 §1.2): the scheduler (Vercel Cron or
 * other) only TRIGGERS jobs; schedule/state/budget are PRN-owned data so the
 * scheduler vendor is replaceable.
 */
export const ScheduledJob = z.object({
  scheduled_job_id: Id,
  job_key: z.string().min(1),
  agent_id: AgentId.nullable(),
  cadence: Cadence,
  next_run_at: IsoDateTime,
  policy_version: z.string().nullable(),
  budget: z.object({
    max_usd: UsdAmount.nullable(),
    max_calls: z.number().int().positive().nullable(),
  }),
  enabled: z.boolean(),
  last_agent_run_id: Id.nullable(),
  created_at: IsoDateTime,
});
export type ScheduledJob = z.infer<typeof ScheduledJob>;

export const AgentRunStatus = z.enum(["queued", "running", "completed", "failed", "skipped"]);

/**
 * One audited agent execution. input_hash + idempotency_key dedupe retried
 * runs so a queue retry never pays twice (#23 §2.4).
 */
export const AgentRun = z.object({
  agent_run_id: Id,
  agent_id: AgentId,
  job_key: z.string().nullable(),
  input_hash: z.string().nullable(),
  idempotency_key: z.string().nullable(),
  status: AgentRunStatus,
  attempts: z.number().int().min(1),
  started_at: IsoDateTime,
  finished_at: IsoDateTime.nullable(),
  output_ids: z.array(Id),
  cost_usd: UsdAmount.nullable(),
  error: z.string().nullable(),
});
export type AgentRun = z.infer<typeof AgentRun>;
