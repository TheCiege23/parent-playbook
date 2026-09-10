-- SYNTHETIC fixtures for the isolated composition security tests.
-- Every identifier below is invented for testing. No production record, no real person,
-- no capture data and no raw validation observation appears here.
-- The live Bergenfield Bears record (friday-adult-reference-001 / friday-reference-001)
-- is NOT referenced, read, copied or recreated.

-- ---- synthetic accounts
insert into auth.users(id, email) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'synthetic-admin-a@example.invalid'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'synthetic-admin-b@example.invalid'),
  ('cccccccc-0000-4000-8000-00000000000c', 'synthetic-member-c@example.invalid')
on conflict (id) do nothing;

insert into public.guardians(id, display_name) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'synthetic admin A'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'synthetic admin B'),
  ('cccccccc-0000-4000-8000-00000000000c', 'synthetic member C')
on conflict (id) do nothing;

-- ---- synthetic organizations: A and B are separate tenants
insert into public.teams(id, name, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'Synthetic Org A', 'aaaaaaaa-0000-4000-8000-00000000000a'),
  ('22222222-2222-4222-8222-222222222222', 'Synthetic Org B', 'bbbbbbbb-0000-4000-8000-00000000000b')
on conflict (id) do nothing;

-- private.handle_new_family() fires on families insert and reads auth.uid(), so the
-- harness supplies a synthetic JWT claim for the duration of this fixture transaction.
select set_config('request.jwt.claims','{"sub":"cccccccc-0000-4000-8000-00000000000c","role":"authenticated"}', true);

-- ---- synthetic family (athletes require one)
insert into public.families(id, name, created_by) values
  ('ffffffff-0000-4000-8000-00000000000f', 'Synthetic Family', 'cccccccc-0000-4000-8000-00000000000c')
on conflict (id) do nothing;

-- ---- synthetic athletes
insert into public.athletes(id, family_id, first_name, birthdate) values
  ('a1111111-1111-4111-8111-11111111111a', 'ffffffff-0000-4000-8000-00000000000f', 'SyntheticRosterA', date '2012-01-01'),
  ('b1111111-1111-4111-8111-11111111111b', 'ffffffff-0000-4000-8000-00000000000f', 'SyntheticRosterB', date '2012-01-01'),
  ('c1111111-1111-4111-8111-11111111111c', 'ffffffff-0000-4000-8000-00000000000f', 'SyntheticOffRoster', date '2012-01-01')
on conflict (id) do nothing;

-- athleteA1 is on Org A's roster; athleteB1 on Org B's; athleteX is on NO roster.
insert into public.team_memberships(team_id, athlete_id, season) values
  ('11111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-11111111111a', '2026'),
  ('22222222-2222-4222-8222-222222222222', 'b1111111-1111-4111-8111-11111111111b', '2026')
on conflict do nothing;

-- ---- helper that builds a structurally valid SYNTHETIC composition payload.
-- The values are arbitrary in-range numbers from a fictional provider id. They are not a
-- composition estimate, are never surfaced in the product, and prove nothing about accuracy.
create or replace function public.test_composition_payload(
  p_result text default 'synthetic-result-001',
  p_assessment text default 'synthetic-assessment-001',
  p_subject text default 'synthetic-subject-001',
  p_scope text default 'adult_reference',
  p_team uuid default '11111111-1111-4111-8111-111111111111',
  p_actor uuid default 'aaaaaaaa-0000-4000-8000-00000000000a',
  p_consent text default 'synthetic-permission-001',
  p_captured timestamptz default '2026-09-10T04:00:00Z',
  p_created timestamptz default '2026-09-10T04:00:00Z',
  p_saved timestamptz default '2026-09-10T04:05:00Z',
  p_retention timestamptz default '2026-10-10T04:00:00Z')
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'schema','PP_COMPANY_COMPOSITION_RESULT_V1',
    'resultId', p_result,
    'assessmentId', p_assessment,
    'subjectId', p_subject,
    'subjectScope', p_scope,
    'organizationId', p_team::text,
    'createdBy', p_actor::text,
    'consentReference', p_consent,
    'capturedAt', to_char(p_captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt', to_char(p_created at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'savedAt', to_char(p_saved at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'retentionUntil', to_char(p_retention at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'provider', jsonb_build_object('id','synthetic-provider','version','0.0.1-test','model','synthetic-composition-model'),
    'modelManifest', jsonb_build_object('schema','PP_BODY_COMPOSITION_MODEL_MANIFEST_V1','studyId','synthetic-validation',
      'trainingMethod','DXA','validationMethod','DXA','rightsStatus','buyer_supplied'),
    'outputs', jsonb_build_array(
      jsonb_build_object('key','lean_mass_kg','label','Lean mass','value',60,'unit','kg',
        'uncertainty', jsonb_build_object('status','provided','lower',57,'upper',63,'method','synthetic interval')),
      jsonb_build_object('key','body_fat_percent','label','Body fat','value',18,'unit','percent',
        'uncertainty', jsonb_build_object('status','not_provided'))),
    'dataScope','Scalar composition outputs, units, uncertainty disclosure and provider identity only. No photos, landmarks, masks, contours, meshes, geometry, raw validation observations or participant/scan codes.',
    'limitations','Estimated body composition from an external model. Not a DEXA measurement, diagnosis, screening result, treatment recommendation or athletic-potential score.'
  )
$$;

-- Insert a row bypassing RLS (owner), used to set up read/update/delete tests.
create or replace function public.test_seed_row(
  p_result text, p_scope text default 'adult_reference',
  p_team uuid default '11111111-1111-4111-8111-111111111111',
  p_actor uuid default 'aaaaaaaa-0000-4000-8000-00000000000a',
  p_subject text default 'synthetic-subject-001',
  p_athlete uuid default null,
  p_captured timestamptz default '2026-09-10T04:00:00Z',
  p_retention timestamptz default '2026-10-10T04:00:00Z')
returns void language plpgsql as $$
begin
  insert into public.company_composition_results(
    result_id, assessment_id, team_id, subject_reference, subject_scope, athlete_id,
    consent_reference, created_by, provider_id, model_id, model_version,
    captured_at, created_at_source, saved_at, retention_until, record)
  values (p_result,'synthetic-assessment-001',p_team,p_subject,p_scope,p_athlete,
    'synthetic-permission-001',p_actor,'synthetic-provider','synthetic-composition-model','0.0.1-test',
    p_captured,p_captured,p_captured + interval '5 minutes',p_retention,
    public.test_composition_payload(p_result,'synthetic-assessment-001',p_subject,p_scope,p_team,p_actor,
      'synthetic-permission-001',p_captured,p_captured,p_captured + interval '5 minutes',p_retention));
end $$;

-- ---- synthetic provider registrations
-- Registering a provider is a platform operation, so these are inserted here as the cluster
-- owner, exactly as Parent Playbook would do out of band. The provider is fictional; no
-- licensed composition model exists and none of these rows implies one does.
insert into public.company_composition_providers
  (team_id, provider_id, model_id, model_version, study_id, rights_status, declared_outputs, approved_by, approved_at, rights_expire_at, revoked_at, note)
values
  -- Active for both synthetic organizations, declaring all five supported outputs.
  ('11111111-1111-4111-8111-111111111111','synthetic-provider','synthetic-composition-model','0.0.1-test','synthetic-validation','buyer_supplied',
   array['lean_mass_kg','fat_mass_kg','body_fat_percent','skeletal_muscle_mass_kg','bone_mineral_content_kg'],
   'aaaaaaaa-0000-4000-8000-00000000000a','2026-01-01T00:00:00Z',null,null,'synthetic fixture'),
  ('22222222-2222-4222-8222-222222222222','synthetic-provider','synthetic-composition-model','0.0.1-test','synthetic-validation','buyer_supplied',
   array['lean_mass_kg','fat_mass_kg','body_fat_percent','skeletal_muscle_mass_kg','bone_mineral_content_kg'],
   'bbbbbbbb-0000-4000-8000-00000000000b','2026-01-01T00:00:00Z',null,null,'synthetic fixture'),
  -- Registered but revoked.
  ('11111111-1111-4111-8111-111111111111','synthetic-provider','synthetic-composition-model','0.0.2-revoked','synthetic-validation','buyer_supplied',
   array['lean_mass_kg','body_fat_percent'],
   'aaaaaaaa-0000-4000-8000-00000000000a','2026-01-01T00:00:00Z',null,'2026-08-01T00:00:00Z','synthetic fixture'),
  -- Registered, never revoked, but its deployment rights lapsed before the fixture save time.
  ('11111111-1111-4111-8111-111111111111','synthetic-provider','synthetic-composition-model','0.0.3-expired','synthetic-validation','buyer_supplied',
   array['lean_mass_kg','body_fat_percent'],
   'aaaaaaaa-0000-4000-8000-00000000000a','2026-01-01T00:00:00Z','2026-02-01T00:00:00Z',null,'synthetic fixture'),
  -- Active, but declares only lean mass, so a body-fat output is outside what it covers.
  ('11111111-1111-4111-8111-111111111111','synthetic-provider','synthetic-composition-model','0.0.4-narrow','synthetic-validation','buyer_supplied',
   array['lean_mass_kg'],
   'aaaaaaaa-0000-4000-8000-00000000000a','2026-01-01T00:00:00Z',null,null,'synthetic fixture'),
  -- Active, but validated against a different study and held under different rights.
  ('11111111-1111-4111-8111-111111111111','synthetic-provider','synthetic-composition-model','0.0.5-otherstudy','other-validation','licensed',
   array['lean_mass_kg','fat_mass_kg','body_fat_percent','skeletal_muscle_mass_kg','bone_mineral_content_kg'],
   'aaaaaaaa-0000-4000-8000-00000000000a','2026-01-01T00:00:00Z',null,null,'synthetic fixture')
on conflict do nothing;
