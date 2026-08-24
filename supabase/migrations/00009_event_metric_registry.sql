-- A08 Metric & Event Steward — the event/metric dictionary registry.
--
-- Table names and module layout are a build-time decision the spec delegates
-- (Loop Spec Audit pre-answer 6): event and metric definitions live together
-- in src/platform/events/ per 14A §21's single "event/metric dictionary" line,
-- and the tables are named for the row shapes they hold.
--
-- APPEND-ONLY BY CONSTRUCTION. A definition is never overwritten in place: a
-- change is a NEW row at the next definition_version, so "no silent KPI
-- redefinition" and "historical versions remain queryable" (both canon,
-- verbatim) are enforced by the schema, not by convention. update and delete
-- are revoked, exactly as the consent ledger and the event stream are
-- (migration 00004).
--
-- WRITTEN BUT NOT APPLIED with the A08 Wave-0 build: applying migrations is a
-- separate, human-coordinated step. Until applied, the dictionary is the
-- in-process registry in src/platform/events/dictionary.ts and every write is
-- FAIL-SOFT per the shipped db/client.ts contract — a missing table must never
-- break or alter the customer flow.

create table if not exists event_definition (
  event_name text not null,
  definition_version integer not null check (definition_version >= 1),
  -- Reserved (white-label approval condition a, 2026-08-24) — no tenant logic.
  tenant_id text not null default 'prn',
  description text not null,
  -- e.g. 'A08', or a domain like 'packet' where no agent owns it yet.
  owning_agent_or_domain text not null,
  -- Envelope top-level keys and/or 'context.<key>' paths.
  required_envelope_fields jsonb not null default '[]'::jsonb,
  -- NULL until an approved schema change introduces a payload (condition 3).
  payload_schema_ref text,
  -- The shipped three-value vocabulary ONLY (condition 13). No fourth enum.
  privacy_class text not null check (privacy_class in ('private','internal','public_safe')),
  -- Presence enforced, content owner-decided: 'TBD' is the only shipped value.
  retention_class text not null,
  status text not null check (status in ('proposed','approved','deprecated')),
  -- Forward alias. A deprecated row MUST set it; nothing is ever deleted.
  deprecated_by text,
  first_seen_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  primary key (event_name, definition_version)
);

create index if not exists idx_event_definition_status
  on event_definition (status, event_name);

create table if not exists metric_definition (
  metric_key text not null,
  definition_version integer not null check (definition_version >= 1),
  -- Reserved (white-label approval condition a, 2026-08-24) — no tenant logic.
  tenant_id text not null default 'prn',
  display_name text not null,
  -- Human-readable. No formula DSL exists; canon specifies no syntax.
  -- The eleven 14A §18.3 owner gauges seed with 'TBD — owner definition
  -- required' and status 'proposed' (condition 9) — never an invented formula.
  formula_description text not null,
  metric_type text not null check (metric_type in ('count','rate','ratio','duration','amount','TBD')),
  source_events jsonb not null default '[]'::jsonb,
  -- REQUIRED for rate/ratio — enforced in the application schema, which is the
  -- one place that can say "rate implies denominator". Blocks silent
  -- denominator drift.
  denominator_event text,
  window text not null,
  segments jsonb,
  -- Any trial target is a TEST figure (hard canon rule 4). No dollar figures.
  target numeric,
  target_is_test_figure boolean,
  status text not null check (status in ('proposed','approved','deprecated')),
  superseded_by text,
  owning_kpi_tree text,
  primary key (metric_key, definition_version)
);

create index if not exists idx_metric_definition_status
  on metric_definition (status, metric_key);

alter table event_definition enable row level security;
alter table metric_definition enable row level security;

-- The registry is NEVER public (A08 §7) and it is append-only: a new version is
-- a new row, so nothing legitimately updates or deletes one.
revoke update, delete on event_definition from service_role;
revoke update, delete on metric_definition from service_role;

-- ---------------------------------------------------------------------------
-- APPROVAL KIND — the item taxonomy (coherence report issue 14).
--
-- Four producers are heading for one Approval Center with no way to tell an
-- opportunity decision from a page publish from a data repair, and the owner
-- would face them in one undifferentiated list. A08 registers the vocabulary
-- BEFORE the first producer ships.
--
-- CARRIER CHOICE, and why this one. The alternatives were (a) an optional
-- typed field on ApprovalItem, or (b) a metadata convention inside the
-- existing free-form `evidence` column. (a) wins and is what ships: it is
-- ADDITIVE by pre-answer 3's own rule set (adding an OPTIONAL field), so no
-- existing row, reader, or test breaks — every item without a kind still
-- parses — while (b) would have overloaded a column documented "IDs and
-- summaries only, never raw customer evidence" with control metadata, and
-- would not be queryable or type-checked. The column is added here rather than
-- by editing 00007 because 00007 is already committed.
-- ---------------------------------------------------------------------------
alter table approval_item add column if not exists approval_kind text;

create index if not exists idx_approval_item_kind
  on approval_item (approval_kind, status);

notify pgrst, 'reload schema';
