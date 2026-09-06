-- T1-33: request-scoped (homeowner-authenticated) read + write seam.
--
-- Condition 1 of the 2026-08-28 A01/A02 approval, carrying forward A00's own
-- approval condition (d): "service-role-only must not be structurally
-- assumed anywhere new." Every table below shipped in 00001/00002/00005 with
-- RLS ENABLED and NO POLICY, by design ("Customer-scoped policies arrive
-- with the Customer Lite wave" — 00002's own header comment). This migration
-- is that wave's read AND write half — the item's done-when is explicit
-- that the request-scoped client is the default path for customer-facing
-- reads AND writes, not reads alone.
--
-- MECHANISM. There is no homeowner login yet — a request is authenticated
-- today only by holding its crypto-random request_id (#14A / D-23:
-- "unguessable capability URL by design"). This migration turns that
-- existing capability into a real, database-enforced boundary instead of an
-- app-level convention:
--   1. Every customer-journey table gets (or already has) a `request_id`
--      column, denormalized so RLS can filter without joining through
--      mutable arrays or nullable FKs.
--   2. `authenticated` (Supabase's standard "holds a valid signed JWT" role)
--      is granted SELECT, INSERT, and — on the one table an existing write
--      path updates in place (problem_record.evidence_ids) — UPDATE. Never
--      DELETE anywhere.
--   3. A SELECT policy (USING) scopes every read to rows whose request_id
--      matches the caller's JWT claim. An INSERT policy (WITH CHECK) scopes
--      every write so a caller can only ever create a row stamped with
--      their OWN request_id — they cannot forge a row under someone else's.
--      An UPDATE policy on problem_record (USING + WITH CHECK) scopes both
--      which existing row can be targeted and what request_id the updated
--      row is allowed to carry (both must be the caller's own).
-- The application mints that JWT server-side (src/platform/db/client.ts,
-- requestScopedClient()), signed with SUPABASE_JWT_SECRET, ONLY after the
-- caller has already presented the matching request_id in the URL — the
-- JWT does not grant anything the URL didn't already gate; it moves
-- enforcement from "every query remembers its WHERE clause" (app-level,
-- one missed filter = cross-subject leak, and service-role bypasses RLS
-- entirely) to "the database refuses the row regardless of the query the
-- application code issues." That is the entire value of this migration.
--
-- Same `auth.jwt()` policy idiom Supabase's own RLS docs use
-- (https://supabase.com/docs/guides/database/postgres/row-level-security),
-- so real homeowner accounts can reuse this exact seam later by adding an
-- owner-id claim/column alongside request_id — no second pattern.
--
-- NOT APPLIED to the live database by this commit (repo convention — see
-- tools/db-migrate.ts). Apply with `npm run db:migrate` once
-- SUPABASE_DB_PASSWORD is set, THEN set SUPABASE_ANON_KEY + SUPABASE_JWT_SECRET
-- in the deploy env so requestScopedClient() actually engages (it fails soft
-- to the service client until both are present — see client.ts).

-- ---------------------------------------------------------------------------
-- 1. Denormalize request_id onto tables that only reach it via a join today.
-- ---------------------------------------------------------------------------

alter table problem_record add column if not exists request_id text;
update problem_record pr
  set request_id = s.request_id
  from intake_session s
  where pr.intake_session_id = s.intake_session_id
    and pr.request_id is null;
create index if not exists idx_problem_record_request on problem_record (request_id);

alter table job_packet add column if not exists request_id text;
update job_packet jp
  set request_id = pr.request_id
  from problem_record pr
  where jp.problem_id = pr.problem_id
    and jp.request_id is null;
create index if not exists idx_job_packet_request on job_packet (request_id);

-- evidence_object has NO column today linking it to a problem or a request
-- at all (the only association is problem_record.evidence_ids, a text[],
-- which is not a foreign key). Backfill via that array so existing rows are
-- scoped too; every future insert must set this column explicitly (the
-- runtime store's recordJourney/attachEvidence writers set it going forward,
-- src/platform/stores/runtime.ts).
alter table evidence_object add column if not exists request_id text;
update evidence_object eo
  set request_id = pr.request_id
  from problem_record pr
  where eo.evidence_id = any(pr.evidence_ids)
    and eo.request_id is null;
create index if not exists idx_evidence_object_request on evidence_object (request_id);

-- consent_event is a per-homeowner-owned row too (the customer's own GRANT
-- of consent) — reachable via problem_id -> problem_record.request_id.
-- It gets a WRITE policy only (see §4): the table's own hardening (00004)
-- already revokes UPDATE/DELETE from every role including service_role, so
-- there is no read policy question to answer here — this item does not
-- change who can read it, only who is allowed to write the initial row.
alter table consent_event add column if not exists request_id text;
update consent_event ce
  set request_id = pr.request_id
  from problem_record pr
  where ce.problem_id = pr.problem_id
    and ce.request_id is null;
create index if not exists idx_consent_event_request on consent_event (request_id);

-- ---------------------------------------------------------------------------
-- 2. Grants to `authenticated`. SELECT + INSERT on the six customer-facing
--    read/write tables, INSERT-only on consent_event (append-only by
--    design), and UPDATE additionally on problem_record (the one place an
--    existing write path updates a row in place — attachEvidence's
--    evidence_ids merge). Never DELETE anywhere.
-- ---------------------------------------------------------------------------

grant select, insert on intake_session to authenticated;
grant select, insert, update on problem_record to authenticated;
grant select, insert on job_packet to authenticated;
grant select, insert on evidence_object to authenticated;
grant select, insert on intake_answer to authenticated;
grant select, insert on diagnosis_answer to authenticated;
grant insert on consent_event to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Request-scoped SELECT policies. `auth.jwt()` is Supabase's own helper
--    (present in every project's `auth` schema); it decodes the caller's
--    validated JWT. NULL request_id never matches a claim, so unbackfilled
--    or legacy rows stay unreadable through this path (they were never
--    reachable by anon/authenticated before this migration either).
-- ---------------------------------------------------------------------------

create policy "request-scoped read" on intake_session
  for select to authenticated
  using (request_id = (auth.jwt() ->> 'request_id'));

create policy "request-scoped read" on problem_record
  for select to authenticated
  using (request_id = (auth.jwt() ->> 'request_id'));

create policy "request-scoped read" on job_packet
  for select to authenticated
  using (request_id = (auth.jwt() ->> 'request_id'));

create policy "request-scoped read" on evidence_object
  for select to authenticated
  using (request_id = (auth.jwt() ->> 'request_id'));

create policy "request-scoped read" on intake_answer
  for select to authenticated
  using (request_id = (auth.jwt() ->> 'request_id'));

create policy "request-scoped read" on diagnosis_answer
  for select to authenticated
  using (request_id = (auth.jwt() ->> 'request_id'));

-- ---------------------------------------------------------------------------
-- 4. Request-scoped WRITE policies. WITH CHECK governs the ROW BEING
--    WRITTEN (post-insert / post-update state) — a request-scoped client
--    can only ever create or leave behind a row whose request_id equals
--    its own claim, regardless of what request_id value the application
--    code tries to put in the payload. This is a distinct guarantee from
--    the read policies above: it stops write FORGERY (creating a row under
--    someone else's request_id), not just read leakage.
-- ---------------------------------------------------------------------------

create policy "request-scoped insert" on intake_session
  for insert to authenticated
  with check (request_id = (auth.jwt() ->> 'request_id'));

create policy "request-scoped insert" on problem_record
  for insert to authenticated
  with check (request_id = (auth.jwt() ->> 'request_id'));

-- USING gates which existing row attachEvidence's evidence_ids merge may
-- target; WITH CHECK gates what the row looks like afterward — together
-- they mean a caller can update only their own problem_record, and cannot
-- use the update to move it under a different request_id.
create policy "request-scoped update" on problem_record
  for update to authenticated
  using (request_id = (auth.jwt() ->> 'request_id'))
  with check (request_id = (auth.jwt() ->> 'request_id'));

create policy "request-scoped insert" on job_packet
  for insert to authenticated
  with check (request_id = (auth.jwt() ->> 'request_id'));

create policy "request-scoped insert" on evidence_object
  for insert to authenticated
  with check (request_id = (auth.jwt() ->> 'request_id'));

create policy "request-scoped insert" on intake_answer
  for insert to authenticated
  with check (request_id = (auth.jwt() ->> 'request_id'));

create policy "request-scoped insert" on diagnosis_answer
  for insert to authenticated
  with check (request_id = (auth.jwt() ->> 'request_id'));

create policy "request-scoped insert" on consent_event
  for insert to authenticated
  with check (request_id = (auth.jwt() ->> 'request_id'));

notify pgrst, 'reload schema';
