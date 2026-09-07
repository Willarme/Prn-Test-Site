-- T6: shared extraction admission and immutable completion. Written, not applied.
-- Only authenticated server reader code can mutate through these service-only
-- RPCs. Customer reads are request scoped. No raw photo or OCR transcript column.
create function public.label_extraction_valid_record(p_record jsonb, p_request_id text, p_tenant_id text, p_evidence_id text)
returns boolean language plpgsql immutable set search_path = pg_catalog, public as $$
declare
  v_printed jsonb; v_field jsonb; v_box jsonb; v_gap jsonb; v_key text;
  v_keys text[] := array['thermostat_mode','fan_mode','setpoint','room_temperature','filter_nominal_dimensions'];
  v_any boolean := false;
  v_confidence jsonb := '{}'::jsonb;
  v_answer_key text;
  v_status text;
begin
  if jsonb_typeof(p_record) is distinct from 'object' or octet_length(p_record::text) > 32768
    or p_record - array['request_id','tenant_id','evidence_id','read_at','run_id','confidence','extraction_status','reason','printed_evidence','target'] <> '{}'::jsonb
    or not (p_record ?& array['request_id','tenant_id','evidence_id','read_at','run_id','confidence','extraction_status'])
    or coalesce(p_request_id,'') !~ '^[a-zA-Z0-9_-]{1,128}$'
    or coalesce(p_tenant_id,'') !~ '^[a-zA-Z0-9_-]{1,128}$'
    or coalesce(p_evidence_id,'') !~ '^[a-zA-Z0-9_-]{1,128}$'
    or jsonb_typeof(p_record->'request_id') is distinct from 'string'
    or jsonb_typeof(p_record->'tenant_id') is distinct from 'string'
    or jsonb_typeof(p_record->'evidence_id') is distinct from 'string'
    or p_record->>'request_id' is distinct from p_request_id
    or p_record->>'tenant_id' is distinct from p_tenant_id
    or p_record->>'evidence_id' is distinct from p_evidence_id
    or jsonb_typeof(p_record->'read_at') is distinct from 'string'
    or coalesce(p_record->>'read_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
    or jsonb_typeof(p_record->'run_id') not in ('null','string')
    or (p_record->'run_id' <> 'null'::jsonb and length(p_record->>'run_id') not between 1 and 160)
    or coalesce(p_record->>'extraction_status','') not in ('readable','unreadable','failed')
    or jsonb_typeof(p_record->'confidence') is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_record->'confidence')) > 32
    or (p_record ? 'reason' and (jsonb_typeof(p_record->'reason') <> 'string' or length(p_record->>'reason') > 500))
    or (p_record ? 'target' and (jsonb_typeof(p_record->'target') <> 'string' or coalesce(p_record->>'target','') !~ '^[a-zA-Z0-9_:-]{1,80}$')) then return false;
  end if;
  perform (p_record->>'read_at')::timestamptz;
  if exists (select 1 from jsonb_each(p_record->'confidence') v where key !~ '^[a-zA-Z0-9_]{1,80}$'
    or value not in ('"high"'::jsonb,'"medium"'::jsonb,'"low"'::jsonb)) then return false; end if;
  if p_record->>'extraction_status' <> 'readable' and p_record->'confidence' <> '{}'::jsonb then return false; end if;
  if not (p_record ? 'printed_evidence') then return true; end if;
  v_printed := p_record->'printed_evidence';
  if coalesce(p_record->>'target','') not in ('thermostat_photo','step:filter')
    or jsonb_typeof(v_printed) is distinct from 'object'
    or v_printed - array['reader_version','outcome','evidence_id','image_sha256','fields','gaps'] <> '{}'::jsonb
    or not (v_printed ?& array['reader_version','outcome','evidence_id','image_sha256','fields','gaps'])
    or v_printed->>'reader_version' is distinct from 'printed-evidence-v1/tesseract.js@7.0.0/eng@1.0.0/45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91'
    or v_printed->>'evidence_id' is distinct from p_evidence_id
    or coalesce(v_printed->>'outcome','') not in ('readable','unreadable','unavailable')
    or (v_printed->'image_sha256' <> 'null'::jsonb and (jsonb_typeof(v_printed->'image_sha256') <> 'string' or v_printed->>'image_sha256' !~ '^[a-f0-9]{64}$'))
    or jsonb_typeof(v_printed->'fields') is distinct from 'object'
    or (v_printed->'fields') - v_keys <> '{}'::jsonb or not (v_printed->'fields' ?& v_keys)
    or jsonb_typeof(v_printed->'gaps') is distinct from 'array' or jsonb_array_length(v_printed->'gaps') > 5 then return false;
  end if;
  for v_gap in select value from jsonb_array_elements(v_printed->'gaps') loop
    if jsonb_typeof(v_gap) <> 'object' or v_gap - array['field','reason'] <> '{}'::jsonb
      or not (v_gap ?& array['field','reason']) or not (coalesce(v_gap->>'field','') = any(v_keys))
      or coalesce(v_gap->>'reason','') not in ('not_legible','ambiguous','reader_unavailable') then return false; end if;
  end loop;
  foreach v_key in array v_keys loop
    v_field := v_printed->'fields'->v_key;
    if v_field = 'null'::jsonb then
      if (select count(*) from jsonb_array_elements(v_printed->'gaps') g where g->>'field' = v_key) <> 1 then return false; end if;
      continue;
    end if;
    v_any := true;
    if exists (select 1 from jsonb_array_elements(v_printed->'gaps') g where g->>'field' = v_key)
      or v_printed->'image_sha256' = 'null'::jsonb
      or jsonb_typeof(v_field) <> 'object'
      or v_field - array['value','unit','confidence','basis','source_media','prepared_image'] <> '{}'::jsonb
      or not (v_field ?& array['value','unit','confidence','basis','source_media','prepared_image'])
      or jsonb_typeof(v_field->'value') <> 'string' or length(v_field->>'value') not between 1 and 80
      or v_field->'unit' not in ('null'::jsonb,'"F"'::jsonb,'"C"'::jsonb,'"in"'::jsonb)
      or v_field->>'basis' is distinct from 'ocr_transcription'
      or jsonb_typeof(v_field->'confidence') <> 'number' or (v_field->>'confidence')::numeric not between 0.85 and 1
      or v_field->'source_media' <> jsonb_build_array(p_evidence_id)
      or jsonb_typeof(v_field->'prepared_image') <> 'object'
      or (v_field->'prepared_image') - array['width','height','bbox'] <> '{}'::jsonb
      or not (v_field->'prepared_image' ?& array['width','height','bbox']) then return false; end if;
    v_box := v_field->'prepared_image'->'bbox';
    if jsonb_typeof(v_box) <> 'object' or v_box - array['x0','y0','x1','y1'] <> '{}'::jsonb
      or not (v_box ?& array['x0','y0','x1','y1']) then return false; end if;
    if exists (select 1 from jsonb_each((v_field->'prepared_image') - 'bbox') v
      where jsonb_typeof(value) <> 'number' or (value #>> '{}')::numeric <> trunc((value #>> '{}')::numeric)
        or (value #>> '{}')::numeric not between 1 and 1800)
      or exists (select 1 from jsonb_each(v_box) v where jsonb_typeof(value) <> 'number'
        or (value #>> '{}')::numeric <> trunc((value #>> '{}')::numeric) or (value #>> '{}')::numeric < 0)
      or (v_box->>'x0')::numeric >= (v_box->>'x1')::numeric or (v_box->>'y0')::numeric >= (v_box->>'y1')::numeric
      or (v_box->>'x1')::numeric > (v_field->'prepared_image'->>'width')::numeric
      or (v_box->>'y1')::numeric > (v_field->'prepared_image'->>'height')::numeric then return false; end if;
    if (p_record->>'target' = 'thermostat_photo' and v_key <> 'filter_nominal_dimensions')
      or (p_record->>'target' = 'step:filter' and v_key = 'filter_nominal_dimensions') then
      v_answer_key := case v_key when 'setpoint' then 'thermostat_setpoint' when 'room_temperature' then 'room_temp' else v_key end;
      v_confidence := v_confidence || jsonb_build_object(v_answer_key,'medium');
    end if;
  end loop;
  v_status := case when v_confidence <> '{}'::jsonb then 'readable'
    when v_printed->>'outcome' = 'unavailable' then 'failed' else 'unreadable' end;
  if v_status = 'readable' and p_record->>'target' = 'thermostat_photo' then
    v_confidence := v_confidence || '{"thermostat_photo":"medium"}'::jsonb;
  end if;
  return ((v_printed->>'outcome' = 'readable') = v_any)
    and p_record->>'extraction_status' = v_status and p_record->'confidence' = v_confidence;
exception when others then return false;
end;
$$;
revoke all privileges on function public.label_extraction_valid_record(jsonb,text,text,text) from public, anon, authenticated, service_role;

create table public.label_extraction_completion (
  evidence_id text primary key references public.evidence_object(evidence_id),
  request_id text not null references public.intake_session(request_id),
  tenant_id text not null,
  problem_id text not null references public.problem_record(problem_id),
  reserved_at timestamptz not null default now(),
  read_at timestamptz,
  record jsonb,
  constraint label_extraction_record_shape check (
    (record is null and read_at is null) or
    (record is not null and read_at is not null and public.label_extraction_valid_record(record,request_id,tenant_id,evidence_id) is true
      and read_at = (record->>'read_at')::timestamptz)
  )
);
create index label_extraction_request on public.label_extraction_completion(request_id,tenant_id,read_at);
alter table public.label_extraction_completion enable row level security;
revoke all privileges on public.label_extraction_completion from public, anon, authenticated, service_role;
grant select on public.label_extraction_completion to authenticated, service_role;
create policy label_extraction_read_own on public.label_extraction_completion for select to authenticated using (
  request_id = (select auth.jwt()->>'request_id') and exists (
    select 1 from public.intake_session s
    join public.problem_record p on p.intake_session_id = s.intake_session_id
    join public.evidence_object e on e.request_id = s.request_id
    where s.request_id = label_extraction_completion.request_id and p.request_id = s.request_id
      and p.problem_id = label_extraction_completion.problem_id and p.tenant_id = label_extraction_completion.tenant_id
      and e.evidence_id = label_extraction_completion.evidence_id and e.tenant_id = p.tenant_id and e.kind = 'photo'
  )
);

-- Lock the existing request before first insert. The same captured evidence
-- cannot admit two reader attempts across processes or concurrent functions.
create function public.reserve_label_extraction(p_request_id text, p_tenant_id text, p_evidence_id text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_problem_id text; v_rows integer;
begin
  select p.problem_id into strict v_problem_id from public.intake_session s
    join public.problem_record p on p.intake_session_id = s.intake_session_id
    join public.evidence_object e on e.request_id = s.request_id
    where s.request_id = p_request_id and p.request_id = p_request_id and p.tenant_id = p_tenant_id
      and e.evidence_id = p_evidence_id and e.tenant_id = p_tenant_id and e.kind = 'photo' for update of s;
  insert into public.label_extraction_completion(evidence_id,request_id,tenant_id,problem_id)
    values(p_evidence_id,p_request_id,p_tenant_id,v_problem_id) on conflict (evidence_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
exception when no_data_found or too_many_rows then
  raise exception 'Extraction evidence ownership mismatch' using errcode = '28000';
end;
$$;
revoke all privileges on function public.reserve_label_extraction(text,text,text) from public, anon, authenticated;
grant execute on function public.reserve_label_extraction(text,text,text) to service_role;

create function public.complete_label_extraction(p_request_id text, p_tenant_id text, p_evidence_id text, p_record jsonb)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_problem_id text; v_previous jsonb;
begin
  if public.label_extraction_valid_record(p_record,p_request_id,p_tenant_id,p_evidence_id) is not true then
    raise exception 'Invalid extraction completion' using errcode = '22023'; end if;
  select p.problem_id into strict v_problem_id from public.intake_session s
    join public.problem_record p on p.intake_session_id = s.intake_session_id
    join public.evidence_object e on e.request_id = s.request_id
    where s.request_id = p_request_id and p.request_id = p_request_id and p.tenant_id = p_tenant_id
      and e.evidence_id = p_evidence_id and e.tenant_id = p_tenant_id and e.kind = 'photo' for update of s;
  -- An unavailable/absent reader also records a completed gap, even when no
  -- execution was reserved. This consumes admission for the same evidence.
  insert into public.label_extraction_completion(evidence_id,request_id,tenant_id,problem_id)
    values(p_evidence_id,p_request_id,p_tenant_id,v_problem_id) on conflict (evidence_id) do nothing;
  select record into v_previous from public.label_extraction_completion
    where evidence_id = p_evidence_id and request_id = p_request_id and tenant_id = p_tenant_id and problem_id = v_problem_id for update;
  if not found then raise exception 'Extraction completion ownership mismatch' using errcode = '28000'; end if;
  if v_previous is not null then
    if v_previous <> p_record then raise exception 'Extraction completion is immutable' using errcode = '22023'; end if;
    return true;
  end if;
  update public.label_extraction_completion set record = p_record, read_at = (p_record->>'read_at')::timestamptz
    where evidence_id = p_evidence_id;
  return true;
exception when no_data_found or too_many_rows then
  raise exception 'Extraction evidence ownership mismatch' using errcode = '28000';
end;
$$;
revoke all privileges on function public.complete_label_extraction(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.complete_label_extraction(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
