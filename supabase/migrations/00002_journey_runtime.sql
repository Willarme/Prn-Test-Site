-- Customer-journey + runtime tables (Door Waves 5-7 persisted).
-- RLS enabled with NO policies on every table: anon/authenticated get nothing,
-- only the server-side service role reads/writes. Customer-scoped policies
-- arrive with the Customer Lite wave.

create table if not exists intake_session (
  intake_session_id text primary key,
  schema_version text not null,
  guest_session_id text,
  request_id text not null unique,
  attribution jsonb not null,
  consent_event_ids text[] not null default '{}',
  entered_at timestamptz not null,
  intake_started_at timestamptz
);
create index if not exists idx_intake_session_request on intake_session (request_id);

create table if not exists consent_event (
  consent_event_id text primary key,
  person_id text,
  guest_session_id text,
  problem_id text,
  scope text not null,
  action text not null check (action in ('GRANT','REVOKE','RENEW')),
  disclosure_version_id text not null,
  surface text not null,
  trace_id text,
  occurred_at timestamptz not null
);

create table if not exists problem_record (
  problem_id text primary key,
  schema_version text not null,
  status text not null check (status in ('draft','clarifying','packet_ready','closed')),
  source_channel text not null check (source_channel in ('web','api','mcp','admin','import')),
  intake_session_id text,
  problem_summary text,
  service_category text,
  service_category_confidence text,
  safety_state text not null check (safety_state in ('normal','review','urgent')),
  safety_rule_id text,
  evidence_ids text[] not null default '{}',
  claim_ids text[] not null default '{}',
  clarifiers_asked jsonb not null default '[]',
  created_at timestamptz not null,
  updated_at timestamptz
);
create index if not exists idx_problem_intake_session on problem_record (intake_session_id);

-- Raw customer evidence: private by default, never exposed publicly.
create table if not exists evidence_object (
  evidence_id text primary key,
  kind text not null check (kind in ('customer_text','photo','voice_transcript')),
  content text not null,
  privacy text not null default 'private' check (privacy = 'private'),
  captured_at timestamptz not null
);

create table if not exists job_packet (
  job_packet_id text primary key,
  packet_version integer not null,
  schema_version text not null,
  problem_id text not null,
  packet jsonb not null,
  generated_at timestamptz not null,
  engine text not null check (engine in ('fixture','production'))
);
create index if not exists idx_job_packet_problem on job_packet (problem_id);

create table if not exists event_envelope (
  event_id text primary key,
  event_name text not null,
  event_version integer not null,
  occurred_at timestamptz not null,
  actor jsonb not null,
  guest_session_id text,
  context jsonb not null default '{}',
  source jsonb not null default '{}',
  versions jsonb not null default '{}',
  result jsonb not null default '{}',
  privacy_class text not null,
  trace_id text,
  agent_run_id text,
  action_request_id text
);
create index if not exists idx_event_name_time on event_envelope (event_name, occurred_at);

-- Owner-published doors. Nothing reaches this table except the owner publish
-- action on a QA-PASS page (#14A 15.1 step 8).
create table if not exists published_page (
  page_id text primary key,
  page_spec_id text not null,
  canonical_path text not null,
  published_at timestamptz not null
);

create table if not exists staged_page_spec (
  page_spec_id text primary key,
  page_id text not null,
  canonical_path text not null,
  spec jsonb not null,
  created_at timestamptz not null
);

create table if not exists admin_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null,
  action text not null,
  target text not null,
  detail text
);
create index if not exists idx_admin_audit_at on admin_audit (at desc);

alter table intake_session enable row level security;
alter table consent_event enable row level security;
alter table problem_record enable row level security;
alter table evidence_object enable row level security;
alter table job_packet enable row level security;
alter table event_envelope enable row level security;
alter table published_page enable row level security;
alter table staged_page_spec enable row level security;
alter table admin_audit enable row level security;
