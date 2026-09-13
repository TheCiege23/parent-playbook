-- Live rehearsal of organization deletion, enforced by row-level security.
--
-- The production deletion rehearsal of 2026-09-10 ran through the service role. It proved the schema,
-- triggers and audit trail in production, but it bypassed row-level security and left the audit actor
-- null. This is the missing half. Acting as an organization administrator, under row-level security,
-- it saves one synthetic body assessment and one synthetic adult reference assessment, shows that
-- another account cannot delete them, deletes them, and checks that each deletion is audited against
-- that administrator without keeping any of the deleted values.
--
-- Against a live project, run it only with the owner's authorization:
--
--   supabase db query --linked --file tests/company-deletion-live-rls.sql
--
-- Everything happens in one transaction that ends in ROLLBACK, so no row, audit entry or synthetic
-- organization survives the connection. tests/db/restore-deletion.cjs runs this exact file on the
-- disposable cluster (D08), and again with the refusal deliberately broken to prove it fails (D09).
begin;

create temporary table company_deletion_context (
  actor_id uuid not null,
  family_id uuid not null,
  athlete_id uuid not null,
  team_id uuid not null,
  membership_id uuid not null,
  consent_id uuid not null,
  assessment_id text not null,
  reference_id text not null,
  captured_at timestamptz not null,
  saved_at timestamptz not null,
  retention_until timestamptz not null
) on commit drop;

insert into company_deletion_context
select u.id, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  'deletion-rehearsal-' || gen_random_uuid()::text, 'deletion-rehearsal-ref-' || gen_random_uuid()::text,
  date_trunc('second', clock_timestamp()),
  date_trunc('second', clock_timestamp()) + interval '1 second',
  date_trunc('second', clock_timestamp()) + interval '30 days'
from auth.users u order by u.created_at limit 1;

do $$ begin
  if not exists (select 1 from company_deletion_context) then
    raise exception 'The deletion rehearsal needs one existing auth user to act as the administrator.';
  end if;
end $$;

grant select on company_deletion_context to authenticated;
select set_config('request.jwt.claim.sub', (select actor_id::text from company_deletion_context), true);
set local role authenticated;

-- A synthetic organization the administrator owns, with one rostered synthetic adult and a live release.
insert into public.families(id, name, created_by)
select family_id, 'Company deletion rehearsal (synthetic)', actor_id from company_deletion_context;
insert into public.athletes(id, family_id, first_name, birthdate, created_by)
select athlete_id, family_id, 'Synthetic Deletion Adult', '1990-01-01', actor_id from company_deletion_context;
insert into public.teams(id, name, created_by)
select team_id, 'Synthetic Deletion Organization', actor_id from company_deletion_context;
insert into public.team_memberships(id, athlete_id, team_id, season)
select membership_id, athlete_id, team_id, 'deletion-rehearsal' from company_deletion_context;
insert into public.biometric_consents(id, athlete_id, guardian_id, subject_is_minor, subject_age_years, policy_version, scan_engine, retention_until, method)
select consent_id, athlete_id, actor_id, false, 36, 'deletion-rehearsal.v1', 'ondevice-pose', retention_until::date, 'transactional_live_smoke'
from company_deletion_context;

-- The value 71.3 appears only in these two records. The audit check below searches for it.
insert into public.company_body_assessments(assessment_id, team_id, athlete_id, consent_id, created_by, captured_at, saved_at, retention_until, record)
select s.assessment_id, s.team_id, s.athlete_id, s.consent_id, s.actor_id, s.captured_at, s.saved_at, s.retention_until,
  jsonb_build_object(
    'schema', 'PP_COMPANY_BODY_ASSESSMENT_V1', 'assessmentId', s.assessment_id, 'subjectId', s.athlete_id::text,
    'organizationId', s.team_id::text, 'createdBy', s.actor_id::text, 'consentReference', s.consent_id::text,
    'capturedAt', to_char(s.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'savedAt', to_char(s.saved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'retentionUntil', to_char(s.retention_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'assessment', jsonb_build_object(
      'schema', 'PP_BODY_SDK_SUMMARY_V1', 'sdkVersion', '0.13.0',
      'createdAt', to_char(s.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'status', 'provisional', 'unit', 'in', 'height', 70, 'processingMs', 1000,
      'engine', jsonb_build_object('id', 'ondevice-pose', 'version', '1.3.0', 'model', 'pose_landmarker_full_float16-v1'),
      'surfaceStatus', 'not_requested', 'outputCount', 1,
      'measurements', jsonb_build_array(jsonb_build_object('key', 'wingspan', 'label', 'Wingspan', 'value', 71.3, 'unit', 'in', 'definition', 'Synthetic rehearsal value.')),
      'missingOutputs', '[]'::jsonb, 'pairs', '[]'::jsonb),
    'surfaceProcessing', 'null'::jsonb,
    'dataScope', 'Synthetic deletion rehearsal. Derived scalar measurements only.',
    'limitations', 'Synthetic value; not a measurement of anyone.')
from company_deletion_context s;

insert into public.company_reference_assessments(assessment_id, team_id, subject_reference, consent_reference, adult_attested_at, created_by, captured_at, saved_at, retention_until, record)
select s.reference_id, s.team_id, 'synthetic-deletion-adult', 'synthetic-deletion-permission', s.captured_at, s.actor_id, s.captured_at, s.saved_at, s.retention_until,
  jsonb_build_object(
    'schema', 'PP_COMPANY_BODY_ASSESSMENT_V1', 'assessmentId', s.reference_id, 'subjectId', 'synthetic-deletion-adult',
    'organizationId', s.team_id::text, 'createdBy', s.actor_id::text, 'consentReference', 'synthetic-deletion-permission',
    'capturedAt', to_char(s.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'savedAt', to_char(s.saved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'retentionUntil', to_char(s.retention_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'assessment', jsonb_build_object(
      'schema', 'PP_BODY_SDK_SUMMARY_V1', 'sdkVersion', '0.13.0',
      'createdAt', to_char(s.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'status', 'provisional', 'unit', 'in', 'height', 70, 'processingMs', 1000,
      'engine', jsonb_build_object('id', 'ondevice-pose', 'version', '1.3.0', 'model', 'pose_landmarker_full_float16-v1'),
      'surfaceStatus', 'not_requested', 'outputCount', 1,
      'measurements', jsonb_build_array(jsonb_build_object('key', 'wingspan', 'label', 'Wingspan', 'value', 71.3, 'unit', 'in', 'definition', 'Synthetic rehearsal value.')),
      'missingOutputs', '[]'::jsonb, 'pairs', '[]'::jsonb),
    'surfaceProcessing', 'null'::jsonb,
    'dataScope', 'Synthetic deletion rehearsal. Derived scalar measurements only.',
    'limitations', 'Synthetic value; not a measurement of anyone.')
from company_deletion_context s;

do $$ begin
  if (select count(*) from public.company_body_assessments b join company_deletion_context s
        on b.team_id = s.team_id and b.assessment_id = s.assessment_id) <> 1
     or (select count(*) from public.company_reference_assessments r join company_deletion_context s
        on r.team_id = s.team_id and r.assessment_id = s.reference_id) <> 1 then
    raise exception 'The administrator could not save the synthetic records under row-level security.';
  end if;
end $$;

-- Another signed-in account, which administers nothing, tries to delete both records.
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true); -- another account
do $$
declare removed integer;
begin
  with gone_body as (
    delete from public.company_body_assessments b using company_deletion_context s
     where b.team_id = s.team_id and b.assessment_id = s.assessment_id returning 1),
  gone_reference as (
    delete from public.company_reference_assessments r using company_deletion_context s
     where r.team_id = s.team_id and r.assessment_id = s.reference_id returning 1)
  select (select count(*) from gone_body) + (select count(*) from gone_reference) into removed;
  if removed <> 0 then
    raise exception 'Another account deleted % organization record(s); row-level security did not refuse it.', removed;
  end if;
end $$;

-- The administrator deletes both.
select set_config('request.jwt.claim.sub', (select actor_id::text from company_deletion_context), true);
do $$
declare removed integer;
begin
  with gone_body as (
    delete from public.company_body_assessments b using company_deletion_context s
     where b.team_id = s.team_id and b.assessment_id = s.assessment_id returning 1),
  gone_reference as (
    delete from public.company_reference_assessments r using company_deletion_context s
     where r.team_id = s.team_id and r.assessment_id = s.reference_id returning 1)
  select (select count(*) from gone_body) + (select count(*) from gone_reference) into removed;
  if removed <> 2 then
    raise exception 'The administrator deleted % of 2 records under row-level security.', removed;
  end if;
end $$;

-- The audit trail is read back as the session owner: tenants cannot see audit rows without an athlete.
reset role;
do $$
declare
  v_actor uuid;
  v_team uuid;
  v_assessment text;
  v_reference text;
begin
  select actor_id, team_id, assessment_id, reference_id into v_actor, v_team, v_assessment, v_reference from company_deletion_context;
  if exists (select 1 from public.company_body_assessments where team_id = v_team and assessment_id = v_assessment)
     or exists (select 1 from public.company_reference_assessments where team_id = v_team and assessment_id = v_reference) then
    raise exception 'A deleted record is still present.';
  end if;
  if (select count(*) from public.access_log
       where action = 'company_body_assessment_delete' and actor_id = v_actor
         and detail->>'team_id' = v_team::text and detail->>'assessment_id' = v_assessment) <> 1 then
    raise exception 'The body assessment deletion was not audited against the administrator.';
  end if;
  if (select count(*) from public.access_log
       where action = 'company_reference_assessment_delete' and actor_id = v_actor
         and detail->>'team_id' = v_team::text and detail->>'assessment_id' = v_reference) <> 1 then
    raise exception 'The reference assessment deletion was not audited against the administrator.';
  end if;
  if exists (select 1 from public.access_log
       where detail->>'team_id' = v_team::text
         and (detail ? 'record' or detail::text like '%71.3%' or detail::text ilike '%wingspan%')) then
    raise exception 'An audit entry kept a value that was supposed to be deleted.';
  end if;
end $$;

select json_build_object(
  'ok', true,
  'rehearsal', 'organization deletion under row-level security',
  'tables', json_build_array('company_body_assessments', 'company_reference_assessments'),
  'refused_for_another_account', true,
  'audited_against_the_administrator', true,
  'deleted_values_in_audit', false,
  'rows_retained', false
) as company_deletion_live_rls_result;
rollback;
