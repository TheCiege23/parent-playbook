-- Live transactional acceptance for the company assessment persistence boundary.
-- Run with `supabase db query --linked --file tests/sdk-supabase-live-rls.sql`.
-- Every fixture and audit event is rolled back before the connection closes.
begin;

create temporary table sdk_company_smoke_context (
  actor_id uuid not null,
  family_id uuid not null,
  athlete_id uuid not null,
  team_id uuid not null,
  membership_id uuid not null,
  consent_id uuid not null,
  assessment_id text not null,
  captured_at timestamptz not null,
  saved_at timestamptz not null,
  retention_until timestamptz not null
) on commit drop;

insert into sdk_company_smoke_context
select u.id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  'live-rls-smoke-'||gen_random_uuid()::text,clock_timestamp(),clock_timestamp()+interval '1 second','2027-09-09 23:59:59+00'::timestamptz
from auth.users u order by u.created_at limit 1;

do $$ begin
  if not exists(select 1 from sdk_company_smoke_context) then
    raise exception 'The live RLS smoke test requires one existing auth user.';
  end if;
end $$;

grant select on sdk_company_smoke_context to authenticated,anon;
grant update on sdk_company_smoke_context to authenticated;
select set_config('request.jwt.claim.sub',(select actor_id::text from sdk_company_smoke_context),true);
set local role authenticated;

-- Since 20260915180000_child_creation_requires_consent.sql a signed-in account adds anyone to a household only through
-- create_athlete_onboarding(), with both required consents; the smoke takes the ids it created, and rolls them back.
update sdk_company_smoke_context set athlete_id=public.create_athlete_onboarding(
  true,null,'SDK live RLS smoke','SDK Smoke Adult','1990-01-01',null,'football','{}',null,
  '[]'::jsonb,'[{"consent_type":"child_data"},{"consent_type":"account"}]'::jsonb);
update sdk_company_smoke_context s set family_id=a.family_id from public.athletes a where a.id=s.athlete_id;
insert into public.teams(id,name,created_by)
select team_id,'SDK Smoke Organization',actor_id from sdk_company_smoke_context;
insert into public.team_memberships(id,athlete_id,team_id,season)
select membership_id,athlete_id,team_id,'sdk-live-smoke' from sdk_company_smoke_context;
insert into public.biometric_consents(id,athlete_id,guardian_id,subject_is_minor,subject_age_years,policy_version,scan_engine,retention_until,method)
select consent_id,athlete_id,actor_id,false,36,'sdk-live-smoke.v1','ondevice-pose',retention_until::date,'transactional_live_smoke'
from sdk_company_smoke_context;

do $$ begin
  if (select count(*) from sdk_company_smoke_context s cross join lateral
      public.company_body_active_consent(s.team_id,s.athlete_id,'ondevice-pose') c
      where c.consent_id=s.consent_id and c.retention_until=s.retention_until::date) <> 1 then
    raise exception 'Scoped company consent reference was not available to the team administrator.';
  end if;
end $$;

insert into public.company_body_assessments(
  assessment_id,team_id,athlete_id,consent_id,created_by,captured_at,saved_at,retention_until,record)
select assessment_id,team_id,athlete_id,consent_id,actor_id,captured_at,saved_at,retention_until,
  jsonb_build_object(
    'schema','PP_COMPANY_BODY_ASSESSMENT_V1','assessmentId',assessment_id,'subjectId',athlete_id::text,
    'organizationId',team_id::text,'createdBy',actor_id::text,'consentReference',consent_id::text,
    'capturedAt',to_char(captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'savedAt',to_char(saved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'retentionUntil',to_char(retention_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'assessment',jsonb_build_object(
      'schema','PP_BODY_SDK_SUMMARY_V1','sdkVersion','0.13.0',
      'createdAt',to_char(captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'status','provisional','unit','in','height',74,'processingMs',1250,
      'engine',jsonb_build_object('id','ondevice-pose','version','1.3.0','model','pose_landmarker_full_float16-v1'),
      'surfaceStatus','not_requested','outputCount',1,
      'measurements',jsonb_build_array(jsonb_build_object('key','wingspan','label','Wingspan','value',76.4,'unit','in','definition','Estimated wingspan.')),
      'missingOutputs','[]'::jsonb,'pairs','[]'::jsonb
    ),
    'surfaceProcessing','null'::jsonb,
    'dataScope','Derived scalar measurements only.',
    'limitations','Provisional photo estimates; accuracy is unvalidated.'
  )
from sdk_company_smoke_context;

do $$ begin
  if (select count(*) from public.company_body_assessments c join sdk_company_smoke_context s
      on c.team_id=s.team_id and c.athlete_id=s.athlete_id and c.assessment_id=s.assessment_id) <> 1 then
    raise exception 'Authenticated company assessment save/read failed.';
  end if;
end $$;

select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
do $$ begin
  if exists(select 1 from public.company_body_assessments c join sdk_company_smoke_context s
      on c.team_id=s.team_id and c.athlete_id=s.athlete_id and c.assessment_id=s.assessment_id) then
    raise exception 'Cross-account company assessment read was not denied.';
  end if;
  if exists(select 1 from sdk_company_smoke_context s cross join lateral
      public.company_body_active_consent(s.team_id,s.athlete_id,'ondevice-pose')) then
    raise exception 'Cross-account consent reference was not denied.';
  end if;
end $$;

select set_config('request.jwt.claim.sub',(select actor_id::text from sdk_company_smoke_context),true);
delete from public.company_body_assessments c using sdk_company_smoke_context s
where c.team_id=s.team_id and c.athlete_id=s.athlete_id and c.assessment_id=s.assessment_id;

do $$ begin
  if exists(select 1 from public.company_body_assessments c join sdk_company_smoke_context s
      on c.team_id=s.team_id and c.athlete_id=s.athlete_id and c.assessment_id=s.assessment_id) then
    raise exception 'Authenticated company assessment delete failed.';
  end if;
  if (select count(*) from public.access_log l join sdk_company_smoke_context s on l.athlete_id=s.athlete_id
      where l.action in ('company_body_assessment_insert','company_body_assessment_delete')) <> 2 then
    raise exception 'Company assessment audit events were not recorded.';
  end if;
end $$;

reset role;
select json_build_object(
  'ok',true,
  'lifecycle',json_build_array('scoped-consent','save','read','deny-cross-account','delete'),
  'audit_events',json_build_array('insert','delete'),
  'temporary_rows_retained',false
) as company_assessment_live_rls_result;
rollback;
