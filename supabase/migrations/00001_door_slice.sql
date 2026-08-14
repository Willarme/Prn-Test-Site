-- Door slice schema (Door Wave 1) — search domain + agent runtime + economics.
-- Authored in Wave 1; APPLIED once the owner selects the Supabase project.
-- RLS: enabled on every table with NO policies -> anon/authenticated roles
-- get nothing; only the server-side service role reads/writes. Customer-facing
-- RLS policies arrive with their waves.

create table if not exists seo_data_provider (
  seo_data_provider_id text primary key,
  provider_key text not null unique,
  display_name text not null,
  status text not null check (status in ('active', 'disabled')),
  credential_env_keys text[] not null default '{}', -- env var NAMES only, never values
  cost_rate_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists search_opportunity (
  search_opportunity_id text primary key,
  schema_version text not null,
  keyword text not null unique,
  intent_cluster_id text,
  cluster_label text,
  problem_family_hint text,
  source text not null check (source in ('dataforseo','search_console','internal_records','seed_import','manual')),
  geography jsonb not null,
  geography_assumed boolean not null default false,
  volume_monthly integer check (volume_monthly >= 0),
  keyword_difficulty numeric check (keyword_difficulty >= 0 and keyword_difficulty <= 100),
  cpc_usd numeric check (cpc_usd >= 0),
  intent_type text not null check (intent_type in ('problem','tool','informational','commercial','unknown')),
  opportunity_score numeric check (opportunity_score >= 0 and opportunity_score <= 100),
  score_components jsonb,
  recommendation text check (recommendation in ('NEW','EXPAND','MERGE','WATCH','REJECT')),
  status text not null check (status in ('candidate','approved','watch','merged','rejected','retired')),
  metric_snapshot_ids text[] not null default '{}',
  serp_snapshot_ids text[] not null default '{}',
  provenance jsonb not null,
  vendor_cost_usd numeric check (vendor_cost_usd >= 0),
  researched_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz
);

create index if not exists idx_search_opportunity_status on search_opportunity (status);
create index if not exists idx_search_opportunity_recommendation on search_opportunity (recommendation);

create table if not exists intent_cluster (
  intent_cluster_id text primary key,
  schema_version text not null,
  label text not null,
  primary_query text not null,
  supporting_queries text[] not null default '{}',
  problem_family text,
  geography jsonb not null,
  distinctness_note text,
  status text not null check (status in ('active','merged','retired')),
  created_at timestamptz not null
);

create table if not exists seo_metric_snapshot (
  metric_snapshot_id text primary key,
  schema_version text not null,
  keyword text not null,
  vendor text not null,
  geography jsonb not null,
  queried_at timestamptz not null,
  volume_monthly integer,
  keyword_difficulty numeric,
  cpc_usd numeric,
  competition numeric,
  trend_12mo numeric[],
  raw_vendor_ref text,
  vendor_cost_usd numeric check (vendor_cost_usd >= 0),
  rate_version text
);

create index if not exists idx_seo_metric_snapshot_keyword on seo_metric_snapshot (keyword);

create table if not exists serp_snapshot (
  serp_snapshot_id text primary key,
  schema_version text not null,
  keyword text not null,
  geography jsonb not null,
  queried_at timestamptz not null,
  results jsonb not null default '[]',
  weakness_note text,
  vendor_cost_usd numeric check (vendor_cost_usd >= 0)
);

create table if not exists page_performance_daily (
  id bigint generated always as identity primary key,
  page_id text not null,
  date date not null,
  source text not null check (source in ('search_console','internal_events')),
  query text,
  impressions integer not null check (impressions >= 0),
  clicks integer not null check (clicks >= 0),
  ctr numeric not null check (ctr >= 0 and ctr <= 1),
  avg_position numeric,
  intake_starts integer,
  packet_completions integer,
  revenue_usd numeric,
  ingested_at timestamptz not null
);

create unique index if not exists uq_page_performance_daily
  on page_performance_daily (page_id, date, source, coalesce(query, ''));

create table if not exists fact_bundle (
  fact_bundle_id text primary key,
  schema_version text not null,
  topic text not null,
  geography jsonb,
  facts jsonb not null default '[]',
  rights_class text not null check (rights_class in ('public','licensed','first_party','unknown_restricted')),
  ttl_days integer not null check (ttl_days > 0),
  expires_at timestamptz,
  permitted_page_classes text[] not null default '{}',
  version integer not null,
  created_at timestamptz not null
);

create table if not exists seo_factory_policy (
  policy_id text not null,
  version integer not null,
  policy jsonb not null, -- full validated SeoFactoryPolicy document
  effective_from timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (policy_id, version)
);

create table if not exists scheduled_job (
  scheduled_job_id text primary key,
  job_key text not null,
  agent_id text,
  cadence text not null check (cadence in ('daily','weekly','monthly','quarterly')),
  next_run_at timestamptz not null,
  policy_version text,
  budget jsonb not null default '{}',
  enabled boolean not null default true,
  last_agent_run_id text,
  created_at timestamptz not null default now()
);

create table if not exists agent_run (
  agent_run_id text primary key,
  agent_id text not null,
  job_key text,
  input_hash text,
  idempotency_key text,
  status text not null check (status in ('queued','running','completed','failed','skipped')),
  attempts integer not null default 1,
  started_at timestamptz not null,
  finished_at timestamptz,
  output_ids text[] not null default '{}',
  cost_usd numeric,
  error text
);

create index if not exists idx_agent_run_idempotency on agent_run (idempotency_key) where status = 'completed';

create table if not exists vendor_cost_rate (
  rate_id text primary key,
  vendor text not null,
  service text not null,
  sku text,
  unit text not null,
  unit_price_usd numeric not null check (unit_price_usd >= 0),
  free_cap numeric,
  tier text,
  currency text not null default 'USD',
  effective_from timestamptz not null,
  effective_to timestamptz,
  source_url text,
  verified_at timestamptz not null,
  version integer not null
);

create table if not exists usage_cost_event (
  usage_cost_event_id text primary key,
  vendor text not null,
  service text not null,
  object_refs jsonb not null default '{}',
  units numeric not null check (units >= 0),
  estimated_cost_usd numeric not null check (estimated_cost_usd >= 0),
  billed_cost_usd numeric,
  rate_version text,
  occurred_at timestamptz not null
);

create index if not exists idx_usage_cost_vendor_month on usage_cost_event (vendor, occurred_at);

create table if not exists revenue_event (
  revenue_event_id text primary key,
  source text not null check (source in ('adsense','sponsor','affiliate','b2b','provider_later','other')),
  refs jsonb not null default '{}',
  gross_usd numeric not null check (gross_usd >= 0),
  platform_fee_usd numeric,
  net_usd numeric not null check (net_usd >= 0),
  occurred_at timestamptz not null,
  evidence_ref text
);

create table if not exists budget_policy (
  budget_policy_id text primary key,
  scope jsonb not null default '{}',
  daily_soft_usd numeric,
  monthly_soft_usd numeric,
  monthly_hard_usd numeric not null check (monthly_hard_usd >= 0),
  override_role text,
  fallback text not null check (fallback in ('stop','degrade','queue')),
  version integer not null
);

-- RLS: deny-all by default (service role only). Do NOT add permissive
-- policies here; customer-scoped access arrives with its own wave + tests.
alter table seo_data_provider enable row level security;
alter table search_opportunity enable row level security;
alter table intent_cluster enable row level security;
alter table seo_metric_snapshot enable row level security;
alter table serp_snapshot enable row level security;
alter table page_performance_daily enable row level security;
alter table fact_bundle enable row level security;
alter table seo_factory_policy enable row level security;
alter table scheduled_job enable row level security;
alter table agent_run enable row level security;
alter table vendor_cost_rate enable row level security;
alter table usage_cost_event enable row level security;
alter table revenue_event enable row level security;
alter table budget_policy enable row level security;
