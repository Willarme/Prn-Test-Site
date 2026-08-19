-- Post-description intake: required-field answers, guided-diagnosis answers,
-- and the generated-once playbook cache. Photo/video evidence rows reuse
-- evidence_object (content = private storage ref; originals never public).

create table if not exists intake_answer (
  id bigint generated always as identity primary key,
  request_id text not null,
  field_key text not null,
  value_text text,
  evidence_id text,
  source text not null check (source in ('auto_detected','typed','photo')),
  answered_at timestamptz not null
);
create index if not exists idx_intake_answer_request on intake_answer (request_id);

create table if not exists diagnosis_answer (
  id bigint generated always as identity primary key,
  request_id text not null,
  step_id text not null,
  answer text,
  evidence_id text,
  answered_at timestamptz not null
);
create index if not exists idx_diagnosis_answer_request on diagnosis_answer (request_id);

-- Generated once per problem family / cluster; replayed statically.
create table if not exists intake_playbook (
  playbook_id text primary key,
  version integer not null,
  problem_family text not null,
  cluster_label text not null,
  playbook jsonb not null,
  generated_by text not null,
  created_at timestamptz not null
);

-- Which playbook a request was routed to (so the walkthrough is stable even
-- if the content bank changes later).
alter table intake_session add column if not exists playbook_id text;

-- evidence kinds now include video.
alter table evidence_object drop constraint if exists evidence_object_kind_check;
alter table evidence_object add constraint evidence_object_kind_check
  check (kind in ('customer_text','photo','video','voice_transcript'));
alter table evidence_object add column if not exists mime text;
alter table evidence_object add column if not exists bytes integer;
alter table evidence_object add column if not exists field_key text;

alter table intake_answer enable row level security;
alter table diagnosis_answer enable row level security;
alter table intake_playbook enable row level security;
grant select, insert on intake_answer to service_role;
grant select, insert on diagnosis_answer to service_role;
grant select, insert on intake_playbook to service_role;
grant usage, select on all sequences in schema public to service_role;

notify pgrst, 'reload schema';
