-- TENANCY ON THE TWO CORE HOMEOWNER RECORDS — the reserved column, given a
-- value.
--
-- WRITTEN BUT NOT APPLIED with this build, as migrations 00006-00014 were.
--
-- WHY THIS IS NOT COSMETIC. A00's approval condition 1 (carried into A01
-- condition 7 and A02 pre-answer 8) reserves an optional `tenant_id` on every
-- core record, default 'prn', with NO tenant logic anywhere. Eight tables
-- already carry the column: agent_run_ledger, approval_item, kill_switch,
-- event_definition, metric_definition, the five A09 tables, search_opportunity,
-- intent_page, staged_page_spec. The two that hold actual HOMEOWNER data —
-- problem_record and evidence_object — did not, and nothing anywhere populated
-- the zod field either. A field that is never written is not reserved, it is
-- decorative.
--
-- These are the tables where getting it wrong is expensive: adding a NOT NULL
-- tenant column to POPULATED homeowner rows later means a backfill under a
-- migration lock on the one dataset that cannot be regenerated. Doing it before
-- the trial run costs a default.
--
-- THERE IS STILL NO TENANT LOGIC. Nothing reads this column to route, filter or
-- authorise; the RLS posture is unchanged (deny-all, service role only) and no
-- policy references tenant_id. The whole mechanism on the code side is
-- `withTenant()` in src/platform/stores/runtime.ts, which fills a blank on the
-- write path and never overwrites a value a record already carries.
--
-- ALREADY-WRITTEN ROWS get the default, which is correct rather than convenient:
-- every row in these tables today belongs to PRN, because PRN is the only tenant
-- that has ever existed.

alter table problem_record add column if not exists tenant_id text not null default 'prn';
alter table evidence_object add column if not exists tenant_id text not null default 'prn';

create index if not exists idx_problem_record_tenant on problem_record (tenant_id);
create index if not exists idx_evidence_object_tenant on evidence_object (tenant_id);

notify pgrst, 'reload schema';
