-- T6-31 candidate catalogue only. WRITTEN, NOT APPLIED. No public selector or QA grant.
create table public.door_page_identity (
  tenant_id text not null, page_id text not null, canonical_intent_id text not null,
  canonical_url text not null, canonical_path text not null,
  latest_version integer not null check(latest_version between 1 and 2147483646),
  primary key(tenant_id,page_id), unique(tenant_id,canonical_path), unique(tenant_id,canonical_intent_id)
);
create table public.door_page_version_reservation (
  reservation_id text primary key, tenant_id text not null, page_id text not null,
  canonical_intent_id text not null, canonical_url text not null, canonical_path text not null,
  page_version integer not null check(page_version between 1 and 2147483646), operation_id text not null,
  expected_latest_version integer not null check(expected_latest_version=page_version-1),
  actor text not null, reason text not null, reserved_at text not null,
  unique(tenant_id,page_id,operation_id), unique(tenant_id,page_id,page_version),
  foreign key(tenant_id,page_id) references public.door_page_identity(tenant_id,page_id)
);
create table public.door_page_version (
  tenant_id text not null, page_id text not null, page_version integer not null,
  reservation_id text not null unique references public.door_page_version_reservation(reservation_id),
  metadata jsonb not null, actor text not null, reason text not null, registered_at text not null,
  primary key(tenant_id,page_id,page_version),
  foreign key(tenant_id,page_id,page_version) references public.door_page_version_reservation(tenant_id,page_id,page_version)
);
alter table public.door_page_identity enable row level security;
alter table public.door_page_version_reservation enable row level security;
alter table public.door_page_version enable row level security;
revoke all on public.door_page_identity,public.door_page_version_reservation,public.door_page_version from public,anon,authenticated,service_role;
grant select on public.door_page_identity,public.door_page_version_reservation,public.door_page_version to service_role;

-- Canonical receipt hashing matches the application's sorted-key JSON serializer.
-- Receipt numbers are bounded integers; no floating-point normalization is involved.
create function public.door_version_json(p jsonb) returns text language sql immutable strict set search_path=pg_catalog,public as $$
  select case jsonb_typeof(p)
    when 'object' then '{'||coalesce((select string_agg(to_jsonb(key)::text||':'||public.door_version_json(value),',' order by key collate "C") from jsonb_each(p)),'')||'}'
    when 'array' then '['||coalesce((select string_agg(public.door_version_json(value),',' order by ord) from jsonb_array_elements(p) with ordinality a(value,ord)),'')||']'
    else p::text end
$$;
create function public.door_version_hash(p jsonb) returns text language sql immutable strict set search_path=pg_catalog,public as $$
  select encode(sha256(convert_to(public.door_version_json(p),'UTF8')),'hex')
$$;
create function public.door_version_keys(p jsonb, keys text[]) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
begin
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  return p ?& keys and (select count(*) from jsonb_object_keys(p))=cardinality(keys);
end
$$;
create function public.door_version_metadata_valid(m jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare r jsonb; v jsonb; k text; h text;
begin
  if not public.door_version_keys(m,array['receipt','receipt_sha256','provenance_status','build_provenance_sha256']) then return false; end if;
  r:=m->'receipt';
  if not public.door_version_keys(r,array['receipt_id','compiler_version','content_baseline_id','tenant_id','page_id','page_version','canonical_intent_id','input_hashes','html_hash','semantic_hash','artifact_hash','canonical_url','robots','date_modified','visible_components','source_ids','claim_ids','section_order','derived_counts','rendered_capability_ids','constants','mode','release_ready','pending_checks','wording_findings']) then return false; end if;
  if r->>'compiler_version' <> 'door-v44-compiler/1.0.0' or r->>'content_baseline_id'<>'ac-v43' or r->'release_ready'<>'false'::jsonb or r->>'mode' not in ('fixture','live') or r->>'robots' not in ('noindex,nofollow','noindex,follow','index,follow') then return false; end if;
  foreach k in array array['receipt_id','compiler_version','content_baseline_id','tenant_id','page_id','canonical_intent_id','canonical_url','robots','mode'] loop if jsonb_typeof(r->k)<>'string' then return false; end if; end loop;
  foreach k in array array['tenant_id','page_id','canonical_intent_id'] loop if r->>k !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then return false; end if; end loop;
  if jsonb_typeof(r->'page_version')<>'number' or r->>'page_version' !~ '^[1-9][0-9]*$' or (r->>'page_version')::numeric>2147483646 then return false; end if;
  if r->'date_modified'<>'null'::jsonb then if jsonb_typeof(r->'date_modified')<>'string' or r->>'date_modified' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then return false; end if; perform (r->>'date_modified')::timestamptz; end if;
  foreach k in array array['html_hash','semantic_hash','artifact_hash'] loop if jsonb_typeof(r->k)<>'string' or r->>k !~ '^[a-f0-9]{64}$' then return false; end if; end loop;
  if jsonb_typeof(r->'input_hashes')<>'object' or jsonb_typeof(r->'derived_counts')<>'object' then return false; end if;
  for k,v in select * from jsonb_each(r->'input_hashes') loop if k in ('__proto__','prototype','constructor') or jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^[a-f0-9]{64}$' then return false; end if; end loop;
  for k,v in select * from jsonb_each(r->'derived_counts') loop if k in ('__proto__','prototype','constructor') or jsonb_typeof(v)<>'number' or v::text !~ '^[0-9]+$' or v::text::numeric>2147483646 then return false; end if; end loop;
  foreach k in array array['source_ids','claim_ids','section_order','rendered_capability_ids','pending_checks'] loop
    if jsonb_typeof(r->k)<>'array' then return false; end if;
    for v in select value from jsonb_array_elements(r->k) loop if jsonb_typeof(v)<>'string' then return false; end if; end loop;
  end loop;
  foreach k in array array['visible_components','constants','wording_findings'] loop if jsonb_typeof(r->k)<>'array' then return false; end if; end loop;
  for v in select value from jsonb_array_elements(r->'visible_components') loop
    if not public.door_version_keys(v,array['component_id','content_hash']) or jsonb_typeof(v->'component_id')<>'string' or jsonb_typeof(v->'content_hash')<>'string' or v->>'content_hash' !~ '^[a-f0-9]{64}$' then return false; end if;
  end loop;
  for v in select value from jsonb_array_elements(r->'constants') loop
    if not public.door_version_keys(v,array['key','value']) or jsonb_typeof(v->'key')<>'string' or jsonb_typeof(v->'value')<>'string' then return false; end if;
  end loop;
  for v in select value from jsonb_array_elements(r->'wording_findings') loop
    if not public.door_version_keys(v,array['code','pointer','severity']) or jsonb_typeof(v->'code')<>'string' or jsonb_typeof(v->'pointer')<>'string' or jsonb_typeof(v->'severity')<>'string' or v->>'severity' not in ('blocker','review') then return false; end if;
  end loop;
  h:=public.door_version_hash(r);
  if m->>'receipt_sha256' is distinct from h then return false; end if;
  if m->>'provenance_status'='unattested' then return m->'build_provenance_sha256'='null'::jsonb and not (r->'input_hashes' ? 'build_provenance_sha256'); end if;
  return m->>'provenance_status'='observed_local' and jsonb_typeof(m->'build_provenance_sha256')='string' and m->>'build_provenance_sha256' ~ '^[a-f0-9]{64}$' and m->>'build_provenance_sha256'=r->'input_hashes'->>'build_provenance_sha256';
exception when others then return false;
end $$;

create function public.reserve_door_page_version(p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare i public.door_page_identity; old public.door_page_version_reservation; row public.door_page_version_reservation; k text; path text; rid text; expected integer; port text;
begin
  if not public.door_version_keys(p_input,array['tenant_id','page_id','canonical_intent_id','canonical_url','operation_id','expected_latest_version','actor','reason','at']) then raise exception 'DOOR_VERSION_INVALID'; end if;
  foreach k in array array['tenant_id','page_id','canonical_intent_id','operation_id'] loop if jsonb_typeof(p_input->k)<>'string' or p_input->>k !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then raise exception 'DOOR_VERSION_INVALID'; end if; end loop;
  foreach k in array array['actor','reason'] loop if jsonb_typeof(p_input->k)<>'string' or length(trim(p_input->>k))=0 or length(p_input->>k)>500 then raise exception 'DOOR_VERSION_INVALID'; end if; end loop;
  if jsonb_typeof(p_input->'at')<>'string' or p_input->>'at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then raise exception 'DOOR_VERSION_INVALID'; end if;
  begin perform (p_input->>'at')::timestamptz; exception when others then raise exception 'DOOR_VERSION_INVALID'; end;
  if jsonb_typeof(p_input->'canonical_url')<>'string' or length(p_input->>'canonical_url')>2048 or p_input->>'canonical_url' !~ '^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[1-9][0-9]{0,4})?/problems/[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'DOOR_VERSION_INVALID'; end if;
  port:=substring(p_input->>'canonical_url' from ':([0-9]+)/');
  if port is not null and (port::integer>65535 or (p_input->>'canonical_url' like 'https:%' and port='443') or (p_input->>'canonical_url' like 'http:%' and port='80')) then raise exception 'DOOR_VERSION_INVALID'; end if;
  path:=substring(p_input->>'canonical_url' from '/problems/.*$');
  if jsonb_typeof(p_input->'expected_latest_version')<>'number' or p_input->>'expected_latest_version' !~ '^[0-9]+$' or (p_input->>'expected_latest_version')::numeric>2147483645 then raise exception 'DOOR_VERSION_INVALID'; end if;
  expected:=(p_input->>'expected_latest_version')::integer;
  rid:=public.door_version_hash(jsonb_build_object('tenant_id',p_input->>'tenant_id','page_id',p_input->>'page_id','operation_id',p_input->>'operation_id'));
  perform pg_advisory_xact_lock(28,hashtext(p_input->>'tenant_id'));
  select * into old from public.door_page_version_reservation where reservation_id=rid;
  if found then
    if to_jsonb(old) - array['reservation_id','canonical_path','page_version','reserved_at'] || jsonb_build_object('at',old.reserved_at) <> p_input then raise exception 'DOOR_VERSION_CONFLICT'; end if;
    return to_jsonb(old);
  end if;
  select * into i from public.door_page_identity where tenant_id=p_input->>'tenant_id' and page_id=p_input->>'page_id' for update;
  if found then
    if i.latest_version<>expected or i.canonical_url<>p_input->>'canonical_url' or i.canonical_intent_id<>p_input->>'canonical_intent_id' then raise exception 'DOOR_VERSION_CONFLICT'; end if;
    update public.door_page_identity set latest_version=expected+1 where tenant_id=i.tenant_id and page_id=i.page_id;
  else
    if expected<>0 or exists(select 1 from public.door_page_identity where tenant_id=p_input->>'tenant_id' and (canonical_path=path or canonical_intent_id=p_input->>'canonical_intent_id')) then raise exception 'DOOR_VERSION_CONFLICT'; end if;
    insert into public.door_page_identity values(p_input->>'tenant_id',p_input->>'page_id',p_input->>'canonical_intent_id',p_input->>'canonical_url',path,1);
  end if;
  insert into public.door_page_version_reservation values(rid,p_input->>'tenant_id',p_input->>'page_id',p_input->>'canonical_intent_id',p_input->>'canonical_url',path,expected+1,p_input->>'operation_id',expected,p_input->>'actor',p_input->>'reason',p_input->>'at') returning * into row;
  insert into public.admin_audit(at,action,target,detail) values((p_input->>'at')::timestamptz,'door_page_version_reserved',row.page_id,to_jsonb(row)::text);
  return to_jsonb(row);
end $$;

create function public.register_door_page_version(p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.door_page_version_reservation; old public.door_page_version; row public.door_page_version; p jsonb; k text;
begin
  if not public.door_version_keys(p_input,array['tenant_id','page_id','reservation_id','metadata','actor','reason','at']) or public.door_version_metadata_valid(p_input->'metadata') is not true then raise exception 'DOOR_VERSION_INVALID'; end if;
  foreach k in array array['tenant_id','page_id'] loop if jsonb_typeof(p_input->k)<>'string' or p_input->>k !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then raise exception 'DOOR_VERSION_INVALID'; end if; end loop;
  foreach k in array array['actor','reason'] loop if jsonb_typeof(p_input->k)<>'string' or length(trim(p_input->>k))=0 or length(p_input->>k)>500 then raise exception 'DOOR_VERSION_INVALID'; end if; end loop;
  if jsonb_typeof(p_input->'reservation_id')<>'string' or p_input->>'reservation_id' !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_input->'at')<>'string' or p_input->>'at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then raise exception 'DOOR_VERSION_INVALID'; end if;
  begin perform (p_input->>'at')::timestamptz; exception when others then raise exception 'DOOR_VERSION_INVALID'; end;
  perform pg_advisory_xact_lock(28,hashtext(p_input->>'tenant_id'));
  select * into r from public.door_page_version_reservation where reservation_id=p_input->>'reservation_id' and tenant_id=p_input->>'tenant_id' and page_id=p_input->>'page_id';
  p:=p_input->'metadata'->'receipt';
  if not found or p->>'tenant_id'<>r.tenant_id or p->>'page_id'<>r.page_id or (p->>'page_version')::integer<>r.page_version or p->>'canonical_intent_id'<>r.canonical_intent_id or p->>'canonical_url'<>r.canonical_url then raise exception 'DOOR_VERSION_CONFLICT'; end if;
  select * into old from public.door_page_version where reservation_id=r.reservation_id;
  if found then
    if to_jsonb(old)-array['page_version','registered_at'] || jsonb_build_object('at',old.registered_at) <> p_input then raise exception 'DOOR_VERSION_CONFLICT'; end if;
    return to_jsonb(old);
  end if;
  insert into public.door_page_version values(r.tenant_id,r.page_id,r.page_version,r.reservation_id,p_input->'metadata',p_input->>'actor',p_input->>'reason',p_input->>'at') returning * into row;
  insert into public.admin_audit(at,action,target,detail) values((p_input->>'at')::timestamptz,'door_page_version_registered',row.page_id,to_jsonb(row)::text);
  return to_jsonb(row);
end $$;

-- Immutable rows remain protected even from accidental elevated direct SQL.
create function public.door_version_immutable() returns trigger language plpgsql set search_path=pg_catalog,public as $$ begin raise exception 'DOOR_VERSION_CONFLICT immutable row'; end $$;
create trigger door_version_reservation_immutable before update or delete on public.door_page_version_reservation for each row execute function public.door_version_immutable();
create trigger door_version_metadata_immutable before update or delete on public.door_page_version for each row execute function public.door_version_immutable();
create function public.door_version_identity_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='DELETE' then raise exception 'DOOR_VERSION_CONFLICT immutable identity'; end if;
  if to_jsonb(new)-'latest_version' <> to_jsonb(old)-'latest_version' or new.latest_version<>old.latest_version+1 then raise exception 'DOOR_VERSION_CONFLICT immutable identity'; end if;
  return new;
end $$;
create trigger door_version_identity_immutable before update or delete on public.door_page_identity for each row execute function public.door_version_identity_guard();
revoke all on function public.door_version_json(jsonb), public.door_version_hash(jsonb), public.door_version_keys(jsonb,text[]), public.door_version_metadata_valid(jsonb), public.door_version_immutable(), public.door_version_identity_guard(), public.reserve_door_page_version(jsonb),public.register_door_page_version(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.reserve_door_page_version(jsonb),public.register_door_page_version(jsonb) to service_role;
