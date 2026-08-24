-- A00 Shared Agent Platform — Agent Run Ledger (spec §4/§5).
-- One APPEND-ONLY row per agent run: the auditable record of what every
-- digital worker did, what it touched (by ID only — never raw PII), what
-- handled it, and what it cost. Same structural discipline as the consent
-- ledger (00004): the application role may insert and read, never update or
-- delete.
--
-- WRITTEN BUT NOT APPLIED with the A00 Wave-0 build: applying migrations is
-- a separate, human-coordinated step. Until applied, the application writes
-- fail-soft (src/platform/runs/ledger.ts) and nothing customer-facing is
-- affected.

create table if not exists agent_run_ledger (
  run_id text primary key,
  agent_id text not null,
  -- Reserved (white-label approval condition a, 2026-08-24): per-client
  -- deployments each run their own store; this column only exists so a later
  -- central fleet view costs nothing. No tenant logic exists anywhere.
  tenant_id text not null default 'prn',
  -- Named trigger_kind (not "trigger") to avoid any keyword friction;
  -- application field name is `trigger`.
  trigger_kind text not null check (trigger_kind in ('request','job','schedule','admin_action')),
  input_ids text[] not null default '{}',
  capabilities_used text[] not null default '{}',
  tool_provider text,           -- 'deterministic-stand-in' until a model is wired
  tool_model_version text,
  outputs_summary jsonb,        -- IDs and small labels only, never PII
  decisions text[],
  cost_usd numeric,             -- TEST-labeled figures only until canon fixes real prices
  latency_ms numeric,
  confidence numeric,
  eval_score numeric,
  actions_taken text[],
  errors text[],
  human_correction text,
  created_at timestamptz not null
);

create index if not exists idx_agent_run_ledger_agent_time
  on agent_run_ledger (agent_id, created_at);

alter table agent_run_ledger enable row level security;

-- Append-only is STRUCTURAL, not conventional (00004 precedent).
revoke update, delete on agent_run_ledger from service_role;

notify pgrst, 'reload schema';
