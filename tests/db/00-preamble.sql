-- Supabase-compatible emulation for a DISPOSABLE, ISOLATED PostgreSQL cluster.
-- This file is test scaffolding only. It is never applied to any real database.
--
-- Documented emulation limits (these are NOT provided by the real platform here):
--   * pg_cron and pg_net are unavailable in this build, so cron.* and net.* are stubs.
--     A stubbed cron.schedule() records the job row but NEVER FIRES. Nothing in this
--     harness proves the nightly retention job actually runs in production.
--   * auth.users is a minimal local table, not GoTrue.
--   * storage.* is a minimal stub sufficient for bucket-policy migrations.
--   * JWT claims are emulated with the standard current_setting('request.jwt.claims')
--     pattern that Supabase's auth.uid() uses.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- roles
do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator nologin noinherit; end if;
end $$;
grant anon, authenticated, service_role to pptest;
grant anon, authenticated, service_role to authenticator;

-- ---------------------------------------------------------------- schemas
create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists storage;
create schema if not exists cron;
create schema if not exists net;
create schema if not exists graphql_public;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
-- Supabase grants ALL on every new public table to anon, authenticated and service_role by
-- default. Reproducing that here matters: without it the harness silently misses the excess
-- TRUNCATE / TRIGGER / REFERENCES privileges a migration must revoke, because there is nothing
-- to revoke. Verified against the live project on 2026-09-10.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

-- ---------------------------------------------------------------- auth (GoTrue stand-in)
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant select on auth.users to authenticated, service_role;

-- The standard Supabase auth.uid() shape: read 'sub' out of the request JWT claims GUC.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  ), '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'anon'
  )
$$;

create or replace function auth.jwt() returns jsonb
language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

create or replace function auth.email() returns text
language sql stable
as $$ select (auth.jwt() ->> 'email') $$;

grant execute on function auth.uid(), auth.role(), auth.jwt(), auth.email() to anon, authenticated, service_role;

-- ---------------------------------------------------------------- pg_cron STUB (never fires)
create table if not exists cron.job (
  jobid bigserial primary key,
  jobname text unique,
  schedule text not null,
  command text not null,
  active boolean not null default true
);
create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint language plpgsql as $$
declare new_id bigint;
begin
  insert into cron.job(jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule=excluded.schedule, command=excluded.command
  returning jobid into new_id;
  return new_id;
end $$;
create or replace function cron.schedule(schedule text, command text)
returns bigint language sql as $$ select cron.schedule('auto-'||md5(command), schedule, command) $$;
create or replace function cron.unschedule(job_name text)
returns boolean language plpgsql as $$
begin delete from cron.job where jobname=job_name; return true; end $$;
create or replace function cron.unschedule(job_id bigint)
returns boolean language plpgsql as $$
begin delete from cron.job where jobid=job_id; return true; end $$;

-- ---------------------------------------------------------------- pg_net STUB (never sends)
create table if not exists net.http_request_queue (id bigserial primary key, url text, body jsonb, created_at timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
returns bigint language plpgsql as $$
declare new_id bigint;
begin insert into net.http_request_queue(url, body) values (url, body) returning id into new_id; return new_id; end $$;
create or replace function extensions.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
returns bigint language sql as $$ select net.http_post(url, body, params, headers, timeout_milliseconds) $$;

-- ---------------------------------------------------------------- storage STUB
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$ select string_to_array(name, '/') $$;
grant all on storage.buckets, storage.objects to authenticated, service_role;
-- Supabase's own guard, as production defines it (read from the live catalog on 2026-09-15): a statement-level
-- trigger that refuses any DELETE on storage.objects unless the Storage API set storage.allow_delete_query, because a
-- row deleted from SQL leaves its file's bytes behind. Statement-level, so it fires even when nothing matches. Without
-- it this stub let a migration's trigger delete report rows from SQL, which production refuses. A test that means
-- "removed through the Storage API" sets the flag for its own transaction, as the Storage API does.
create or replace function storage.protect_delete() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
      using hint = 'This prevents accidental data loss from orphaned objects.', errcode = '42501';
  end if;
  return null;
end $$;
drop trigger if exists protect_objects_delete on storage.objects;
create trigger protect_objects_delete before delete on storage.objects
  for each statement execute function storage.protect_delete();

-- ---------------------------------------------------------------- vault STUB
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (id uuid primary key default gen_random_uuid(), name text, decrypted_secret text);

-- ---------------------------------------------------------------- replay seed shim
-- 20260806160436_trainer_marketplace_enums_tables.sql ends by seeding app_admins with a
-- hard-coded guardian UUID from the production account. Replaying the real history into an
-- empty cluster needs that FK target to exist, so the harness pre-creates a SYNTHETIC row
-- with the same id. No production data is copied; only the identifier already present in
-- the committed migration is reused, so the migration text runs unmodified.
insert into auth.users(id, email) values ('74ea7be3-beb7-4c95-9594-ca8047a11f54', 'synthetic-seed-admin@example.invalid')
  on conflict (id) do nothing;
