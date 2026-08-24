-- A09 Data Quality & Reconciliation — findings, quarantine and repair records.
--
-- WRITTEN BUT NOT APPLIED with the A09 Wave-0 build, exactly as migrations
-- 00006-00009 were: applying migrations is a separate, human-coordinated step.
-- Until applied, the durable store is the file-backed dev database
-- (src/platform/stores/dev-db.ts) selected by src/platform/quality/store.ts.
--
-- A09 DOES NOT INHERIT THE PLATFORM'S FAIL-SOFT WRITE CONTRACT, and this file
-- is where that shows up in the schema. Every other A00 store keeps an
-- in-process buffer and logs a miss when its table is absent; A09 cannot,
-- because a swallowed finding leaves bad data feeding KPIs while the run
-- reports clean. So A09 writes to a store that persists in BOTH configurations,
-- and a write that does not land is a loud, counted failure (Loop Spec Audit
-- condition 7).
--
-- ONE TABLE FOR FINDINGS, WITH A `kind` DISCRIMINATOR (pre-answer 4).
-- DataQualityIssue and ReconciliationMismatch are the same shape under one
-- column: one RLS policy, one tenant_id, one quarantine join, one cockpit
-- query. Two tables would only pay off if the shapes diverged, and they do not.
--
-- APPEND-ONLY WHERE THE RECORD IS A FINDING. A finding's status lifecycle is a
-- VERSION CHAIN — a transition inserts a new row at the next finding_version,
-- never an update — mirroring event_definition in migration 00009 and the
-- consent ledger in 00004. update and delete are revoked, so "a data-quality
-- system cannot quietly lose or rewrite its own findings" is enforced by the
-- database rather than by convention.
--
-- THE ONE EXCEPTION, deliberately: a quarantine marker's status. A marker
-- exists precisely so an owner can release it, so UPDATE is granted at COLUMN
-- level on status/released_at/released_by and nowhere else. Every release
-- emits data_quality.quarantine_released, so the HISTORY stays append-only even
-- though the flag does not. DELETE is revoked here too — nothing A09 records is
-- ever destroyed.
--
-- NO CUSTOMER EVIDENCE CAN BE STORED HERE, BY SHAPE. There is no free-text
-- column anywhere in this file: findings carry enums, ids, integers and one
-- `detail_code` constrained to lowercase snake_case. A photo reference, a
-- consent paragraph or a homeowner's own words cannot be represented in these
-- tables at all (condition 9, enforced in the types AND here).

create table if not exists data_quality_issue (
  issue_id text not null,
  -- Append-only lifecycle: a status change is a NEW version, never an update.
  finding_version integer not null check (finding_version >= 1),
  -- Reserved (white-label approval condition a, 2026-08-24) — no tenant logic.
  tenant_id text not null default 'prn',
  -- THE DISCRIMINATOR. One queue, one cockpit line, one Approval Center.
  kind text not null check (kind in ('data_quality_issue','reconciliation_mismatch')),
  source text not null check (source in ('ingest','reconciliation','deploy_check','metric_anomaly')),
  check_kind text not null check (check_kind in (
    'required_field','legal_transition','event_linkage','referential',
    'duplicate','schema_drift','cross_source_total'
  )),
  -- Both stored, so a finding stays readable against the rule AS IT WAS WRITTEN.
  rule_id text not null,
  rule_version integer not null check (rule_version >= 1),
  -- A CLOSED vocabulary, not a free-form table name: an open string here would
  -- let a finding name any table, including one holding customer evidence.
  entity_type text not null check (entity_type in (
    'problem_record','job_packet','search_opportunity','page_spec',
    'intake_session','event_envelope','consent_event'
  )),
  entity_id text not null,
  -- IDs only, and bounded in the application schema so a sweep cannot dump a
  -- table into a finding.
  related_entity_ids jsonb not null default '[]'::jsonb,
  severity text not null check (severity in ('critical','high','medium','low')),
  -- The ONLY non-enum, non-numeric, non-id column. Lowercase snake_case, max 48
  -- chars: a sentence, a URL or consent wording cannot be stored in it.
  detail_code text not null check (detail_code ~ '^[a-z][a-z0-9_]{2,47}$'),
  -- Cross-source checks only.
  expected_count integer,
  observed_count integer,
  delta_pct numeric,
  tolerance_applied numeric,
  -- { method, suspected_owner, basis, agent_run_id }. suspected_owner is NULL
  -- when the Agent Run Ledger did not support naming one — never a guess.
  root_hypothesis jsonb not null,
  quarantined boolean not null default false,
  status text not null check (status in (
    'open','repair_proposed','repair_executed','repair_verified','rejected','wont_fix'
  )),
  created_at timestamptz not null,
  resolved_at timestamptz,
  primary key (issue_id, finding_version)
);

create index if not exists idx_data_quality_issue_open
  on data_quality_issue (status, severity, created_at);

create index if not exists idx_data_quality_issue_entity
  on data_quality_issue (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- QUARANTINE MARKER — ITS OWN TABLE, referencing the original row.
--
-- Never a `quarantined_at` column bolted onto a watched table (condition 10).
-- A separate marker avoids schema changes and RLS-policy edits on live customer
-- tables, avoids touching the append-only consent ledger's shape at all, and is
-- the cleaner per-client story. The original row is never modified, never moved
-- and never deleted — that is the whole difference between quarantining and
-- dropping.
--
-- Wave 0 scopes enforcement to KPI/aggregate and admin reads ONLY. The
-- customer-facing read path serves the record UNCHANGED.
-- TODO-ASK-OWNER (Melissa): what a homeowner sees when their own record is
-- quarantined mid-journey is homeowner experience, copy and psychology — parked,
-- not decided, and gated behind the policy flag
-- quality.quarantine_customer_reads which ships FALSE.
-- ---------------------------------------------------------------------------
create table if not exists quarantine_marker (
  marker_id text primary key,
  tenant_id text not null default 'prn',
  entity_type text not null check (entity_type in (
    'problem_record','job_packet','search_opportunity','page_spec',
    'intake_session','event_envelope','consent_event'
  )),
  entity_id text not null,
  -- Every marker has a reason with a paper trail.
  issue_id text not null,
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{2,47}$'),
  severity text not null check (severity in ('critical','high','medium','low')),
  status text not null check (status in ('active','released')),
  applied_at timestamptz not null,
  released_at timestamptz,
  -- A release is a human act.
  released_by text,
  -- A release must record who and when, or it is not auditable.
  constraint quarantine_release_is_audited check (
    status = 'active'
    or (released_at is not null and released_by is not null)
  )
);

create index if not exists idx_quarantine_marker_active
  on quarantine_marker (status, entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- REPAIR RECORDS. The auto-repair allow-list ships EMPTY and the
-- quality.auto_repair_enabled policy flag ships FALSE, so in Wave 0 every row
-- in repair_execution has an owner behind it. Nothing here can be written by a
-- schedule.
-- ---------------------------------------------------------------------------
create table if not exists repair_proposal (
  proposal_id text primary key,
  tenant_id text not null default 'prn',
  issue_id text not null,
  repair_kind text not null,
  entity_type text not null,
  entity_id text not null,
  -- The declared FIELD NAME a repair would write. Publish-state and page-content
  -- fields are refused in application code (condition 8) — no repair may ever
  -- publish, unpublish, retire or edit a page.
  target_field text not null,
  simulated_rows_affected integer not null check (simulated_rows_affected >= 0),
  simulated_rule_passes_after boolean not null,
  simulation_detail_code text not null check (simulation_detail_code ~ '^[a-z][a-z0-9_]{2,47}$'),
  -- Canon's guardrail is not optional: a repair that cannot describe its own
  -- reversal cannot be recorded.
  reversible boolean not null default true check (reversible),
  requires_approval boolean not null default true,
  -- The Approval Center item this was filed as (migration 00007).
  approval_id text,
  proposed_at timestamptz not null
);

create index if not exists idx_repair_proposal_issue
  on repair_proposal (issue_id, proposed_at);

create table if not exists repair_execution (
  execution_id text primary key,
  tenant_id text not null default 'prn',
  proposal_id text not null,
  issue_id text not null,
  repair_kind text not null,
  -- 'owner:<id>'. Never 'system' while the allow-list is empty.
  executed_by text not null,
  executed_at timestamptz not null,
  rows_affected integer not null check (rows_affected >= 0),
  verified boolean not null default false,
  verified_at timestamptz,
  -- Set when this execution UNDOES a prior one, so the trail never loses a step.
  rollback_of text,
  -- Points at the snapshot below. Written BEFORE the mutation.
  executed_at_reversal_token text not null
);

create index if not exists idx_repair_execution_issue
  on repair_execution (issue_id, executed_at);

-- The exact prior value a repair overwrote, so a reversal restores it
-- byte-for-byte. ID ARRAYS ONLY — every declared repair kind touches an id list
-- and nothing else, which is what keeps the snapshot inside the
-- no-raw-evidence contract. A repair needing to snapshot free text could not be
-- declared at all; that is the intended ceiling on what A09 may ever repair.
create table if not exists repair_reversal_snapshot (
  reversal_token text primary key,
  tenant_id text not null default 'prn',
  entity_type text not null,
  entity_id text not null,
  target_field text not null,
  previous_ids jsonb not null default '[]'::jsonb,
  captured_at timestamptz not null
);

-- ---------------------------------------------------------------------------
-- RLS on every new table, exactly as every existing one in this repo.
-- ---------------------------------------------------------------------------
alter table data_quality_issue enable row level security;
alter table quarantine_marker enable row level security;
alter table repair_proposal enable row level security;
alter table repair_execution enable row level security;
alter table repair_reversal_snapshot enable row level security;

-- APPEND-ONLY WHERE THE RECORD IS A FINDING. A status change is a new
-- finding_version row; nothing legitimately updates or deletes one.
revoke update, delete on data_quality_issue from service_role;
revoke update, delete on repair_proposal from service_role;
revoke update, delete on repair_execution from service_role;
revoke update, delete on repair_reversal_snapshot from service_role;

-- THE ONE MUTABLE ROW, and only three of its columns. A marker exists so it can
-- be released; it may never be deleted, and no other field may be rewritten
-- after the fact.
revoke update, delete on quarantine_marker from service_role;
grant update (status, released_at, released_by) on quarantine_marker to service_role;

notify pgrst, 'reload schema';
