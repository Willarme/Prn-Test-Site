-- A05 Intent-Door Page Factory — THE PAGE REGISTRY.
--
-- WRITTEN BUT NOT APPLIED with the A05 Wave-2 build, exactly as migrations
-- 00006-00011 were: applying migrations is a separate, human-coordinated step.
-- Until applied, the durable store is the file-backed dev database
-- (src/platform/stores/dev-db.ts) selected by
-- src/platform/search/page-registry-store.ts.
--
-- WHY THIS MIGRATION EXISTS AT ALL — the test every A05 table had to pass was
-- "is a real table needed, or is this a table invented for its own sake".
-- `staged_page_spec` has existed since migration 00002 and is NOT duplicated
-- here; it already stores the PageSpec document. What has never had a table
-- anywhere in this repo is the REGISTRY ROW — page_id, canonical_path,
-- current_page_spec_id, lifecycle_status, published_at, retired_at,
-- redirect_to_path. The zod object (`IntentPage`, domain/search/pages.ts) has
-- shipped since the door slice with no storage behind it, which is why earlier
-- waves could only express "this page is at STAGED" as a field on a spec and
-- why nothing could answer "which spec is this page currently serving".
--
-- TWO WRITES, NOT THREE. A05 §5 names PageSpec, PageVersion and Page Registry.
-- There is no PageVersion object in this repo and Loop Spec Audit C17 rules the
-- shipped two are correct: versioning is `PageSpec.version` plus
-- `IntentPage.current_page_spec_id`. Regeneration inserts a new spec row and
-- repoints the pointer; it never overwrites a spec.
--
-- ONE ROW PER PAGE, UPDATED IN PLACE — and deliberately NOT append-only, unlike
-- the consent ledger (00004), the event dictionary (00009), A09's findings
-- (00010) and A04's decisions (00011). A registry row is CURRENT STATE, not a
-- record of what happened. The append-only record of why it moved already
-- exists in two places that are append-only at the database level: the event
-- envelope (page.draft_created / page.staged / page.refreshed) and the agent
-- run ledger. Making current state append-only too would mean every reader
-- resolving a fold before it could render a page.
--
-- NO CUSTOMER DATA CAN BE STORED HERE, BY SHAPE. Every column is an identifier,
-- a path, an enum value or a timestamp. There is no free-text column at all —
-- not even an owner note — so a homeowner's words, a photo reference or consent
-- text has nowhere to sit.

create table if not exists intent_page (
  page_id text primary key,
  -- Reserved (white-label approval condition a / Loop Spec Audit C1) — no
  -- tenant logic, routing or UI exists around it. A05 is the agent where
  -- per-client templates matter most, so the field is here from day one.
  tenant_id text not null default 'prn',
  -- The FINAL PUBLIC path, e.g. /problems/ac-blowing-warm-air (C6). Both routes
  -- key off it: findStagedByPath serves the staged view from it and
  -- findPublishedByPath the live one. It is NEVER a /staged/ value.
  canonical_path text not null,
  -- Which PageSpec version this page currently serves. Nullable: a registry row
  -- can outlive its spec (a retired page), and a redirect-only row has none.
  current_page_spec_id text,
  -- The frozen 7-state machine in domain/search/lifecycle.ts (C17). A05 owns
  -- APPROVED -> STAGED and REFRESH -> STAGED; A06 owns STAGED -> QA_PASS and
  -- the rebuild; the OWNER alone owns QA_PASS -> PUBLISHED.
  lifecycle_status text not null check (
    lifecycle_status in ('IDEA','APPROVED','STAGED','QA_PASS','PUBLISHED','REFRESH','RETIRED')
  ),
  -- Publish state is the OWNER's, written only by the owner-gated publish
  -- route. A05 never writes these two, and its registry entry omits
  -- published_page from write_access to say so structurally.
  published_at timestamptz,
  retired_at timestamptz,
  redirect_to_path text,
  created_at timestamptz not null,
  -- A published page must record when, and a retired page must record when.
  -- Cheap, and it makes "published but no publish date" unrepresentable.
  constraint intent_page_published_has_date check (
    lifecycle_status <> 'PUBLISHED' or published_at is not null
  ),
  constraint intent_page_retired_has_date check (
    lifecycle_status <> 'RETIRED' or retired_at is not null
  )
);

-- One live page per public path. This is the cannibalization rule as a database
-- constraint rather than only as an agent check: two doors on one URL is the
-- doorway failure the whole quality gate exists to prevent, and a partial index
-- lets a RETIRED page's path be reclaimed.
create unique index if not exists idx_intent_page_live_path
  on intent_page (tenant_id, canonical_path)
  where lifecycle_status <> 'RETIRED';

create index if not exists idx_intent_page_tenant on intent_page (tenant_id);
create index if not exists idx_intent_page_status on intent_page (lifecycle_status);

-- ---------------------------------------------------------------------------
-- Tenancy on the existing staged spec table (C1), additive.
-- ---------------------------------------------------------------------------
-- `staged_page_spec` is EXTENDED, never duplicated: it has held the PageSpec
-- document since migration 00002 and every existing row stays valid.
alter table staged_page_spec add column if not exists tenant_id text not null default 'prn';
create index if not exists idx_staged_page_spec_tenant on staged_page_spec (tenant_id);

-- ---------------------------------------------------------------------------
-- RLS.
-- ---------------------------------------------------------------------------
-- RLS on with NO policies: anon/authenticated get nothing. A05's data-access
-- module ACCEPTS a PlatformClientProvider rather than importing the service
-- client (A00 approval condition d / Loop Spec Audit C10); these tables hold
-- public page content rather than homeowner data, so no request-scoped client
-- is needed today — the seam is the requirement, not the feature.
alter table intent_page enable row level security;

-- Update is granted here, unlike the append-only tables: a registry row is
-- current state and the lifecycle moves it. Delete is NOT — a page that should
-- no longer serve is RETIRED, which keeps its path reserved and its history
-- legible, and erasing the row would silently free a public URL for reuse.
revoke delete on intent_page from service_role;
grant select, insert, update on intent_page to service_role;
