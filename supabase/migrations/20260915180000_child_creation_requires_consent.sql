-- Consent is required in the database for every new child.
--
-- Until now the browser was the only place a child's consent was required. public.create_athlete_onboarding()
-- (20260806143444) wrote one consent row per entry it was handed and never checked that the list held any, so a call
-- with p_consents = '[]' created a child with no consent at all. And the ath_insert policy (20260730143035) let any
-- owner or co-parent insert into public.athletes directly, past that function entirely. On 2026-09-15 a signed-in
-- regression in production found that a signed-in parent could not add a child, because the only consent check lived on a
-- browser screen they never saw; PR #105 fixed the browser. This closes the database. Three options were weighed, and all
-- three are taken, because each covers what the others do not.
--
-- (a) The function refuses. p_consents is read as a list of {"consent_type": <type>} entries, each a known type given
--     once, and anything else is refused (22023) instead of being cast and hoped for; a list without both child_data
--     and account is refused (22023). Both checks run before anything is written. On its own this leaves ath_insert
--     as a way around the function.
--
-- (b) The policy goes. ath_insert is dropped, so a signed-in account has no way to add a child except the function.
--     Nothing needed the policy: no client code, edge function or migration inserts athletes directly. Two rollback-only
--     scripts written for the live project did (tests/company-deletion-live-rls.sql, tests/sdk-supabase-live-rls.sql);
--     they now create their synthetic adult through the function. Table grants are left alone: row-level security is
--     the boundary here as it is across this schema, and with no INSERT policy it refuses. (a) and (b) together bind
--     only the authenticated role. The service role and the table owner bypass row-level security, and a future
--     SECURITY DEFINER function could add a child without asking.
--
-- (c) A deferred check on every writer. athletes_require_consent is a DEFERRABLE INITIALLY DEFERRED constraint trigger:
--     when the transaction commits, each child it inserted (or re-keyed) that still exists must have granted child_data
--     and account consent rows from one guardian who is, at that moment, a member of the child's household. Deferred,
--     because consent_records references athletes, so the rows that satisfy it can only be written after the child.
--     SET CONSTRAINTS can make it run earlier, never skip it. Its costs were checked before choosing it:
--       - It fires on INSERT (and a change of id), never on other updates or deletes, so delete-account's hand-over of
--         consent records to the guardian who stays (an UPDATE of consent_records) and a household's deletion
--         (cascading DELETEs) never meet it.
--       - It checks no existing row, so replaying the migration history, or applying this to a database that already
--         holds children, cannot fail on them. Counted read-only on 2026-09-15, the live project held 2 athletes, none
--         without a granted child_data or account consent, and none without either from a guardian who is currently a
--         member of its household.
--       - tests/db/10-fixtures.sql inserts its three synthetic athletes in one committed transaction, so it now inserts
--         their consent rows too.
--       - A pg_dump restore creates triggers after loading data and is unaffected. A data-only restore into a schema
--         that already has this trigger must load athletes and consent_records in one transaction, or disable
--         triggers, since each COPY committed on its own would meet the check before its consent rows exist.
--
-- What this guarantees: no transaction commits a new public.athletes row without granted child_data and account
-- consent rows from one guardian of that child's household, whichever role writes it, unless the trigger is disabled
-- (only the table owner or a superuser can) or the session runs with session_replication_role = replica (a privileged
-- setting that skips ordinary triggers).
--
-- What it does not: anything after that transaction commits. The service role or the owner can later change or delete
-- consent rows (a signed-in account can do neither); the guardian who consented can leave the household (delete-account
-- hands their rows to the guardian who stays; removing a member does not); an editor can still change a child's
-- family_id. Existing children are not re-checked. The database cannot tell that a person ticked a box, only that the
-- rows exist, and the optional consents (media, sharing, third_party) are not required.

create or replace function public.create_athlete_onboarding(
  p_new_family boolean,
  p_family_id uuid,
  p_family_name text,
  p_first text,
  p_birthdate date,
  p_hand text,
  p_sport text,
  p_positions text[],
  p_level text,
  p_goals jsonb,
  p_consents jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_family uuid;
  v_athlete uuid := gen_random_uuid();
  v_consents jsonb := coalesce(p_consents, '[]'::jsonb);
  g jsonb;
  c jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if coalesce(p_first,'') = '' then raise exception 'first name required'; end if;
  if coalesce(p_sport,'') = '' then raise exception 'sport required'; end if;

  -- Consent, before anything is written. Each entry is checked on its own terms rather than cast: an entry that is not
  -- an object, carries anything besides consent_type, names no known type, or repeats a type is refused. The CASE keeps
  -- the object-only operations off anything that is not an object, and "is not true" counts a NULL as a failure.
  if jsonb_typeof(v_consents) is distinct from 'array' then
    raise exception 'Each consent must be {"consent_type": <a known type>}, given once, in a list.' using errcode = '22023';
  end if;
  if exists (
       select 1 from jsonb_array_elements(v_consents) e
        where (case when jsonb_typeof(e) = 'object'
                    then e - 'consent_type' = '{}'::jsonb
                     and jsonb_typeof(e -> 'consent_type') = 'string'
                     and (e ->> 'consent_type') = any (enum_range(null::public.consent_type)::text[])
               end) is not true)
     or (select count(*) <> count(distinct e ->> 'consent_type') from jsonb_array_elements(v_consents) e) then
    raise exception 'Each consent must be {"consent_type": <a known type>}, given once, in a list.' using errcode = '22023';
  end if;
  if not (v_consents @> '[{"consent_type": "child_data"}]'::jsonb and v_consents @> '[{"consent_type": "account"}]'::jsonb) then
    raise exception 'Both required consents, child_data and account, are needed to add a child.' using errcode = '22023';
  end if;

  if p_new_family or p_family_id is null then
    v_family := gen_random_uuid();
    insert into public.families(id, name, created_by)
      values (v_family, coalesce(nullif(p_family_name,''), 'My Family'), v_uid);
    insert into public.family_members(family_id, guardian_id, role)
      values (v_family, v_uid, 'owner')
      on conflict do nothing;
  else
    v_family := p_family_id;
    if not exists (select 1 from public.family_members where family_id = v_family and guardian_id = v_uid) then
      raise exception 'not authorized for this family';
    end if;
  end if;

  insert into public.athletes(id, family_id, first_name, birthdate, dominant_hand, created_by)
    values (v_athlete, v_family, p_first, p_birthdate, nullif(p_hand,''), v_uid);

  insert into public.athlete_sports(athlete_id, sport_key, positions, level, is_primary)
    values (v_athlete, p_sport, coalesce(p_positions, '{}'::text[]), nullif(p_level,''), true);

  if p_goals is not null then
    for g in select * from jsonb_array_elements(p_goals) loop
      insert into public.goals(athlete_id, type, sport_key, key, label, created_by)
        values (v_athlete, (g->>'type')::public.goal_type, p_sport, g->>'key', g->>'label', v_uid);
    end loop;
  end if;

  for c in select * from jsonb_array_elements(v_consents) loop
    insert into public.consent_records(guardian_id, athlete_id, consent_type, granted, method)
      values (v_uid, v_athlete, (c->>'consent_type')::public.consent_type, true, 'onboarding_checkbox');
  end loop;

  return v_athlete;
end;
$$;

drop policy ath_insert on public.athletes;

-- SECURITY DEFINER so the check reads every consent and membership row whoever is committing, with row-level security
-- out of the way; it only reads. No tenant role may call it, and as a trigger function it cannot be called anyway.
create or replace function private.require_athlete_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family uuid;
begin
  -- The child as it stands when the check runs. One deleted again in the same transaction leaves nothing to protect.
  select a.family_id into v_family from public.athletes a where a.id = new.id;
  if not found then
    return null;
  end if;
  if not exists (
    select 1
      from public.family_members m
     where m.family_id = v_family
       and exists (select 1 from public.consent_records c
                    where c.athlete_id = new.id and c.guardian_id = m.guardian_id
                      and c.consent_type = 'child_data' and c.granted)
       and exists (select 1 from public.consent_records c
                    where c.athlete_id = new.id and c.guardian_id = m.guardian_id
                      and c.consent_type = 'account' and c.granted)
  ) then
    raise exception 'A child needs consent before it is saved: athlete % has no granted child_data and account consent from one guardian in its household.', new.id
      using errcode = '23514',
            hint = 'Add a child through public.create_athlete_onboarding(), which records both in the same transaction.';
  end if;
  return null;
end;
$$;
revoke all on function private.require_athlete_consent() from public, anon, authenticated;

create constraint trigger athletes_require_consent
  after insert or update of id on public.athletes
  deferrable initially deferred
  for each row execute function private.require_athlete_consent();
