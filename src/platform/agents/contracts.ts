import { z } from "zod";
import { Cadence, Id, IsoDateTime, UsdAmount } from "@/domain/shared/primitives";

/**
 * Agent trial-scope statuses, normalized from #14A §12 / kit
 * 07_TRIAL_AGENTS.md. An agent is a governed responsibility boundary using
 * shared capabilities — never a separate app, and never "one LLM call per
 * agent" (#23 §2).
 *
 * A00 MIGRATION NOTE (spec §9 step 1, authorized at approval 2026-08-24):
 * this enum was previously named `AgentStage` and the field on
 * `AgentDefinition` was `stage`. The FIELD is renamed to `status`; the VALUES
 * are preserved verbatim so every existing reader (admin Agents panel, the
 * build-kit superset test) observes exactly the strings it always did. The
 * A00 spec's proposed four-value status vocabulary
 * ("LIVE" | "SANDBOX" | "PAUSED" | "RETIRED") cannot hold these richer
 * kit-derived values without changing observable behavior, so reconciling the
 * two vocabularies is left as an owner decision — deliberately NOT blended
 * here (hard canon rule 2).
 */
export const AgentStatus = z.enum([
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
export type AgentStatus = z.infer<typeof AgentStatus>;

/**
 * Canon phase bands (A00 spec §4). Values mirror each agent's architecture-
 * prompt document frontmatter `phase` field in
 * `prn-vault/Project/03 Build/Agent Architecture Prompts/` — deliberately NOT
 * named `stage` (that name carried the trial-scope meaning now living in
 * `status`). "TBD" is reserved for agents with no frontmatter/canon source for
 * their band yet; use a documented source when it exists, never a guess.
 * A sourced phase band does not establish spec approval or runtime activation.
 */
export const PhaseBand = z.enum(["FOUNDATION", "TRIAL", "PHASE2", "LATER", "TBD"]);
export type PhaseBand = z.infer<typeof PhaseBand>;

/**
 * Per-agent budgets (A00 spec §4). Every field optional until the owners set
 * real values; any dollar figure set here MUST be a TEST-labeled figure
 * (hard canon rule 4) — `ai_api_dollars_per_day` is a TEST value, never a
 * real price, until canon fixes one.
 */
export const AgentBudgets = z.object({
  ai_api_dollars_per_day: z.number().nonnegative().optional(),
  contacts_per_day: z.number().int().nonnegative().optional(),
  page_publishes_per_day: z.number().int().nonnegative().optional(),
  db_writes_per_run: z.number().int().nonnegative().optional(),
  max_retries: z.number().int().nonnegative().optional(),
  max_blast_radius: z.string().optional(),
});
export type AgentBudgets = z.infer<typeof AgentBudgets>;

export const AgentId = z.string().regex(/^A\d{2}$/);

/**
 * A00 Agent Registry entry (spec §4) — the extended schema on the same
 * versioned code module that has always carried the trial roster.
 *
 * `autonomy_level`: canon carries TWO non-identical autonomy scales (the
 * A0–A5 "Autonomy level" ladder in 01 Canon/17 + 01 Canon/20 §1, and the
 * L-numbered observe→…→exception-only "Autonomy ladder" in 01 Canon/20
 * per-agent fields + 01 Canon/26). Neither outranks the other, so which one
 * this field stores is an OPEN owner decision (Joshua + Melissa) — every
 * entry ships the literal string "TBD" until that call is made. Do not
 * assume either scale when reading this field.
 *
 * `mandate` is retained verbatim for existing readers; `purpose` mirrors it
 * until the owners author distinct one-line missions.
 */
export const AgentDefinition = z.object({
  agent_id: AgentId,
  name: z.string().min(1),
  status: AgentStatus,
  mandate: z.string().min(1),
  purpose: z.string().min(1),
  owner_layer: z.string().min(1),
  phase_band: PhaseBand,
  autonomy_level: z.string().min(1),
  policy_version: z.string().min(1),
  prompt_version: z.string().optional(),
  allowed_capabilities: z.array(z.string()),
  data_access: z.array(z.string()),
  write_access: z.array(z.string()),
  budgets: AgentBudgets,
  schedule: z.string().optional(),
  eval_suite_ref: z.string().optional(),
  health: z.enum(["green", "amber", "red"]).optional(),
  kill_switch_ref: z.string().min(1),
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
