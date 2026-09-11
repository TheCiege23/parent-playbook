-- Strip TRUNCATE, TRIGGER, REFERENCES and MAINTAIN from anon and authenticated on every table
-- in public, and stop new tables from inheriting them.
--
-- Why this matters: Supabase's default privileges grant ALL on each new public table to anon,
-- authenticated and service_role. ALL includes TRUNCATE, and **TRUNCATE is not subject to
-- row-level security**. Every policy in this schema is written on the assumption that a tenant
-- can only reach its own rows; TRUNCATE ignores all of it and empties the table. The same
-- default also hands out TRIGGER (attach a trigger to someone else's table), REFERENCES (point
-- a foreign key at it, which can block deletes) and, on PostgreSQL 17+, MAINTAIN (VACUUM,
-- ANALYZE, REINDEX, CLUSTER, REFRESH MATERIALIZED VIEW).
--
-- Found on 2026-09-10 while applying the composition migration: 51 of 53 public tables carried
-- all of it for both roles, including company_reference_assessments, biometric_consents,
-- athletes and measurements. PostgREST exposes no TRUNCATE verb, so this was a latent excess
-- privilege rather than one reachable through the documented API — but it defeats every policy
-- here for anything that can execute SQL as those roles, and least privilege is cheap.
--
-- What this deliberately does NOT touch: SELECT, INSERT, UPDATE and DELETE. Those are what the
-- application actually uses, and row-level security is what constrains them. Nothing about the
-- app's behaviour changes.

-- ---------------------------------------------------------------- existing tables
do $$
declare
  target record;
  revoked integer := 0;
  -- MAINTAIN only exists on PostgreSQL 17+. Build the privilege list to match the server so
  -- this migration still applies on an older cluster.
  privileges text := case when current_setting('server_version_num')::integer >= 170000
                          then 'truncate, trigger, references, maintain'
                          else 'truncate, trigger, references' end;
begin
  for target in
    select c.oid::regclass as relation
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')          -- ordinary and partitioned tables
    order by c.relname
  loop
    execute format('revoke %s on %s from anon, authenticated', privileges, target.relation);
    revoked := revoked + 1;
  end loop;
  raise notice 'least-privilege grants applied to % public tables', revoked;
end $$;

-- ---------------------------------------------------------------- future tables
-- Without this, the next `create table` in public silently re-grants everything above.
--
-- Default privileges are per-owner, and the owner differs by environment: on Supabase they
-- belong to postgres and supabase_admin, on a plain cluster to whoever created the schema. So
-- read the actual owners out of pg_default_acl rather than hardcoding a guess. A role whose
-- defaults this connection may not alter is reported and skipped, not treated as a failure.
do $$
declare
  owner_role text;
  privileges text := case when current_setting('server_version_num')::integer >= 170000
                          then 'truncate, trigger, references, maintain'
                          else 'truncate, trigger, references' end;
begin
  for owner_role in
    select distinct pg_get_userbyid(d.defaclrole)
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    where n.nspname = 'public' and d.defaclobjtype = 'r'
  loop
    begin
      execute format(
        'alter default privileges for role %I in schema public revoke %s on tables from anon, authenticated',
        owner_role, privileges);
      raise notice 'default privileges tightened for role %', owner_role;
    exception when insufficient_privilege then
      raise notice 'not a member of %; its default privileges are unchanged', owner_role;
    end;
  end loop;
end $$;
