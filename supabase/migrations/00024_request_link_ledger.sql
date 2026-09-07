-- T8-39 / T8-38: durable issuance and Keep receipts for hosted loop surfaces.
-- WRITTEN, NOT APPLIED. Deploy only after applying and verifying this migration.
-- Full signed tokens are private capabilities: no anon reads, no client writes,
-- no broad service table grants. Every mutation is a service-only transaction.
create table public.issued_request_links (
  link_id text primary key check (link_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  request_id text not null references public.intake_session(request_id),
  tenant_id text not null,
  problem_id text not null references public.problem_record(problem_id),
  scope text not null check (scope in ('keep','ask','media','packet','magic')),
  token text not null check (length(token) between 1 and 4096),
  created_at timestamptz not null,
  exp timestamptz
);
create index on public.issued_request_links(request_id, created_at);
create table public.request_keep_state (
  request_id text primary key references public.intake_session(request_id),
  tenant_id text not null,
  problem_id text not null references public.problem_record(problem_id),
  email_id text references public.email_outbox(email_id),
  magic_id text not null references public.magic_links(magic_id),
  confirmed_at timestamptz
);
alter table public.issued_request_links enable row level security;
alter table public.request_keep_state enable row level security;
-- 00003 has default grants; remove them before granting the read-only surface.
revoke all on public.issued_request_links, public.request_keep_state from public, anon, authenticated, service_role;
grant select on public.issued_request_links, public.request_keep_state to authenticated, service_role;
create policy "request-scoped read" on public.issued_request_links for select to authenticated using (
  request_id = (auth.jwt()->>'request_id') and exists (
    select 1 from public.intake_session s join public.problem_record p on p.intake_session_id=s.intake_session_id
    where s.request_id=issued_request_links.request_id and p.request_id=s.request_id
      and p.problem_id=issued_request_links.problem_id and p.tenant_id=issued_request_links.tenant_id
  )
);
create policy "request-scoped read" on public.request_keep_state for select to authenticated using (
  request_id = (auth.jwt()->>'request_id') and exists (
    select 1 from public.intake_session s join public.problem_record p on p.intake_session_id=s.intake_session_id
    where s.request_id=request_keep_state.request_id and p.request_id=s.request_id
      and p.problem_id=request_keep_state.problem_id and p.tenant_id=request_keep_state.tenant_id
  )
);

create function public.register_request_link(p_request_id text, p_tenant_id text, p_link jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_problem text; v_existing public.issued_request_links;
begin
  select p.problem_id into strict v_problem from public.intake_session s
    join public.problem_record p on p.intake_session_id=s.intake_session_id
    where s.request_id=p_request_id and p.request_id=s.request_id and p.tenant_id=p_tenant_id for update of s;
  if jsonb_typeof(p_link) is distinct from 'object' then raise exception 'invalid issued link'; end if;
  insert into public.issued_request_links(link_id,request_id,tenant_id,problem_id,scope,token,created_at,exp)
    values(p_link->>'link_id',p_request_id,p_tenant_id,v_problem,p_link->>'scope',p_link->>'token',
      (p_link->>'created_at')::timestamptz,(p_link->>'exp')::timestamptz)
    on conflict(link_id) do nothing;
  select * into strict v_existing from public.issued_request_links where link_id=p_link->>'link_id';
  if v_existing.request_id<>p_request_id or v_existing.tenant_id<>p_tenant_id or v_existing.problem_id<>v_problem
      or v_existing.scope is distinct from (p_link->>'scope') or v_existing.token is distinct from (p_link->>'token')
      or v_existing.exp is distinct from (p_link->>'exp')::timestamptz then raise exception 'issued link conflict'; end if;
  return to_jsonb(v_existing);
end $$;

create function public.register_request_keep(p_request_id text,p_tenant_id text,p_email_id text,p_magic_id text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_problem text; v_current text;
begin
  select p.problem_id into strict v_problem from public.intake_session s
    join public.problem_record p on p.intake_session_id=s.intake_session_id
    where s.request_id=p_request_id and p.request_id=s.request_id and p.tenant_id=p_tenant_id for update of s;
  select magic_link_id into v_current from public.keep_claims where request_id=p_request_id and tenant_id=p_tenant_id
    order by claimed_at desc, id desc limit 1;
  if v_current is distinct from p_magic_id then return false; end if;
  if not exists(select 1 from public.magic_links where magic_id=p_magic_id and request_id=p_request_id and tenant_id=p_tenant_id)
    or (p_email_id is not null and not exists(select 1 from public.email_outbox where email_id=p_email_id and request_id=p_request_id and tenant_id=p_tenant_id))
    then raise exception 'keep receipt identity mismatch'; end if;
  insert into public.request_keep_state(request_id,tenant_id,problem_id,email_id,magic_id,confirmed_at)
    values(p_request_id,p_tenant_id,v_problem,p_email_id,p_magic_id,null)
    on conflict(request_id) do update set email_id=excluded.email_id,magic_id=excluded.magic_id,
      confirmed_at=case when request_keep_state.magic_id=excluded.magic_id then request_keep_state.confirmed_at else null end;
  return true;
end $$;

-- With an owner link: consume, confirm, and register that link in ONE transaction.
-- Without one: repair a receipt only for an already consumed current magic link.
-- Any failed issuance/receipt write rolls back consumption, leaving a valid retry.
create function public.confirm_request_keep(p_request_id text,p_tenant_id text,p_magic_id text,p_at timestamptz,p_owner_link jsonb)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_problem text; v_current text; v_consumed timestamptz;
begin
  select p.problem_id into strict v_problem from public.intake_session s
    join public.problem_record p on p.intake_session_id=s.intake_session_id
    where s.request_id=p_request_id and p.request_id=s.request_id and p.tenant_id=p_tenant_id for update of s;
  select magic_link_id into v_current from public.keep_claims where request_id=p_request_id and tenant_id=p_tenant_id
    order by claimed_at desc, id desc limit 1;
  if v_current is distinct from p_magic_id then return false; end if;
  if not exists(select 1 from public.request_keep_state
    where request_id=p_request_id and tenant_id=p_tenant_id and problem_id=v_problem and magic_id=p_magic_id)
    then raise exception 'keep receipt unavailable'; end if;
  select consumed_at into v_consumed from public.magic_links
    where magic_id=p_magic_id and request_id=p_request_id and tenant_id=p_tenant_id for update;
  if not found or p_at is null then return false; end if;
  if p_owner_link is not null then
    if v_consumed is not null then return false; end if;
    if p_owner_link->>'scope' is distinct from 'keep' then raise exception 'invalid owner link scope'; end if;
    perform public.register_request_link(p_request_id,p_tenant_id,p_owner_link);
    update public.magic_links set consumed_at=p_at where magic_id=p_magic_id and request_id=p_request_id and consumed_at is null;
  elsif v_consumed is null then return false;
  end if;
  update public.request_keep_state set confirmed_at=coalesce(confirmed_at,p_at)
    where request_id=p_request_id and tenant_id=p_tenant_id and magic_id=p_magic_id;
  return true;
end $$;

revoke all on function public.register_request_link(text,text,jsonb),public.register_request_keep(text,text,text,text),
  public.confirm_request_keep(text,text,text,timestamptz,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.register_request_link(text,text,jsonb),public.register_request_keep(text,text,text,text),
  public.confirm_request_keep(text,text,text,timestamptz,jsonb) to service_role;
notify pgrst, 'reload schema';
