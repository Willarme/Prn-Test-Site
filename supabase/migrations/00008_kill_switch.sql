-- A00 Shared Agent Platform — Kill Switch state (spec §4/§5).
-- The ONE deliberately mutable-in-place platform primitive: a toggle, not a
-- ledger. Every toggle also emits a platform.kill_switch_* EventEnvelope
-- (provisional names pending A08) so the HISTORY of toggles remains
-- append-only and auditable even though current state is a flag.
--
-- Scopes: GLOBAL + AGENT are operative in Wave 0. CAPABILITY / PAGE_CLASS
-- are contract-reserved (no engage path yet). 'TENANT' is a reserved FUTURE
-- value (white-label approval condition b, 2026-08-24) — included in the
-- check constraint so a later fleet view needs no schema change, but nothing
-- writes it today.
--
-- WRITTEN BUT NOT APPLIED with the A00 Wave-0 build: applying migrations is
-- a separate, human-coordinated step. Until applied, switch state is
-- in-process and fail-soft (src/platform/killswitch/index.ts).

create table if not exists kill_switch (
  -- 'global' or 'agent:<agent_id>' (future: 'capability:<key>', 'page_class:<id>', 'tenant:<id>')
  switch_key text primary key,
  scope text not null check (scope in ('GLOBAL','AGENT','CAPABILITY','PAGE_CLASS','TENANT')),
  -- Reserved (white-label approval condition a, 2026-08-24) — no tenant logic.
  tenant_id text not null default 'prn',
  scope_ref text,
  engaged boolean not null default false,
  engaged_by text,
  engaged_at timestamptz,
  reason text,
  updated_at timestamptz not null
);

alter table kill_switch enable row level security;

notify pgrst, 'reload schema';
