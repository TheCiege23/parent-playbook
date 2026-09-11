-- Organization-scoped body-composition results.
--
-- This table is deliberately separate from public.company_body_assessments and
-- public.company_reference_assessments: composition scalars come from an external licensed
-- model, not from the provisional length dictionary, and mixing them would let one payload
-- allowlist drift into covering both. It stays empty until a provider manifest and estimate
-- pass the application validators; nothing here creates, seeds or implies a composition value.
--
-- Adult-reference and child-athlete scopes never share a row shape. An adult_reference row
-- always has a null athlete_id, so an adult measurement can never be attached to a child
-- profile; a child_athlete row must name a rostered athlete and repeat that id as its opaque
-- subject reference.
--
-- Provider eligibility is enforced HERE, not only in the browser. A result must reference a
-- provider registration this organization actually holds, and the registration table is not
-- writable by organization accounts. Without that, an organization administrator with a valid
-- session could store a structurally perfect row naming a model that does not exist.

-- ===========================================================================================
-- Provider registry
-- ===========================================================================================
-- Registering a provider is a PLATFORM operation, never a tenant one. `authenticated` gets
-- SELECT on its own team's rows so the application can show what is licensed, and gets no
-- INSERT, UPDATE or DELETE grant and no policy for them. Moving approval outside the tenant's
-- reach is the whole point: a registry an organization can write to enforces nothing.

create or replace function private.composition_outputs_are_declarable(keys text[])
returns boolean language sql immutable set search_path = '' as $$
  -- array_length() of an empty array returns NULL, and `NULL between 1 and 5` is NULL, which a
  -- CHECK constraint accepts. Coalesce before comparing or a provider can declare no outputs.
  select keys is not null
     and coalesce(array_length(keys,1),0) between 1 and 5
     and coalesce(array_length(keys,1),0) = (select count(distinct k) from unnest(keys) k)
     and not exists (
       select 1 from unnest(keys) k
       where k <> all(array['lean_mass_kg','fat_mass_kg','body_fat_percent','skeletal_muscle_mass_kg','bone_mineral_content_kg'])
     );
$$;

create table if not exists public.company_composition_providers (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  provider_id text not null check (char_length(provider_id) between 1 and 100 and provider_id=btrim(provider_id)),
  model_id text not null check (char_length(model_id) between 1 and 300 and model_id=btrim(model_id)),
  model_version text not null check (char_length(model_version) between 1 and 100 and model_version=btrim(model_version)),
  -- The independent DXA validation study this exact model was accepted against.
  study_id text not null check (char_length(study_id) between 1 and 180 and study_id=btrim(study_id)),
  rights_status text not null check (rights_status in ('owned','licensed','buyer_supplied')),
  declared_outputs text[] not null check (private.composition_outputs_are_declarable(declared_outputs)),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  rights_expire_at timestamptz,
  revoked_at timestamptz,
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  unique (team_id, provider_id, model_id, model_version),
  check (rights_expire_at is null or rights_expire_at > approved_at),
  check (revoked_at is null or revoked_at >= approved_at)
);
create index if not exists company_composition_provider_team_idx on public.company_composition_providers(team_id, provider_id);

alter table public.company_composition_providers enable row level security;
create policy company_composition_provider_select on public.company_composition_providers for select to authenticated
  using (private.is_admin_of_team(team_id));
-- Supabase grants ALL on a new public table to anon and authenticated by default, which
-- includes TRUNCATE, TRIGGER and REFERENCES. TRUNCATE is not subject to row-level security,
-- so start from nothing and grant back only what the application needs. anon needs nothing:
-- the composition room requires a signed-in organization administrator.
revoke all on public.company_composition_providers from anon, authenticated;
grant select on public.company_composition_providers to authenticated;

create or replace function private.audit_company_composition_provider_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.access_log(actor_id,athlete_id,action,detail)
  values ((select auth.uid()),null,'company_composition_provider_'||lower(tg_op),
    jsonb_build_object('team_id',coalesce(new.team_id,old.team_id),'provider_id',coalesce(new.provider_id,old.provider_id),
      'model_id',coalesce(new.model_id,old.model_id),'model_version',coalesce(new.model_version,old.model_version),
      'rights_status',coalesce(new.rights_status,old.rights_status),'revoked',(coalesce(new.revoked_at,old.revoked_at) is not null)));
  return coalesce(new,old);
end;
$$;
create trigger company_composition_provider_audit after insert or update or delete on public.company_composition_providers
  for each row execute function private.audit_company_composition_provider_change();

-- ===========================================================================================
-- Result payload allowlist
-- ===========================================================================================

create or replace function private.company_composition_payload_is_allowed(
  payload jsonb, row_result text, row_assessment text, row_subject text, row_scope text,
  row_team uuid, row_actor uuid, row_consent text, row_captured timestamptz,
  row_created timestamptz, row_saved timestamptz, row_retention timestamptz,
  row_provider text, row_model text, row_model_version text)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare allowed boolean;
begin
  if jsonb_typeof(payload) <> 'object' or private.company_body_payload_has_forbidden_key(payload) then return false; end if;
  -- Require the EXACT key set, not merely the absence of unknown keys. jsonb_typeof() of a
  -- missing key returns NULL and `NULL <> 'array'` evaluates to NULL rather than true, so the
  -- shape checks below cannot on their own reject a payload that simply omits outputs or
  -- provider. Counting keys closes that hole, and every shape test uses IS DISTINCT FROM.
  select (select count(*) from jsonb_object_keys(payload)) = 17
     and not exists (
       select 1 from jsonb_object_keys(payload) key
       where key <> all(array['schema','resultId','assessmentId','subjectId','subjectScope','organizationId','createdBy','consentReference','capturedAt','createdAt','savedAt','retentionUntil','provider','modelManifest','outputs','dataScope','limitations'])
     ) into allowed;
  if not allowed
     or payload->>'schema' is distinct from 'PP_COMPANY_COMPOSITION_RESULT_V1'
     or payload->>'resultId' is distinct from row_result
     or payload->>'assessmentId' is distinct from row_assessment
     or payload->>'subjectId' is distinct from row_subject
     or payload->>'subjectScope' is distinct from row_scope
     or payload->>'organizationId' is distinct from row_team::text
     or payload->>'createdBy' is distinct from row_actor::text
     or payload->>'consentReference' is distinct from row_consent
     or (payload->>'capturedAt')::timestamptz is distinct from row_captured
     or (payload->>'createdAt')::timestamptz is distinct from row_created
     or (payload->>'savedAt')::timestamptz is distinct from row_saved
     or (payload->>'retentionUntil')::timestamptz is distinct from row_retention
     -- The provider named INSIDE the payload is what a reader renders, so it must equal the
     -- indexed columns the registry foreign key is checked against.
     or payload#>>'{provider,id}' is distinct from row_provider
     or payload#>>'{provider,model}' is distinct from row_model
     or payload#>>'{provider,version}' is distinct from row_model_version
     or jsonb_typeof(payload->'provider') is distinct from 'object'
     or jsonb_typeof(payload->'modelManifest') is distinct from 'object'
     or jsonb_typeof(payload->'outputs') is distinct from 'array'
     or jsonb_typeof(payload->'dataScope') is distinct from 'string'
     or jsonb_typeof(payload->'limitations') is distinct from 'string'
     or coalesce(jsonb_array_length(payload->'outputs'), 0) < 1
     or coalesce(jsonb_array_length(payload->'outputs'), 99) > 5
     or (select count(distinct element.item->>'key') from jsonb_array_elements(payload->'outputs') as element(item))
        is distinct from jsonb_array_length(payload->'outputs')
     or payload#>>'{modelManifest,schema}' is distinct from 'PP_BODY_COMPOSITION_MODEL_MANIFEST_V1'
     or payload#>>'{modelManifest,trainingMethod}' is distinct from 'DXA'
     or payload#>>'{modelManifest,validationMethod}' is distinct from 'DXA'
     or coalesce(payload#>>'{modelManifest,rightsStatus}','') <> all(array['owned','licensed','buyer_supplied'])
     -- The non-diagnostic disclosure is part of the record, not decoration. Pin it exactly so a
     -- direct writer cannot store "clinically validated" text beside the same numbers.
     or payload->>'dataScope' is distinct from 'Scalar composition outputs, units, uncertainty disclosure and provider identity only. No photos, landmarks, masks, contours, meshes, geometry, raw validation observations or participant/scan codes.'
     or payload->>'limitations' is distinct from 'Estimated body composition from an external model. Not a DEXA measurement, diagnosis, screening result, treatment recommendation or athletic-potential score.' then return false;
  end if;
  if (select count(*) from jsonb_object_keys(payload->'provider')) <> 3
     or exists (select 1 from jsonb_object_keys(payload->'provider') key where key <> all(array['id','version','model'])) then return false; end if;
  if (select count(*) from jsonb_object_keys(payload->'modelManifest')) <> 5
     or exists (select 1 from jsonb_object_keys(payload->'modelManifest') key where key <> all(array['schema','studyId','trainingMethod','validationMethod','rightsStatus'])) then return false; end if;
  -- Only the five supported scalar outputs, each with its fixed label, unit and physiological
  -- bounds, and an uncertainty interval that actually brackets the value it describes.
  if exists (
    select 1
    from jsonb_array_elements(payload->'outputs') as element(item)
    left join (values
      ('lean_mass_kg','Lean mass','kg',5::numeric,220::numeric),
      ('fat_mass_kg','Fat mass','kg',0::numeric,180::numeric),
      ('body_fat_percent','Body fat','percent',1::numeric,75::numeric),
      ('skeletal_muscle_mass_kg','Skeletal muscle mass','kg',2::numeric,140::numeric),
      ('bone_mineral_content_kg','Bone mineral content','kg',0.2::numeric,10::numeric)
    ) as spec(metric_key,metric_label,metric_unit,metric_min,metric_max)
      on spec.metric_key = element.item->>'key'
    where spec.metric_key is null
       or jsonb_typeof(element.item) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(element.item)) <> 5
       or exists (select 1 from jsonb_object_keys(element.item) key where key <> all(array['key','label','value','unit','uncertainty']))
       or element.item->>'label' is distinct from spec.metric_label
       or element.item->>'unit' is distinct from spec.metric_unit
       or jsonb_typeof(element.item->'value') is distinct from 'number'
       or jsonb_typeof(element.item->'label') is distinct from 'string'
       or (element.item->>'value')::numeric < spec.metric_min
       or (element.item->>'value')::numeric > spec.metric_max
       or jsonb_typeof(element.item->'uncertainty') is distinct from 'object'
       or coalesce(element.item#>>'{uncertainty,status}','') <> all(array['provided','not_provided'])
       or exists (select 1 from jsonb_object_keys(element.item->'uncertainty') key where key <> all(array['status','lower','upper','method']))
       -- not_provided carries status alone; provided must carry all three interval fields.
       or (element.item#>>'{uncertainty,status}' = 'not_provided'
           and (select count(*) from jsonb_object_keys(element.item->'uncertainty')) <> 1)
       or (element.item#>>'{uncertainty,status}' = 'provided'
           and ((select count(*) from jsonb_object_keys(element.item->'uncertainty')) <> 4
                or jsonb_typeof(element.item#>'{uncertainty,lower}') is distinct from 'number'
                or jsonb_typeof(element.item#>'{uncertainty,upper}') is distinct from 'number'
                or jsonb_typeof(element.item#>'{uncertainty,method}') is distinct from 'string'
                or (element.item#>>'{uncertainty,lower}')::numeric > (element.item->>'value')::numeric
                or (element.item#>>'{uncertainty,upper}')::numeric < (element.item->>'value')::numeric
                or (element.item#>>'{uncertainty,lower}')::numeric < spec.metric_min
                or (element.item#>>'{uncertainty,upper}')::numeric > spec.metric_max))
  ) then return false; end if;
  return true;
exception when others then return false;
end;
$$;

-- ===========================================================================================
-- Results
-- ===========================================================================================

create table if not exists public.company_composition_results (
  id uuid primary key default gen_random_uuid(),
  result_id text not null check (char_length(result_id) between 1 and 180 and result_id=btrim(result_id)),
  assessment_id text not null check (char_length(assessment_id) between 1 and 180 and assessment_id=btrim(assessment_id)),
  team_id uuid not null references public.teams(id) on delete cascade,
  subject_reference text not null check (char_length(subject_reference) between 1 and 180 and subject_reference=btrim(subject_reference)),
  subject_scope text not null check (subject_scope in ('adult_reference','child_athlete')),
  athlete_id uuid references public.athletes(id) on delete cascade,
  consent_reference text not null check (char_length(consent_reference) between 1 and 180 and consent_reference=btrim(consent_reference)),
  created_by uuid not null references auth.users(id),
  provider_id text not null check (char_length(provider_id) between 1 and 100),
  model_id text not null check (char_length(model_id) between 1 and 300),
  model_version text not null check (char_length(model_version) between 1 and 100),
  captured_at timestamptz not null,
  created_at_source timestamptz not null,
  saved_at timestamptz not null,
  retention_until timestamptz not null,
  record jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(team_id,subject_reference,result_id),
  -- A result can only name a provider registration this organization holds. Deleting a
  -- registration that still has results is refused; revoke it instead.
  foreign key (team_id,provider_id,model_id,model_version)
    references public.company_composition_providers(team_id,provider_id,model_id,model_version)
    on update cascade on delete restrict,
  -- An adult reference is never attached to a child profile, and a child result must name its athlete.
  check ((subject_scope='child_athlete') = (athlete_id is not null)),
  check (subject_scope<>'child_athlete' or subject_reference=athlete_id::text),
  check (captured_at<=created_at_source and created_at_source<=saved_at),
  -- Bounded retention: composition results expire, and never more than 400 days after capture.
  check (retention_until>captured_at and retention_until<=captured_at+interval '400 days'),
  check (private.company_composition_payload_is_allowed(record,result_id,assessment_id,subject_reference,subject_scope,team_id,created_by,consent_reference,captured_at,created_at_source,saved_at,retention_until,provider_id,model_id,model_version))
);
create index if not exists company_composition_retention_idx on public.company_composition_results(retention_until);
create index if not exists company_composition_subject_idx on public.company_composition_results(team_id,subject_reference,captured_at desc);

-- The foreign key proves the registration exists. This proves it was still usable when the
-- result was saved, and that the result stays inside what the registration declared. It is a
-- BEFORE trigger rather than an RLS clause on purpose: RLS is bypassed by the service role,
-- and an invented composition value should not become storable by changing which key wrote it.
create or replace function private.enforce_company_composition_provider()
returns trigger language plpgsql security definer set search_path = '' as $$
declare registration record; used text[];
begin
  -- A NULL payload is the NOT NULL constraint's to reject; reporting it as a manifest
  -- mismatch would send a reader looking in the wrong place.
  if new.record is null then return new; end if;
  select p.* into registration from public.company_composition_providers p
   where p.team_id=new.team_id and p.provider_id=new.provider_id
     and p.model_id=new.model_id and p.model_version=new.model_version;
  if not found then
    raise exception 'composition provider is not registered for this organization' using errcode='23514';
  end if;
  if registration.revoked_at is not null then
    raise exception 'composition provider registration was revoked' using errcode='23514';
  end if;
  if registration.rights_expire_at is not null and registration.rights_expire_at <= new.saved_at then
    raise exception 'composition provider deployment rights had expired when this result was saved' using errcode='23514';
  end if;
  if new.record#>>'{modelManifest,rightsStatus}' is distinct from registration.rights_status
     or new.record#>>'{modelManifest,studyId}' is distinct from registration.study_id then
    raise exception 'composition manifest reference does not match the registered provider' using errcode='23514';
  end if;
  select array_agg(element.item->>'key') into used
    from jsonb_array_elements(new.record->'outputs') as element(item);
  if used is null or exists (select 1 from unnest(used) k where k <> all(registration.declared_outputs)) then
    raise exception 'composition result contains an output the registered provider did not declare' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger company_composition_result_provider_guard
  before insert or update on public.company_composition_results
  for each row execute function private.enforce_company_composition_provider();

alter table public.company_composition_results enable row level security;

-- Tenant isolation: organization administrators only, and a child-athlete result additionally
-- requires that athlete to be on the requesting team's roster.
create or replace function private.can_manage_company_composition(requested_team uuid, requested_athlete uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin_of_team(requested_team)
    and (requested_athlete is null or private.can_manage_company_body_assessment(requested_team,requested_athlete));
$$;
revoke all on function private.can_manage_company_composition(uuid,uuid) from public,anon,authenticated;
grant execute on function private.can_manage_company_composition(uuid,uuid) to authenticated;

create policy company_composition_select on public.company_composition_results for select to authenticated
  using (private.can_manage_company_composition(team_id,athlete_id));
create policy company_composition_insert on public.company_composition_results for insert to authenticated
  with check (created_by=(select auth.uid()) and private.can_manage_company_composition(team_id,athlete_id));
create policy company_composition_update on public.company_composition_results for update to authenticated
  using (private.can_manage_company_composition(team_id,athlete_id))
  with check (created_by=(select auth.uid()) and private.can_manage_company_composition(team_id,athlete_id));
create policy company_composition_delete on public.company_composition_results for delete to authenticated
  using (private.can_manage_company_composition(team_id,athlete_id));
-- Same least-privilege reset as the registry: no TRUNCATE, TRIGGER or REFERENCES, no anon.
revoke all on public.company_composition_results from anon, authenticated;
grant select,insert,update,delete on public.company_composition_results to authenticated;

create or replace function private.audit_company_composition_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.access_log(actor_id,athlete_id,action,detail)
  values ((select auth.uid()),coalesce(new.athlete_id,old.athlete_id),'company_composition_result_'||lower(tg_op),
    jsonb_build_object('team_id',coalesce(new.team_id,old.team_id),'result_id',coalesce(new.result_id,old.result_id),
      'assessment_id',coalesce(new.assessment_id,old.assessment_id),
      'subject_reference',coalesce(new.subject_reference,old.subject_reference),'subject_scope',coalesce(new.subject_scope,old.subject_scope),
      'provider_id',coalesce(new.provider_id,old.provider_id),'model_id',coalesce(new.model_id,old.model_id),'model_version',coalesce(new.model_version,old.model_version)));
  return coalesce(new,old);
end;
$$;
create trigger company_composition_result_audit after insert or update or delete on public.company_composition_results
  for each row execute function private.audit_company_composition_change();

create or replace function private.sweep_company_composition_retention()
returns integer language plpgsql security definer set search_path = '' as $$
declare deleted_count integer;
begin
  with gone as (delete from public.company_composition_results where retention_until<=now() returning id)
  select count(*) into deleted_count from gone;
  return deleted_count;
end;
$$;
revoke all on function private.sweep_company_composition_retention() from public,anon,authenticated;
select cron.unschedule('company-composition-result-retention') where exists(select 1 from cron.job where jobname='company-composition-result-retention');
select cron.schedule('company-composition-result-retention','50 3 * * *',$$select private.sweep_company_composition_retention();$$);
