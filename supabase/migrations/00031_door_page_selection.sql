-- Exact immutable selection sets. WRITTEN, NOT APPLIED. No seeded release authority.
create table public.door_page_selection_guard(tenant_id text not null,revision integer not null check(revision>0),operation_id text not null,request_sha256 text not null,record jsonb not null,primary key(tenant_id,revision),unique(tenant_id,operation_id));
create table public.door_page_selection_set(tenant_id text not null,revision integer not null check(revision>0),operation_id text not null,request_sha256 text not null,record jsonb not null,primary key(tenant_id,revision),unique(tenant_id,operation_id));
create table public.door_page_selection_head(tenant_id text primary key,selection_revision integer not null default 0,guard_revision integer not null default 0);
alter table public.door_page_selection_guard enable row level security;
alter table public.door_page_selection_set enable row level security;
alter table public.door_page_selection_head enable row level security;
revoke all on public.door_page_selection_guard,public.door_page_selection_set,public.door_page_selection_head from public,anon,authenticated,service_role;
grant select on public.door_page_selection_guard,public.door_page_selection_set,public.door_page_selection_head to service_role;
create trigger door_selection_guard_immutable before update or delete on public.door_page_selection_guard for each row execute function public.door_version_immutable();
create trigger door_selection_set_immutable before update or delete on public.door_page_selection_set for each row execute function public.door_version_immutable();

create function public.door_selection_command_valid(p jsonb,extra text[]) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare k text;
begin
 if not public.door_version_keys(p,array['tenant_id','operation_id','actor','reason','at','expected_revision']||extra) then return false; end if;
 foreach k in array array['tenant_id','operation_id'] loop if jsonb_typeof(p->k) is distinct from 'string' or p->>k !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then return false; end if; end loop;
 foreach k in array array['actor','reason'] loop if jsonb_typeof(p->k) is distinct from 'string' or length(p->>k) not between 1 and 500 or btrim(p->>k)='' then return false; end if; end loop;
 if jsonb_typeof(p->'expected_revision') is distinct from 'number' or p->>'expected_revision' !~ '^(0|[1-9][0-9]*)$' or (p->>'expected_revision')::numeric>2147483645 or jsonb_typeof(p->'at') is distinct from 'string' or p->>'at' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$' then return false; end if;
 perform (p->>'at')::timestamptz;return true;
exception when others then return false;end $$;
create function public.door_selection_fence_valid(p jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare k text;begin
 if not public.door_version_keys(p,array['revision','dependency_revision','hold_revision','dependencies_sha256','environment_sha256','holds_sha256']) then return false; end if;
 foreach k in array array['revision','dependency_revision','hold_revision'] loop if jsonb_typeof(p->k) is distinct from 'number' or p->>k !~ '^(0|[1-9][0-9]*)$' or (p->>k)::numeric>2147483646 then return false;end if;end loop;
 foreach k in array array['dependencies_sha256','environment_sha256','holds_sha256'] loop if jsonb_typeof(p->k) is distinct from 'string' or p->>k !~ '^[a-f0-9]{64}$' then return false;end if;end loop;return true;
exception when others then return false;end $$;
create function public.door_selection_guard_valid(s jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare p jsonb:=s->'release_policy';r jsonb;k text;x jsonb;required text[]:=array['H01','H02','H03','H04','H05','H06','H07','H08','H09','H10','H11','H12','H13','H14','H15','H16','H17','H18','opportunity','family_preflight','schema','intent','constants','actions','layout_counts','source_claims','capabilities','safety','structured_data','assets_social','provenance_dates','wording','security','accessibility','responsive','interaction','performance','batch_quality','template_corpus','staged_preview','hosted_runtime','reproducibility'];begin
 if not public.door_version_keys(s,array['fence','policy_sha256','release_policy','origin','index_policy','publish_enabled','blocked_page_ids','family_routes']) or not public.door_selection_fence_valid(s->'fence') or jsonb_typeof(s->'publish_enabled') is distinct from 'boolean' or s->>'index_policy' not in ('trial_noindex','public_indexable') or jsonb_typeof(s->'origin') is distinct from 'string' or s->>'origin' !~ '^https://[A-Za-z0-9.-]+(:[1-9][0-9]{0,4})?$' then return false;end if;
 if not public.door_version_keys(p,array['version','required_checks','producers','dependencies','environment','max_evidence_age_seconds','holds']) or s->>'policy_sha256' is distinct from public.door_version_hash(p) or s->'fence'->>'dependencies_sha256' is distinct from public.door_version_hash(p->'dependencies') or s->'fence'->>'environment_sha256' is distinct from public.door_version_hash(p->'environment') or s->'fence'->>'holds_sha256' is distinct from public.door_version_hash(p->'holds') or s->'origin' is distinct from p->'environment'->'origin' then return false;end if;
 if s->>'origin'<>lower(s->>'origin') or s->>'origin' ~ ':443$' or (s->>'origin' ~ ':[0-9]+$' and (substring(s->>'origin' from ':([0-9]+)$'))::numeric>65535) or jsonb_typeof(p->'version') is distinct from 'string' or p->>'version' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$' then return false;end if;
 if not public.door_version_keys(p->'environment',array['id','manifest_sha256','commit','origin']) or jsonb_typeof(p->'environment'->'id') is distinct from 'string' or p->'environment'->>'id' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$' or jsonb_typeof(p->'environment'->'manifest_sha256') is distinct from 'string' or p->'environment'->>'manifest_sha256' !~ '^[a-f0-9]{64}$' or jsonb_typeof(p->'environment'->'commit') is distinct from 'string' or p->'environment'->>'commit' !~ '^[a-f0-9]{40}$' then return false;end if;
 if not public.door_version_keys(p->'holds',array['public_publish','door_pages_live','trial_noindex']) or p->'holds'->'trial_noindex' is distinct from 'true'::jsonb or jsonb_typeof(p->'holds'->'public_publish') is distinct from 'boolean' or jsonb_typeof(p->'holds'->'door_pages_live') is distinct from 'boolean' then return false;end if;
 if jsonb_typeof(p->'required_checks') is distinct from 'array' or jsonb_array_length(p->'required_checks')<>42 or (select count(distinct value) from jsonb_array_elements(p->'required_checks'))<>42 or jsonb_typeof(p->'producers') is distinct from 'array' or jsonb_array_length(p->'producers') not between 1 and 100 or jsonb_typeof(p->'dependencies') is distinct from 'array' or jsonb_typeof(p->'max_evidence_age_seconds') is distinct from 'number' or p->>'max_evidence_age_seconds' !~ '^[1-9][0-9]*$' or (p->>'max_evidence_age_seconds')::numeric>31536000 then return false;end if;
 if exists(select 1 from jsonb_array_elements(p->'required_checks') c where jsonb_typeof(c)<>'string' or not (c#>>'{}')=any(required)) or jsonb_array_length(p->'dependencies')>1000 then return false;end if;
 foreach k in array array['template','schema','fixture_corpus','prompt','source','capability','theme','disclosure'] loop if not exists(select 1 from jsonb_array_elements(p->'dependencies') d where d->>'kind'=k) then return false;end if;end loop;
 for r in select value from jsonb_array_elements(p->'dependencies') loop
  if not public.door_version_keys(r,array['kind','id','version','sha256']) or jsonb_typeof(r->'sha256') is distinct from 'string' or r->>'sha256' !~ '^[a-f0-9]{64}$' then return false;end if;
  foreach k in array array['kind','id','version'] loop if jsonb_typeof(r->k) is distinct from 'string' or r->>k !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$' then return false;end if;end loop;
 end loop;
 if exists(select 1 from (select value->>'kind'||'/'||(value->>'id') key,lag(value->>'kind'||'/'||(value->>'id')) over(order by ordinality) previous from jsonb_array_elements(p->'dependencies') with ordinality) d where previous>=key collate "C") or (select count(distinct value->>'id') from jsonb_array_elements(p->'producers'))<>jsonb_array_length(p->'producers') then return false;end if;
 for r in select value from jsonb_array_elements(p->'producers') loop if not public.door_version_keys(r,array['id','version','implementation_sha256','actor_kind','trust_scope','kinds','check_ids']) or r->>'trust_scope' not in ('governed_execution','reviewed_repository','human_action') or r->>'actor_kind' not in ('system','human') or jsonb_typeof(r->'kinds') is distinct from 'array' or jsonb_typeof(r->'check_ids') is distinct from 'array' then return false;end if;end loop;
 for r in select value from jsonb_array_elements(p->'producers') loop
  foreach k in array array['id','version'] loop if jsonb_typeof(r->k) is distinct from 'string' or r->>k !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$' then return false;end if;end loop;
  if jsonb_typeof(r->'implementation_sha256') is distinct from 'string' or r->>'implementation_sha256' !~ '^[a-f0-9]{64}$' or jsonb_typeof(r->'actor_kind') is distinct from 'string' or jsonb_typeof(r->'trust_scope') is distinct from 'string' or jsonb_array_length(r->'kinds')=0 or (select count(distinct value) from jsonb_array_elements(r->'kinds'))<>jsonb_array_length(r->'kinds') or (select count(distinct value) from jsonb_array_elements(r->'check_ids'))<>jsonb_array_length(r->'check_ids') then return false;end if;
  for x in select value from jsonb_array_elements(r->'kinds') loop if jsonb_typeof(x)<>'string' or x#>>'{}' not in ('artifact_integrity','independent_critic','check_matrix','technical_assessment','content_approval','release_evaluation','publish_action','review','revocation') then return false;end if;end loop;
  if exists(select 1 from jsonb_array_elements(r->'check_ids') c where jsonb_typeof(c)<>'string' or not (c#>>'{}')=any(required)) then return false;end if;
 end loop;
 if jsonb_typeof(s->'blocked_page_ids') is distinct from 'array' or jsonb_array_length(s->'blocked_page_ids')>1000 or (select count(distinct value) from jsonb_array_elements(s->'blocked_page_ids'))<>jsonb_array_length(s->'blocked_page_ids') or jsonb_typeof(s->'family_routes') is distinct from 'array' or jsonb_array_length(s->'family_routes')>1000 then return false;end if;
 for r in select value from jsonb_array_elements(s->'blocked_page_ids') loop if jsonb_typeof(r) is distinct from 'string' or r#>>'{}' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then return false;end if;end loop;
 for r in select value from jsonb_array_elements(s->'family_routes') loop if not public.door_version_keys(r,array['family_id','path','label']) or jsonb_typeof(r->'family_id') is distinct from 'string' or length(r->>'family_id') not between 1 and 150 or jsonb_typeof(r->'label') is distinct from 'string' or length(r->>'label') not between 1 and 500 or jsonb_typeof(r->'path') is distinct from 'string' or r->>'path' !~ '^/[a-z0-9]+(-[a-z0-9]+)*$' then return false;end if;end loop;
 return (select count(distinct value->>'family_id')=jsonb_array_length(s->'family_routes') and count(distinct value->>'path')=jsonb_array_length(s->'family_routes') from jsonb_array_elements(s->'family_routes'));
exception when others then return false;end $$;
create function public.door_selection_closure(entries jsonb,removed jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog,public as $$
declare kept jsonb;next_kept jsonb;begin
 select coalesce(jsonb_agg(value order by value->>'page_id' collate "C"),'[]') into kept from jsonb_array_elements(entries) where not removed ? (value->>'page_id');
 loop
  select coalesce(jsonb_agg(e order by e->>'page_id' collate "C"),'[]') into next_kept from jsonb_array_elements(kept) e where not exists(select 1 from jsonb_array_elements_text(e->'related_page_ids') rel where not exists(select 1 from jsonb_array_elements(kept) k where k->>'page_id'=rel));
  exit when next_kept=kept;kept:=next_kept;
 end loop;return kept;end $$;
create function public.door_selection_append(c jsonb,g jsonb,old jsonb,entries jsonb,kind text,request text) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare r jsonb;rev integer:=coalesce((old->>'revision')::integer,0)+1;begin
 r:=jsonb_build_object('tenant_id',c->>'tenant_id','operation_id',c->>'operation_id','actor',c->>'actor','reason',c->>'reason','at',c->>'at','revision',rev,'previous_revision',rev-1,'guard_revision',(g->>'revision')::integer,'action',kind,'request_sha256',request,'entries',entries);
 r:=r||jsonb_build_object('selection_sha256',public.door_version_hash(r));
 insert into public.door_page_selection_set values(c->>'tenant_id',rev,c->>'operation_id',request,r);
 update public.door_page_selection_head set selection_revision=rev where tenant_id=c->>'tenant_id';
 insert into public.admin_audit(at,action,target,detail) values((c->>'at')::timestamptz,'door_selection_committed',c->>'tenant_id',jsonb_build_object('tenant_id',c->>'tenant_id','revision',rev,'operation_id',c->>'operation_id','actor',c->>'actor','reason',c->>'reason','hash',r->>'selection_sha256')::text);return r;
end $$;
create function public.door_selection_bind(entries jsonb,old jsonb,action text) returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare e jsonb;t jsonb;prior jsonb;rel text;bindings jsonb;result jsonb:='[]';old_family jsonb;new_family jsonb;validation jsonb;baked jsonb;input_tenant text;begin
 for e in select value from jsonb_array_elements(entries) loop
  select ((payload_json::jsonb)->'context_parts'->>'validation')::jsonb,tenant_id into validation,input_tenant from public.door_page_version_input where reservation_id=e->>'reservation_id';
  bindings:='[]';for rel in select value from jsonb_array_elements_text(e->'related_page_ids') loop
   select value into t from jsonb_array_elements(entries) where value->>'page_id'=rel;
   if t is null or t->'page_id'=e->'page_id' or t->'family_id'<>e->'family_id' then raise exception 'SELECTION_RELATED_REBUILD_REQUIRED';end if;
   select value into baked from jsonb_array_elements(validation->'pages') where value->>'page_id'=rel;
   if baked is null or baked->'canonical_path' is distinct from t->'canonical_path' or baked->>'tenant_id' is distinct from input_tenant or baked->'live' is distinct from 'true'::jsonb or baked->'redirect_to' is distinct from 'null'::jsonb then raise exception 'SELECTION_RELATED_REBUILD_REQUIRED';end if;
   bindings:=bindings||jsonb_build_array(jsonb_build_object('page_id',rel,'page_version',t->'page_version','input_sha256',t->'input_sha256','artifact_hash',t->'artifact_hash','canonical_path',t->'canonical_path'));
  end loop;
  select value into prior from jsonb_array_elements(coalesce(old->'entries','[]')) where value->'page_id'=e->'page_id';
  if prior is not null and prior->'artifact_hash'=e->'artifact_hash' then
   if prior->'related_bindings' is distinct from bindings then raise exception 'SELECTION_RELATED_REBUILD_REQUIRED';end if;
   select coalesce(jsonb_agg(value->>'page_id' order by value->>'page_id' collate "C"),'[]') into old_family from jsonb_array_elements(old->'entries') where value->'family_id'=e->'family_id';
   select coalesce(jsonb_agg(value->>'page_id' order by value->>'page_id' collate "C"),'[]') into new_family from jsonb_array_elements(entries) where value->'family_id'=e->'family_id';
   if action='publish' and old_family<>new_family then raise exception 'SELECTION_RELATED_REBUILD_REQUIRED';end if;
  end if;
  result:=result||jsonb_build_array(e||jsonb_build_object('related_bindings',bindings));
 end loop;
 return (select coalesce(jsonb_agg(value order by value->>'page_id' collate "C"),'[]') from jsonb_array_elements(result));end $$;
create function public.commit_door_page_selection(p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c jsonb:=p_input-'observed_fence';h public.door_page_selection_head;g jsonb;old jsonb;prior jsonb;r jsonb;t jsonb;entries jsonb:='[]';request text;previous_target jsonb;checked_at timestamptz:=clock_timestamp();k text;begin
 if not public.door_selection_command_valid(c,array['fence','action','entries']) or not public.door_selection_fence_valid(c->'fence') or p_input->'observed_fence' is distinct from c->'fence' or c->>'action' not in ('publish','rollback') or jsonb_typeof(c->'entries') is distinct from 'array' or jsonb_array_length(c->'entries')>1000 then raise exception 'SELECTION_INVALID';end if;
 if (select count(distinct value->>'page_id') from jsonb_array_elements(c->'entries'))<>jsonb_array_length(c->'entries') then raise exception 'SELECTION_INVALID';end if;
 for t in select value from jsonb_array_elements(c->'entries') loop
  if not public.door_version_keys(t,array['page_id','page_version','reservation_id','input_sha256','artifact_hash','compile_receipt_sha256','release_evaluation_sha256','content_approval_sha256','publish_action_sha256']) or jsonb_typeof(t->'page_id') is distinct from 'string' or t->>'page_id' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' or jsonb_typeof(t->'page_version') is distinct from 'number' or t->>'page_version' !~ '^[1-9][0-9]*$' or (t->>'page_version')::numeric>2147483646 then raise exception 'SELECTION_INVALID';end if;
  foreach k in array array['reservation_id','input_sha256','artifact_hash','compile_receipt_sha256','release_evaluation_sha256','content_approval_sha256','publish_action_sha256'] loop if jsonb_typeof(t->k) is distinct from 'string' or t->>k !~ '^[a-f0-9]{64}$' then raise exception 'SELECTION_INVALID';end if;end loop;
 end loop;
 c:=c||jsonb_build_object('entries',(select coalesce(jsonb_agg(value order by value->>'page_id' collate "C"),'[]') from jsonb_array_elements(c->'entries')));request:=public.door_version_hash(c);
 perform pg_advisory_xact_lock(28,hashtext(c->>'tenant_id'));checked_at:=clock_timestamp();
 select record into prior from public.door_page_selection_set where tenant_id=c->>'tenant_id' and operation_id=c->>'operation_id';if found then if prior->>'request_sha256'<>request then raise exception 'SELECTION_CONFLICT';end if;return prior;end if;
 select * into h from public.door_page_selection_head where tenant_id=c->>'tenant_id';if not found then raise exception 'SELECTION_HOLD';end if;
 select record into g from public.door_page_selection_guard where tenant_id=h.tenant_id and revision=h.guard_revision;select record into old from public.door_page_selection_set where tenant_id=h.tenant_id and revision=h.selection_revision;
 if h.selection_revision<>(c->>'expected_revision')::integer then raise exception 'SELECTION_CONFLICT';end if;
 if g is null or g->'state'->'fence' is distinct from c->'fence' or g->'state'->'publish_enabled' is distinct from 'true'::jsonb or g->'state'->'release_policy'->'holds'->'public_publish' is distinct from 'false'::jsonb or g->'state'->'release_policy'->'holds'->'door_pages_live' is distinct from 'true'::jsonb then raise exception 'SELECTION_HOLD';end if;
 for t in select value from jsonb_array_elements(c->'entries') loop
  if g->'state'->'blocked_page_ids' ? (t->>'page_id') then raise exception 'SELECTION_HOLD';end if;
  if c->>'action'='rollback' and not exists(select 1 from public.door_page_selection_set history cross join lateral jsonb_array_elements(history.record->'entries') e where history.tenant_id=h.tenant_id and e->'page_id'=t->'page_id' and e->'page_version'=t->'page_version' and e->'reservation_id'=t->'reservation_id' and e->'input_sha256'=t->'input_sha256' and e->'artifact_hash'=t->'artifact_hash' and e->'compile_receipt_sha256'=t->'compile_receipt_sha256') then raise exception 'SELECTION_INELIGIBLE';end if;
  select value-'canonical_path'-'canonical_url'-'family_id'-'family_path'-'label'-'related_page_ids'-'related_bindings'-'robots'-'valid_until'-'sitemap_eligible' into previous_target from jsonb_array_elements(coalesce(old->'entries','[]')) where value->'page_id'=t->'page_id';
  r:=public.door_selection_entry(t,h.tenant_id,g,checked_at,case when previous_target=t then null else c end);entries:=entries||jsonb_build_array(r);
 end loop;
 entries:=public.door_selection_bind(entries,old,c->>'action');return public.door_selection_append(c,g,old,entries,c->>'action',request);
end $$;
create function public.withdraw_door_page_selection(p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c jsonb:=p_input;h public.door_page_selection_head;g jsonb;old jsonb;prior jsonb;request text;r jsonb;begin
 if not public.door_selection_command_valid(c,array['expected_hold_revision','page_ids']) or jsonb_typeof(c->'expected_hold_revision') is distinct from 'number' or c->>'expected_hold_revision' !~ '^(0|[1-9][0-9]*)$' or (c->>'expected_hold_revision')::numeric>2147483646 or jsonb_typeof(c->'page_ids') is distinct from 'array' or jsonb_array_length(c->'page_ids') not between 1 and 1000 or (select count(distinct value) from jsonb_array_elements(c->'page_ids'))<>jsonb_array_length(c->'page_ids') then raise exception 'SELECTION_INVALID';end if;
 for r in select value from jsonb_array_elements(c->'page_ids') loop if jsonb_typeof(r) is distinct from 'string' or r#>>'{}' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then raise exception 'SELECTION_INVALID';end if;end loop;
 c:=c||jsonb_build_object('page_ids',(select jsonb_agg(value order by value#>>'{}' collate "C") from jsonb_array_elements(c->'page_ids')));request:=public.door_version_hash(c);perform pg_advisory_xact_lock(28,hashtext(c->>'tenant_id'));
 select record into prior from public.door_page_selection_set where tenant_id=c->>'tenant_id' and operation_id=c->>'operation_id';if found then if prior->>'request_sha256'<>request then raise exception 'SELECTION_CONFLICT';end if;return prior;end if;
 select * into h from public.door_page_selection_head where tenant_id=c->>'tenant_id';if not found then raise exception 'SELECTION_CONFLICT';end if;
 select record into g from public.door_page_selection_guard where tenant_id=h.tenant_id and revision=h.guard_revision;select record into old from public.door_page_selection_set where tenant_id=h.tenant_id and revision=h.selection_revision;
 if h.selection_revision<>(c->>'expected_revision')::integer or (g->'state'->'fence'->>'hold_revision')::integer<>(c->>'expected_hold_revision')::integer then raise exception 'SELECTION_CONFLICT';end if;
 return public.door_selection_append(c,g,old,public.door_selection_closure(coalesce(old->'entries','[]'),c->'page_ids'),'unpublish',request);
end $$;
create function public.read_door_page_serving_snapshot(p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare h public.door_page_selection_head;g jsonb;selected jsonb;managed jsonb;r jsonb;t jsonb;derived jsonb;removed jsonb:='[]';entries jsonb:='[]';status text;checked_at timestamptz:=clock_timestamp();begin
 if not public.door_version_keys(p_input,array['tenant_id','observed_fence']) or jsonb_typeof(p_input->'tenant_id') is distinct from 'string' or p_input->>'tenant_id' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' or (p_input->'observed_fence'<>'null'::jsonb and not public.door_selection_fence_valid(p_input->'observed_fence')) then raise exception 'SELECTION_INVALID';end if;
 perform pg_advisory_xact_lock(28,hashtext(p_input->>'tenant_id'));checked_at:=clock_timestamp();
 select * into h from public.door_page_selection_head where tenant_id=p_input->>'tenant_id';select record into g from public.door_page_selection_guard where tenant_id=h.tenant_id and revision=h.guard_revision;select record into selected from public.door_page_selection_set where tenant_id=h.tenant_id and revision=h.selection_revision;
 select coalesce(jsonb_agg(jsonb_build_object('page_id',page_id,'canonical_path',canonical_path,'kind','catalog') order by canonical_path collate "C"),'[]') into managed from public.door_page_identity where tenant_id=p_input->>'tenant_id' and canonical_path<>'/problems/ac-blowing-warm-air';managed:=managed||jsonb_build_array(jsonb_build_object('page_id',null,'canonical_path','/problems/ac-blowing-warm-air','kind','frozen_control'));
 status:=case when g is null then 'unconfigured' when g->'state'->'fence' is distinct from p_input->'observed_fence' then 'stale' else 'current' end;
 if status='current' and selected is not null and g->'state'->'publish_enabled'='true'::jsonb then
  removed:=g->'state'->'blocked_page_ids';
  for r in select value from jsonb_array_elements(selected->'entries') loop
   t:=r-'canonical_path'-'canonical_url'-'family_id'-'family_path'-'label'-'related_page_ids'-'related_bindings'-'robots'-'valid_until'-'sitemap_eligible';
   begin derived:=public.door_selection_entry(t,h.tenant_id,g,checked_at);if derived->'canonical_path' is distinct from r->'canonical_path' or derived->'label' is distinct from r->'label' or derived->'family_path' is distinct from r->'family_path' or (r->>'valid_until')::timestamptz<=checked_at then raise exception 'SELECTION_INELIGIBLE';end if;
   exception when others then removed:=removed||jsonb_build_array(r->>'page_id');end;
  end loop;entries:=public.door_selection_closure(selected->'entries',removed);
 end if;
 return jsonb_build_object('tenant_id',p_input->>'tenant_id','revision',coalesce(h.selection_revision,0),'selection_sha256',selected->'selection_sha256','guard_revision',coalesce(h.guard_revision,0),'fence',g->'state'->'fence','origin',g->'state'->'origin','index_policy',g->'state'->'index_policy','entries',entries,'managed',managed,'as_of',to_char(checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'guard_status',status);
end $$;

create function public.register_door_page_selection_guard(p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare h public.door_page_selection_head;old jsonb;r jsonb;s jsonb:=p_input->'state';request text;selected jsonb;kept jsonb;removed jsonb;begin
 if not public.door_selection_command_valid(p_input,array['state']) or not public.door_selection_guard_valid(s) then raise exception 'SELECTION_INVALID';end if;
 request:=public.door_version_hash(p_input);perform pg_advisory_xact_lock(28,hashtext(p_input->>'tenant_id'));
 select record into r from public.door_page_selection_guard where tenant_id=p_input->>'tenant_id' and operation_id=p_input->>'operation_id';if found then if r->>'request_sha256'<>request then raise exception 'SELECTION_CONFLICT';end if;return r;end if;
 insert into public.door_page_selection_head(tenant_id) values(p_input->>'tenant_id') on conflict do nothing;select * into h from public.door_page_selection_head where tenant_id=p_input->>'tenant_id';
 select record into old from public.door_page_selection_guard where tenant_id=h.tenant_id and revision=h.guard_revision;
 if h.guard_revision<>(p_input->>'expected_revision')::integer or (s->'fence'->>'revision')::integer<>h.guard_revision+1 or (old is not null and ((s->'fence'->>'dependency_revision')::integer<(old->'state'->'fence'->>'dependency_revision')::integer or (s->'fence'->>'hold_revision')::integer<(old->'state'->'fence'->>'hold_revision')::integer)) then raise exception 'SELECTION_CONFLICT';end if;
 r:=(p_input-'expected_revision')||jsonb_build_object('revision',h.guard_revision+1,'previous_revision',h.guard_revision,'request_sha256',request);r:=r||jsonb_build_object('guard_sha256',public.door_version_hash(r));
 insert into public.door_page_selection_guard values(h.tenant_id,h.guard_revision+1,p_input->>'operation_id',request,r);update public.door_page_selection_head set guard_revision=h.guard_revision+1 where tenant_id=h.tenant_id;
 insert into public.admin_audit(at,action,target,detail) values((p_input->>'at')::timestamptz,'door_selection_guard',h.tenant_id,jsonb_build_object('tenant_id',h.tenant_id,'revision',h.guard_revision+1,'operation_id',p_input->>'operation_id','actor',p_input->>'actor','reason',p_input->>'reason','hash',r->>'guard_sha256')::text);
 select record into selected from public.door_page_selection_set where tenant_id=h.tenant_id and revision=h.selection_revision;
 if selected is not null then
  removed:=s->'blocked_page_ids';if s->'publish_enabled'<>'true'::jsonb or s->'release_policy'->'holds'->'public_publish'='true'::jsonb or s->'release_policy'->'holds'->'door_pages_live'<>'true'::jsonb then select coalesce(jsonb_agg(value->>'page_id'),'[]') into removed from jsonb_array_elements(selected->'entries');end if;
  kept:=public.door_selection_closure(selected->'entries',removed);if kept<>selected->'entries' then perform public.door_selection_append(p_input||jsonb_build_object('operation_id',public.door_version_hash(jsonb_build_object('guard_operation',p_input->>'operation_id'))),r,selected,kept,'hold_withdrawal',request);end if;
 end if;return r;
end $$;
create function public.door_selection_text(nodes jsonb) returns text language plpgsql immutable set search_path=pg_catalog,public as $$
declare n jsonb;t text:='';begin for n in select value from jsonb_array_elements(nodes) loop t:=t||case when n ? 'children' then public.door_selection_text(n->'children') when n->>'type'='text' then n->>'value' when n ? 'label' then n->>'label' else ' ' end;end loop;return t;end $$;
create function public.door_selection_entry(t jsonb,tenant text,g jsonb,checked_at timestamptz,c jsonb default null) returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare v public.door_page_version;i public.door_page_version_input;payload jsonb;spec jsonb;ctx jsonb;model jsonb;writer jsonb;assignments jsonb;s jsonb:=g->'state';family jsonb;subject jsonb;records jsonb;ev jsonb;ap jsonb;act jsonb;r jsonb;valid_until timestamptz;begin
 if not public.door_version_keys(t,array['page_id','page_version','reservation_id','input_sha256','artifact_hash','compile_receipt_sha256','release_evaluation_sha256','content_approval_sha256','publish_action_sha256']) then raise exception 'SELECTION_INVALID';end if;
 select * into v from public.door_page_version where tenant_id=tenant and page_id=t->>'page_id' and page_version=(t->>'page_version')::integer;
 select * into i from public.door_page_version_input where tenant_id=tenant and page_id=t->>'page_id' and page_version=(t->>'page_version')::integer;
 if v.reservation_id is null or i.reservation_id is null or v.reservation_id is distinct from t->>'reservation_id' or i.reservation_id<>v.reservation_id or i.input_sha256 is distinct from t->>'input_sha256' or v.metadata->>'receipt_sha256' is distinct from t->>'compile_receipt_sha256' or v.metadata->'receipt'->>'artifact_hash' is distinct from t->>'artifact_hash' then raise exception 'SELECTION_INELIGIBLE';end if;
 payload:=i.payload_json::jsonb;spec:=(payload->>'spec_json')::jsonb;ctx:=(public.door_input_context_text(payload->'context_parts',''))::jsonb;model:=(payload->>'model_provenance_json')::jsonb;
 if ctx->'validation'->>'mode'<>'live' or model->>'status'<>'recorded' or spec->'identity'->>'canonical_path'='/problems/ac-blowing-warm-air' or ctx->'validation'->'origin' is distinct from s->'origin' or spec->'release'->'index_policy' is distinct from s->'index_policy' or v.metadata->'receipt'->>'robots'<>(case when s->>'index_policy'='trial_noindex' then 'noindex,follow' else 'index,follow' end) or (s->>'index_policy'='public_indexable' and s->'release_policy'->'holds'->'trial_noindex'='true'::jsonb) then raise exception 'SELECTION_INELIGIBLE';end if;
 select value into family from jsonb_array_elements(s->'family_routes') where value->'family_id'=spec->'identity'->'family_id';if family is null then raise exception 'SELECTION_INELIGIBLE';end if;
 select coalesce(jsonb_agg(value order by public.door_version_json(value) collate "C"),'[]') into assignments from jsonb_array_elements(model->'assignments') where value->>'capability'='generate_page_copy';
 if jsonb_array_length(assignments)=0 or (select count(distinct value->>'run_id') from jsonb_array_elements(assignments))<>jsonb_array_length(assignments) then raise exception 'SELECTION_INELIGIBLE';end if;
 writer:=jsonb_build_object('assignments_sha256',public.door_version_hash(jsonb_build_object('format','door-writer-identity/1.0.0','assignments',assignments)),'models',(select jsonb_agg(m order by public.door_version_json(m) collate "C") from (select distinct jsonb_build_object('provider',value->>'provider','model_id',value->>'model_id') m from jsonb_array_elements(assignments)) q));
 subject:=jsonb_build_object('tenant_id',tenant,'page_id',t->>'page_id','page_version',(t->>'page_version')::integer,'reservation_id',t->>'reservation_id','input_sha256',t->>'input_sha256','artifact_hash',t->>'artifact_hash','compile_receipt_sha256',t->>'compile_receipt_sha256');
 select coalesce(jsonb_agg(receipt),'[]') into records from public.door_page_evidence where tenant_id=tenant and page_id=t->>'page_id';
 select receipt into ev from public.door_page_evidence where receipt_sha256=t->>'release_evaluation_sha256' and kind='release_evaluation';select receipt into ap from public.door_page_evidence where receipt_sha256=t->>'content_approval_sha256' and kind='content_approval';select receipt into act from public.door_page_evidence where receipt_sha256=t->>'publish_action_sha256' and kind='publish_action';
 for r in select value from jsonb_array_elements(jsonb_build_array(ev,ap,act)) loop
  if r is null or r='null'::jsonb or r->'subject' is distinct from subject or r->>'verdict'<>'PASS' or r->'findings'<>'[]'::jsonb or (r->>'finished_at')::timestamptz>checked_at or (r->>'expires_at')::timestamptz<=checked_at or r->'dependencies' is distinct from s->'release_policy'->'dependencies' or r->'environment' is distinct from s->'release_policy'->'environment'
   or not exists(select 1 from jsonb_array_elements(s->'release_policy'->'producers') p where (p-'kinds'-'check_ids')=((r->'producer')-'actor_id'-'run_id') and p->'kinds' ? (r->>'kind'))
   or exists(select 1 from jsonb_array_elements(records) rev where rev->>'kind'='revocation' and rev->'subject'=subject and rev->'output'->>'target_receipt_sha256'=r->>'receipt_sha256' and (rev->>'finished_at')::timestamptz<=checked_at and exists(select 1 from jsonb_array_elements(s->'release_policy'->'producers') p where (p-'kinds'-'check_ids')=((rev->'producer')-'actor_id'-'run_id') and p->'kinds' ? 'revocation')) then raise exception 'SELECTION_INELIGIBLE';end if;
 end loop;
 if ev->'output'->'eligible' is distinct from 'true'::jsonb or ev->'output'->>'content_approval_sha256' is distinct from ap->>'receipt_sha256' or ev->'output'->'assessment_sha256' is distinct from ap->'output'->'assessment_sha256' or ap->'output'->>'decision'<>'APPROVE' or ev->'output'->'fence' is distinct from s->'fence' or ev->'output'->'policy_sha256' is distinct from s->'policy_sha256' or act->'output'->>'release_evaluation_sha256' is distinct from ev->>'receipt_sha256' or act->'output'->>'content_approval_sha256' is distinct from ap->>'receipt_sha256' or act->'producer'->>'actor_kind'<>'human' or (act->>'started_at')::timestamptz<(ev->>'finished_at')::timestamptz then raise exception 'SELECTION_INELIGIBLE';end if;
 if c is not null and (act->'output'->'expected_selection_revision' is distinct from c->'expected_revision' or act->'output'->'operation_id' is distinct from c->'operation_id' or act->'output'->'action' is distinct from c->'action' or act->'output'->'reason' is distinct from c->'reason' or act->'producer'->'actor_id' is distinct from c->'actor') then raise exception 'SELECTION_INELIGIBLE';end if;
 if not public.evaluate_door_release_evidence(jsonb_build_object('phase','publish','subject',subject,'receipts',records,'active_receipt_hashes',ev->'output'->'evidence_hashes','writer',writer,'policy',s->'release_policy','fence',s->'fence','now',to_char(checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) then raise exception 'SELECTION_INELIGIBLE';end if;
 select min(least((value->>'expires_at')::timestamptz,(value->>'finished_at')::timestamptz+((s->'release_policy'->>'max_evidence_age_seconds')::integer*interval '1 second'))) into valid_until from jsonb_array_elements(records) where ev->'output'->'evidence_hashes' ? (value->>'receipt_sha256') or value->>'receipt_sha256' in (ev->>'receipt_sha256',ap->>'receipt_sha256',act->>'receipt_sha256');
 return t||jsonb_build_object('canonical_path',spec->'identity'->>'canonical_path','canonical_url',v.metadata->'receipt'->>'canonical_url','family_id',family->>'family_id','family_path',family->>'path','label',btrim(regexp_replace(public.door_selection_text(spec->'sections'->'hero'->'h1'),'\s+',' ','g')),'related_page_ids',spec->'related_page_ids','related_bindings','[]'::jsonb,'robots',v.metadata->'receipt'->>'robots','valid_until',to_char(valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'sitemap_eligible',s->>'index_policy'='public_indexable');
end $$;

revoke all on function public.door_selection_command_valid(jsonb,text[]),public.door_selection_fence_valid(jsonb),public.door_selection_guard_valid(jsonb),public.door_selection_closure(jsonb,jsonb),public.door_selection_append(jsonb,jsonb,jsonb,jsonb,text,text),public.door_selection_text(jsonb),public.door_selection_entry(jsonb,text,jsonb,timestamptz,jsonb),public.door_selection_bind(jsonb,jsonb,text),public.register_door_page_selection_guard(jsonb),public.commit_door_page_selection(jsonb),public.withdraw_door_page_selection(jsonb),public.read_door_page_serving_snapshot(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.register_door_page_selection_guard(jsonb),public.commit_door_page_selection(jsonb),public.withdraw_door_page_selection(jsonb),public.read_door_page_serving_snapshot(jsonb) to service_role;
