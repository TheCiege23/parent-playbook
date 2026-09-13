-- A body scan becomes one record.
--
-- Until now a parent's four-photo scan existed only as up to 25 rows in public.measurements, each
-- carrying a copy of the same PP_SCAN_V1 note. Nothing in the database knew those rows were one
-- scan: the app rebuilt the session by parsing notes, a single scan could not be deleted, consent
-- was checked only by the browser, and nothing stopped a photo or landmark field arriving in the
-- provenance. This makes the scan a row of its own:
--
--   - public.body_scan_assessments holds one row per scan: athlete, the release it was taken under,
--     the engine, when it was captured, when it must be destroyed, and scalar provenance only;
--   - measurements.scan_assessment_id links the outputs to it. A composite foreign key keeps a row
--     and its scan on the same athlete, and deleting the scan deletes its outputs;
--   - public.save_body_scan_assessment() writes the scan and its outputs in one transaction, as the
--     signed-in guardian, so a dropped connection cannot leave one without the other;
--   - a trigger requires a live release for this athlete AND this scan method, including for the
--     service role, which bypasses row-level security;
--   - the provenance is held to an exact key list and refused if any key names a photo, image,
--     landmark, mask, contour, mesh, geometry, vertex, face, digest or fingerprint;
--   - inserts and deletes are written to access_log with identifiers only, never a measurement;
--   - the nightly biometric-retention sweep also deletes scans past their retention_until.
--
-- What does NOT change: withdrawing a release still stops future scans without deleting saved ones,
-- and every existing reader of measurements keeps working, because the note is still written.
--
-- If the guardian who gave the release deletes their account, the release row goes and the scan's
-- consent_id is cleared rather than the scan deleted: a co-parent leaving must not erase the other
-- parent's child's records. The retention date the scan was saved with still governs it.

-- ---------------------------------------------------------------------------------------------
-- Provenance. The same token rule the company assessment tables use, plus an exact key list. The
-- browser's key photo_reuse_check is stored as reuse_check: "photo" is a forbidden token, and this
-- key describes a check that the four photos were distinct files, not a photo.
create or replace function private.body_scan_record_is_allowed(record jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(record) = 'object'
     and length(record::text) <= 16000
     and not exists (
       select 1 from jsonb_object_keys(record) k
        where k not in ('processing', 'reuse_check', 'output_dictionary', 'side_method', 'input_height', 'quality'))
     and not private.company_body_payload_has_forbidden_key(record);
$$;

create table if not exists public.body_scan_assessments (
  id uuid primary key,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  consent_id uuid references public.biometric_consents(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  engine_id text not null check (length(engine_id) between 1 and 80),
  engine_version text not null check (length(engine_version) between 1 and 80),
  engine_model text not null check (length(engine_model) between 1 and 80),
  captured_at timestamptz not null,
  -- The family's calendar day, which can differ from the UTC date of captured_at by one.
  measured_on date not null,
  saved_at timestamptz not null default now(),
  retention_until timestamptz not null,
  output_count smallint not null check (output_count between 1 and 32),
  record jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint body_scan_assessments_id_athlete_key unique (id, athlete_id),
  constraint body_scan_assessments_measured_on_check
    check (measured_on between (captured_at at time zone 'UTC')::date - 1 and (captured_at at time zone 'UTC')::date + 1),
  constraint body_scan_assessments_retention_check
    check (retention_until > captured_at and retention_until <= captured_at + interval '12 months 1 day'),
  constraint body_scan_assessments_record_check check (private.body_scan_record_is_allowed(record))
);

comment on table public.body_scan_assessments is
  'One parent body scan. Its outputs are the measurements rows that reference it. Scalar provenance only: no photos, landmarks or geometry.';

create index if not exists body_scan_assessments_athlete_captured_idx on public.body_scan_assessments (athlete_id, captured_at desc);
create index if not exists body_scan_assessments_consent_idx on public.body_scan_assessments (consent_id);
create index if not exists body_scan_assessments_created_by_idx on public.body_scan_assessments (created_by);
create index if not exists body_scan_assessments_retention_idx on public.body_scan_assessments (retention_until);

alter table public.measurements add column if not exists scan_assessment_id uuid;
alter table public.measurements
  add constraint measurements_scan_assessment_fkey foreign key (scan_assessment_id, athlete_id)
  references public.body_scan_assessments (id, athlete_id) on delete cascade;
alter table public.measurements
  add constraint measurements_scan_assessment_photo_check check (scan_assessment_id is null or source = 'photo');
create index if not exists measurements_scan_assessment_idx on public.measurements (scan_assessment_id) where scan_assessment_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Consent, enforced for every writer. A release covers one scan method: consent to the on-device
-- pose engine is not consent to anything else.
create or replace function private.scan_consent_is_live(consent uuid, ath uuid, engine text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.biometric_consents c
    where c.id = consent and c.athlete_id = ath and c.scan_engine = engine
      and c.revoked_at is null and c.retention_until >= current_date);
$$;
revoke all on function private.scan_consent_is_live(uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.scan_consent_is_live(uuid, uuid, text) to authenticated;

create or replace function private.require_body_scan_consent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.consent_id is null or not private.scan_consent_is_live(new.consent_id, new.athlete_id, new.engine_id) then
    raise exception 'That scan permission is not live for this athlete and scan method. Ask for permission again before saving.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists body_scan_assessment_consent_gate on public.body_scan_assessments;
create trigger body_scan_assessment_consent_gate
  before insert on public.body_scan_assessments
  for each row execute function private.require_body_scan_consent();

-- ---------------------------------------------------------------------------------------------
-- Audit: identifiers and provenance only. When the whole athlete is being deleted, the athlete row
-- is already gone by the time this runs, so the log keeps no link to it rather than failing the delete.
create or replace function private.audit_body_scan_assessment_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ath uuid := coalesce(new.athlete_id, old.athlete_id);
begin
  insert into public.access_log(actor_id, athlete_id, action, detail)
  values ((select auth.uid()),
    case when exists (select 1 from public.athletes a where a.id = ath) then ath end,
    'body_scan_assessment_' || lower(tg_op),
    jsonb_build_object(
      'assessment_id', coalesce(new.id, old.id),
      'athlete_id', ath,
      'engine_id', coalesce(new.engine_id, old.engine_id),
      'engine_version', coalesce(new.engine_version, old.engine_version),
      'output_count', coalesce(new.output_count, old.output_count),
      'captured_at', coalesce(new.captured_at, old.captured_at)));
  return coalesce(new, old);
end;
$$;
drop trigger if exists body_scan_assessment_audit on public.body_scan_assessments;
create trigger body_scan_assessment_audit
  after insert or delete on public.body_scan_assessments
  for each row execute function private.audit_body_scan_assessment_change();

-- ---------------------------------------------------------------------------------------------
-- Access. Read follows the measurements it describes, including the coach and organization
-- policies measurements already carries. Write is edit rights, as the signed-in guardian. There is
-- no UPDATE: a scan is a record of what happened, and a correction is a new scan.
alter table public.body_scan_assessments enable row level security;

drop policy if exists body_scan_assessment_select on public.body_scan_assessments;
create policy body_scan_assessment_select on public.body_scan_assessments for select to authenticated
  using (private.can_view_athlete(athlete_id) or private.can_coach_view_athlete(athlete_id) or private.can_org_view_athlete(athlete_id));
drop policy if exists body_scan_assessment_insert on public.body_scan_assessments;
create policy body_scan_assessment_insert on public.body_scan_assessments for insert to authenticated
  with check (created_by = (select auth.uid()) and private.can_edit_athlete(athlete_id));
drop policy if exists body_scan_assessment_delete on public.body_scan_assessments;
create policy body_scan_assessment_delete on public.body_scan_assessments for delete to authenticated
  using (private.can_edit_athlete(athlete_id));

revoke all on public.body_scan_assessments from anon, authenticated;
grant select, insert, delete on public.body_scan_assessments to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The save. Security invoker, so row-level security applies to both inserts exactly as it would to
-- the caller writing them directly. Stable ids from the browser make a retry after a dropped
-- connection a no-op rather than a duplicate.
create or replace function public.save_body_scan_assessment(p_assessment jsonb, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
  v_athlete uuid;
  v_consent uuid;
  v_captured timestamptz;
  v_measured date;
  v_count integer;
  v_consent_until date;
  v_retention timestamptz;
begin
  if v_actor is null then
    raise exception 'Sign in to save a scan.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_assessment) is distinct from 'object' or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'A scan needs its record and its measurements.' using errcode = '22023';
  end if;

  v_id := (p_assessment->>'id')::uuid;
  v_athlete := (p_assessment->>'athlete_id')::uuid;
  v_consent := (p_assessment->>'consent_id')::uuid;
  v_captured := (p_assessment->>'captured_at')::timestamptz;
  v_count := jsonb_array_length(p_rows);

  if v_id is null or v_athlete is null or v_captured is null then
    raise exception 'A scan needs an id, an athlete and a capture time.' using errcode = '22023';
  end if;
  if v_count < 1 or v_count > 32 then
    raise exception 'A scan saves between 1 and 32 measurements.' using errcode = '22023';
  end if;
  -- A scan is saved in the session that took it. A capture time far from now is a clock problem or
  -- a replay, not a scan.
  if v_captured > now() + interval '1 hour' or v_captured < now() - interval '7 days' then
    raise exception 'That scan''s capture time is not within the last week.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) r
     where jsonb_typeof(r) is distinct from 'object'
        or (r->>'athlete_id') is distinct from v_athlete::text
        or (r->>'created_by') is distinct from v_actor::text
        or (r->>'scan_assessment_id') is distinct from v_id::text
        or (r->>'source') is distinct from 'photo'
        or (r->>'measured_on') is distinct from (p_rows->0->>'measured_on')) then
    raise exception 'Every measurement must belong to this scan, this athlete and the signed-in guardian.' using errcode = '22023';
  end if;
  v_measured := (p_rows->0->>'measured_on')::date;

  -- Destroyed at the earlier of twelve months after capture and the end of the release it was taken under.
  select c.retention_until into v_consent_until from public.biometric_consents c where c.id = v_consent;
  v_retention := least(v_captured + interval '12 months',
    coalesce((v_consent_until + 1)::timestamp at time zone 'UTC', v_captured + interval '12 months'));

  insert into public.body_scan_assessments(id, athlete_id, consent_id, created_by, engine_id, engine_version, engine_model,
    captured_at, measured_on, retention_until, output_count, record)
  values (v_id, v_athlete, v_consent, v_actor, p_assessment#>>'{engine,id}', p_assessment#>>'{engine,version}',
    p_assessment#>>'{engine,model}', v_captured, v_measured, v_retention, v_count,
    coalesce(p_assessment->'record', '{}'::jsonb))
  on conflict (id) do nothing;

  insert into public.measurements(id, athlete_id, metric_key, value, unit, source, measured_on, created_by, note, scan_assessment_id)
  select (r->>'id')::uuid, v_athlete, r->>'metric_key', (r->>'value')::numeric, r->>'unit', 'photo', v_measured, v_actor,
         r->>'note', v_id
    from jsonb_array_elements(p_rows) r
  on conflict (id) do nothing;

  return jsonb_build_object('id', v_id, 'outputs', v_count);
end;
$$;
revoke all on function public.save_body_scan_assessment(jsonb, jsonb) from public, anon;
grant execute on function public.save_body_scan_assessment(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Retention. The legacy date sweep stays for jump rows and any scan row that is not linked; linked
-- rows go with their scan, on the scan's own retention date.
create or replace function private.sweep_biometric_retention()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  a integer;
begin
  with gone_scans as (
    delete from public.body_scan_assessments where retention_until <= now() returning id
  )
  select count(*) into a from gone_scans;

  -- 'video' added alongside 'photo': the jump-capture engine (js/jump-measure.js) makes
  -- the exact same on-device, never-uploaded, retention-scheduled promise on its consent
  -- screen as the body scan does, on the same 12-month schedule, and an unenforced
  -- schedule is the specific thing BIPA 15(a) prohibits.
  with gone as (
    delete from public.measurements
     where source in ('photo', 'video')
       and measured_on < (current_date - interval '12 months')
    returning athlete_id
  )
  select count(*) into n from gone;

  if n > 0 or a > 0 then
    insert into public.access_log(actor_id, athlete_id, action, detail)
    values (null, null, 'biometric_retention_sweep',
            jsonb_build_object('deleted', n, 'scans_deleted', a, 'cutoff', (current_date - interval '12 months')::date));
  end if;

  return n + a;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Existing scans. Rows saved before this migration are linked when their note parses, names this
-- athlete, and the release it names is still live for the same engine. Anything else keeps its note,
-- stays readable exactly as before and is swept on the existing date rule.
create or replace function private.try_scan_note(note text)
returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  if note is null or left(note, 11) <> 'PP_SCAN_V1:' or length(note) > 16000 then return null; end if;
  return substr(note, 12)::jsonb;
exception when others then
  return null;
end;
$$;

create or replace function private.link_legacy_body_scans()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  linked integer := 0;
  scan record;
  v_captured timestamptz;
  v_consent_until date;
begin
  for scan in
    with parsed as (
      select m.id as row_id, m.athlete_id, m.measured_on, m.created_by, private.try_scan_note(m.note) as meta
        from public.measurements m
       where m.scan_assessment_id is null and m.source = 'photo' and m.note like 'PP_SCAN_V1:%'
    )
    select p.meta->>'id' as scan_id, p.athlete_id, min(p.measured_on) as measured_on,
           (array_agg(p.created_by))[1] as created_by, (array_agg(p.meta))[1] as meta,
           count(*) as n, array_agg(p.row_id) as row_ids
      from parsed p
     where p.meta is not null and p.meta->>'schema' = '1' and p.meta->>'athlete_id' = p.athlete_id::text
     group by p.meta->>'id', p.athlete_id
  loop
    begin
      v_captured := (scan.meta->>'captured_at')::timestamptz;
      select c.retention_until into v_consent_until from public.biometric_consents c where c.id = (scan.meta->>'consent_id')::uuid;
      insert into public.body_scan_assessments(id, athlete_id, consent_id, created_by, engine_id, engine_version, engine_model,
        captured_at, measured_on, retention_until, output_count, record)
      values ((scan.scan_id)::uuid, scan.athlete_id, (scan.meta->>'consent_id')::uuid, scan.created_by,
        scan.meta#>>'{engine,id}', scan.meta#>>'{engine,version}', scan.meta#>>'{engine,model}',
        v_captured, scan.measured_on,
        least(v_captured + interval '12 months',
          coalesce((v_consent_until + 1)::timestamp at time zone 'UTC', v_captured + interval '12 months')),
        scan.n,
        jsonb_build_object('processing', scan.meta->'processing', 'reuse_check', scan.meta->'photo_reuse_check',
          'output_dictionary', scan.meta->'output_dictionary', 'side_method', scan.meta->'side_method',
          'input_height', scan.meta->'input_height', 'quality', scan.meta->'quality'));
      update public.measurements set scan_assessment_id = (scan.scan_id)::uuid where id = any(scan.row_ids);
      linked := linked + scan.n;
    exception when others then
      -- A legacy scan that today's rules would refuse (a withdrawn or expired release, too many rows,
      -- an unrecognised provenance key) is left exactly as it was.
      null;
    end;
  end loop;
  return linked;
end;
$$;
revoke all on function private.link_legacy_body_scans() from public, anon, authenticated;
revoke all on function private.try_scan_note(text) from public, anon, authenticated;

select private.link_legacy_body_scans();
