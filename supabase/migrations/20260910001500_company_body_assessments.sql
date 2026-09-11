-- Portable company SDK assessments persisted under an existing team/roster scope.
-- This table contains curated scalar records only. Source photos and derived geometry
-- stay outside the database contract.

create or replace function private.company_body_payload_has_forbidden_key(payload jsonb)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare item record;
declare normalized_key text;
begin
  if jsonb_typeof(payload) = 'object' then
    for item in select key,value from jsonb_each(payload) loop
      normalized_key=lower(regexp_replace(item.key,'([a-z0-9])([A-Z])','\1_\2','g'));
      if normalized_key ~ '(^|_)(photo|photos|image|images|landmark|landmarks|mask|masks|contour|contours|mesh|meshes|geometry|geometries|vertex|vertices|face|faces|digest|digests|fingerprint|fingerprints)($|_)' then return true; end if;
      if private.company_body_payload_has_forbidden_key(item.value) then return true; end if;
    end loop;
  elsif jsonb_typeof(payload) = 'array' then
    for item in select value from jsonb_array_elements(payload) loop
      if private.company_body_payload_has_forbidden_key(item.value) then return true; end if;
    end loop;
  end if;
  return false;
end;
$$;

create or replace function private.company_body_payload_is_allowed(
  payload jsonb, row_assessment text, row_athlete uuid, row_team uuid,
  row_actor uuid, row_consent uuid, row_captured timestamptz,
  row_saved timestamptz, row_retention timestamptz)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare allowed boolean;
begin
  if jsonb_typeof(payload) <> 'object' or private.company_body_payload_has_forbidden_key(payload) then return false; end if;
  select not exists (
    select 1 from jsonb_object_keys(payload) key
    where key <> all(array['schema','assessmentId','subjectId','organizationId','createdBy','consentReference','capturedAt','savedAt','retentionUntil','assessment','surfaceProcessing','dataScope','limitations'])
  ) into allowed;
  if not allowed
     or payload->>'schema' is distinct from 'PP_COMPANY_BODY_ASSESSMENT_V1'
     or payload->>'assessmentId' is distinct from row_assessment
     or payload->>'subjectId' is distinct from row_athlete::text
     or payload->>'organizationId' is distinct from row_team::text
     or payload->>'createdBy' is distinct from row_actor::text
     or payload->>'consentReference' is distinct from row_consent::text
     or (payload->>'capturedAt')::timestamptz is distinct from row_captured
     or (payload->>'savedAt')::timestamptz is distinct from row_saved
     or (payload->>'retentionUntil')::timestamptz is distinct from row_retention
     or jsonb_typeof(payload->'assessment') <> 'object'
     or payload#>>'{assessment,schema}' is distinct from 'PP_BODY_SDK_SUMMARY_V1'
     or payload#>>'{assessment,status}' is distinct from 'provisional'
     or payload#>>'{assessment,unit}' is distinct from 'in'
     or coalesce(payload#>>'{assessment,surfaceStatus}','') <> all(array['generated','rejected','skipped','unavailable','not_requested'])
     or jsonb_typeof(payload#>'{assessment,measurements}') <> 'array'
     or jsonb_array_length(payload#>'{assessment,measurements}') > 25
     or jsonb_typeof(payload#>'{assessment,missingOutputs}') <> 'array'
     or jsonb_typeof(payload#>'{assessment,pairs}') <> 'array'
     or jsonb_typeof(payload#>'{assessment,engine}') <> 'object' then return false;
  end if;
  if exists (select 1 from jsonb_object_keys(payload->'assessment') key where key <> all(array['schema','sdkVersion','createdAt','status','unit','height','processingMs','engine','surfaceStatus','outputCount','measurements','missingOutputs','pairs'])) then return false; end if;
  if exists (select 1 from jsonb_object_keys(payload#>'{assessment,engine}') key where key <> all(array['id','version','model'])) then return false; end if;
  if exists (select 1 from jsonb_array_elements(payload#>'{assessment,measurements}') as element(item) where jsonb_typeof(element.item)<>'object' or exists(select 1 from jsonb_object_keys(element.item) key where key <> all(array['key','label','value','unit','definition']))) then return false; end if;
  if exists (select 1 from jsonb_array_elements(payload#>'{assessment,pairs}') as element(item) where jsonb_typeof(element.item)<>'object' or exists(select 1 from jsonb_object_keys(element.item) key where key <> all(array['label','left','right','difference']))) then return false; end if;
  if payload->'surfaceProcessing' <> 'null'::jsonb then
    if jsonb_typeof(payload->'surfaceProcessing') <> 'object'
       or payload#>>'{surfaceProcessing,schema}' is distinct from 'PP_COMPANY_SURFACE_PROCESSING_V1'
       or exists (select 1 from jsonb_object_keys(payload->'surfaceProcessing') key where key <> all(array['schema','status','adjustment'])) then return false; end if;
    if payload#>'{surfaceProcessing,adjustment}' <> 'null'::jsonb and (
      jsonb_typeof(payload#>'{surfaceProcessing,adjustment}') <> 'object'
      or exists (select 1 from jsonb_object_keys(payload#>'{surfaceProcessing,adjustment}') key where key <> all(array['protocol','componentCountBefore','originalOccupiedVoxels','removedVoxels','removedFraction','affectedFromFloorFraction','affectedToFloorFraction']))
    ) then return false; end if;
  end if;
  return true;
exception when others then
  return false;
end;
$$;

create table if not exists public.company_body_assessments (
  id uuid primary key default gen_random_uuid(),
  assessment_id text not null check (char_length(assessment_id) between 1 and 180),
  team_id uuid not null references public.teams(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  consent_id uuid not null references public.biometric_consents(id),
  created_by uuid not null references auth.users(id),
  captured_at timestamptz not null,
  saved_at timestamptz not null,
  retention_until timestamptz not null,
  record jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(team_id,athlete_id,assessment_id),
  check (retention_until > captured_at),
  check (private.company_body_payload_is_allowed(record,assessment_id,athlete_id,team_id,created_by,consent_id,captured_at,saved_at,retention_until))
);
create index if not exists company_body_assessments_retention_idx on public.company_body_assessments(retention_until);
create index if not exists company_body_assessments_subject_idx on public.company_body_assessments(team_id,athlete_id,saved_at desc);

alter table public.company_body_assessments enable row level security;

create or replace function private.can_manage_company_body_assessment(requested_team uuid,requested_athlete uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin_of_team(requested_team)
    and exists(select 1 from public.team_memberships tm where tm.team_id=requested_team and tm.athlete_id=requested_athlete);
$$;
revoke all on function private.can_manage_company_body_assessment(uuid,uuid) from public,anon,authenticated;
grant execute on function private.can_manage_company_body_assessment(uuid,uuid) to authenticated;

-- Evaluate the parent-granted consent behind the policy boundary. Team administrators
-- can manage a rostered athlete's company assessment, but the existing consent-table
-- RLS intentionally exposes consent rows only through family access. Without this
-- narrow definer function, a valid consent can be invisible inside the INSERT/UPDATE
-- policy and every company write is denied. Only a boolean is returned; the release
-- record and its detail never become readable to the organization account.
create or replace function private.can_use_company_body_consent(
  requested_consent uuid, requested_athlete uuid, requested_retention timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.biometric_consents c
    where c.id=requested_consent
      and c.athlete_id=requested_athlete
      and c.revoked_at is null
      and c.retention_until>=current_date
      and requested_retention::date<=c.retention_until
  );
$$;
revoke all on function private.can_use_company_body_consent(uuid,uuid,timestamptz) from public,anon,authenticated;

-- This is the only consent decision exposed to an organization account. It first
-- proves that the caller administers the requested team and that the athlete is on
-- that roster, then checks the otherwise-hidden parent consent.
create or replace function private.can_write_company_body_assessment(
  requested_team uuid, requested_athlete uuid, requested_consent uuid, requested_retention timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_manage_company_body_assessment(requested_team,requested_athlete)
    and private.can_use_company_body_consent(requested_consent,requested_athlete,requested_retention);
$$;
revoke all on function private.can_write_company_body_assessment(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.can_write_company_body_assessment(uuid,uuid,uuid,timestamptz) to authenticated;

create policy company_body_select on public.company_body_assessments for select to authenticated
  using (private.can_manage_company_body_assessment(team_id,athlete_id));
create policy company_body_insert on public.company_body_assessments for insert to authenticated
  with check (created_by=auth.uid()
    and private.can_write_company_body_assessment(team_id,athlete_id,consent_id,retention_until));
create policy company_body_update on public.company_body_assessments for update to authenticated
  using (private.can_manage_company_body_assessment(team_id,athlete_id))
  with check (created_by=auth.uid()
    and private.can_write_company_body_assessment(team_id,athlete_id,consent_id,retention_until));
create policy company_body_delete on public.company_body_assessments for delete to authenticated
  using (private.can_manage_company_body_assessment(team_id,athlete_id));
grant select,insert,update,delete on public.company_body_assessments to authenticated;

create or replace function private.audit_company_body_assessment_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.access_log(actor_id,athlete_id,action,detail)
  values ((select auth.uid()),coalesce(new.athlete_id,old.athlete_id),'company_body_assessment_'||lower(tg_op),
    jsonb_build_object('team_id',coalesce(new.team_id,old.team_id),'assessment_id',coalesce(new.assessment_id,old.assessment_id)));
  return coalesce(new,old);
end;
$$;
create trigger company_body_assessment_audit after insert or update or delete on public.company_body_assessments
  for each row execute function private.audit_company_body_assessment_change();

create or replace function private.sweep_company_body_assessment_retention()
returns integer language plpgsql security definer set search_path = '' as $$
declare deleted_count integer;
begin
  with gone as (delete from public.company_body_assessments where retention_until<=now() returning id)
  select count(*) into deleted_count from gone;
  return deleted_count;
end;
$$;
revoke all on function private.sweep_company_body_assessment_retention() from public,anon,authenticated;
select cron.unschedule('company-body-assessment-retention') where exists(select 1 from cron.job where jobname='company-body-assessment-retention');
select cron.schedule('company-body-assessment-retention','35 3 * * *',$$select private.sweep_company_body_assessment_retention();$$);
