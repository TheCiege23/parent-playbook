-- Separate organization-owned adult reference records for SDK/buyer acceptance.
-- These records never require, create or reference a child athlete profile.

create or replace function private.company_reference_payload_is_allowed(
  payload jsonb, row_assessment text, row_subject text, row_team uuid,
  row_actor uuid, row_consent text, row_captured timestamptz,
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
     or payload->>'subjectId' is distinct from row_subject
     or payload->>'organizationId' is distinct from row_team::text
     or payload->>'createdBy' is distinct from row_actor::text
     or payload->>'consentReference' is distinct from row_consent
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
exception when others then return false;
end;
$$;

create table if not exists public.company_reference_assessments (
  id uuid primary key default gen_random_uuid(),
  assessment_id text not null check (char_length(assessment_id) between 1 and 180 and assessment_id=btrim(assessment_id)),
  team_id uuid not null references public.teams(id) on delete cascade,
  subject_reference text not null check (char_length(subject_reference) between 1 and 180 and subject_reference=btrim(subject_reference)),
  consent_reference text not null check (char_length(consent_reference) between 1 and 180 and consent_reference=btrim(consent_reference)),
  adult_attested_at timestamptz not null,
  created_by uuid not null references auth.users(id),
  captured_at timestamptz not null,
  saved_at timestamptz not null,
  retention_until timestamptz not null,
  record jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(team_id,subject_reference,assessment_id),
  check (retention_until > captured_at and adult_attested_at <= saved_at),
  check (private.company_reference_payload_is_allowed(record,assessment_id,subject_reference,team_id,created_by,consent_reference,captured_at,saved_at,retention_until))
);
create index if not exists company_reference_retention_idx on public.company_reference_assessments(retention_until);
create index if not exists company_reference_subject_idx on public.company_reference_assessments(team_id,subject_reference,saved_at desc);

alter table public.company_reference_assessments enable row level security;
create policy company_reference_select on public.company_reference_assessments for select to authenticated using (private.is_admin_of_team(team_id));
create policy company_reference_insert on public.company_reference_assessments for insert to authenticated with check (created_by=auth.uid() and private.is_admin_of_team(team_id));
create policy company_reference_update on public.company_reference_assessments for update to authenticated using (private.is_admin_of_team(team_id)) with check (created_by=auth.uid() and private.is_admin_of_team(team_id));
create policy company_reference_delete on public.company_reference_assessments for delete to authenticated using (private.is_admin_of_team(team_id));
grant select,insert,update,delete on public.company_reference_assessments to authenticated;

create or replace function private.audit_company_reference_assessment_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.access_log(actor_id,athlete_id,action,detail)
  values ((select auth.uid()),null,'company_reference_assessment_'||lower(tg_op),
    jsonb_build_object('team_id',coalesce(new.team_id,old.team_id),'assessment_id',coalesce(new.assessment_id,old.assessment_id),'subject_reference',coalesce(new.subject_reference,old.subject_reference)));
  return coalesce(new,old);
end;
$$;
create trigger company_reference_assessment_audit after insert or update or delete on public.company_reference_assessments
  for each row execute function private.audit_company_reference_assessment_change();

create or replace function private.sweep_company_reference_assessment_retention()
returns integer language plpgsql security definer set search_path = '' as $$
declare deleted_count integer;
begin
  with gone as (delete from public.company_reference_assessments where retention_until<=now() returning id)
  select count(*) into deleted_count from gone;
  return deleted_count;
end;
$$;
revoke all on function private.sweep_company_reference_assessment_retention() from public,anon,authenticated;
select cron.unschedule('company-reference-assessment-retention') where exists(select 1 from cron.job where jobname='company-reference-assessment-retention');
select cron.schedule('company-reference-assessment-retention','40 3 * * *',$$select private.sweep_company_reference_assessment_retention();$$);
