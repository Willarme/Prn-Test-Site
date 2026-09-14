-- T8-44 / Stage 13. WRITTEN, NOT APPLIED. Recorded launch seed is below.
-- Runtime policy lives in the reviewed feature registry. Mutations and audit
-- entries commit together; absence is version 0, never an implicit LIVE grant.
create table public.feature_state (
  tenant_id text not null check (tenant_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  feature_id text not null check (feature_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  state text not null check (state in ('LIVE','PREVIEW','HIDDEN')),
  version integer not null check (version > 0),
  actor text not null check (length(trim(actor)) > 0 and length(actor) <= 500),
  reason text not null check (length(trim(reason)) > 0 and length(reason) <= 500),
  decision_ref text not null check (length(trim(decision_ref)) > 0 and length(decision_ref) <= 500),
  updated_at timestamptz not null,
  primary key (tenant_id, feature_id)
);
create table public.feature_interest (
  tenant_id text not null check (tenant_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  feature_id text not null check (feature_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  feature_version integer not null check (feature_version >= 0),
  page text not null check (page ~ '^/[a-zA-Z0-9/_-]{0,255}$'),
  answer text not null check (answer in ('yes','no','maybe')),
  visitor_hash text not null check (visitor_hash ~ '^[a-f0-9]{64}$'),
  dedupe_key text not null check (dedupe_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  primary key (tenant_id, dedupe_key),
  unique (tenant_id, feature_id, feature_version, visitor_hash)
);
create index feature_interest_feature on public.feature_interest(tenant_id,feature_id,answer);
create index feature_interest_burst on public.feature_interest(tenant_id,visitor_hash,created_at);
alter table public.feature_state enable row level security;
alter table public.feature_interest enable row level security;
-- Undo inherited default grants (00003); customer roles get no table/RPC access.
revoke all on public.feature_state, public.feature_interest from public,anon,authenticated,service_role;
grant select on public.feature_state to service_role;

create function public.set_feature_states(p_tenant_id text,p_changes jsonb,p_actor text,p_reason text,p_decision_ref text,p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_change jsonb; v_previous public.feature_state; v_row public.feature_state; v_result jsonb := '[]'::jsonb;
begin
  if p_tenant_id is null or p_tenant_id !~ '^[a-zA-Z0-9_-]{1,128}$' or
      jsonb_typeof(p_changes) is distinct from 'array' then raise exception 'invalid feature state input'; end if;
  if jsonb_array_length(p_changes) not between 1 and 100 or
      (select count(distinct value->>'feature_id') from jsonb_array_elements(p_changes)) <> jsonb_array_length(p_changes)
      then raise exception 'invalid feature state changes'; end if;
  -- Serializes even the first insert, where no row exists to lock. One lock per
  -- tenant also makes overlapping bulk edits deadlock-free and all-or-nothing.
  perform pg_advisory_xact_lock(27, hashtext(p_tenant_id));
  for v_change in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(v_change) is distinct from 'object' or
        jsonb_typeof(v_change->'expected_version') is distinct from 'number' or
        (v_change->>'expected_version') !~ '^[0-9]+$' or
        (v_change->>'expected_version')::bigint not between 0 and 2147483646 then raise exception 'invalid expected version'; end if;
    select * into v_previous from public.feature_state
      where tenant_id=p_tenant_id and feature_id=v_change->>'feature_id' for update;
    if coalesce(v_previous.version,0) <> (v_change->>'expected_version')::integer then
      raise exception using errcode='P0002', message='feature state version conflict';
    end if;
    insert into public.feature_state(tenant_id,feature_id,state,version,actor,reason,decision_ref,updated_at)
      values(p_tenant_id,v_change->>'feature_id',v_change->>'state',coalesce(v_previous.version,0)+1,p_actor,p_reason,p_decision_ref,p_at)
      on conflict(tenant_id,feature_id) do update set state=excluded.state,version=excluded.version,
        actor=excluded.actor,reason=excluded.reason,decision_ref=excluded.decision_ref,updated_at=excluded.updated_at
      returning * into v_row;
    insert into public.admin_audit(at,action,target,detail) values(p_at,'feature_state_changed',v_row.feature_id,
      (to_jsonb(v_row) || jsonb_build_object('previous_state',v_previous.state,'previous_version',coalesce(v_previous.version,0)))::text);
    v_result := v_result || jsonb_build_array(to_jsonb(v_row));
  end loop;
  return v_result;
end $$;

create function public.record_feature_interest(p_input jsonb)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_count integer;
begin
  if jsonb_typeof(p_input) is distinct from 'object' or
      jsonb_typeof(p_input->'feature_version') is distinct from 'number' or
      (p_input->>'feature_version') !~ '^[0-9]+$' then raise exception 'invalid feature interest'; end if;
  -- Same lock as state mutations: a PREVIEW cannot disappear between validation
  -- and insertion. It also serializes per-visitor burst accounting across workers.
  perform pg_advisory_xact_lock(27, hashtext(p_input->>'tenant_id'));
  if exists(select 1 from public.feature_interest where tenant_id=p_input->>'tenant_id' and
      (dedupe_key=p_input->>'dedupe_key' or (feature_id=p_input->>'feature_id' and
        feature_version=(p_input->>'feature_version')::integer and visitor_hash=p_input->>'visitor_hash'))) then return false; end if;
  if not exists(select 1 from public.feature_state where tenant_id=p_input->>'tenant_id' and
      feature_id=p_input->>'feature_id' and state='PREVIEW' and version=(p_input->>'feature_version')::integer) then
    raise exception using errcode='P0004',message='feature preview unavailable';
  end if;
  if (select count(*) from public.feature_interest where tenant_id=p_input->>'tenant_id' and
      visitor_hash=p_input->>'visitor_hash' and created_at >= (p_input->>'created_at')::timestamptz - interval '60 seconds') >= 20 then
    raise exception using errcode='P0003',message='feature interest rate limit';
  end if;
  insert into public.feature_interest(tenant_id,feature_id,feature_version,page,answer,visitor_hash,dedupe_key,created_at)
    values(p_input->>'tenant_id',p_input->>'feature_id',(p_input->>'feature_version')::integer,p_input->>'page',p_input->>'answer',
      p_input->>'visitor_hash',p_input->>'dedupe_key',(p_input->>'created_at')::timestamptz)
    on conflict do nothing;
  get diagnostics v_count = row_count;
  if v_count=0 then return false; end if;
  insert into public.admin_audit(at,action,target,detail)
    values((p_input->>'created_at')::timestamptz,'feature_interest_recorded',p_input->>'feature_id',
      jsonb_build_object('tenant_id',p_input->>'tenant_id','feature_id',p_input->>'feature_id',
        'feature_version',(p_input->>'feature_version')::integer,'answer',p_input->>'answer')::text);
  return true;
end $$;

create function public.feature_interest_counts(p_tenant_id text)
returns table(feature_id text,yes bigint,no bigint,maybe bigint,total bigint)
language sql stable security definer set search_path = pg_catalog, public as $$
  select i.feature_id, count(*) filter(where i.answer='yes'), count(*) filter(where i.answer='no'),
    count(*) filter(where i.answer='maybe'), count(*) from public.feature_interest i
    where i.tenant_id=p_tenant_id group by i.feature_id order by i.feature_id
$$;
revoke all on function public.set_feature_states(text,jsonb,text,text,text,timestamptz),
  public.record_feature_interest(jsonb), public.feature_interest_counts(text) from public,anon,authenticated,service_role;
grant execute on function public.set_feature_states(text,jsonb,text,text,text,timestamptz),
  public.record_feature_interest(jsonb), public.feature_interest_counts(text) to service_role;

-- BEGIN RECORDED LAUNCH SEED. Idempotent; existing runtime decisions always win.
-- TO BUILD and YOURS remain absent. These are system-applied recorded launch
-- states, not a fabricated owner interaction. Registry parity is tested.
with inserted as (
  insert into public.feature_state(tenant_id,feature_id,state,version,actor,reason,decision_ref,updated_at)
  select 'prn',feature_id,state,1,'system:c6ff9a','applying recorded D5 launch scope',
    '13e938/D5;30e5f8;plan-v2.2/20.14',current_timestamp
  from (values
    ('door_pages','LIVE'),('intake','LIVE'),('walkthrough','LIVE'),('job_packet','LIVE'),('explainers','LIVE'),
    ('product_dashboard','PREVIEW'),('product_trust_network','PREVIEW'),('product_smartquote','PREVIEW'),('product_home_memory','PREVIEW'),
    ('keep','HIDDEN'),('ask','HIDDEN'),('send','HIDDEN'),('find','HIDDEN'),('shared_links','HIDDEN'),
    ('customer_profile','HIDDEN'),('account_details','HIDDEN'),('home_memory','HIDDEN'),('trust_network','HIDDEN'),
    ('smartquote','HIDDEN'),('dashboard','HIDDEN'),('statistics_library','HIDDEN'),('statistics_categories','HIDDEN'),
    ('statistics_all','HIDDEN'),('pdf_keep_qr','HIDDEN'),('pdf_ask_qr','HIDDEN'),('demo','HIDDEN'),
    ('feature_lab','HIDDEN'),('staged_listing','HIDDEN'),('provider_os','HIDDEN')
  ) as launch(feature_id,state)
  on conflict(tenant_id,feature_id) do nothing returning *
)
insert into public.admin_audit(at,action,target,detail)
  select updated_at,'feature_state_changed',feature_id,
    (to_jsonb(inserted) || jsonb_build_object('previous_state',null,'previous_version',0))::text from inserted;
-- END RECORDED LAUNCH SEED.
notify pgrst, 'reload schema';
