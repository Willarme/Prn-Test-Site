-- T8-32: preserve the loop ledgers' intended operation boundaries.
-- Apply after 00020 and inspect the existing migration ledger first. When
-- installing 00020 for the first time, apply both files and their ledger entries
-- in one controlled transaction. No rows are deleted or rewritten here.
--
-- 00003 grants ALL by default to service_role. 00020's narrower GRANT statements
-- do not remove that inherited UPDATE/TRUNCATE privilege. Establish an explicit
-- operation allow-list for these eight tables, preserving current runtime calls.

revoke all privileges on table
  public.link_revocations, public.keep_claims, public.magic_links,
  public.ask_answers, public.feedback, public.email_outbox,
  public.job_addresses, public.signups
from anon, authenticated, service_role;

grant select, insert on table
  public.link_revocations, public.keep_claims, public.magic_links,
  public.ask_answers, public.feedback, public.email_outbox,
  public.job_addresses, public.signups
to service_role;

-- These are the only in-place update operations implemented by RuntimeStore.
grant update (consumed_at) on public.magic_links to service_role;
grant update (sent_at, provider_id) on public.email_outbox to service_role;
-- saveSignup intentionally upserts the complete supplied signup on vote_id.
grant update on public.signups to service_role;

grant select, insert on table
  public.link_revocations, public.keep_claims, public.magic_links,
  public.ask_answers, public.feedback, public.job_addresses
to authenticated;

-- Restrict these identity sequences without changing any other table's access.
revoke all privileges on sequence public.keep_claims_id_seq, public.job_addresses_id_seq
from anon, authenticated, service_role;
grant usage, select on sequence public.keep_claims_id_seq, public.job_addresses_id_seq
to authenticated, service_role;

notify pgrst, 'reload schema';
