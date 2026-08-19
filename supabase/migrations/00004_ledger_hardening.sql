-- Consent ledger hardening + immutable disclosure text.

-- The consent ledger is the legal record of what a customer agreed to. Make
-- append-only STRUCTURAL, not just conventional: the application role may
-- insert and read, never update or delete.
revoke update, delete on consent_event from service_role;
revoke update, delete on event_envelope from service_role;

-- Immutable record of the exact disclosure text shown at the time, so a
-- consent event can always be reproduced even after the wording is revised
-- (#14A 9.3, build-kit 23).
create table if not exists disclosure_version (
  disclosure_version_id text primary key,
  version_label text not null,
  content_text text not null,
  content_hash text not null,
  status text not null check (status in ('draft','active','superseded')),
  jurisdiction_hint text,
  effective_from timestamptz not null,
  first_seen_at timestamptz not null default now()
);
alter table disclosure_version enable row level security;
grant select, insert on disclosure_version to service_role;
revoke update, delete on disclosure_version from service_role;

-- The migration bookkeeping table is created by the migrate tool, before this
-- file runs; lock it down to match every other table.
alter table if exists _prn_migrations enable row level security;
revoke all privileges on _prn_migrations from anon, authenticated;

notify pgrst, 'reload schema';
