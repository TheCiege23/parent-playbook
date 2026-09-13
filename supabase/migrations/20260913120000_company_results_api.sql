-- Organization API keys, and the authenticated results API behind them.
--
-- Until now an organization's stored results could be read only by a signed-in administrator in a
-- browser, through row-level security. A buyer integrating those results into their own systems needs
-- a server-to-server route that does not borrow a person's session. That route is
-- supabase/functions/company-results-api, and every access rule it depends on lives here, in the
-- database, so the function itself decides nothing:
--
--   * A key belongs to one organization. Only that organization's administrator can create or revoke
--     it. The secret is returned once; only its SHA-256 hash is stored, and no tenant role can read
--     the hash column.
--   * A key carries scopes (results:read, results:delete), an expiry of at most a year, and a
--     per-minute rate limit.
--   * The four API functions are executable by service_role alone, the role the edge function holds,
--     and each authenticates the key itself before touching a row.
--   * Child body assessments are served only while the athlete is on the organization's roster and
--     the biometric release behind the record is live. That is stricter than the administrator's own
--     row-level security, deliberately: data leaving for another system should stop leaving the moment
--     a parent withdraws.
--   * Every result served and every deletion is written to access_log with the key that did it.

-- ---------------------------------------------------------------------------------------------- keys
create table if not exists public.company_api_keys (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  key_prefix text not null unique check (key_prefix ~ '^ppk_[0-9a-f]{8}$'),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  label text not null check (char_length(label) between 1 and 100 and label = btrim(label)),
  scopes text[] not null check (cardinality(scopes) between 1 and 2 and scopes <@ array['results:read','results:delete']::text[]),
  rate_limit_per_minute integer not null default 120 check (rate_limit_per_minute between 1 and 6000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  last_used_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '366 days')
);
create index if not exists company_api_keys_team_idx on public.company_api_keys(team_id);

alter table public.company_api_keys enable row level security;

-- Administrators see their organization's keys, never a hash, and change them only through the two
-- functions below.
revoke all on public.company_api_keys from public, anon, authenticated;
grant select (id, team_id, key_prefix, label, scopes, rate_limit_per_minute, created_by, created_at,
  expires_at, revoked_at, revoked_by, last_used_at) on public.company_api_keys to authenticated;
create policy company_api_keys_select on public.company_api_keys for select to authenticated
  using (private.is_admin_of_team(team_id));

-- One row per key per minute. Kept in private, so no API surface reaches it.
create table if not exists private.company_api_key_windows (
  key_id uuid not null references public.company_api_keys(id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null,
  primary key (key_id, window_start)
);
revoke all on private.company_api_key_windows from public, anon, authenticated;

create or replace function public.create_company_api_key(
  p_team uuid, p_label text, p_scopes text[], p_expires_at timestamptz, p_rate_limit_per_minute integer default 120)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_raw text;
  v_prefix text;
  v_secret text;
  v_id uuid;
begin
  if auth.uid() is null or not private.is_admin_of_team(p_team) then
    raise exception 'only an administrator of this organization can create its API keys' using errcode = '42501';
  end if;
  -- Two version-4 UUIDs give 244 random bits from the server's cryptographic generator.
  v_raw := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_prefix := 'ppk_' || substr(v_raw, 1, 8);
  v_secret := v_prefix || '_' || substr(v_raw, 9);
  insert into public.company_api_keys(team_id, key_prefix, key_hash, label, scopes, rate_limit_per_minute, created_by, expires_at)
  values (p_team, v_prefix, encode(sha256(convert_to(v_secret, 'UTF8')), 'hex'), p_label, p_scopes,
          coalesce(p_rate_limit_per_minute, 120), auth.uid(), p_expires_at)
  returning id into v_id;
  insert into public.access_log(actor_id, athlete_id, action, detail)
  values (auth.uid(), null, 'company_api_key_created',
          jsonb_build_object('team_id', p_team, 'key_id', v_id, 'key_prefix', v_prefix, 'scopes', to_jsonb(p_scopes), 'expires_at', p_expires_at));
  return jsonb_build_object('id', v_id, 'key_prefix', v_prefix, 'secret', v_secret, 'scopes', to_jsonb(p_scopes),
    'expires_at', p_expires_at, 'notice', 'This secret is shown once. Only its SHA-256 hash is stored.');
end;
$$;
revoke all on function public.create_company_api_key(uuid, text, text[], timestamptz, integer) from public, anon, authenticated;
grant execute on function public.create_company_api_key(uuid, text, text[], timestamptz, integer) to authenticated;

create or replace function public.revoke_company_api_key(p_key uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_team uuid;
begin
  select k.team_id into v_team from public.company_api_keys k where k.id = p_key;
  -- A key in another organization is reported exactly like a missing one.
  if v_team is null or auth.uid() is null or not private.is_admin_of_team(v_team) then
    raise exception 'API key not found' using errcode = '42501';
  end if;
  update public.company_api_keys
     set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, auth.uid())
   where id = p_key;
  insert into public.access_log(actor_id, athlete_id, action, detail)
  values (auth.uid(), null, 'company_api_key_revoked', jsonb_build_object('team_id', v_team, 'key_id', p_key));
  return true;
end;
$$;
revoke all on function public.revoke_company_api_key(uuid) from public, anon, authenticated;
grant execute on function public.revoke_company_api_key(uuid) to authenticated;

-- ------------------------------------------------------------------------------------ authentication
create or replace function private.company_api_authenticate(p_secret text, p_scope text)
returns public.company_api_keys language plpgsql security definer set search_path = '' as $$
declare
  v_key public.company_api_keys;
  v_used integer;
begin
  if p_secret is null or p_secret !~ '^ppk_[0-9a-f]{8}_[0-9a-f]{56}$' then
    raise exception 'invalid API key' using errcode = '28000';
  end if;
  select * into v_key from public.company_api_keys k where k.key_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
  -- Unknown, revoked and expired keys get one answer, so a caller cannot tell which it holds.
  if not found or v_key.revoked_at is not null or v_key.expires_at <= now() then
    raise exception 'invalid API key' using errcode = '28000';
  end if;
  if not (p_scope = any(v_key.scopes)) then
    raise exception 'this API key does not carry the % scope', p_scope using errcode = '42501';
  end if;
  insert into private.company_api_key_windows as w (key_id, window_start, request_count)
  values (v_key.id, date_trunc('minute', now()), 1)
  on conflict (key_id, window_start) do update set request_count = w.request_count + 1
  returning w.request_count into v_used;
  if v_used > v_key.rate_limit_per_minute then
    raise exception 'rate limit of % requests per minute exceeded', v_key.rate_limit_per_minute using errcode = '54000';
  end if;
  delete from private.company_api_key_windows w where w.key_id = v_key.id and w.window_start < now() - interval '10 minutes';
  update public.company_api_keys set last_used_at = now() where id = v_key.id;
  return v_key;
end;
$$;
revoke all on function private.company_api_authenticate(text, text) from public, anon, authenticated;

-- The rows a key may see, in one place, so list and get cannot disagree about scope.
create or replace function private.company_results_api_rows(p_team uuid, p_kind text)
returns table(id uuid, saved_at timestamptz, athlete_id uuid, record jsonb)
language sql stable security definer set search_path = '' as $$
  select b.id, b.saved_at, b.athlete_id, b.record
    from public.company_body_assessments b
   where p_kind = 'body_assessments'
     and b.team_id = p_team
     and b.retention_until > now()
     and exists (select 1 from public.team_memberships tm where tm.team_id = b.team_id and tm.athlete_id = b.athlete_id)
     and exists (select 1 from public.biometric_consents c
                  where c.id = b.consent_id and c.athlete_id = b.athlete_id
                    and c.revoked_at is null and c.retention_until >= current_date)
  union all
  select r.id, r.saved_at, null::uuid, r.record
    from public.company_reference_assessments r
   where p_kind = 'reference_assessments'
     and r.team_id = p_team
     and r.retention_until > now()
$$;
revoke all on function private.company_results_api_rows(uuid, text) from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------ the API
create or replace function public.company_results_api_list(
  p_secret text, p_kind text, p_cursor text default null, p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key public.company_api_keys;
  v_limit integer := coalesce(p_limit, 50);
  v_after_saved timestamptz;
  v_after_id uuid;
  v_items jsonb;
  v_next text;
begin
  v_key := private.company_api_authenticate(p_secret, 'results:read');
  if p_kind is null or p_kind not in ('body_assessments', 'reference_assessments') then
    raise exception 'unknown result kind' using errcode = '22023';
  end if;
  if v_limit < 1 or v_limit > 100 then
    raise exception 'limit must be between 1 and 100' using errcode = '22023';
  end if;
  if p_cursor is not null then
    begin
      v_after_saved := split_part(convert_from(decode(p_cursor, 'hex'), 'UTF8'), '|', 1)::timestamptz;
      v_after_id := split_part(convert_from(decode(p_cursor, 'hex'), 'UTF8'), '|', 2)::uuid;
    exception when others then
      raise exception 'invalid cursor' using errcode = '22023';
    end;
  end if;

  with page as (
    select v.id, v.saved_at, v.athlete_id, v.record,
           row_number() over (order by v.saved_at desc, v.id desc) as n
      from private.company_results_api_rows(v_key.team_id, p_kind) v
     where v_after_saved is null or (v.saved_at, v.id) < (v_after_saved, v_after_id)
     order by v.saved_at desc, v.id desc
     limit v_limit + 1
  ), logged as (
    insert into public.access_log(actor_id, athlete_id, action, detail)
    select null, p.athlete_id, 'company_results_api_read',
           jsonb_build_object('team_id', v_key.team_id, 'key_id', v_key.id, 'kind', p_kind, 'result_id', p.id)
      from page p
     where p.n <= v_limit
    returning 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'savedAt', p.saved_at, 'record', p.record) order by p.n)
                    filter (where p.n <= v_limit), '[]'::jsonb),
         case when count(*) > v_limit then
           encode(convert_to((array_agg(p.saved_at::text || '|' || p.id::text order by p.n desc) filter (where p.n <= v_limit))[1], 'UTF8'), 'hex')
         end
    into v_items, v_next
    from page p;

  return jsonb_build_object('schema', 'PP_COMPANY_RESULTS_PAGE_V1', 'kind', p_kind, 'items', v_items, 'nextCursor', v_next);
end;
$$;

create or replace function public.company_results_api_get(p_secret text, p_kind text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key public.company_api_keys;
  v_row record;
begin
  v_key := private.company_api_authenticate(p_secret, 'results:read');
  if p_kind is null or p_kind not in ('body_assessments', 'reference_assessments') then
    raise exception 'unknown result kind' using errcode = '22023';
  end if;
  select v.id, v.saved_at, v.athlete_id, v.record into v_row
    from private.company_results_api_rows(v_key.team_id, p_kind) v
   where v.id = p_id;
  -- Missing, expired, withdrawn and another organization's all come back as nothing.
  if not found then return null; end if;
  insert into public.access_log(actor_id, athlete_id, action, detail)
  values (null, v_row.athlete_id, 'company_results_api_read',
          jsonb_build_object('team_id', v_key.team_id, 'key_id', v_key.id, 'kind', p_kind, 'result_id', v_row.id));
  return jsonb_build_object('schema', 'PP_COMPANY_RESULT_V1', 'kind', p_kind, 'id', v_row.id, 'savedAt', v_row.saved_at, 'record', v_row.record);
end;
$$;

-- Deletion reaches every row the organization holds, including one whose release was withdrawn or
-- whose athlete left the roster: removing data is never the direction to restrict.
create or replace function public.company_results_api_delete(p_secret text, p_kind text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key public.company_api_keys;
  v_athlete uuid;
  v_deleted boolean;
begin
  v_key := private.company_api_authenticate(p_secret, 'results:delete');
  if p_kind is null or p_kind not in ('body_assessments', 'reference_assessments') then
    raise exception 'unknown result kind' using errcode = '22023';
  end if;
  if p_kind = 'body_assessments' then
    delete from public.company_body_assessments b where b.id = p_id and b.team_id = v_key.team_id returning b.athlete_id into v_athlete;
  else
    delete from public.company_reference_assessments r where r.id = p_id and r.team_id = v_key.team_id;
  end if;
  v_deleted := found;
  if v_deleted then
    insert into public.access_log(actor_id, athlete_id, action, detail)
    values (null, v_athlete, 'company_results_api_delete',
            jsonb_build_object('team_id', v_key.team_id, 'key_id', v_key.id, 'kind', p_kind, 'result_id', p_id));
  end if;
  return jsonb_build_object('schema', 'PP_COMPANY_RESULT_DELETION_V1', 'kind', p_kind, 'id', p_id, 'deleted', v_deleted);
end;
$$;

revoke all on function public.company_results_api_list(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.company_results_api_get(text, text, uuid) from public, anon, authenticated;
revoke all on function public.company_results_api_delete(text, text, uuid) from public, anon, authenticated;
grant execute on function public.company_results_api_list(text, text, text, integer) to service_role;
grant execute on function public.company_results_api_get(text, text, uuid) to service_role;
grant execute on function public.company_results_api_delete(text, text, uuid) to service_role;
