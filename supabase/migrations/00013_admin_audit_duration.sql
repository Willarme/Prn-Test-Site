-- OWNER HOURS — the one column A10 cannot be built without.
--
-- WRITTEN BUT NOT APPLIED with A02's build (2026-08-25), exactly as every
-- migration since 00006 has been: applying migrations is a separate,
-- human-coordinated step. Verify with `npm run db:migrate -- --status`.
--
-- WHY THIS EXISTS, AND WHY NOW RATHER THAN WITH A10. The Trial Spec Audit's
-- owner-layer finding (§4) is that A10's Owner Hours — "the number the whole
-- one-person-company constraint answers to" — is PERMANENTLY uncomputable,
-- because `admin_audit` has carried {at, action, target, detail} since
-- migration 00002 and nothing anywhere records a duration. Audit rows are
-- append-only history: a duration not written at the moment the owner did the
-- work cannot be reconstructed afterwards. So the column has to exist BEFORE
-- the trial runs, not when the agent that reads it is built. That is the same
-- reasoning that puts the packet.viewed / packet.downloaded / packet.share_opened
-- emitters in this wave rather than in A07's.
--
-- NULLABLE ON PURPOSE. NULL means "not measured" and is the correct value for
-- every row already in the table and for any caller with nothing honest to
-- record. 0 would mean "took no time", which is never true of owner work — and
-- an averaged Owner Hours polluted with fake zeroes is worse than no number.
--
-- Milliseconds, matching agent_run_ledger.latency_ms and the event envelope's
-- result.duration_ms, so the owner-time and machine-time series are joinable
-- without a unit conversion nobody remembers to do.

alter table admin_audit
  add column if not exists duration_ms integer;

comment on column admin_audit.duration_ms is
  'How long the owner action took, in milliseconds. NULL = not measured (never 0). Feeds A10 Owner Hours.';
