-- T1-35: request-owned, restart-durable effort admission. Written, not deployed.
-- Costs and selection metadata are supplied by authenticated SERVER routes.
-- Only service_role can execute the atomic mutation; authenticated may read
-- their own request but cannot create cheap attempts or replace the ledger.
-- One strict operation validator is used for new input and every historical
-- receipt. It is internal only; no caller receives an additional write seam.
create function public.intake_effort_validate_operation(p_operation jsonb)
returns void language plpgsql immutable set search_path = pg_catalog, public as $$
declare
  v_decision jsonb;
  v_kind text;
  v_units integer;
begin
  if p_operation is null or jsonb_typeof(p_operation) <> 'object'
    or p_operation - array['operation_id','kind','question_id','question_type','units','requirement_ids','decision_reason','selection_decisions','finish_reason','policy_version'] <> '{}'::jsonb
    or not (p_operation ?& array['operation_id','kind','question_id','question_type','units','requirement_ids','decision_reason','selection_decisions','finish_reason','policy_version'])
    or jsonb_typeof(p_operation->'operation_id') <> 'string'
    or coalesce(p_operation->>'operation_id', '') !~ '^[a-zA-Z0-9_.:-]{1,160}$'
    or p_operation->>'policy_version' is distinct from 'merged-intake-1.0.0'
    or coalesce(p_operation->>'kind', '') not in ('opening','answer','skip','retry','media','finish','selection')
    or jsonb_typeof(p_operation->'units') <> 'number'
    or (p_operation->>'units')::numeric <> trunc((p_operation->>'units')::numeric)
    or (p_operation->>'units')::numeric not between 0 and 20
    or jsonb_typeof(p_operation->'requirement_ids') <> 'array'
    or jsonb_array_length(p_operation->'requirement_ids') > 50
    or jsonb_typeof(p_operation->'selection_decisions') <> 'array'
    or jsonb_array_length(p_operation->'selection_decisions') > 50
    or jsonb_typeof(p_operation->'decision_reason') not in ('string','null')
    or length(coalesce(p_operation->>'decision_reason','')) > 240 then
    raise exception 'Invalid effort operation' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_operation->'requirement_ids') v
    where jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[a-zA-Z0-9_.:-]{1,160}$') then
    raise exception 'Invalid effort requirement ids' using errcode = '22023';
  end if;
  for v_decision in select value from jsonb_array_elements(p_operation->'selection_decisions') loop
    if jsonb_typeof(v_decision) <> 'object'
      or v_decision - array['question_id','fills_fields','already_populated_fields','policy_version'] <> '{}'::jsonb
      or not (v_decision ?& array['question_id','fills_fields','already_populated_fields','policy_version'])
      or jsonb_typeof(v_decision->'question_id') <> 'string'
      or jsonb_typeof(v_decision->'policy_version') <> 'string'
      or coalesce(v_decision->>'question_id','') !~ '^[a-zA-Z0-9_.:-]{1,160}$'
      or coalesce(v_decision->>'policy_version','') !~ '^[a-zA-Z0-9_.:-]{1,160}$'
      or jsonb_typeof(v_decision->'fills_fields') <> 'array'
      or jsonb_typeof(v_decision->'already_populated_fields') <> 'array'
      or jsonb_array_length(v_decision->'fills_fields') > 50
      or jsonb_array_length(v_decision->'already_populated_fields') > 50 then
      raise exception 'Invalid effort selection decision' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements((v_decision->'fills_fields') || (v_decision->'already_populated_fields')) v
      where jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[a-zA-Z0-9_.:-]{1,160}$') then
      raise exception 'Invalid effort selection fields' using errcode = '22023';
    end if;
  end loop;
  v_kind := p_operation->>'kind'; v_units := (p_operation->>'units')::integer;
  if v_kind = 'finish' then
    if v_units <> 0 or p_operation->'question_id' <> 'null'::jsonb or p_operation->'question_type' <> 'null'::jsonb
      or coalesce(p_operation->>'finish_reason','') not in ('homeowner_finish','effort_limit','ready','safety_stop') then
      raise exception 'Invalid effort finish' using errcode = '22023';
    end if;
  elsif v_kind = 'selection' then
    if v_units <> 0 or jsonb_typeof(p_operation->'question_id') <> 'string'
      or coalesce(p_operation->>'question_id','') !~ '^[a-zA-Z0-9_.:-]{1,160}$'
      or p_operation->'question_type' <> 'null'::jsonb or p_operation->'finish_reason' <> 'null'::jsonb then
      raise exception 'Invalid effort selection' using errcode = '22023';
    end if;
  elsif v_units < 1 or jsonb_typeof(p_operation->'question_id') <> 'string'
    or coalesce(p_operation->>'question_id','') !~ '^[a-zA-Z0-9_.:-]{1,160}$'
    or coalesce(p_operation->>'question_type','') not in ('closed_choice','confirm','media','short_text','free_text')
    or p_operation->'finish_reason' <> 'null'::jsonb then
    raise exception 'Invalid effort action' using errcode = '22023';
  end if;
end;
$$;
revoke all privileges on function public.intake_effort_validate_operation(jsonb) from public, anon, authenticated, service_role;

-- Replay the append order, deriving acceptance, charges and first finish.
-- Checking only cached effort_spent permits an over-budget commit after a
-- damaged total. Checking paired finish fields permits reopening a finished
-- request. Any malformed shape/cast or mismatch is an explicit false result.
create function public.intake_effort_valid_ledger(p_ledger jsonb, p_request_id text, p_tenant_id text, p_problem_id text)
returns boolean language plpgsql immutable set search_path = pg_catalog, public as $$
declare
  v_attempt jsonb;
  v_operation jsonb;
  v_ids text[] := array[]::text[];
  v_spent integer := 0;
  v_units integer;
  v_reason text;
  v_finished_at text := null;
  v_finish_reason text := null;
begin
  if jsonb_typeof(p_ledger) is distinct from 'object'
    or p_ledger - array['request_id','tenant_id','problem_id','policy_version','effort_spent','max_effort','finished_at','finish_reason','attempts'] <> '{}'::jsonb
    or not (p_ledger ?& array['request_id','tenant_id','problem_id','policy_version','effort_spent','max_effort','finished_at','finish_reason','attempts'])
    or jsonb_typeof(p_ledger->'request_id') is distinct from 'string'
    or jsonb_typeof(p_ledger->'tenant_id') is distinct from 'string'
    or jsonb_typeof(p_ledger->'problem_id') is distinct from 'string'
    or coalesce(p_request_id,'') !~ '^[a-zA-Z0-9_.:-]{1,160}$'
    or coalesce(p_tenant_id,'') !~ '^[a-zA-Z0-9_.:-]{1,160}$'
    or coalesce(p_problem_id,'') !~ '^[a-zA-Z0-9_.:-]{1,160}$'
    or p_ledger->>'request_id' is distinct from p_request_id
    or p_ledger->>'tenant_id' is distinct from p_tenant_id
    or p_ledger->>'problem_id' is distinct from p_problem_id
    or p_ledger->>'policy_version' is distinct from 'merged-intake-1.0.0'
    or p_ledger->'max_effort' is distinct from '20'::jsonb
    or jsonb_typeof(p_ledger->'effort_spent') is distinct from 'number'
    or (p_ledger->>'effort_spent')::numeric <> trunc((p_ledger->>'effort_spent')::numeric)
    or (p_ledger->>'effort_spent')::numeric not between 0 and 20
    or jsonb_typeof(p_ledger->'finished_at') not in ('string','null')
    or jsonb_typeof(p_ledger->'finish_reason') not in ('string','null')
    or jsonb_typeof(p_ledger->'attempts') is distinct from 'array' then return false;
  end if;
  for v_attempt in select value from jsonb_array_elements(p_ledger->'attempts') loop
    if jsonb_typeof(v_attempt) is distinct from 'object'
      or v_attempt - array['operation','occurred_at','charged_units','accepted','rejection_reason'] <> '{}'::jsonb
      or not (v_attempt ?& array['operation','occurred_at','charged_units','accepted','rejection_reason'])
      or jsonb_typeof(v_attempt->'occurred_at') is distinct from 'string'
      or coalesce(v_attempt->>'occurred_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
      or jsonb_typeof(v_attempt->'charged_units') is distinct from 'number'
      or (v_attempt->>'charged_units')::numeric <> trunc((v_attempt->>'charged_units')::numeric)
      or (v_attempt->>'charged_units')::numeric not between 0 and 20
      or jsonb_typeof(v_attempt->'accepted') is distinct from 'boolean'
      or jsonb_typeof(v_attempt->'rejection_reason') not in ('string','null') then return false;
    end if;
    -- Validate actual date/time values as well as the wire format. Receipt
    -- order is authoritative; wall clocks may move backwards under contention.
    perform (v_attempt->>'occurred_at')::timestamptz;
    v_operation := v_attempt->'operation';
    perform public.intake_effort_validate_operation(v_operation);
    if (v_operation->>'operation_id') = any(v_ids) then return false; end if;
    v_ids := array_append(v_ids, v_operation->>'operation_id');
    v_units := (v_operation->>'units')::integer;
    v_reason := null;
    if v_operation->>'kind' not in ('finish','selection') then
      if v_finished_at is not null then v_reason := 'finished';
      elsif v_spent + v_units > 20 then v_reason := 'effort_limit'; end if;
    end if;
    if (v_attempt->>'accepted')::boolean is distinct from (v_reason is null)
      or v_attempt->>'rejection_reason' is distinct from v_reason
      or (v_attempt->>'charged_units')::integer is distinct from (case when v_reason is null then v_units else 0 end) then return false;
    end if;
    if v_reason is null then v_spent := v_spent + v_units; end if;
    if v_operation->>'kind' = 'finish' and v_finished_at is null then
      v_finished_at := v_attempt->>'occurred_at'; v_finish_reason := v_operation->>'finish_reason';
    end if;
  end loop;
  return (p_ledger->>'effort_spent')::integer = v_spent
    and (p_ledger->>'finished_at') is not distinct from v_finished_at
    and (p_ledger->>'finish_reason') is not distinct from v_finish_reason;
exception when others then
  return false;
end;
$$;
revoke all privileges on function public.intake_effort_valid_ledger(jsonb,text,text,text) from public, anon, authenticated, service_role;

create table public.intake_effort_ledger (
  request_id text primary key references public.intake_session(request_id),
  tenant_id text not null,
  problem_id text not null references public.problem_record(problem_id),
  ledger jsonb not null,
  constraint intake_effort_identity check (
    public.intake_effort_valid_ledger(ledger, request_id, tenant_id, problem_id) is true
  )
);
alter table public.intake_effort_ledger enable row level security;
revoke all privileges on public.intake_effort_ledger from public, anon, authenticated, service_role;
grant select on public.intake_effort_ledger to authenticated, service_role;
create policy intake_effort_read_own on public.intake_effort_ledger for select to authenticated using (
  request_id = (select auth.jwt()->>'request_id')
  and exists (
    select 1 from public.intake_session s join public.problem_record p on p.intake_session_id = s.intake_session_id
    where s.request_id = intake_effort_ledger.request_id
      and p.problem_id = intake_effort_ledger.problem_id and p.tenant_id = intake_effort_ledger.tenant_id
  )
);

create function public.record_intake_effort(p_request_id text, p_tenant_id text, p_operation jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_problem_id text;
  v_ledger jsonb;
  v_previous jsonb;
  v_attempt jsonb;
  v_kind text;
  v_units integer;
  v_reason text := null;
  v_spent integer;
  v_at text;
begin
  if p_request_id is null or p_request_id !~ '^[a-zA-Z0-9_.:-]{1,160}$'
    or p_tenant_id is null or p_tenant_id !~ '^[a-zA-Z0-9_.:-]{1,160}$' then
    raise exception 'Invalid effort identity' using errcode = '22023';
  end if;
  perform public.intake_effort_validate_operation(p_operation);
  v_kind := p_operation->>'kind'; v_units := (p_operation->>'units')::integer;

  -- Lock the existing request even before its first ledger exists, so two
  -- first appends cannot each initialize an independent twenty-unit budget.
  begin
    select p.problem_id into strict v_problem_id
    from public.intake_session s join public.problem_record p on p.intake_session_id = s.intake_session_id
    where s.request_id = p_request_id and p.tenant_id = p_tenant_id for update of s;
  exception when no_data_found or too_many_rows then
    raise exception 'Effort request ownership mismatch' using errcode = '28000';
  end;
  select ledger into v_ledger from public.intake_effort_ledger
    where request_id = p_request_id and tenant_id = p_tenant_id and problem_id = v_problem_id for update;
  if v_ledger is null then
    v_ledger := jsonb_build_object('request_id',p_request_id,'tenant_id',p_tenant_id,'problem_id',v_problem_id,
      'policy_version','merged-intake-1.0.0','effort_spent',0,'max_effort',20,'finished_at',null,'finish_reason',null,'attempts','[]'::jsonb);
    insert into public.intake_effort_ledger(request_id,tenant_id,problem_id,ledger)
      values(p_request_id,p_tenant_id,v_problem_id,v_ledger);
  end if;
  -- Validate under the request/ledger locks, before even an idempotent return.
  -- This protects old/corrupt rows independently of the table constraint.
  if public.intake_effort_valid_ledger(v_ledger,p_request_id,p_tenant_id,v_problem_id) is not true then
    raise exception 'Invalid intake effort ledger' using errcode = '22023';
  end if;
  select value into v_previous from jsonb_array_elements(v_ledger->'attempts')
    where value->'operation'->>'operation_id' = p_operation->>'operation_id';
  if v_previous is not null then
    if v_previous->'operation' <> p_operation then
      raise exception 'Effort operation id already used with different input' using errcode = '22023';
    end if;
    return jsonb_build_object('accepted',v_previous->'accepted','duplicate',true,'reason',v_previous->'rejection_reason','ledger',v_ledger);
  end if;
  v_spent := (v_ledger->>'effort_spent')::integer;
  if v_kind not in ('finish','selection') then
    if v_ledger->'finished_at' <> 'null'::jsonb then v_reason := 'finished';
    elsif v_spent + v_units > 20 then v_reason := 'effort_limit'; end if;
  end if;
  v_at := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_attempt := jsonb_build_object('operation',p_operation,'occurred_at',v_at,
    'charged_units',case when v_reason is null then v_units else 0 end,
    'accepted',v_reason is null,'rejection_reason',v_reason);
  v_ledger := jsonb_set(v_ledger,'{attempts}',(v_ledger->'attempts') || jsonb_build_array(v_attempt));
  v_ledger := jsonb_set(v_ledger,'{effort_spent}',to_jsonb(v_spent + case when v_reason is null then v_units else 0 end));
  if v_kind = 'finish' and v_ledger->'finished_at' = 'null'::jsonb then
    v_ledger := jsonb_set(jsonb_set(v_ledger,'{finished_at}',to_jsonb(v_at)),'{finish_reason}',p_operation->'finish_reason');
  end if;
  if public.intake_effort_valid_ledger(v_ledger,p_request_id,p_tenant_id,v_problem_id) is not true then
    raise exception 'Invalid intake effort ledger' using errcode = '22023';
  end if;
  update public.intake_effort_ledger set ledger = v_ledger where request_id = p_request_id;
  return jsonb_build_object('accepted',v_reason is null,'duplicate',false,'reason',v_reason,'ledger',v_ledger);
end;
$$;
revoke all privileges on function public.record_intake_effort(text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_intake_effort(text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
