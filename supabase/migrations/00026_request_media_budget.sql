-- T1-14: atomic shared admission before private storage writes. Existing
-- evidence is grandfathered for reading and counted at first initialization.
alter table public.evidence_object add column duration_seconds double precision
  check (duration_seconds is null or (duration_seconds > 0 and duration_seconds <= 30));

-- Avoid a lost evidence ID when admitted uploads finish at the same time.
-- Initial journey insertion can precede its problem row; its initial IDs are
-- supplied by createJourney. Later inserts extend the existing array atomically.
create function public.link_inserted_request_evidence() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  update public.problem_record p set
    evidence_ids=case when new.evidence_id=any(p.evidence_ids) then p.evidence_ids else array_append(p.evidence_ids,new.evidence_id) end,
    updated_at=greatest(p.updated_at,new.captured_at)
  from public.intake_session s where s.request_id=new.request_id and p.intake_session_id=s.intake_session_id and p.tenant_id=new.tenant_id;
  return new;
end;
$$;
revoke all privileges on function public.link_inserted_request_evidence() from public,anon,authenticated,service_role;
create trigger link_inserted_request_evidence after insert on public.evidence_object for each row execute function public.link_inserted_request_evidence();

create table public.request_media_budget (
  request_id text primary key references public.intake_session(request_id),
  tenant_id text not null,
  problem_id text not null references public.problem_record(problem_id),
  baseline_photos integer not null check (baseline_photos >= 0),
  baseline_videos integer not null check (baseline_videos >= 0),
  reservations jsonb not null default '[]' check (jsonb_typeof(reservations) = 'array' and jsonb_array_length(reservations) <= 5),
  updated_at timestamptz not null default now()
);
alter table public.request_media_budget enable row level security;
revoke all privileges on public.request_media_budget from public, anon, authenticated, service_role;
grant select on public.request_media_budget to authenticated, service_role;
create policy request_media_budget_read_own on public.request_media_budget for select to authenticated using (
  request_id = (select auth.jwt()->>'request_id') and exists (
    select 1 from public.intake_session s join public.problem_record p on p.intake_session_id = s.intake_session_id
    where s.request_id = request_media_budget.request_id and p.problem_id = request_media_budget.problem_id and p.tenant_id = request_media_budget.tenant_id
  )
);

create function public.reserve_request_media(p_request_id text, p_tenant_id text, p_operation jsonb, p_policy jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_problem text; v_row public.request_media_budget%rowtype; v_prior jsonb;
  v_kind text; v_used integer; v_max integer; v_duration numeric;
begin
  if p_request_id is null or p_request_id !~ '^[a-zA-Z0-9_.:-]{1,160}$'
    or p_tenant_id is null or p_tenant_id !~ '^[a-zA-Z0-9_.:-]{1,160}$'
    or jsonb_typeof(p_operation) is distinct from 'object'
    or p_operation - array['operation_id','kind','duration_seconds'] <> '{}'
    or not (p_operation ?& array['operation_id','kind','duration_seconds'])
    or coalesce(p_operation->>'operation_id','') !~ '^[a-zA-Z0-9_.:-]{1,160}$'
    or jsonb_typeof(p_operation->'operation_id') <> 'string' or jsonb_typeof(p_operation->'kind') <> 'string'
    or coalesce(p_operation->>'kind','') not in ('photo','video')
    or jsonb_typeof(p_policy) is distinct from 'object'
    or p_policy - array['photos','videos','seconds','photo_version','video_version','seconds_version'] <> '{}'
    or not (p_policy ?& array['photos','videos','seconds','photo_version','video_version','seconds_version']) then
    raise exception 'Invalid media admission' using errcode = '22023';
  end if;
  -- These are release-envelope backstops. Active values and their versions
  -- are supplied by the server's A00 Policy Store, never by the homeowner.
  if (p_policy->>'photos')::numeric not between 1 and 4 or (p_policy->>'videos')::numeric <> 1
    or (p_policy->>'seconds')::numeric not between 1 and 30
    or exists (select 1 from jsonb_each(p_policy) e where jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric <> trunc((e.value #>> '{}')::numeric) or (e.value #>> '{}')::numeric < 1) then
    raise exception 'Media policy outside release envelope' using errcode = '22023';
  end if;
  v_kind := p_operation->>'kind';
  if v_kind = 'photo' and p_operation->'duration_seconds' <> 'null' then raise exception 'Photo duration invalid' using errcode='22023'; end if;
  if v_kind = 'video' then
    if jsonb_typeof(p_operation->'duration_seconds') <> 'number' then raise exception 'Video duration missing' using errcode='22023'; end if;
    v_duration := (p_operation->>'duration_seconds')::numeric;
    if v_duration <= 0 or v_duration > (p_policy->>'seconds')::numeric then raise exception 'Video duration exceeds policy' using errcode='22023'; end if;
  end if;
  begin
    select p.problem_id into strict v_problem from public.intake_session s join public.problem_record p on p.intake_session_id=s.intake_session_id
    where s.request_id=p_request_id and p.tenant_id=p_tenant_id for update of s;
  exception when no_data_found or too_many_rows then raise exception 'Media request ownership mismatch' using errcode='28000'; end;
  select * into v_row from public.request_media_budget where request_id=p_request_id for update;
  if not found then
    insert into public.request_media_budget(request_id,tenant_id,problem_id,baseline_photos,baseline_videos)
      select p_request_id,p_tenant_id,v_problem,count(*) filter(where kind='photo'),count(*) filter(where kind='video')
      from public.evidence_object where request_id=p_request_id returning * into v_row;
  end if;
  if v_row.tenant_id <> p_tenant_id or v_row.problem_id <> v_problem then raise exception 'Media budget identity mismatch' using errcode='28000'; end if;
  select value into v_prior from jsonb_array_elements(v_row.reservations) where value->>'operation_id'=p_operation->>'operation_id';
  v_used := case when v_kind='photo' then v_row.baseline_photos else v_row.baseline_videos end +
    (select count(*) from jsonb_array_elements(v_row.reservations) where value->>'kind'=v_kind);
  v_max := (p_policy->>case when v_kind='photo' then 'photos' else 'videos' end)::integer;
  if v_prior is not null then
    if v_prior - 'policy' <> p_operation or v_prior->'policy' <> p_policy then raise exception 'Media operation identity reused' using errcode='22023'; end if;
    return jsonb_build_object('accepted',true,'duplicate',true,'used',v_used,'max',v_max);
  end if;
  if v_used >= v_max then return jsonb_build_object('accepted',false,'duplicate',false,'used',v_used,'max',v_max); end if;
  update public.request_media_budget set reservations=reservations || jsonb_build_array(p_operation || jsonb_build_object('policy',p_policy)),updated_at=now() where request_id=p_request_id;
  return jsonb_build_object('accepted',true,'duplicate',false,'used',v_used+1,'max',v_max);
end;
$$;
revoke all privileges on function public.reserve_request_media(text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.reserve_request_media(text,text,jsonb,jsonb) to service_role;
