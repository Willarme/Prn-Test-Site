-- A04 Search Opportunity — the OWNER'S DECISION on an opportunity.
--
-- WRITTEN BUT NOT APPLIED with the A04 Wave-2 build, exactly as migrations
-- 00006-00010 were: applying migrations is a separate, human-coordinated step.
-- Until applied, the durable store is the file-backed dev database
-- (src/platform/stores/dev-db.ts) selected by
-- src/platform/search/decision-store.ts.
--
-- WHY THIS MIGRATION EXISTS AT ALL. Loop Spec Audit condition C14 says the
-- OpportunityStore stays as-is and no Supabase migration should be invented for
-- opportunities. This is not that. `search_opportunity` already exists
-- (migration 00001) and is EXTENDED here, never duplicated — the four columns
-- below are the owner-decision fields the coherence report requires
-- (`status` already existed; `approved_at`/`approved_by` did not), plus the
-- reserved tenant_id every A00 record carries and the score_version disclosure
-- field. All are nullable and additive: every existing row stays valid.
--
-- THE ONE NEW TABLE, AND WHY IT IS NOT A PARALLEL OPPORTUNITIES TABLE.
-- `opportunity_decision` is an append-only ledger of DECISIONS referencing
-- search_opportunity_id. It exists because the live 96 records are a COMMITTED
-- ARTIFACT (data/factory/opportunities.json), reproducible output that
-- `npm run factory` regenerates wholesale — and regenerating it also
-- regenerates A05's staged portfolio and A06's QA results in the same pass
-- (condition 13). An owner's click must not be inside a file that the next
-- pipeline run overwrites. So decisions are an OVERLAY joined at read time,
-- and the artifact stays byte-identical.
--
-- APPEND-ONLY. Changing your mind writes a NEW decision; the effective status
-- is the fold over the history (src/domain/search/decision.ts). update and
-- delete are revoked, so "the owner's decision history cannot be quietly
-- rewritten" is enforced by the database rather than by convention — the same
-- discipline as the consent ledger (00004), the event dictionary (00009) and
-- A09's findings (00010).
--
-- NO CUSTOMER DATA CAN BE STORED HERE, BY SHAPE. The only free-text column is
-- `note`, which is the OWNER's own annotation and is length-capped. There is no
-- column a homeowner's words, a photo reference or consent text could occupy.

-- ---------------------------------------------------------------------------
-- 1. Extend the EXISTING search_opportunity table (never a parallel one).
-- ---------------------------------------------------------------------------

-- Reserved (white-label approval condition a, 2026-08-24) — no tenant logic.
alter table search_opportunity add column if not exists tenant_id text not null default 'prn';

-- Owner-decision provenance (coherence report seam 2). Set together on accept,
-- cleared on reject/defer: a record must never carry an approval stamp while
-- sitting in a non-approved status.
alter table search_opportunity add column if not exists approved_at timestamptz;
alter table search_opportunity add column if not exists approved_by text;

-- Which scoring version produced opportunity_score (condition 12). NULL means
-- v1 — the 96 committed records were scored under SCORING_VERSION 1.0.0 before
-- this field existed, and a rescore must DISCLOSE its version rather than
-- silently rewrite history.
alter table search_opportunity add column if not exists score_version text;

create index if not exists idx_search_opportunity_tenant on search_opportunity (tenant_id);

-- ---------------------------------------------------------------------------
-- 2. The append-only owner-decision ledger.
-- ---------------------------------------------------------------------------

create table if not exists opportunity_decision (
  decision_id text primary key,
  -- Reserved (white-label approval condition a) — no tenant logic.
  tenant_id text not null default 'prn',
  search_opportunity_id text not null,
  -- The owner's verb. Deferral is a real decision with a real record: "not yet
  -- looked at" and "looked at, not now" are different states in a queue.
  decision text not null check (decision in ('accept','reject','defer')),
  -- The status the verb puts the opportunity into. Derived, stored for audit.
  status_after text not null check (
    status_after in ('candidate','approved','watch','merged','rejected','retired')
  ),
  decided_by text not null,
  decided_at timestamptz not null,
  -- The OWNER's own annotation. Never customer-derived; length-capped.
  note text check (note is null or char_length(note) <= 500),
  -- What A04 thought at the moment of the decision. The DISAGREEMENT between
  -- the agent's recommendation and the owner's decision is the signal worth
  -- keeping — it is how anyone later learns whether the scoring is any good.
  recommendation_at_decision text check (
    recommendation_at_decision is null
    or recommendation_at_decision in ('NEW','EXPAND','MERGE','WATCH','REJECT')
  ),
  score_at_decision numeric check (
    score_at_decision is null or (score_at_decision >= 0 and score_at_decision <= 100)
  ),
  score_version_at_decision text,
  -- Provenance: the Approval Center item and the Agent Run Ledger row.
  approval_id text,
  run_id text
);

create index if not exists idx_opportunity_decision_opportunity
  on opportunity_decision (search_opportunity_id, decided_at desc);
create index if not exists idx_opportunity_decision_tenant
  on opportunity_decision (tenant_id);

-- ---------------------------------------------------------------------------
-- 3. RLS + append-only enforcement.
-- ---------------------------------------------------------------------------
-- RLS on with NO policies: anon/authenticated get nothing. Elevated
-- credentials remain for narrowly scoped internal operations only; A04's
-- data-access modules ACCEPT a PlatformClientProvider rather than importing the
-- service client (A00 approval condition d / Loop Spec Audit condition 7).
alter table opportunity_decision enable row level security;

-- The owner's decision history is never rewritten or erased.
revoke update, delete on opportunity_decision from service_role;
grant select, insert on opportunity_decision to service_role;
