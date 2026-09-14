-- Immutable, service-issued evidence. A digest proves identity, not executor
-- authority: the release evaluator additionally checks current producer policy.
create table public.door_page_evidence (
  receipt_sha256 text primary key check (receipt_sha256 ~ '^[a-f0-9]{64}$'),
  tenant_id text not null, page_id text not null, page_version integer not null,
  kind text not null, artifact_hash text not null, input_sha256 text not null,
  receipt jsonb not null,
  foreign key(tenant_id,page_id,page_version) references public.door_page_version(tenant_id,page_id,page_version)
);
alter table public.door_page_evidence enable row level security;
revoke all on public.door_page_evidence from public,anon,authenticated,service_role;
grant select on public.door_page_evidence to service_role;

create function public.append_door_page_evidence(p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s jsonb; o jsonb; p jsonb; env jsonb; x jsonb; y jsonb; k text; expected text[]; ref text; refs text[]:='{}'; allowed text[];
  v public.door_page_version; inp public.door_page_version_input; prior public.door_page_evidence; old public.door_page_evidence;
begin
  begin
    if not public.door_version_keys(p_input,array['format','subject','producer','environment','dependencies','started_at','finished_at','expires_at','verdict','findings','attachments','receipt_sha256','kind','output'])
      or p_input->>'format'<>'door-v44-evidence/1.0.0' or octet_length(p_input::text)>8388608 then raise exception 'invalid'; end if;
    if jsonb_path_exists(p_input #- '{output,generation_id}' #- '{output,prior_attempt_sha256}', 'strict $.** ? (@ == null)')
      or exists(select 1 from jsonb_path_query(p_input, 'strict $.** ? (@.type() == "string")') text_value where text_value#>>'{}' ~ '[[:cntrl:]]') then raise exception 'invalid'; end if;
    if jsonb_typeof(p_input->'receipt_sha256')<>'string' or p_input->>'receipt_sha256' !~ '^[a-f0-9]{64}$'
      or public.door_input_text_hash(public.door_version_json(p_input-'receipt_sha256')) is distinct from p_input->>'receipt_sha256' then raise exception 'invalid'; end if;
    s:=p_input->'subject'; o:=p_input->'output'; p:=p_input->'producer'; env:=p_input->'environment';
    if not public.door_version_keys(s,array['tenant_id','page_id','page_version','reservation_id','input_sha256','artifact_hash','compile_receipt_sha256']) then raise exception 'invalid'; end if;
    foreach k in array array['tenant_id','page_id'] loop if jsonb_typeof(s->k)<>'string' or s->>k !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then raise exception 'invalid'; end if; end loop;
    foreach k in array array['reservation_id','input_sha256','artifact_hash','compile_receipt_sha256'] loop if jsonb_typeof(s->k)<>'string' or s->>k !~ '^[a-f0-9]{64}$' then raise exception 'invalid'; end if; end loop;
    if jsonb_typeof(s->'page_version')<>'number' or s->>'page_version' !~ '^[1-9][0-9]*$' or (s->>'page_version')::numeric>2147483646 then raise exception 'invalid'; end if;
    foreach k in array array['started_at','finished_at','expires_at'] loop if jsonb_typeof(p_input->k)<>'string' or p_input->>k !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then raise exception 'invalid'; end if; perform (p_input->>k)::timestamptz; end loop;
    if (p_input->>'started_at')::timestamptz>(p_input->>'finished_at')::timestamptz or (p_input->>'finished_at')::timestamptz>=(p_input->>'expires_at')::timestamptz then raise exception 'invalid'; end if;
    if not public.door_version_keys(p,array['id','version','implementation_sha256','run_id','actor_id','actor_kind','trust_scope']) then raise exception 'invalid'; end if;
    foreach k in array array['id','version','run_id','actor_id'] loop if jsonb_typeof(p->k)<>'string' or p->>k !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$' then raise exception 'invalid'; end if; end loop;
    if jsonb_typeof(p->'implementation_sha256')<>'string' or p->>'implementation_sha256' !~ '^[a-f0-9]{64}$' or p->>'actor_kind' not in ('system','human') or p->>'trust_scope' not in ('governed_execution','reviewed_repository','human_action','synthetic_test') then raise exception 'invalid'; end if;
    if not public.door_version_keys(env,array['id','manifest_sha256','commit','origin']) or jsonb_typeof(env->'id')<>'string' or jsonb_typeof(env->'origin')<>'string' or env->>'origin' !~ '^https?://[A-Za-z0-9.-]+(:[1-9][0-9]{0,4})?$' or env->>'manifest_sha256' !~ '^[a-f0-9]{64}$' or env->>'commit' !~ '^[a-f0-9]{40}$' then raise exception 'invalid'; end if;
    if jsonb_typeof(p_input->'verdict')<>'string' or p_input->>'verdict' not in ('PASS','FAIL','BLOCKED','NOT_RUN','WARN') then raise exception 'invalid'; end if;
    foreach k in array array['dependencies','findings','attachments'] loop if jsonb_typeof(p_input->k)<>'array' or jsonb_array_length(p_input->k)>1000 then raise exception 'invalid'; end if; end loop;
    for x in select value from jsonb_array_elements(p_input->'dependencies') loop
      if not public.door_version_keys(x,array['kind','id','version','sha256']) then raise exception 'invalid'; end if;
      foreach k in array array['kind','id','version'] loop if jsonb_typeof(x->k)<>'string' or x->>k !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$' then raise exception 'invalid'; end if; end loop;
      if jsonb_typeof(x->'sha256')<>'string' or x->>'sha256' !~ '^[a-f0-9]{64}$' then raise exception 'invalid'; end if;
    end loop;
    if exists(select 1 from (select value->>'kind'||'/'||(value->>'id') as key, lag(value->>'kind'||'/'||(value->>'id')) over(order by ordinality) as last from jsonb_array_elements(p_input->'dependencies') with ordinality) d where last>=key collate "C") then raise exception 'invalid'; end if;
    for x in select value from jsonb_array_elements(p_input->'findings') loop
      if not public.door_version_keys(x,array['code','pointer','severity']) or jsonb_typeof(x->'code')<>'string' or x->>'code' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$' or jsonb_typeof(x->'pointer')<>'string' or x->>'pointer' !~ '^(/[A-Za-z0-9_~./-]*)?$' or length(x->>'pointer')>500 or x->>'severity' not in ('blocker','review') then raise exception 'invalid'; end if;
    end loop;
    for x in select value from jsonb_array_elements(p_input->'attachments') loop
      if not public.door_version_keys(x,array['id','sha256','bytes','media_type']) or jsonb_typeof(x->'id')<>'string' or x->>'id' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$' or x->>'sha256' !~ '^[a-f0-9]{64}$' or jsonb_typeof(x->'bytes')<>'number' or x->>'bytes' !~ '^(0|[1-9][0-9]*)$' or (x->>'bytes')::numeric>2147483646 or x->>'media_type' not in ('application/json','text/plain','image/png','image/webp') then raise exception 'invalid'; end if;
    end loop;
    case p_input->>'kind'
      when 'artifact_integrity' then expected:=array['artifact_read_verified','semantic_verified','input_verified'];
        if o->'artifact_read_verified' is distinct from 'true'::jsonb or o->'semantic_verified' is distinct from 'true'::jsonb or o->'input_verified' is distinct from 'true'::jsonb then raise exception 'invalid'; end if;
      when 'independent_critic' then expected:=array['provider','model_id','generation_id','prompt_id','prompt_version','prompt_sha256','policy_sha256','projection_sha256','writer_assignments_sha256','repair_iteration','prior_attempt_sha256','schema_repaired','cost_usd','usage'];
        if jsonb_typeof(o->'repair_iteration')<>'number' or o->>'repair_iteration' not in ('0','1','2') or jsonb_typeof(o->'schema_repaired')<>'boolean' or jsonb_typeof(o->'cost_usd')<>'string' or o->>'cost_usd' !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' then raise exception 'invalid'; end if;
        foreach k in array array['provider','model_id','prompt_id','prompt_version'] loop if jsonb_typeof(o->k)<>'string' or o->>k !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$' then raise exception 'invalid'; end if; end loop;
        if o->'generation_id'<>'null'::jsonb and (jsonb_typeof(o->'generation_id')<>'string' or o->>'generation_id' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$') then raise exception 'invalid'; end if;
        if (o->>'repair_iteration'='0') is distinct from (o->'prior_attempt_sha256'='null'::jsonb) then raise exception 'invalid'; end if;
        if o->>'repair_iteration'<>'0' then refs:=array_append(refs,o->>'prior_attempt_sha256'); end if;
        if not public.door_version_keys(o->'usage',array['prompt_tokens','completion_tokens','total_tokens']) then raise exception 'invalid'; end if;
        foreach k in array array['prompt_tokens','completion_tokens','total_tokens'] loop if jsonb_typeof(o->'usage'->k)<>'number' or o->'usage'->>k !~ '^(0|[1-9][0-9]*)$' or (o->'usage'->>k)::numeric>2147483646 then raise exception 'invalid'; end if; end loop;
        if (o->'usage'->>'prompt_tokens')::numeric+(o->'usage'->>'completion_tokens')::numeric<>(o->'usage'->>'total_tokens')::numeric then raise exception 'invalid'; end if;
      when 'check_matrix' then expected:=array['checks'];
        if jsonb_typeof(o->'checks')<>'array' or jsonb_array_length(o->'checks') not between 1 and 42 then raise exception 'invalid'; end if;
        for x in select value from jsonb_array_elements(o->'checks') loop
          if not public.door_version_keys(x,array['check_id','verdict','result_sha256']) or x->>'check_id' not in ('H01','H02','H03','H04','H05','H06','H07','H08','H09','H10','H11','H12','H13','H14','H15','H16','H17','H18','opportunity','family_preflight','schema','intent','constants','actions','layout_counts','source_claims','capabilities','safety','structured_data','assets_social','provenance_dates','wording','security','accessibility','responsive','interaction','performance','batch_quality','template_corpus','staged_preview','hosted_runtime','reproducibility') or x->>'verdict' not in ('PASS','FAIL','BLOCKED','NOT_RUN','WARN') or x->>'result_sha256' !~ '^[a-f0-9]{64}$' then raise exception 'invalid'; end if;
        end loop;
        if (select count(distinct value->>'check_id') from jsonb_array_elements(o->'checks'))<>jsonb_array_length(o->'checks') then raise exception 'invalid'; end if;
      when 'technical_assessment' then expected:=array['eligible','policy_sha256','evidence_hashes','dependencies_sha256','environment_sha256','fence'];
      when 'release_evaluation' then expected:=array['eligible','policy_sha256','evidence_hashes','dependencies_sha256','environment_sha256','fence','assessment_sha256','content_approval_sha256']; refs:=array[o->>'assessment_sha256',o->>'content_approval_sha256'];
      when 'content_approval' then expected:=array['assessment_sha256','decision']; refs:=array[o->>'assessment_sha256']; if o->>'decision' not in ('APPROVE','REJECT') then raise exception 'invalid'; end if;
      when 'publish_action' then expected:=array['release_evaluation_sha256','content_approval_sha256','expected_selection_revision','operation_id','action','reason']; refs:=array[o->>'release_evaluation_sha256',o->>'content_approval_sha256'];
        if jsonb_typeof(o->'expected_selection_revision')<>'number' or o->>'expected_selection_revision' !~ '^(0|[1-9][0-9]*)$' or (o->>'expected_selection_revision')::numeric>2147483646 or o->>'action' not in ('publish','rollback','unpublish') or jsonb_typeof(o->'operation_id')<>'string' or o->>'operation_id' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' or jsonb_typeof(o->'reason')<>'string' or length(o->>'reason') not between 1 and 500 then raise exception 'invalid'; end if;
      when 'review' then expected:=array['reviewed_evidence_sha256','accepted_findings']; refs:=array[o->>'reviewed_evidence_sha256']; if jsonb_typeof(o->'accepted_findings')<>'array' or jsonb_array_length(o->'accepted_findings') not between 1 and 500 then raise exception 'invalid'; end if;
      when 'revocation' then expected:=array['target_receipt_sha256','reason_code']; refs:=array[o->>'target_receipt_sha256']; if jsonb_typeof(o->'reason_code')<>'string' or o->>'reason_code' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$' then raise exception 'invalid'; end if;
      else raise exception 'invalid';
    end case;
    if not public.door_version_keys(o,expected) then raise exception 'invalid'; end if;
    for k,x in select * from jsonb_each(o) loop if k like '%\_sha256' escape '\' and x<>'null'::jsonb and (jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[a-f0-9]{64}$') then raise exception 'invalid'; end if; end loop;
    if p_input->>'kind' in ('content_approval','publish_action','review') and (p->>'actor_kind'<>'human' or p->>'trust_scope' not in ('human_action','synthetic_test')) then raise exception 'invalid'; end if;
    if p_input->>'kind' in ('technical_assessment','release_evaluation') then
      if jsonb_typeof(o->'eligible')<>'boolean' or (o->'eligible'='true'::jsonb) is distinct from (p_input->>'verdict'='PASS') or jsonb_typeof(o->'evidence_hashes')<>'array' or jsonb_array_length(o->'evidence_hashes')>1000 or not public.door_version_keys(o->'fence',array['revision','dependency_revision','hold_revision','dependencies_sha256','environment_sha256','holds_sha256']) then raise exception 'invalid'; end if;
      foreach k in array array['revision','dependency_revision','hold_revision'] loop if jsonb_typeof(o->'fence'->k)<>'number' or o->'fence'->>k !~ '^(0|[1-9][0-9]*)$' or (o->'fence'->>k)::numeric>2147483646 then raise exception 'invalid'; end if; end loop;
      foreach k in array array['dependencies_sha256','environment_sha256','holds_sha256'] loop if jsonb_typeof(o->'fence'->k)<>'string' or o->'fence'->>k !~ '^[a-f0-9]{64}$' then raise exception 'invalid'; end if; end loop;
      if o->'dependencies_sha256' is distinct from o->'fence'->'dependencies_sha256' or o->'environment_sha256' is distinct from o->'fence'->'environment_sha256' then raise exception 'invalid'; end if;
      for x in select value from jsonb_array_elements(o->'evidence_hashes') loop if jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[a-f0-9]{64}$' then raise exception 'invalid'; end if; refs:=array_append(refs,x#>>'{}'); end loop;
      if exists(select 1 from (select value#>>'{}' as h,lag(value#>>'{}') over(order by ordinality) as last from jsonb_array_elements(o->'evidence_hashes') with ordinality) e where last>=h collate "C") then raise exception 'invalid'; end if;
    end if;
  exception when others then raise exception 'DOOR_EVIDENCE_INVALID'; end;
  perform pg_advisory_xact_lock(28,hashtext(s->>'tenant_id'));
  select * into v from public.door_page_version where tenant_id=s->>'tenant_id' and page_id=s->>'page_id' and page_version=(s->>'page_version')::integer;
  select * into inp from public.door_page_version_input where reservation_id=s->>'reservation_id';
  if v.reservation_id is null or inp.reservation_id is null or v.reservation_id is distinct from s->>'reservation_id' or v.metadata->>'receipt_sha256' is distinct from s->>'compile_receipt_sha256' or v.metadata->'receipt'->>'artifact_hash' is distinct from s->>'artifact_hash' or inp.input_sha256 is distinct from s->>'input_sha256' then raise exception 'DOOR_EVIDENCE_CONFLICT'; end if;
  select * into old from public.door_page_evidence where receipt_sha256=p_input->>'receipt_sha256';
  if found then if old.receipt is distinct from p_input then raise exception 'DOOR_EVIDENCE_CONFLICT'; end if; return old.receipt; end if;
  foreach ref in array refs loop
    select * into prior from public.door_page_evidence where receipt_sha256=ref;
    if not found or prior.tenant_id<>s->>'tenant_id' or prior.page_id<>s->>'page_id' or (prior.receipt->>'finished_at')::timestamptz>(p_input->>'started_at')::timestamptz then raise exception 'DOOR_EVIDENCE_CONFLICT'; end if;
    if p_input->>'kind'='independent_critic' then
      if prior.kind<>'independent_critic' or prior.page_version>=(s->>'page_version')::integer or (prior.receipt->'output'->>'repair_iteration')::integer+1<>(o->>'repair_iteration')::integer then raise exception 'DOOR_EVIDENCE_CONFLICT'; end if;
    else
      if prior.receipt->'subject' is distinct from s then raise exception 'DOOR_EVIDENCE_CONFLICT'; end if;
      case p_input->>'kind'
        when 'content_approval' then allowed:=array['technical_assessment'];
        when 'review' then allowed:=array['check_matrix','independent_critic'];
        when 'revocation' then allowed:=array['artifact_integrity','independent_critic','check_matrix','technical_assessment','content_approval','release_evaluation','publish_action','review'];
        when 'technical_assessment' then allowed:=array['artifact_integrity','independent_critic','check_matrix','review'];
        when 'release_evaluation' then
          if ref=o->>'assessment_sha256' then allowed:=array['technical_assessment']; elsif ref=o->>'content_approval_sha256' then allowed:=array['content_approval']; else allowed:=array['artifact_integrity','independent_critic','check_matrix','review','technical_assessment','content_approval']; end if;
        when 'publish_action' then if ref=o->>'release_evaluation_sha256' then allowed:=array['release_evaluation']; else allowed:=array['content_approval']; end if;
        else allowed:='{}';
      end case;
      if not prior.kind=any(allowed) then raise exception 'DOOR_EVIDENCE_CONFLICT'; end if;
    end if;
  end loop;
  insert into public.door_page_evidence values(p_input->>'receipt_sha256',s->>'tenant_id',s->>'page_id',(s->>'page_version')::integer,p_input->>'kind',s->>'artifact_hash',s->>'input_sha256',p_input);
  insert into public.admin_audit(at,action,target,detail) values((p_input->>'finished_at')::timestamptz,'door_page_evidence_appended',s->>'page_id',jsonb_build_object('tenant_id',s->>'tenant_id','receipt_sha256',p_input->>'receipt_sha256','kind',p_input->>'kind','actor',p->>'actor_id')::text);
  return p_input;
end $$;
create trigger door_page_evidence_immutable before update or delete on public.door_page_evidence for each row execute function public.door_version_immutable();
revoke all on function public.append_door_page_evidence(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.append_door_page_evidence(jsonb) to service_role;

-- Transactional counterpart of evaluateDoorRelease. Selection calls this using
-- table-loaded history and the current guard/policy, under the same tenant lock.
-- This is evidence eligibility, never an assertion that a vendor actually ran.
create function public.door_evidence_authorized(r jsonb, policy jsonb) returns boolean language sql immutable set search_path=pg_catalog,public as $$
  select exists(select 1 from jsonb_array_elements(policy->'producers') p where p->>'id'=r->'producer'->>'id' and p->>'version'=r->'producer'->>'version'
    and p->>'implementation_sha256'=r->'producer'->>'implementation_sha256' and p->>'actor_kind'=r->'producer'->>'actor_kind' and p->>'trust_scope'=r->'producer'->>'trust_scope'
    and p->>'trust_scope' in ('governed_execution','reviewed_repository','human_action') and p->'kinds' ? (r->>'kind'))
$$;
create function public.door_evidence_accepted(r jsonb, usable jsonb) returns boolean language sql immutable set search_path=pg_catalog,public as $$
  select coalesce((r->>'verdict'='PASS' and r->'findings'='[]'::jsonb) or (r->>'verdict'='WARN' and jsonb_array_length(r->'findings')>0
    and not exists(select 1 from jsonb_array_elements(r->'findings') f where f->>'severity' is distinct from 'review')
    and exists(select 1 from jsonb_array_elements(usable) v where v->>'kind'='review' and v->>'verdict'='PASS' and v->'findings'='[]'::jsonb
      and v->'output'->>'reviewed_evidence_sha256'=r->>'receipt_sha256' and v->'output'->'accepted_findings'=r->'findings')),false)
$$;
create function public.evaluate_door_release_evidence(p_input jsonb) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare policy jsonb; subject jsonb; fence jsonb; records jsonb; active jsonb; writer jsonb; usable jsonb:='[]'; revoked text[]:='{}'; r jsonb; a jsonb; prior jsonb; assessment jsonb; approval jsonb; producer jsonb;
  current_at timestamptz; dep text; env text; policy_hash text; key text; found_check boolean; found_critic boolean:=false; found_artifact boolean:=false; approved boolean:=false; hashes jsonb;
  required text[]:=array['H01','H02','H03','H04','H05','H06','H07','H08','H09','H10','H11','H12','H13','H14','H15','H16','H17','H18','opportunity','family_preflight','schema','intent','constants','actions','layout_counts','source_claims','capabilities','safety','structured_data','assets_social','provenance_dates','wording','security','accessibility','responsive','interaction','performance','batch_quality','template_corpus','staged_preview','hosted_runtime','reproducibility'];
begin
  if not public.door_version_keys(p_input,array['phase','subject','receipts','active_receipt_hashes','writer','policy','fence','now']) or jsonb_typeof(p_input->'phase')<>'string' or p_input->>'phase' not in ('technical','publish') then return false; end if;
  policy:=p_input->'policy'; subject:=p_input->'subject'; fence:=p_input->'fence'; records:=p_input->'receipts'; active:=p_input->'active_receipt_hashes'; writer:=p_input->'writer'; current_at:=(p_input->>'now')::timestamptz;
  if writer<>'null'::jsonb then
    if not public.door_version_keys(writer,array['models','assignments_sha256']) or jsonb_typeof(writer->'models')<>'array' or jsonb_typeof(writer->'assignments_sha256')<>'string' or writer->>'assignments_sha256' !~ '^[a-f0-9]{64}$' then return false; end if;
    for a in select value from jsonb_array_elements(writer->'models') loop if not public.door_version_keys(a,array['provider','model_id']) or jsonb_typeof(a->'provider')<>'string' or jsonb_typeof(a->'model_id')<>'string' then return false; end if; end loop;
  end if;
  if current_at is null or not public.door_version_keys(policy,array['version','required_checks','producers','dependencies','environment','max_evidence_age_seconds','holds'])
    or jsonb_typeof(policy->'required_checks')<>'array' or jsonb_typeof(policy->'producers')<>'array' or jsonb_array_length(policy->'producers')=0
    or jsonb_typeof(policy->'max_evidence_age_seconds')<>'number' or policy->>'max_evidence_age_seconds' !~ '^[1-9][0-9]*$' or (policy->>'max_evidence_age_seconds')::numeric>31536000
    or not public.door_version_keys(policy->'holds',array['public_publish','door_pages_live','trial_noindex']) or jsonb_typeof(policy->'holds'->'public_publish')<>'boolean' or jsonb_typeof(policy->'holds'->'door_pages_live')<>'boolean' or policy->'holds'->'trial_noindex' is distinct from 'true'::jsonb then return false; end if;
  if jsonb_array_length(policy->'required_checks')<>42 or exists(select 1 from jsonb_array_elements_text(policy->'required_checks') c where not c=any(required)) or (select count(distinct value) from jsonb_array_elements_text(policy->'required_checks'))<>42 then return false; end if;
  foreach key in array array['template','schema','fixture_corpus','prompt','source','capability','theme','disclosure'] loop
    if not exists(select 1 from jsonb_array_elements(policy->'dependencies') d where d->>'kind'=key) then return false; end if;
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(policy->'producers'))<>jsonb_array_length(policy->'producers') then return false; end if;
  dep:=public.door_input_text_hash(public.door_version_json(policy->'dependencies')); env:=public.door_input_text_hash(public.door_version_json(policy->'environment')); policy_hash:=public.door_input_text_hash(public.door_version_json(policy));
  if fence->>'dependencies_sha256' is distinct from dep or fence->>'environment_sha256' is distinct from env or fence->>'holds_sha256' is distinct from public.door_input_text_hash(public.door_version_json(policy->'holds')) then return false; end if;
  if jsonb_typeof(records)<>'array' or jsonb_typeof(active)<>'array' or (select count(distinct value->>'receipt_sha256') from jsonb_array_elements(records))<>jsonb_array_length(records)
    or (select count(distinct value) from jsonb_array_elements_text(active))<>jsonb_array_length(active)
    or exists(select 1 from jsonb_array_elements_text(active) h where not exists(select 1 from jsonb_array_elements(records) entry where entry->>'receipt_sha256'=h)) then return false; end if;
  for r in select value from jsonb_array_elements(records) loop
    if r->>'receipt_sha256' is distinct from public.door_input_text_hash(public.door_version_json(r-'receipt_sha256')) then return false; end if;
    if r->>'kind'='revocation' and r->'subject'=subject and public.door_evidence_authorized(r,policy) and (r->>'finished_at')::timestamptz<=current_at then revoked:=array_append(revoked,r->'output'->>'target_receipt_sha256'); end if;
  end loop;
  for r in select value from jsonb_array_elements(records) loop
    if not active ? (r->>'receipt_sha256') or r->>'kind' in ('revocation','publish_action','release_evaluation') then continue; end if;
    if r->'subject' is distinct from subject or not public.door_evidence_authorized(r,policy) or r->>'receipt_sha256'=any(revoked)
      or (r->>'finished_at')::timestamptz>current_at or (r->>'expires_at')::timestamptz<=current_at
      or extract(epoch from current_at-(r->>'finished_at')::timestamptz)>(policy->>'max_evidence_age_seconds')::numeric
      or public.door_input_text_hash(public.door_version_json(r->'dependencies'))<>dep or public.door_input_text_hash(public.door_version_json(r->'environment'))<>env then return false; end if;
    usable:=usable||jsonb_build_array(r);
  end loop;
  if exists(select 1 from jsonb_array_elements(records) entry where entry->>'kind'='independent_critic' and entry->'subject'=subject and public.door_evidence_authorized(entry,policy) and entry->>'verdict'='FAIL'
    and (entry->>'finished_at')::timestamptz<=current_at and not entry->>'receipt_sha256'=any(revoked)) then return false; end if;
  for r in select value from jsonb_array_elements(usable) loop
    if r->>'kind'='artifact_integrity' and public.door_evidence_accepted(r,usable) then found_artifact:=true; end if;
    if r->>'kind'<>'independent_critic' then continue; end if;
    found_critic:=true;
    if not public.door_evidence_accepted(r,usable) or writer='null'::jsonb or jsonb_typeof(writer->'models')<>'array' or jsonb_array_length(writer->'models')=0
      or writer->>'assignments_sha256' is distinct from r->'output'->>'writer_assignments_sha256' or exists(select 1 from jsonb_array_elements(writer->'models') w where w->>'model_id'=r->'output'->>'model_id') then return false; end if;
    if (r->'output'->>'repair_iteration')::integer>0 then
      select value into prior from jsonb_array_elements(records) p where p->>'receipt_sha256'=r->'output'->>'prior_attempt_sha256';
      if prior is null or prior->>'kind'<>'independent_critic' or prior->'subject'->>'tenant_id' is distinct from subject->>'tenant_id' or prior->'subject'->>'page_id' is distinct from subject->>'page_id'
        or (prior->'subject'->>'page_version')::integer>=(subject->>'page_version')::integer or not public.door_evidence_authorized(prior,policy) or (prior->'output'->>'repair_iteration')::integer+1<>(r->'output'->>'repair_iteration')::integer or (prior->>'finished_at')::timestamptz>(r->>'started_at')::timestamptz then return false; end if;
    end if;
  end loop;
  if not found_artifact or not found_critic then return false; end if;
  foreach key in array required loop
    found_check:=false;
    for r in select value from jsonb_array_elements(usable) where value->>'kind'='check_matrix' loop
      select value into producer from jsonb_array_elements(policy->'producers') p where p->>'id'=r->'producer'->>'id';
      if not producer->'check_ids' ? key then continue; end if;
      for a in select value from jsonb_array_elements(r->'output'->'checks') where value->>'check_id'=key loop
        found_check:=true;
        if not public.door_evidence_accepted(r,usable) or (a->>'verdict'<>'PASS' and not(key='batch_quality' and a->>'verdict'='WARN' and public.door_evidence_accepted(r,usable))) then return false; end if;
      end loop;
    end loop;
    if not found_check then return false; end if;
  end loop;
  if p_input->>'phase'='publish' then
    if policy->'holds'->'public_publish'='true'::jsonb or policy->'holds'->'door_pages_live'<>'true'::jsonb then return false; end if;
    select coalesce(jsonb_agg(value->>'receipt_sha256' order by value->>'receipt_sha256' collate "C"),'[]'::jsonb) into hashes from jsonb_array_elements(usable) where value->>'kind' not in ('technical_assessment','content_approval');
    select value into approval from jsonb_array_elements(records) entry where entry->>'kind'='content_approval' and entry->'subject'=subject and public.door_evidence_authorized(entry,policy)
      and (entry->>'finished_at')::timestamptz<=current_at and not entry->>'receipt_sha256'=any(revoked) order by entry->>'finished_at' desc,entry->>'receipt_sha256' desc limit 1;
    if approval is null or not active ? (approval->>'receipt_sha256') or approval->'output'->>'decision'<>'APPROVE' or not public.door_evidence_accepted(approval,usable) then return false; end if;
    for assessment in select value from jsonb_array_elements(usable) where value->>'kind'='technical_assessment' loop
      if public.door_evidence_accepted(assessment,usable) and assessment->'output'->'eligible'='true'::jsonb and assessment->'output'->>'policy_sha256'=policy_hash and assessment->'output'->'fence'=fence and assessment->'output'->'evidence_hashes'=hashes
        and assessment->>'receipt_sha256'=approval->'output'->>'assessment_sha256' and (assessment->>'finished_at')::timestamptz<=(approval->>'started_at')::timestamptz then approved:=true; end if;
    end loop;
    if not approved then return false; end if;
  end if;
  return true;
exception when others then return false;
end $$;
revoke all on function public.door_evidence_authorized(jsonb,jsonb),public.door_evidence_accepted(jsonb,jsonb),public.evaluate_door_release_evidence(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.evaluate_door_release_evidence(jsonb) to service_role;
