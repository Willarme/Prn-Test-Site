-- LOOP SURFACES — the rows behind the homeowner loop's scoped links, the Home
-- Memory claim, the Trust Network ask, the feedback popup, the mail outbox,
-- the job address and the product-page vote (campaign track F2b, 2026-09-05;
-- src/platform/stores/runtime.ts carries the same methods on both backends;
-- the file store keeps dev-db collections of the SAME names).
--
-- WRITTEN BUT NOT APPLIED with this build, as every migration since 00006 was:
-- applying is a separate, human-coordinated step (Melissa, before the next
-- deploy — `npm run db:migrate` on her machine). Until it is applied the
-- Supabase store's writes to these tables throw, naming this file, and its
-- reads return the truthful empty answer with a one-per-process warning.
--
-- WHAT THE LINKS MUST GUARANTEE (PRN Master Build Spec MERGED §16.2, and the
-- Unique Links decisions doc): opaque signed tokens, never personal data in a
-- URL, never a sequential id, revocable from the homeowner's side. The token
-- itself is minted and checked in src/platform/links/tokens.ts (HMAC-SHA256);
-- what the database holds is the REVOCATION LEDGER — a link id that appears
-- in link_revocations stops opening, and nothing else about the record moves
-- (§11.4: revocation kills the link, the record is unchanged; decision 8, A).
--
-- TENANCY AND SCOPE, copied from 00015 and 00019. Every table carries
-- tenant_id default 'prn' (reserved column, no tenant logic anywhere) and the
-- request-keyed tables carry request_id so the SAME request-scoped RLS
-- policies 00019 put on the journey tables apply here: a request-scoped
-- client reads and writes only rows stamped with its own request_id, and
-- cannot forge a row under another's. The two tables that belong to no
-- journey — email_outbox (the server's own outbox, read back by id at
-- /mail/<id>) and signups (a vote from a product preview page) — stay
-- deny-all + service role, the 00002/00003 posture.
--
-- APPEND-ONLY, with one deliberate exception. Nothing here is ever deleted.
-- magic_links.consumed_at and email_outbox.sent_at/provider_id are the two
-- in-place updates: a magic link is consumed exactly once and an outbox row
-- records the moment it actually went. Both are stamped, never cleared.

-- ---------------------------------------------------------------------------
-- 0. Evidence kinds now include the door's voice note (F1, routine decision
--    12: accepted and stored, listed as "Voice note (not transcribed)").
-- ---------------------------------------------------------------------------

alter table evidence_object drop constraint if exists evidence_object_kind_check;
alter table evidence_object add constraint evidence_object_kind_check
  check (kind in ('customer_text','photo','video','voice_transcript','voice_note'));

-- ---------------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------------

-- The revocation ledger. One row per killed link; a link id is checked here
-- on every open. The record it pointed at is untouched.
create table if not exists link_revocations (
  link_id text primary key,
  tenant_id text not null default 'prn',
  request_id text not null,
  revoked_at timestamptz not null
);
create index if not exists idx_link_revocations_request on link_revocations (request_id);

-- "Keep this" — one contact field attached to a record that already exists
-- (§16.1: email or phone, magic link, no password). Newest row wins on read.
create table if not exists keep_claims (
  id bigint generated always as identity primary key,
  tenant_id text not null default 'prn',
  request_id text not null,
  contact text not null,
  contact_kind text not null check (contact_kind in ('email','phone')),
  claimed_at timestamptz not null,
  magic_link_id text not null
);
create index if not exists idx_keep_claims_request on keep_claims (request_id);

-- One-field, no-password sign-in. consumed_at is stamped once by the
-- single-use UPDATE (consumeMagicLink matches only a null consumed_at).
create table if not exists magic_links (
  magic_id text primary key,
  tenant_id text not null default 'prn',
  request_id text not null,
  contact text not null,
  created_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists idx_magic_links_request on magic_links (request_id);

-- A friend's answer to the Trust Network ask, given without an account and
-- limited to this one request's context (§16.2).
create table if not exists ask_answers (
  ask_id text primary key,
  tenant_id text not null default 'prn',
  request_id text not null,
  friend_name text not null,
  friend_contact text,
  provider_name text not null,
  provider_contact text,
  reason text,
  created_at timestamptz not null
);
create index if not exists idx_ask_answers_request on ask_answers (request_id);

-- The feedback popup's four fields (Unique Links and Feedback Popup decisions
-- §2): one score chip, up to four "what it got right" options, one free-text
-- near-miss. Never a price question, never a provider question.
create table if not exists feedback (
  feedback_id text primary key,
  tenant_id text not null default 'prn',
  request_id text not null,
  score text not null check (score in ('not_really','somewhat','very')),
  "right" text[] not null default '{}',
  slow text,
  created_at timestamptz not null
);
create index if not exists idx_feedback_request on feedback (request_id);

-- The mail outbox. mode 'preview' (routine decision 8, the default) is stored
-- and shown at /mail/<id>; mode 'live' goes through the provider and records
-- sent_at + provider_id when it has. request_id is nullable: a message
-- belongs to a journey when it belongs to one.
create table if not exists email_outbox (
  email_id text primary key,
  tenant_id text not null default 'prn',
  request_id text,
  "to" text not null,
  subject text not null,
  text text not null,
  html text not null,
  mode text not null check (mode in ('preview','live')),
  created_at timestamptz not null,
  sent_at timestamptz,
  provider_id text
);
create index if not exists idx_email_outbox_request on email_outbox (request_id);

-- The job address the packet requires (Directions §3.3; routine decision 10).
-- Append-only: a corrected address is a new row and the newest wins on read.
create table if not exists job_addresses (
  id bigint generated always as identity primary key,
  tenant_id text not null default 'prn',
  request_id text not null,
  street text not null,
  city_state_zip text not null,
  property_type text,
  storeys text,
  saved_at timestamptz not null
);
create index if not exists idx_job_addresses_request on job_addresses (request_id);

-- A vote from one of Melissa's product preview pages (POST /api/signup). The
-- browser's vote_id is its own idempotency key: a person who fills the form
-- after clicking yes posts twice by design, and the second CORRECTS the first
-- (upsert on vote_id). A "yes" carries the most identifying payload in the
-- trial — USER_PRIVATE, service role only, never echoed, never in a URL.
create table if not exists signups (
  signup_id text primary key,
  tenant_id text not null default 'prn',
  page text not null,
  vote text not null check (vote in ('yes','no')),
  name text,
  email text,
  phone text,
  zip text,
  reasons text[] not null default '{}',
  vote_id text unique,
  browser_at text,
  created_at timestamptz not null
);

-- ---------------------------------------------------------------------------
-- 2. RLS on, everywhere, from the moment the tables exist. Service role keeps
--    the 00003 posture (explicit grants, as 00014 does, so this file stands on
--    its own). UPDATE is granted only where an in-place stamp exists; DELETE
--    is granted nowhere, to nobody.
-- ---------------------------------------------------------------------------

alter table link_revocations enable row level security;
alter table keep_claims enable row level security;
alter table magic_links enable row level security;
alter table ask_answers enable row level security;
alter table feedback enable row level security;
alter table email_outbox enable row level security;
alter table job_addresses enable row level security;
alter table signups enable row level security;

grant select, insert on link_revocations to service_role;
grant select, insert on keep_claims to service_role;
grant select, insert, update on magic_links to service_role;
grant select, insert on ask_answers to service_role;
grant select, insert on feedback to service_role;
grant select, insert, update on email_outbox to service_role;
grant select, insert on job_addresses to service_role;
grant select, insert, update on signups to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke delete on link_revocations, keep_claims, magic_links, ask_answers, feedback, email_outbox, job_addresses, signups from service_role;

-- ---------------------------------------------------------------------------
-- 3. Request-scoped grants + policies on the six request-keyed tables — the
--    exact 00019 idiom: SELECT scoped by USING, INSERT scoped by WITH CHECK,
--    both against the caller's own JWT request_id claim. email_outbox and
--    signups get NO policy and NO grant to authenticated: deny-all.
-- ---------------------------------------------------------------------------

grant select, insert on link_revocations to authenticated;
grant select, insert on keep_claims to authenticated;
grant select, insert on magic_links to authenticated;
grant select, insert on ask_answers to authenticated;
grant select, insert on feedback to authenticated;
grant select, insert on job_addresses to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy "request-scoped read" on link_revocations
  for select to authenticated
  using (request_id = (auth.jwt() ->> 'request_id'));
create policy "request-scoped insert" on link_revocations
  for insert to authenticated
  with check (request_id = (auth.jwt() ->> 'request_id'));

create policy "request-scoped read" on keep_claims
  for select to authenticated
  using (request_id = (auth.jwt() ->> 'request_id'));
create policy "request-scoped insert" on keep_claims
  for insert to authenticated
  with check (request_id = (auth.jwt() ->> 'request_id'));

create policy "request-scoped read" on magic_links
  for select to authenticated
  using (request_id = (auth.jwt() ->> 'request_id'));
create policy "request-scoped insert" on magic_links
  for insert to authenticated
  with check (request_id = (auth.jwt() ->> 'request_id'));

create policy "request-scoped read" on ask_answers
  for select to authenticated
  using (request_id = (auth.jwt() ->> 'request_id'));
create policy "request-scoped insert" on ask_answers
  for insert to authenticated
  with check (request_id = (auth.jwt() ->> 'request_id'));

create policy "request-scoped read" on feedback
  for select to authenticated
  using (request_id = (auth.jwt() ->> 'request_id'));
create policy "request-scoped insert" on feedback
  for insert to authenticated
  with check (request_id = (auth.jwt() ->> 'request_id'));

create policy "request-scoped read" on job_addresses
  for select to authenticated
  using (request_id = (auth.jwt() ->> 'request_id'));
create policy "request-scoped insert" on job_addresses
  for insert to authenticated
  with check (request_id = (auth.jwt() ->> 'request_id'));

notify pgrst, 'reload schema';
