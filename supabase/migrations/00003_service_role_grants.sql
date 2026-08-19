-- The project was created with "Automatically expose new tables" OFF (the
-- secure choice), so no Data API role has privileges on our tables. Grant them
-- to the SERVER-SIDE service role only; the public roles keep nothing. This is
-- defence in depth on top of RLS deny-all: even if a policy were added by
-- mistake, anon/authenticated still hold no table privileges.

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

notify pgrst, 'reload schema';
