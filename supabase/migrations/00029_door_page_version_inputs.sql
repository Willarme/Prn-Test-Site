-- T6-31 immutable governed inputs. WRITTEN, NOT APPLIED. Candidate-only.
-- Application capture/read validates the full strict DTO + canonical DoorSpec schema.
-- SQL validates transport, identity, immutable hashes and registration closure. It
-- does not claim to execute JSON Schema/AJV or to attest actual model execution.
-- Full-context decimals/exponents remain canonical JSON TEXT, not JSONB reserialization.
create table public.door_page_version_input (
  tenant_id text not null, page_id text not null, page_version integer not null,
  reservation_id text primary key references public.door_page_version_reservation(reservation_id),
  payload_json text not null check(octet_length(payload_json)<=8388608),
  input_sha256 text not null, spec_sha256 text not null, context_sha256 text not null, schema_sha256 text not null,
  source_records_sha256 text not null, fact_records_sha256 text not null, asset_records_sha256 text not null,
  actor text not null, reason text not null, captured_at text not null,
  unique(tenant_id,page_id,page_version),
  foreign key(tenant_id,page_id,page_version) references public.door_page_version_reservation(tenant_id,page_id,page_version)
);
alter table public.door_page_version_input enable row level security;
revoke all on public.door_page_version_input from public,anon,authenticated,service_role;
grant select on public.door_page_version_input to service_role;

create function public.door_input_text_hash(p text) returns text language sql immutable strict set search_path=pg_catalog,public as $$ select encode(sha256(convert_to(p,'UTF8')),'hex') $$;
-- Each value is an already-canonical JSON string. Joining only fixed ASCII keys
-- keeps JS floating point spelling unchanged, including inside schema bundles.
create function public.door_input_context_text(parts jsonb, validation_override text default null) returns text language sql immutable strict set search_path=pg_catalog,public as $$
  select '{'||string_agg(to_jsonb(key)::text||':'||case when key='validation' and validation_override<>'' then validation_override else value#>>'{}' end,',' order by key collate "C")||'}' from jsonb_each(parts)
$$;

create function public.capture_door_page_version_input(p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.door_page_version_reservation; old public.door_page_version_input; row public.door_page_version_input;
  p jsonb; s jsonb; parts jsonb; ctx jsonb; v jsonb; a jsonb; m jsonb; x jsonb; k text; token text:='__DOOR_PAGE_INPUT_PROVENANCE_SHA256__'; base_context text; schema_array jsonb;
begin
  if not public.door_version_keys(p_input,array['tenant_id','page_id','page_version','reservation_id','payload_json','input_sha256','spec_sha256','context_sha256','schema_sha256','source_records_sha256','fact_records_sha256','asset_records_sha256','actor','reason','captured_at']) then raise exception 'DOOR_INPUT_INVALID'; end if;
  begin
    if jsonb_typeof(p_input->'payload_json')<>'string' or octet_length(p_input->>'payload_json')>8388608 then raise exception 'invalid'; end if;
    p:=(p_input->>'payload_json')::jsonb;
    if not public.door_version_keys(p,array['format','tenant_id','page_id','page_version','reservation_id','spec_json','context_parts','assignments_json','model_provenance_json','validation_template_json','schema_json']) then raise exception 'invalid'; end if;
    if p->>'format' is distinct from 'door-page-version-input/1.0.0' or p->'tenant_id' is distinct from p_input->'tenant_id' or p->'page_id' is distinct from p_input->'page_id' or p->'page_version' is distinct from p_input->'page_version' or p->'reservation_id' is distinct from p_input->'reservation_id' then raise exception 'invalid'; end if;
    foreach k in array array['tenant_id','page_id'] loop if jsonb_typeof(p_input->k)<>'string' or p_input->>k !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then raise exception 'invalid'; end if; end loop;
    foreach k in array array['reservation_id','input_sha256','spec_sha256','context_sha256','schema_sha256','source_records_sha256','fact_records_sha256','asset_records_sha256'] loop if jsonb_typeof(p_input->k)<>'string' or p_input->>k !~ '^[a-f0-9]{64}$' then raise exception 'invalid'; end if; end loop;
    foreach k in array array['actor','reason'] loop if jsonb_typeof(p_input->k)<>'string' or length(trim(p_input->>k))=0 or length(p_input->>k)>500 then raise exception 'invalid'; end if; end loop;
    if jsonb_typeof(p_input->'captured_at')<>'string' or p_input->>'captured_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then raise exception 'invalid'; end if;
    perform (p_input->>'captured_at')::timestamptz;
    if jsonb_typeof(p_input->'page_version')<>'number' or p_input->>'page_version' !~ '^[1-9][0-9]*$' or (p_input->>'page_version')::numeric>2147483646 then raise exception 'invalid'; end if;
    foreach k in array array['spec_json','assignments_json','model_provenance_json','validation_template_json','schema_json'] loop if jsonb_typeof(p->k)<>'string' then raise exception 'invalid'; end if; end loop;
    if public.door_version_json(p) is distinct from p_input->>'payload_json' or public.door_input_text_hash(p_input->>'payload_json') is distinct from p_input->>'input_sha256' then raise exception 'invalid'; end if;
    parts:=p->'context_parts';
    if not public.door_version_keys(parts,array['validation','site','disclosure_text','disclosure_text_sha256','source_records','fact_records','asset_records','visible_approvals','intent_review']) then raise exception 'invalid'; end if;
    for k,x in select * from jsonb_each(parts) loop if jsonb_typeof(x)<>'string' then raise exception 'invalid'; end if; perform (x#>>'{}')::jsonb; end loop;
    base_context:=public.door_input_context_text(parts,''); ctx:=base_context::jsonb; v:=ctx->'validation'; s:=(p->>'spec_json')::jsonb;
    if jsonb_typeof(s)<>'object' or not public.door_version_keys(v,array['schema_bundle','mode','tenant_id','content_baseline_id','versions','prompt_identities','origin','index_policy','approved_content_at','evaluated_at','disclosure','subjects','action_patterns','sources','claims','pages','families','eligibilities','capabilities','visual_assets','icon_ids','input_hashes']) then raise exception 'invalid'; end if;
    if jsonb_typeof(v->'input_hashes')<>'object' or exists(select 1 from jsonb_object_keys(v->'input_hashes') as t(key) where key=any(array['build_provenance_sha256','spec_sha256','schema_sha256','context_sha256','compiler_context_sha256','context_before_provenance_sha256','source_records_sha256','fact_records_sha256','asset_records_sha256','constants_sha256','actions_sha256','dom_sha256','order_sha256','wording_derivative_sha256','wording_rules_sha256'])) then raise exception 'invalid'; end if;
    if (v->>'mode' in ('fixture','live')) is not true or v->>'content_baseline_id' is distinct from 'ac-v43' or v->'tenant_id' is distinct from p_input->'tenant_id' then raise exception 'invalid'; end if;
    if (p->>'validation_template_json')::jsonb is distinct from jsonb_set(v,'{input_hashes,build_provenance_sha256}',to_jsonb(token),true)
      or (length(p->>'validation_template_json')-length(replace(p->>'validation_template_json',token,'')))/length(token)<>1 then raise exception 'invalid'; end if;
    if public.door_input_text_hash(p->>'spec_json') is distinct from p_input->>'spec_sha256' or public.door_input_text_hash(base_context) is distinct from p_input->>'context_sha256'
      or public.door_input_text_hash(parts->>'source_records') is distinct from p_input->>'source_records_sha256' or public.door_input_text_hash(parts->>'fact_records') is distinct from p_input->>'fact_records_sha256'
      or public.door_input_text_hash(parts->>'asset_records') is distinct from p_input->>'asset_records_sha256' or public.door_input_text_hash(p->>'schema_json') is distinct from p_input->>'schema_sha256' then raise exception 'invalid'; end if;
    select jsonb_agg(value order by value->>'$id' collate "C") into schema_array from jsonb_array_elements(v->'schema_bundle');
    if (p->>'schema_json')::jsonb is distinct from schema_array then raise exception 'invalid'; end if;
    a:=(p->>'assignments_json')::jsonb;
    if a is distinct from jsonb_build_object('content_baseline_id',v->'content_baseline_id','template_version',s->'versions'->'template','schema_version',s->'schema_version','theme_version',s->'versions'->'theme','taxonomy_version',s->'versions'->'taxonomy','source_bundle_version',s->'versions'->'source_bundle','prompt_identities',s->'versions'->'prompt_identities') then raise exception 'invalid'; end if;
    if v->'versions' is distinct from jsonb_build_object('template',a->'template_version','schema',a->'schema_version','theme',a->'theme_version','taxonomy',a->'taxonomy_version','source_bundle',a->'source_bundle_version') then raise exception 'invalid'; end if;
    m:=(p->>'model_provenance_json')::jsonb;
    if m->>'status'='not_recorded' then if not public.door_version_keys(m,array['status']) then raise exception 'invalid'; end if;
    elsif m->>'status'='fixture_no_model_calls' then if not public.door_version_keys(m,array['status','fixture_id']) or v->>'mode'<>'fixture' or jsonb_typeof(m->'fixture_id')<>'string' or m->>'fixture_id' !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,149}$' then raise exception 'invalid'; end if;
    elsif m->>'status'='recorded' then
      if not public.door_version_keys(m,array['status','assignments']) or jsonb_typeof(m->'assignments')<>'array' or jsonb_array_length(m->'assignments') not between 1 and 100 then raise exception 'invalid'; end if;
      for x in select value from jsonb_array_elements(m->'assignments') loop
        if not public.door_version_keys(x,array['capability','provider','model_id','catalogue_policy_version','run_id','record_sha256']) then raise exception 'invalid'; end if;
        foreach k in array array['capability','provider','model_id','catalogue_policy_version','run_id','record_sha256'] loop if jsonb_typeof(x->k)<>'string' or length(x->>k) not between 1 and 500 then raise exception 'invalid'; end if; end loop;
        if x->>'run_id' !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,149}$' or x->>'record_sha256' !~ '^[a-f0-9]{64}$' then raise exception 'invalid'; end if;
      end loop;
      if (select count(distinct (value->>'capability',value->>'run_id')) from jsonb_array_elements(m->'assignments'))<>jsonb_array_length(m->'assignments') then raise exception 'invalid'; end if;
    else raise exception 'invalid'; end if;
  exception when others then raise exception 'DOOR_INPUT_INVALID'; end;
  -- SAME lock as00028 registration: capture must win before first registration.
  perform pg_advisory_xact_lock(28,hashtext(p_input->>'tenant_id'));
  select * into r from public.door_page_version_reservation where reservation_id=p_input->>'reservation_id' and tenant_id=p_input->>'tenant_id' and page_id=p_input->>'page_id';
  if not found or r.page_version is distinct from (p_input->>'page_version')::integer or s->'identity'->>'tenant_id' is distinct from r.tenant_id or s->'identity'->>'page_id' is distinct from r.page_id
    or (s->'identity'->>'page_version')::integer is distinct from r.page_version or s->'identity'->>'canonical_intent_id' is distinct from r.canonical_intent_id
    or s->'identity'->>'canonical_path' is distinct from r.canonical_path or (v->>'origin')||r.canonical_path is distinct from r.canonical_url then raise exception 'DOOR_INPUT_CONFLICT'; end if;
  select * into old from public.door_page_version_input where reservation_id=r.reservation_id;
  if found then if to_jsonb(old)<>p_input then raise exception 'DOOR_INPUT_CONFLICT'; end if; return to_jsonb(old); end if;
  if exists(select 1 from public.door_page_version where reservation_id=r.reservation_id) then raise exception 'DOOR_INPUT_CONFLICT'; end if;
  insert into public.door_page_version_input select * from jsonb_populate_record(null::public.door_page_version_input,p_input) returning * into row;
  insert into public.admin_audit(at,action,target,detail) values((row.captured_at)::timestamptz,'door_page_input_captured',row.page_id,jsonb_build_object('tenant_id',row.tenant_id,'reservation_id',row.reservation_id,'input_sha256',row.input_sha256,'actor',row.actor,'reason',row.reason)::text);
  return to_jsonb(row);
end $$;

create function public.door_page_input_registration_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare i public.door_page_version_input; p jsonb; r jsonb; h jsonb; parts jsonb; context_text text; proof text; template text; validation_context jsonb; k text; x jsonb;
begin
  select * into i from public.door_page_version_input where reservation_id=new.reservation_id;
  if not found then return new; end if; -- historical metadata-only candidates stay readable; managed orchestration requires input.
  p:=i.payload_json::jsonb; parts:=p->'context_parts'; r:=new.metadata->'receipt'; h:=r->'input_hashes'; proof:=h->>'build_provenance_sha256';
  if proof is null then context_text:=public.door_input_context_text(parts,'');
  else
    if proof !~ '^[a-f0-9]{64}$' or h->>'context_before_provenance_sha256' is distinct from i.context_sha256 or h->>'source_records_sha256' is distinct from i.source_records_sha256
      or h->>'fact_records_sha256' is distinct from i.fact_records_sha256 or h->>'asset_records_sha256' is distinct from i.asset_records_sha256 then raise exception 'DOOR_VERSION_CONFLICT input receipt mismatch'; end if;
    template:=replace(p->>'validation_template_json','__DOOR_PAGE_INPUT_PROVENANCE_SHA256__',proof);
    context_text:=public.door_input_context_text(parts,template);
  end if;
  if new.tenant_id<>i.tenant_id or new.page_id<>i.page_id or new.page_version<>i.page_version or h->>'spec_sha256' is distinct from i.spec_sha256
    or h->>'schema_sha256' is distinct from i.schema_sha256 or h->>'compiler_context_sha256' is distinct from public.door_input_text_hash(context_text)
    then raise exception 'DOOR_VERSION_CONFLICT input receipt mismatch'; end if;
  -- The schema bundle is the only arbitrary numeric JSON namespace. Excluding
  -- it leaves a strict DTO of strings/booleans/bounded integer dimensions.
  validation_context:=(context_text::jsonb->'validation')-'schema_bundle';
  if h->>'context_sha256' is distinct from public.door_version_hash(validation_context||jsonb_build_object('schema_sha256',i.schema_sha256)) then raise exception 'DOOR_VERSION_CONFLICT input receipt mismatch'; end if;
  for k,x in select * from jsonb_each((parts->>'validation')::jsonb->'input_hashes') loop
    if h->k is distinct from x then raise exception 'DOOR_VERSION_CONFLICT input receipt mismatch'; end if;
  end loop;
  return new;
end $$;
create trigger door_page_input_registration_closure before insert on public.door_page_version for each row execute function public.door_page_input_registration_guard();
create trigger door_page_input_immutable before update or delete on public.door_page_version_input for each row execute function public.door_version_immutable();
revoke all on function public.door_input_text_hash(text),public.door_input_context_text(jsonb,text),public.capture_door_page_version_input(jsonb),public.door_page_input_registration_guard() from public,anon,authenticated,service_role;
grant execute on function public.capture_door_page_version_input(jsonb) to service_role;
