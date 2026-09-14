-- Durable fixture-only execution. WRITTEN, NOT APPLIED. No publication or QA authority.
-- All numeric fields are bounded integers; existing canonical JSON hash is exact here.
create table public.door_page_run (
 tenant_id text not null check(tenant_id='prn'),run_id text not null,idempotency_key text not null,
 request_sha256 text not null,revision integer not null check(revision between 1 and 232),record jsonb not null,
 primary key(tenant_id,run_id),unique(tenant_id,idempotency_key)
);
alter table public.door_page_run enable row level security;
revoke all on public.door_page_run from public,anon,authenticated,service_role;
grant select on public.door_page_run to service_role;

create function public.door_run_time(p jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
begin
 if jsonb_typeof(p) is distinct from 'string' or p#>>'{}' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$' then return false;end if;
 perform (p#>>'{}')::timestamptz;return true;
exception when others then return false;end $$;
create function public.door_run_id(p jsonb) returns boolean language sql immutable set search_path=pg_catalog,public as $$ select jsonb_typeof(p)='string' and p#>>'{}' ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' $$;
create function public.door_run_hash(p jsonb) returns boolean language sql immutable set search_path=pg_catalog,public as $$ select jsonb_typeof(p)='string' and p#>>'{}' ~ '^[a-f0-9]{64}$' $$;
create function public.door_run_creation(r jsonb) returns jsonb language sql immutable set search_path=pg_catalog,public as $$
 select (r-array['format','revision','updated_at','status','creation_sha256','state_sha256','items'])||jsonb_build_object('items',(select jsonb_agg(value-array['ordinal','status','execution_at','attempts','completed_at','outcome'] order by ordinality) from jsonb_array_elements(r->'items') with ordinality))
$$;
create function public.door_run_create_valid(p jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare k text;i jsonb;previous text:='';prefix text;begin
 if not public.door_version_keys(p,array['tenant_id','run_id','idempotency_key','request_sha256','actor','reason','created_at','mode','dry_run','package_sha256','executor_version','executor_sha256','environment','items'])
 or p->'tenant_id' is distinct from '"prn"'::jsonb or p->'mode' is distinct from '"fixture"'::jsonb or jsonb_typeof(p->'dry_run') is distinct from 'boolean' or not public.door_run_time(p->'created_at') then return false;end if;
 foreach k in array array['run_id','idempotency_key','executor_version'] loop if public.door_run_id(p->k) is not true then return false;end if;end loop;
 foreach k in array array['request_sha256','package_sha256','executor_sha256'] loop if public.door_run_hash(p->k) is not true then return false;end if;end loop;
 foreach k in array array['actor','reason'] loop if jsonb_typeof(p->k) is distinct from 'string' or length(p->>k) not between 1 and 500 or btrim(p->>k)='' or p->>k ~ '[[:cntrl:]]' then return false;end if;end loop;
 if not public.door_version_keys(p->'environment',array['kind','commit_sha']) or p->'environment'->'kind' not in ('"local"'::jsonb,'"trial"'::jsonb)
 or (p->'environment'->'commit_sha'<>'null'::jsonb and (jsonb_typeof(p->'environment'->'commit_sha')<>'string' or p->'environment'->>'commit_sha' !~ '^[a-f0-9]{40}$')) then return false;end if;
 if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') not between 1 and 11 then return false;end if;
 prefix:='fixture_'||substr(public.door_version_hash(jsonb_build_object('tenant_id',p->>'tenant_id','run_id',p->>'run_id')),1,24);
 for i in select value from jsonb_array_elements(p->'items') loop
  if not public.door_version_keys(i,array['item_id','fixture_id','page_id','operation_id']) or jsonb_typeof(i->'fixture_id') is distinct from 'string' or i->>'fixture_id' !~ '^F(0[1-9]|1[01])$'
  or i->>'fixture_id'<=previous collate "C" or i->'item_id' is distinct from i->'fixture_id' or i->>'page_id' is distinct from prefix||'_'||lower(i->>'fixture_id')
  or i->>'operation_id' is distinct from prefix||'_'||lower(i->>'fixture_id')||'_v1' then return false;end if;
  previous:=i->>'fixture_id';
 end loop;return octet_length(p::text)<=524288;
exception when others then return false;end $$;
create function public.door_run_outcome_valid(o jsonb,r jsonb,i jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare k text;d jsonb;a jsonb:=o->'artifact';begin
 if not public.door_version_keys(o,array['status','fixture_id','diagnostics','input_sha256','spec_sha256','html_hash','semantic_hash','compile_receipt_sha256','reservation_id','artifact','control_report','model_calls','cost_usd','release_ready'])
 or o->'status' not in ('"BUILT"'::jsonb,'"BLOCKED"'::jsonb,'"FAILED"'::jsonb) or o->'fixture_id' is distinct from i->'fixture_id'
 or o->'model_calls' is distinct from '0'::jsonb or o->'cost_usd' is distinct from '"0"'::jsonb or o->'release_ready' is distinct from 'false'::jsonb then return false;end if;
 foreach k in array array['input_sha256','spec_sha256','html_hash','semantic_hash','compile_receipt_sha256','reservation_id'] loop if o->k<>'null'::jsonb and public.door_run_hash(o->k) is not true then return false;end if;end loop;
 if jsonb_typeof(o->'diagnostics') is distinct from 'array' or jsonb_array_length(o->'diagnostics')>100 then return false;end if;
 for d in select value from jsonb_array_elements(o->'diagnostics') loop
  if not public.door_version_keys(d,array['code','pointer']) or jsonb_typeof(d->'code') is distinct from 'string' or d->>'code' !~ '^[A-Z][A-Z0-9_]{0,99}$'
  or jsonb_typeof(d->'pointer') is distinct from 'string' or length(d->>'pointer')>500 or d->>'pointer' !~ '^(/[A-Za-z0-9_~./-]*)?$' then return false;end if;
 end loop;
 if o->>'status'='BUILT' then
  foreach k in array array['input_sha256','spec_sha256','html_hash','semantic_hash','compile_receipt_sha256'] loop if public.door_run_hash(o->k) is not true then return false;end if;end loop;
  if not public.door_version_keys(a,array['namespace','artifact_hash','tenant_id','page_id','page_version','run_id']) or public.door_run_hash(a->'artifact_hash') is not true
  or a->'tenant_id' is distinct from r->'tenant_id' or a->'run_id' is distinct from r->'run_id' or a->'page_id' is distinct from i->'page_id' or a->'page_version' is distinct from '1'::jsonb
  or a->>'namespace' is distinct from (case when (r->>'dry_run')::boolean then 'dry-run' else 'saved' end) then return false;end if;
  if r->'dry_run'='false'::jsonb and public.door_run_hash(o->'reservation_id') is not true then return false;end if;
 elsif a<>'null'::jsonb then return false;end if;
 if r->'dry_run'='true'::jsonb and o->'reservation_id'<>'null'::jsonb then return false;end if;
 if o->'control_report'<>'null'::jsonb then
  d:=o->'control_report';if i->>'fixture_id'<>'F01' or o->>'status'<>'BLOCKED' or not public.door_version_keys(d,array['report_sha256','source_pin_hash','candidate_hash','status']) or d->'status' is distinct from '"BLOCKED_CONTROL_DERIVATIVE"'::jsonb then return false;end if;
  foreach k in array array['report_sha256','source_pin_hash','candidate_hash'] loop if public.door_run_hash(d->k) is not true then return false;end if;end loop;
 end if;return true;
exception when others then return false;end $$;
create function public.door_run_valid(r jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare c jsonb;i jsonb;a jsonb;last_a jsonb;ordinal integer:=0;rev integer:=1;seen text[]:=array[]::text[];open_seen boolean:=false;terminal boolean:=true;expected text;begin
 if not public.door_version_keys(r,array['tenant_id','run_id','idempotency_key','request_sha256','actor','reason','created_at','mode','dry_run','package_sha256','executor_version','executor_sha256','environment','items','format','revision','updated_at','status','creation_sha256','state_sha256'])
 or r->'format' is distinct from '"door-page-run/1.0.0"'::jsonb or r->>'revision' !~ '^[1-9][0-9]*$' or jsonb_typeof(r->'revision') is distinct from 'number' or not public.door_run_time(r->'updated_at') then return false;end if;
 c:=public.door_run_creation(r);
 if not public.door_run_create_valid(c) or r->>'creation_sha256' is distinct from public.door_version_hash(c) or r->>'state_sha256' is distinct from public.door_version_hash(r-'state_sha256') or (r->>'updated_at')::timestamptz<(r->>'created_at')::timestamptz then return false;end if;
 for i in select value from jsonb_array_elements(r->'items') loop
  ordinal:=ordinal+1;
  if not public.door_version_keys(i,array['item_id','fixture_id','page_id','operation_id','ordinal','status','execution_at','attempts','completed_at','outcome']) or i->'ordinal' is distinct from to_jsonb(ordinal)
  or i->'status' not in ('"PENDING"'::jsonb,'"RUNNING"'::jsonb,'"BUILT"'::jsonb,'"BLOCKED"'::jsonb,'"FAILED"'::jsonb)
  or (open_seen and i->>'status'<>'PENDING') or jsonb_typeof(i->'attempts') is distinct from 'array' or jsonb_array_length(i->'attempts')>20 then return false;end if;
  if i->>'status' in ('PENDING','RUNNING') then open_seen:=true;terminal:=false;end if;
  if i->>'status'='PENDING' then
   if jsonb_array_length(i->'attempts')<>0 or i->'execution_at'<>'null'::jsonb or i->'completed_at'<>'null'::jsonb or i->'outcome'<>'null'::jsonb then return false;end if;
  else
   if jsonb_array_length(i->'attempts')=0 or i->'execution_at' is distinct from i->'attempts'->0->'claimed_at' then return false;end if;
  end if;
  last_a:=null;
  for a in select value from jsonb_array_elements(i->'attempts') loop
   if not public.door_version_keys(a,array['attempt_id','claimed_at','lease_expires_at']) or public.door_run_id(a->'attempt_id') is not true or not public.door_run_time(a->'claimed_at') or not public.door_run_time(a->'lease_expires_at') or a->>'attempt_id'=any(seen) then return false;end if;
   if (a->>'claimed_at')::timestamptz<(r->>'created_at')::timestamptz or (a->>'claimed_at')::timestamptz>(r->>'updated_at')::timestamptz or (a->>'lease_expires_at')::timestamptz<=(a->>'claimed_at')::timestamptz or (a->>'lease_expires_at')::timestamptz>(a->>'claimed_at')::timestamptz+interval '30 minutes'
   or (last_a is not null and (a->>'claimed_at')::timestamptz<(last_a->>'lease_expires_at')::timestamptz) then return false;end if;
   seen:=array_append(seen,a->>'attempt_id');last_a:=a;rev:=rev+1;
  end loop;
  if i->>'status'='RUNNING' and (i->'completed_at'<>'null'::jsonb or i->'outcome'<>'null'::jsonb) then return false;end if;
  if i->>'status' not in ('PENDING','RUNNING') then
   rev:=rev+1;
   if not public.door_run_time(i->'completed_at') or i->'outcome'->'status' is distinct from i->'status' or not public.door_run_outcome_valid(i->'outcome',r,i)
   or (i->>'completed_at')::timestamptz<(last_a->>'claimed_at')::timestamptz or (i->>'completed_at')::timestamptz>=(last_a->>'lease_expires_at')::timestamptz or (i->>'completed_at')::timestamptz>(r->>'updated_at')::timestamptz then return false;end if;
  end if;
 end loop;
 expected:=case when terminal then 'COMPLETED' when rev=1 then 'PENDING' else 'RUNNING' end;
 return r->'revision'=to_jsonb(rev) and r->>'status'=expected and octet_length(r::text)<=524288;
exception when others then return false;end $$;
create function public.door_run_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if tg_op='DELETE' then raise exception 'DOOR_RUN_CONFLICT';end if;
 if not public.door_run_valid(new.record) or new.tenant_id<>new.record->>'tenant_id' or new.run_id<>new.record->>'run_id' or new.idempotency_key<>new.record->>'idempotency_key' or new.request_sha256<>new.record->>'request_sha256' or new.revision<>(new.record->>'revision')::integer then raise exception 'DOOR_RUN_INVALID';end if;
 if tg_op='UPDATE' and (public.door_run_creation(old.record)<>public.door_run_creation(new.record) or new.revision<>old.revision+1) then raise exception 'DOOR_RUN_CONFLICT';end if;
 return new;
end $$;
create trigger door_page_run_guard before insert or update or delete on public.door_page_run for each row execute function public.door_run_guard();
create function public.door_run_audit(r jsonb,prior jsonb) returns void language sql set search_path=pg_catalog,public as $$
 insert into public.admin_audit(at,action,target,detail) values((r->>'updated_at')::timestamptz,'door_page_run_transition',r->>'run_id',jsonb_build_object('tenant_id',r->>'tenant_id','revision',(r->>'revision')::integer,'creation_sha256',r->>'creation_sha256','state_sha256',r->>'state_sha256','actor',r->>'actor','reason',r->>'reason','environment',r->'environment',
 'role','owner-session','request_id',r->>'idempotency_key','request_sha256',r->>'request_sha256','previous_revision',coalesce((prior->>'revision')::integer,0),'previous_state_sha256',prior->>'state_sha256','previous_status',prior->>'status','status',r->>'status')::text)
$$;
create function public.create_door_page_run(p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r jsonb;items jsonb;begin
 if not public.door_run_create_valid(p_input) then raise exception 'DOOR_RUN_INVALID';end if;
 perform pg_advisory_xact_lock(28,hashtext(p_input->>'tenant_id'));
 select record into r from public.door_page_run where tenant_id=p_input->>'tenant_id' and (run_id=p_input->>'run_id' or idempotency_key=p_input->>'idempotency_key');
 if found then
  if r->'run_id' is distinct from p_input->'run_id' or r->'idempotency_key' is distinct from p_input->'idempotency_key' or r->'request_sha256' is distinct from p_input->'request_sha256' then raise exception 'DOOR_RUN_CONFLICT';end if;return r;
 end if;
 select jsonb_agg(value||jsonb_build_object('ordinal',ordinality,'status','PENDING','execution_at',null,'attempts','[]'::jsonb,'completed_at',null,'outcome',null) order by ordinality) into items from jsonb_array_elements(p_input->'items') with ordinality;
 r:=p_input||jsonb_build_object('format','door-page-run/1.0.0','revision',1,'status','PENDING','updated_at',p_input->>'created_at','items',items,'creation_sha256',public.door_version_hash(p_input));
 r:=r||jsonb_build_object('state_sha256',public.door_version_hash(r));
 insert into public.door_page_run values(p_input->>'tenant_id',p_input->>'run_id',p_input->>'idempotency_key',p_input->>'request_sha256',1,r);
 perform public.door_run_audit(r,null);return r;
end $$;
create function public.door_run_command_valid(p jsonb,completion boolean) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
begin
 if not public.door_version_keys(p,array['tenant_id','run_id','expected_revision','attempt_id','at']||case when completion then array['item_id','outcome'] else array['lease_expires_at'] end)
 or p->'tenant_id' is distinct from '"prn"'::jsonb or public.door_run_id(p->'run_id') is not true or public.door_run_id(p->'attempt_id') is not true or not public.door_run_time(p->'at')
 or jsonb_typeof(p->'expected_revision') is distinct from 'number' or p->>'expected_revision' !~ '^[1-9][0-9]*$' or (p->>'expected_revision')::numeric>231 then return false;end if;
 if completion then return public.door_run_id(p->'item_id') is true;
 else return public.door_run_time(p->'lease_expires_at') and (p->>'lease_expires_at')::timestamptz>(p->>'at')::timestamptz and (p->>'lease_expires_at')::timestamptz<=(p->>'at')::timestamptz+interval '30 minutes';end if;
exception when others then return false;end $$;
create function public.claim_door_page_run(p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r jsonb;prior jsonb;i jsonb;a jsonb;n integer;begin
 if not public.door_run_command_valid(p_input,false) then raise exception 'DOOR_RUN_INVALID';end if;
 perform pg_advisory_xact_lock(28,hashtext(p_input->>'tenant_id'));
 select record into r from public.door_page_run where tenant_id=p_input->>'tenant_id' and run_id=p_input->>'run_id' for update;
 if not found then raise exception 'DOOR_RUN_NOT_FOUND';end if;
 prior:=r;
 for i in select value from jsonb_array_elements(r->'items') loop
  if exists(select 1 from jsonb_array_elements(i->'attempts') x where x->'attempt_id'=p_input->'attempt_id') then
   a:=i->'attempts'->-1;
   if a->'attempt_id'=p_input->'attempt_id' and a->'claimed_at'=p_input->'at' and a->'lease_expires_at'=p_input->'lease_expires_at' then return r;end if;
   raise exception 'DOOR_RUN_CONFLICT';
  end if;
 end loop;
 if r->'revision'<>p_input->'expected_revision' or (p_input->>'at')::timestamptz<(r->>'updated_at')::timestamptz then raise exception 'DOOR_RUN_CONFLICT';end if;
 select value,(ordinality-1)::integer into i,n from jsonb_array_elements(r->'items') with ordinality where value->>'status' in ('PENDING','RUNNING') order by ordinality limit 1;
 if not found then return r;end if;
 if jsonb_array_length(i->'attempts')>=20 or (i->>'status'='RUNNING' and (p_input->>'at')::timestamptz<(i->'attempts'->-1->>'lease_expires_at')::timestamptz) then raise exception 'DOOR_RUN_CONFLICT';end if;
 i:=i||jsonb_build_object('status','RUNNING','execution_at',case when i->'execution_at'='null'::jsonb then p_input->'at' else i->'execution_at' end,
  'attempts',(i->'attempts')||jsonb_build_array(jsonb_build_object('attempt_id',p_input->>'attempt_id','claimed_at',p_input->>'at','lease_expires_at',p_input->>'lease_expires_at')));
 r:=jsonb_set(r,array['items',n::text],i)-'state_sha256';r:=r||jsonb_build_object('revision',(r->>'revision')::integer+1,'updated_at',p_input->>'at','status','RUNNING');r:=r||jsonb_build_object('state_sha256',public.door_version_hash(r));
 update public.door_page_run set revision=(r->>'revision')::integer,record=r where tenant_id=p_input->>'tenant_id' and run_id=p_input->>'run_id';perform public.door_run_audit(r,prior);return r;
end $$;
create function public.complete_door_page_run(p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r jsonb;prior jsonb;i jsonb;a jsonb;n integer;begin
 if not public.door_run_command_valid(p_input,true) then raise exception 'DOOR_RUN_INVALID';end if;
 perform pg_advisory_xact_lock(28,hashtext(p_input->>'tenant_id'));
 select record into r from public.door_page_run where tenant_id=p_input->>'tenant_id' and run_id=p_input->>'run_id' for update;
 if not found then raise exception 'DOOR_RUN_NOT_FOUND';end if;
 prior:=r;
 select value,(ordinality-1)::integer into i,n from jsonb_array_elements(r->'items') with ordinality where value->'item_id'=p_input->'item_id';
 if not found then raise exception 'DOOR_RUN_CONFLICT';end if;
 if not public.door_run_outcome_valid(p_input->'outcome',r,i) then raise exception 'DOOR_RUN_INVALID';end if;
 a:=i->'attempts'->-1;
 if i->'outcome'<>'null'::jsonb then if a->'attempt_id'=p_input->'attempt_id' and i->'outcome'=p_input->'outcome' then return r;else raise exception 'DOOR_RUN_CONFLICT';end if;end if;
 if r->'revision'<>p_input->'expected_revision' or i->>'status'<>'RUNNING' or a->'attempt_id' is distinct from p_input->'attempt_id'
 or (p_input->>'at')::timestamptz<(r->>'updated_at')::timestamptz or (p_input->>'at')::timestamptz>=(a->>'lease_expires_at')::timestamptz then raise exception 'DOOR_RUN_CONFLICT';end if;
 i:=i||jsonb_build_object('status',p_input->'outcome'->>'status','completed_at',p_input->>'at','outcome',p_input->'outcome');
 r:=jsonb_set(r,array['items',n::text],i)-'state_sha256';r:=r||jsonb_build_object('revision',(r->>'revision')::integer+1,'updated_at',p_input->>'at','status',case when exists(select 1 from jsonb_array_elements(r->'items') x where x->>'status' in ('PENDING','RUNNING')) then 'RUNNING' else 'COMPLETED' end);r:=r||jsonb_build_object('state_sha256',public.door_version_hash(r));
 update public.door_page_run set revision=(r->>'revision')::integer,record=r where tenant_id=p_input->>'tenant_id' and run_id=p_input->>'run_id';perform public.door_run_audit(r,prior);return r;
end $$;
-- Helpers never become an alternative elevated mutation surface.
revoke all on function public.door_run_time(jsonb),public.door_run_id(jsonb),public.door_run_hash(jsonb),public.door_run_creation(jsonb),public.door_run_create_valid(jsonb),public.door_run_outcome_valid(jsonb,jsonb,jsonb),public.door_run_valid(jsonb),public.door_run_guard(),public.door_run_audit(jsonb,jsonb),public.door_run_command_valid(jsonb,boolean),public.create_door_page_run(jsonb),public.claim_door_page_run(jsonb),public.complete_door_page_run(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_door_page_run(jsonb),public.claim_door_page_run(jsonb),public.complete_door_page_run(jsonb) to service_role;
