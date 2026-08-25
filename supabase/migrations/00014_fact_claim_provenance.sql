-- A01 PROVENANCE — the two durable objects the whole "PRN never invents a
-- fact" claim rests on, given somewhere to live.
--
-- WRITTEN BUT NOT APPLIED with this build, exactly as migrations 00006-00013
-- were: applying migrations is a separate, human-coordinated step. Until it is
-- applied, the durable store is the file-backed dev database
-- (src/platform/stores/dev-db.ts, arrays `fact_claims` / `derivation_records`),
-- which is the same backend the whole customer journey runs on today.
--
-- WHY IT EXISTS NOW AND NOT WITH A01's BUILD. A01 shipped `FactClaim` and
-- `DerivationRecord` as contracts and deliberately minted no table for them,
-- recording the reason in tests/a01.seams-and-constraints.test.ts: the table
-- needs an owner-scoped policy decision, not just a CREATE TABLE. What changed
-- is that A01's production surface is now the LIVE intake path (finding 1), so
-- a real homeowner journey produces claims and a derivation — and an object
-- that is produced on the customer path and stored nowhere is a fact PRN
-- established and then lost.
--
-- THE POLICY QUESTION IS STILL OPEN, AND THIS MIGRATION DOES NOT ANSWER IT.
-- The RLS posture below is deny-all + service-role, copied from 00002/00003 —
-- i.e. "nobody but us", which is the SAFE default and not the considered one.
-- TODO-ASK-OWNER (Joshua): who may read a homeowner's claims, under whose
-- credential, and whether the homeowner can read their own. That is the
-- decision this table is waiting on; deny-all holds until it is made, and
-- nothing is lost by making it after the rows exist because widening a policy
-- is reversible in a way that a missing row is not.
--
-- NO NEW EVIDENCE COPY. Both tables carry evidence IDS and never evidence
-- content: the homeowner's words live once, in evidence_object, and a second
-- copy is how a private corpus quietly becomes two private corpora.

create table if not exists fact_claim (
  claim_id text primary key,
  tenant_id text not null default 'prn',
  schema_version text not null,
  problem_id text not null,
  subject text not null,
  predicate text not null,
  object text not null,
  claim_class text not null check (claim_class in ('OBSERVED','SUPPLIED','CALCULATED','INFERRED')),
  provenance text not null,
  evidence_ids text[] not null,
  confidence text check (confidence in ('high','medium','low')),
  privacy_class text not null check (privacy_class in ('USER_PRIVATE','DERIVED_LOCAL','PUBLIC_SAFE')),
  public_eligibility text not null check (public_eligibility in ('NO','AGGREGATE_ONLY','YES_IF_POLICY')),
  created_by_run_id text,
  derivation_id text,
  created_at timestamptz not null,
  -- Canon fields A01 does not populate in the trial. They exist so the day a
  -- mechanism exists it has a column rather than a migration.
  verification_status text,
  valid_from timestamptz,
  valid_to timestamptz,
  freshness_status text,
  dispute_status text
);
create index if not exists idx_fact_claim_problem on fact_claim (problem_id);
create index if not exists idx_fact_claim_tenant on fact_claim (tenant_id);

create table if not exists derivation_record (
  derivation_id text primary key,
  tenant_id text not null default 'prn',
  schema_version text not null,
  problem_id text not null,
  claim_ids text[] not null,
  method text not null check (method in ('deterministic','model')),
  capability_key text not null,
  model_id text,
  prompt_id text,
  prompt_version text,
  schema_contract_version text,
  policy_version text,
  input_evidence_ids text[] not null,
  agent_run_id text,
  created_at timestamptz not null
);
create index if not exists idx_derivation_record_problem on derivation_record (problem_id);
create index if not exists idx_derivation_record_tenant on derivation_record (tenant_id);

-- ---------------------------------------------------------------------------
-- RLS — deny-all, service role only, and APPEND-ONLY.
-- ---------------------------------------------------------------------------
-- A claim is a record of what was established at a moment, under a named
-- method and a named policy version. Updating one would rewrite what PRN
-- believed at the time, which is the one thing a provenance record must not
-- allow; a claim that turns out to be wrong is superseded by a new claim, not
-- edited. Delete is withheld for the same reason.
alter table fact_claim enable row level security;
alter table derivation_record enable row level security;

revoke update, delete on fact_claim from service_role;
revoke update, delete on derivation_record from service_role;
grant select, insert on fact_claim to service_role;
grant select, insert on derivation_record to service_role;

notify pgrst, 'reload schema';
