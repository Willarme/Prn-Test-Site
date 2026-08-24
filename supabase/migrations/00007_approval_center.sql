-- A00 Shared Agent Platform — Approval Center queue (spec §4/§5).
-- One owner-facing queue for anything needing a human "yes". Rows mutate
-- ONLY on status/resolved_* (enforced in the application layer; the decision
-- is additionally recorded on the admin audit trail). The first real
-- consumer is A06 (Wave 2) — the existing /admin Pages approve/publish flow
-- is deliberately NOT migrated onto this queue by A00.
--
-- WRITTEN BUT NOT APPLIED with the A00 Wave-0 build: applying migrations is
-- a separate, human-coordinated step. Until applied, the application queue
-- is in-process and fail-soft (src/platform/approvals/center.ts).

create table if not exists approval_item (
  approval_id text primary key,
  agent_id text not null,
  -- Reserved (white-label approval condition a, 2026-08-24) — no tenant logic.
  tenant_id text not null default 'prn',
  run_id text not null,          -- links back to agent_run_ledger.run_id
  what_happened text not null,
  evidence jsonb,                -- IDs and summaries only, never raw customer evidence
  recommendation text,
  impact text not null,
  risk text not null,
  reversibility text not null check (reversibility in ('reversible','hard-to-reverse','irreversible')),
  proposed_change jsonb,
  status text not null check (status in ('PENDING','APPROVED','MODIFIED','REJECTED','DO_NOT_ASK_AGAIN_FOR_CLASS')),
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null
);

create index if not exists idx_approval_item_status_time
  on approval_item (status, created_at);

alter table approval_item enable row level security;

-- Unlike the ledgers, resolution IS an update — but never a delete.
revoke delete on approval_item from service_role;

notify pgrst, 'reload schema';
