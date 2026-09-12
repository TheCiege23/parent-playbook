-- Externally measured body composition: DEXA, clinical BIA, smart scales, health platforms and
-- transcribed reports.
--
-- These are EVIDENCE INPUTS, not model outputs, and they are deliberately not routed through
-- company_composition_providers. A DEXA scan has no provider registration, no model manifest and
-- no deployment rights to check; forcing one would either invent a fake registration or make the
-- import impossible. The two tables answer different questions: that one holds what a model
-- estimated, this one holds what a machine measured. js/body-composition-reference.mjs enforces
-- the same separation in the payload, and public.describe_composition_origin below is the SQL
-- side of the rule that an imported DEXA result can never be presented as our estimate.
--
-- Ownership differs from the company tables too. A composition result belongs to the guardian who
-- imported it, on behalf of an athlete they can edit. An organization sees it only when the
-- guardian has shared it, and then only for reading. That is the opposite default from
-- company_composition_results, which is organization-owned, and it is deliberate: a child's
-- clinical scan is the family's, and an organization that could write to it could alter a medical
-- record it did not create.

-- ---------------------------------------------------------------------------------------------
-- Which quantities each kind of source is allowed to claim.
--
-- Bioimpedance does not measure fat mass; it measures impedance and derives the rest through the
-- manufacturer's equation. DXA does not isolate skeletal muscle from lean soft tissue, and does
-- not produce the visceral-fat index consumer scales report. BMI is arithmetic and nothing
-- measures it. Encoding this in the database as well as in the contract matters because the
-- service role bypasses RLS but not a CHECK: a value that overstates what a machine did should
-- not become storable by changing which key wrote it.
create or replace function private.composition_source_may_claim(
  source_class text, output_key text, output_status text)
returns boolean language sql immutable set search_path = '' as $$
  select case
    -- Arithmetic, whatever the source. No device measures or estimates it.
    when output_key = 'bmi' then output_status = 'calculated'
    when source_class = 'dexa' then
      (output_status = 'measured' and output_key in
        ('body_fat_percent','fat_mass_kg','lean_mass_kg','bone_mineral_content_kg','weight_kg'))
    when source_class in ('bia_clinical','smart_scale','health_platform') then
      (output_status = 'measured' and output_key = 'weight_kg')
      or (output_status = 'device_estimated' and output_key in
        ('body_fat_percent','fat_mass_kg','lean_mass_kg','skeletal_muscle_mass_kg',
         'bone_mass_kg','body_water_mass_kg','visceral_fat_index'))
    -- A person transcribed a document. What the document's method measured is recorded in
    -- method_label; the transcription is never better evidence than the document.
    when source_class = 'manual_report' then
      (output_status = 'measured' and output_key in
        ('body_fat_percent','fat_mass_kg','lean_mass_kg','bone_mineral_content_kg','weight_kg'))
      or (output_status = 'device_estimated' and output_key in
        ('skeletal_muscle_mass_kg','bone_mass_kg','body_water_mass_kg','visceral_fat_index'))
    else false
  end;
$$;
-- Granted to authenticated, not revoked: a CHECK constraint runs with the privileges of whoever
-- is inserting, so a parent who cannot execute this cannot save a record at all. It reads no
-- table and returns a boolean about its arguments.
revoke all on function private.composition_source_may_claim(text,text,text) from public, anon;
grant execute on function private.composition_source_may_claim(text,text,text) to authenticated;

-- The payload check. Mirrors js/body-composition-reference.mjs; the module gives a person a
-- sentence they can act on, this makes the rule true regardless of which client wrote the row.
create or replace function private.external_composition_payload_is_allowed(
  payload jsonb, expected_record text, expected_subject text, expected_scope text,
  expected_source text, expected_measured timestamptz, expected_saved timestamptz)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb; seen text[] := '{}'; bounds record; measured timestamptz; saved timestamptz;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then return false; end if;
  if payload->>'schema' <> 'PP_BODY_COMPOSITION_REFERENCE_V1' then return false; end if;
  if payload->>'origin' <> 'external_measurement' then return false; end if;
  -- A model estimate must never be storable here, whatever else it claims.
  if payload ? 'provider' or payload ? 'modelManifest' or payload->>'status' = 'estimated' then
    return false;
  end if;
  -- The row's columns and the payload have to agree, or one of them is decoration.
  if payload->>'recordId' is distinct from expected_record
     or payload->>'subjectId' is distinct from expected_subject
     or payload->>'scope' is distinct from expected_scope
     or payload->>'sourceClass' is distinct from expected_source then
    return false;
  end if;
  -- A malformed instant is a rejection, not an exception: a CHECK that raises gives the caller a
  -- cast error instead of the rule it broke.
  begin
    measured := (payload->>'measuredAt')::timestamptz;
    saved := (payload->>'savedAt')::timestamptz;
  exception when others then return false;
  end;
  -- Compared at millisecond resolution, which is all an ISO-8601 instant carries. A column
  -- holding a microsecond-precision now() describes the same moment as a payload that can only
  -- write .123Z, and a check that called those two different would refuse every record whose
  -- saved_at came from the database clock.
  if date_trunc('milliseconds', measured) is distinct from date_trunc('milliseconds', expected_measured)
     or date_trunc('milliseconds', saved) is distinct from date_trunc('milliseconds', expected_saved) then
    return false;
  end if;
  if jsonb_typeof(payload->'outputs') <> 'array' or jsonb_array_length(payload->'outputs') = 0
     or jsonb_array_length(payload->'outputs') > 10 then
    return false;
  end if;

  for item in select * from jsonb_array_elements(payload->'outputs') loop
    if item->>'key' is null or item->>'status' is null then return false; end if;
    if item->>'key' = any(seen) then return false; end if;
    seen := seen || (item->>'key');
    if not private.composition_source_may_claim(expected_source, item->>'key', item->>'status') then
      return false;
    end if;
    -- A quoted number is a different thing from a number, and the difference is exactly how a
    -- string that is not a number at all gets past a range check.
    if jsonb_typeof(item->'value') <> 'number' then return false; end if;
    -- Physiological range, in the storage unit. A transcription slip is far likelier than a real
    -- 140% body fat, so it is refused rather than stored and shown to a parent.
    select * into bounds from (values
      ('body_fat_percent', 1::numeric, 75::numeric, 'percent'),
      ('fat_mass_kg', 0, 180, 'kg'), ('lean_mass_kg', 5, 220, 'kg'),
      ('skeletal_muscle_mass_kg', 2, 140, 'kg'), ('bone_mineral_content_kg', 0.2, 10, 'kg'),
      ('bone_mass_kg', 0.5, 15, 'kg'), ('body_water_mass_kg', 5, 120, 'kg'),
      ('visceral_fat_index', 1, 60, 'index'), ('weight_kg', 2, 400, 'kg'),
      ('bmi', 5, 90, 'kg_m2')
    ) as t(key, lo, hi, unit) where t.key = item->>'key';
    if not found then return false; end if;
    if item->>'unit' is distinct from bounds.unit then return false; end if;
    if (item->>'value')::numeric < bounds.lo or (item->>'value')::numeric > bounds.hi then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function private.external_composition_payload_is_allowed(
  jsonb,text,text,text,text,timestamptz,timestamptz) from public, anon;
grant execute on function private.external_composition_payload_is_allowed(
  jsonb,text,text,text,text,timestamptz,timestamptz) to authenticated;

-- ---------------------------------------------------------------------------------------------
create table if not exists public.external_composition_records (
  id uuid primary key default gen_random_uuid(),
  record_id text not null check (char_length(record_id) between 1 and 180 and record_id = btrim(record_id)),
  subject_reference text not null check (char_length(subject_reference) between 1 and 180 and subject_reference = btrim(subject_reference)),
  subject_scope text not null check (subject_scope in ('adult_reference','child_athlete')),
  athlete_id uuid references public.athletes(id) on delete cascade,
  -- The guardian who imported it. Not "the subject": an adult reference may be imported by an
  -- organization administrator about themselves, and a child record is always imported by an
  -- adult on the child's behalf.
  guardian_id uuid not null references auth.users(id) on delete cascade,
  -- Set only when the guardian has shared it with an organization. Null means private.
  team_id uuid references public.teams(id) on delete set null,
  -- The specific release this record was imported under, for a child. A free-text consent
  -- reference would say that somebody once agreed to something; a foreign key says which release,
  -- so a withdrawal can be traced to the records it covers. Cascades rather than restricts
  -- because both this table and biometric_consents hang off the athlete: with RESTRICT, deleting
  -- an athlete would deadlock on whichever cascade Postgres happened to run first.
  consent_id uuid references public.biometric_consents(id) on delete cascade,

  source_class text not null check (source_class in
    ('dexa','bia_clinical','smart_scale','health_platform','manual_report')),
  method_label text check (method_label is null or char_length(method_label) between 1 and 200),
  device_manufacturer text check (device_manufacturer is null or char_length(device_manufacturer) <= 200),
  device_model text check (device_model is null or char_length(device_model) <= 200),
  device_software_version text check (device_software_version is null or char_length(device_software_version) <= 100),
  facility text check (facility is null or char_length(facility) <= 200),
  operator text check (operator is null or char_length(operator) <= 200),
  originating_app text check (originating_app is null or char_length(originating_app) <= 200),
  -- The identifier the source itself used, when it has one. Part of duplicate detection: two
  -- imports of the same Apple Health sample are the same reading, not two readings.
  source_record_id text check (source_record_id is null or char_length(source_record_id) <= 200),

  measured_at timestamptz not null,
  saved_at timestamptz not null,
  retention_until timestamptz not null,
  record jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Duplicate detection needs one key that means "the same person". For a child that is the
  -- athlete id, which is globally unique, so two co-parents importing the same scan collapse to
  -- one row. For an adult reference the subject label is free text, and two unrelated people
  -- both calling themselves 'me' must not collide, so the importer scopes it.
  subject_key text generated always as (
    case when subject_scope = 'child_athlete' then 'athlete:' || athlete_id::text
         else 'guardian:' || guardian_id::text || ':' || subject_reference end) stored,

  -- An adult reference is never attached to a child profile, and a child record must name its
  -- athlete or it cannot be bound to a guardian consent.
  check ((subject_scope = 'child_athlete') = (athlete_id is not null)),
  check ((subject_scope = 'child_athlete') = (consent_id is not null)),
  check (subject_scope <> 'child_athlete' or subject_reference = athlete_id::text),
  check (measured_at <= saved_at),
  -- Retention runs from the day we took custody, not from the measurement. A parent importing a
  -- scan from three years ago is a normal thing to do, and a window anchored to measured_at would
  -- make the record unstorable rather than short-lived. Five years is longer than a model
  -- estimate's 400 days because a clinical scan is a longitudinal reference point, but it is
  -- still bounded: this is health data, not an archive.
  check (retention_until > saved_at and retention_until <= saved_at + interval '1825 days'),
  -- A facility identifies which scanner produced a clinical result; without it two machines are
  -- indistinguishable in a history.
  check (source_class not in ('dexa','bia_clinical') or facility is not null),
  -- A health platform only transports a value another app recorded.
  check (source_class <> 'health_platform' or originating_app is not null),
  check (source_class <> 'manual_report' or method_label is not null),
  check (private.external_composition_payload_is_allowed(
    record, record_id, subject_reference, subject_scope, source_class, measured_at, saved_at))
);

-- Duplicate protection. Re-importing the same CSV, or syncing the same health sample twice, must
-- not create a second reading — a duplicated measurement looks like corroboration.
create unique index if not exists external_composition_identity_idx
  on public.external_composition_records(subject_key, record_id);
create unique index if not exists external_composition_source_sample_idx
  on public.external_composition_records(subject_key, source_class, source_record_id)
  where source_record_id is not null;
create unique index if not exists external_composition_reading_idx
  on public.external_composition_records(subject_key, source_class, measured_at, coalesce(device_model,''));
create index if not exists external_composition_retention_idx
  on public.external_composition_records(retention_until);
create index if not exists external_composition_history_idx
  on public.external_composition_records(subject_key, measured_at desc);
create index if not exists external_composition_team_idx
  on public.external_composition_records(team_id) where team_id is not null;
create index if not exists external_composition_guardian_idx
  on public.external_composition_records(guardian_id);
create index if not exists external_composition_athlete_idx
  on public.external_composition_records(athlete_id) where athlete_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Private report documents. Referenced by storage key, never embedded: a PDF inside the row would
-- drag a clinical document carrying a name, a date of birth and a referring physician into every
-- export and audit entry that touches the record.
create table if not exists public.external_composition_attachments (
  id uuid primary key default gen_random_uuid(),
  record_uuid uuid not null references public.external_composition_records(id) on delete cascade,
  storage_key text not null unique check (char_length(storage_key) between 1 and 300),
  content_type text not null check (content_type in ('application/pdf','image/jpeg','image/png','text/csv')),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','verified_against_report')),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  -- Verified means a person compared the typed numbers against the document. Claiming it without
  -- saying who and when is not a verification.
  check ((verification_status = 'verified_against_report') = (verified_by is not null and verified_at is not null))
);
create index if not exists external_composition_attachment_record_idx
  on public.external_composition_attachments(record_uuid);

-- ---------------------------------------------------------------------------------------------
-- Consent. A child's clinical body composition is biometric data about a minor, so the same live
-- release that gates a scan gates an import.
--
-- The consent may come from any guardian with edit rights, not only the importer. Two parents
-- share one child: requiring the importing parent to have personally signed would block the
-- co-parent who is holding the printout, and the release covers the child's data rather than one
-- adult's actions.
create or replace function private.biometric_consent_is_live(consent uuid, ath uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.biometric_consents c
    where c.id = consent and c.athlete_id = ath
      and c.revoked_at is null and c.retention_until >= current_date);
$$;
revoke all on function private.biometric_consent_is_live(uuid,uuid) from public, anon, authenticated;
grant execute on function private.biometric_consent_is_live(uuid,uuid) to authenticated;

-- Enforced by trigger rather than only by policy, because the service role bypasses RLS. An
-- import path that runs with the service key must not be the way a record arrives for a child
-- whose family never agreed, or withdrew.
create or replace function private.require_external_composition_consent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.subject_scope = 'child_athlete' then
    if not exists (select 1 from public.athletes a where a.id = new.athlete_id) then
      raise exception 'A child composition record must name a real athlete.' using errcode = '23503';
    end if;
    if not private.biometric_consent_is_live(new.consent_id, new.athlete_id) then
      raise exception 'That biometric release is not live for this athlete. Record a release before importing a body composition result, or restore it if it was withdrawn.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists external_composition_consent_gate on public.external_composition_records;
create trigger external_composition_consent_gate
  before insert or update on public.external_composition_records
  for each row execute function private.require_external_composition_consent();

-- ---------------------------------------------------------------------------------------------
-- Source provenance is immutable once a person has verified the record against its document.
-- Correcting a transcription is legitimate; silently changing which machine produced a verified
-- result is how a smart-scale reading becomes a DEXA scan in a history.
create or replace function private.guard_external_composition_provenance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare verified boolean;
begin
  select exists(select 1 from public.external_composition_attachments a
    where a.record_uuid = old.id and a.verification_status = 'verified_against_report') into verified;
  if verified and (new.source_class is distinct from old.source_class
      or new.measured_at is distinct from old.measured_at
      or new.record is distinct from old.record
      or new.device_model is distinct from old.device_model
      or new.device_manufacturer is distinct from old.device_manufacturer
      or new.facility is distinct from old.facility) then
    raise exception 'This record has been verified against its report. Its source, device, measurement time and values can no longer be changed; withdraw it and import a corrected record instead.'
      using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists external_composition_provenance_guard on public.external_composition_records;
create trigger external_composition_provenance_guard
  before update on public.external_composition_records
  for each row execute function private.guard_external_composition_provenance();

-- ---------------------------------------------------------------------------------------------
-- Enabled, not FORCEd. FORCE would also apply to the owner, and the owner is what the
-- SECURITY DEFINER retention sweep runs as: the sweep would then be filtered by the very
-- policies it exists to act outside of, and would silently delete nothing. Every other table
-- here is enabled-not-forced for the same reason.
alter table public.external_composition_records enable row level security;
alter table public.external_composition_attachments enable row level security;

-- The guardian who imported it, or anyone who can edit that athlete. An organization
-- administrator can READ a record the guardian shared, and nothing more: an organization that
-- could write to a clinical record it did not create could alter someone's medical history.
create or replace function private.can_read_external_composition(
  requested_athlete uuid, requested_guardian uuid, requested_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select requested_guardian = (select auth.uid())
    or (requested_athlete is not null and private.can_edit_athlete(requested_athlete))
    or (requested_team is not null and requested_athlete is not null
        and private.is_admin_of_team(requested_team)
        and private.can_org_view_athlete(requested_athlete));
$$;
revoke all on function private.can_read_external_composition(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function private.can_read_external_composition(uuid,uuid,uuid) to authenticated;

create or replace function private.can_write_external_composition(
  requested_athlete uuid, requested_guardian uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select requested_guardian = (select auth.uid())
    and (requested_athlete is null or private.can_edit_athlete(requested_athlete));
$$;
revoke all on function private.can_write_external_composition(uuid,uuid) from public, anon, authenticated;
grant execute on function private.can_write_external_composition(uuid,uuid) to authenticated;

create policy external_composition_select on public.external_composition_records for select to authenticated
  using (private.can_read_external_composition(athlete_id, guardian_id, team_id) or private.is_admin());
create policy external_composition_insert on public.external_composition_records for insert to authenticated
  with check (guardian_id = (select auth.uid())
    and private.can_write_external_composition(athlete_id, guardian_id)
    and (subject_scope <> 'child_athlete' or private.biometric_consent_is_live(consent_id, athlete_id)));
create policy external_composition_update on public.external_composition_records for update to authenticated
  using (private.can_write_external_composition(athlete_id, guardian_id))
  with check (guardian_id = (select auth.uid()) and private.can_write_external_composition(athlete_id, guardian_id));
create policy external_composition_delete on public.external_composition_records for delete to authenticated
  using (private.can_write_external_composition(athlete_id, guardian_id));

-- Attachments follow write rights on the record, not read rights. The shared numbers are what an
-- organization was given; the source document carries a name, a date of birth and a referring
-- physician, and was not.
-- The guardian, and the platform verifier. Not the organization the numbers were shared with:
-- a verifier's whole job is to open the document, and an organization's is not.
create policy external_composition_attachment_select on public.external_composition_attachments for select to authenticated
  using (private.is_admin() or exists (select 1 from public.external_composition_records r
    where r.id = record_uuid and private.can_write_external_composition(r.athlete_id, r.guardian_id)));
create policy external_composition_attachment_insert on public.external_composition_attachments for insert to authenticated
  with check (verification_status = 'unverified' and exists (select 1 from public.external_composition_records r
    where r.id = record_uuid and private.can_write_external_composition(r.athlete_id, r.guardian_id)));
create policy external_composition_attachment_delete on public.external_composition_attachments for delete to authenticated
  using (exists (select 1 from public.external_composition_records r
    where r.id = record_uuid and private.can_write_external_composition(r.athlete_id, r.guardian_id)));

revoke all on public.external_composition_records from anon, authenticated;
grant select, insert, update, delete on public.external_composition_records to authenticated;
revoke all on public.external_composition_attachments from anon, authenticated;
-- No UPDATE: marking an attachment verified goes through the RPC below, so a guardian cannot
-- certify their own transcription by writing the column directly.
grant select, insert, delete on public.external_composition_attachments to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The platform verifier. Verification is a claim that a person compared the typed numbers against
-- the document, so it is not something the person who typed them can assert about themselves.
create or replace function public.verify_composition_attachment(p_attachment uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare updated public.external_composition_attachments;
begin
  if not private.is_admin() then
    raise exception 'Only a platform verifier can mark a composition report verified.'
      using errcode = '42501';
  end if;
  update public.external_composition_attachments
     set verification_status = 'verified_against_report',
         verified_by = (select auth.uid()), verified_at = now()
   where id = p_attachment and verification_status = 'unverified'
  returning * into updated;
  if updated.id is null then
    return jsonb_build_object('verified', false,
      'reason', 'No unverified attachment with that id. It may already be verified, or deleted.');
  end if;
  insert into public.access_log(actor_id, athlete_id, action, detail)
  select (select auth.uid()), r.athlete_id, 'external_composition_attachment_verified',
    jsonb_build_object('record_id', r.record_id, 'attachment_id', updated.id,
      'source_class', r.source_class)
  from public.external_composition_records r where r.id = updated.record_uuid;
  return jsonb_build_object('verified', true, 'attachmentId', updated.id);
end;
$$;
revoke all on function public.verify_composition_attachment(uuid) from public, anon;
grant execute on function public.verify_composition_attachment(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
create or replace function private.audit_external_composition_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.access_log(actor_id, athlete_id, action, detail)
  values ((select auth.uid()), coalesce(new.athlete_id, old.athlete_id),
    'external_composition_record_' || lower(tg_op),
    -- Identifiers and provenance only. No measured value reaches the audit trail: an audit row
    -- naming somebody's body fat percentage is itself health data, retained on a different
    -- schedule from the record it describes.
    jsonb_build_object(
      'record_id', coalesce(new.record_id, old.record_id),
      'subject_scope', coalesce(new.subject_scope, old.subject_scope),
      'source_class', coalesce(new.source_class, old.source_class),
      'device_model', coalesce(new.device_model, old.device_model),
      'team_id', coalesce(new.team_id, old.team_id),
      'measured_at', coalesce(new.measured_at, old.measured_at)));
  return coalesce(new, old);
end;
$$;
drop trigger if exists external_composition_record_audit on public.external_composition_records;
create trigger external_composition_record_audit
  after insert or update or delete on public.external_composition_records
  for each row execute function private.audit_external_composition_change();

-- ---------------------------------------------------------------------------------------------
-- The private bucket the report documents live in, keyed on the record's own id so a storage
-- policy can find the row that governs it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('composition-reports','composition-reports', false, 20971520,
  array['application/pdf','image/jpeg','image/png','text/csv'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.can_reach_composition_report(folder uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or exists (select 1 from public.external_composition_records r
    where r.id = folder and private.can_write_external_composition(r.athlete_id, r.guardian_id));
$$;
revoke all on function private.can_reach_composition_report(uuid) from public, anon, authenticated;
grant execute on function private.can_reach_composition_report(uuid) to authenticated;

-- UUID-guarded like the athlete-media policies: a non-uuid first segment belongs to some other
-- app on this shared project and must not raise a cast error inside its storage queries.
drop policy if exists composition_report_select on storage.objects;
create policy composition_report_select on storage.objects for select using (
  bucket_id = 'composition-reports'
  and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       then private.can_reach_composition_report((storage.foldername(name))[1]::uuid)
       else false end);
drop policy if exists composition_report_insert on storage.objects;
create policy composition_report_insert on storage.objects for insert with check (
  bucket_id = 'composition-reports'
  and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       then private.can_reach_composition_report((storage.foldername(name))[1]::uuid)
       else false end);
drop policy if exists composition_report_delete on storage.objects;
create policy composition_report_delete on storage.objects for delete using (
  bucket_id = 'composition-reports'
  and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       then private.can_reach_composition_report((storage.foldername(name))[1]::uuid)
       else false end);
-- No UPDATE policy. Replacing the bytes under a verified attachment would leave a verification
-- that vouches for a document nobody checked; a correction is a new attachment.

-- Deleting the record cascades to the attachment row. The stored object is not covered by that
-- cascade, so it is removed here — otherwise an expired record leaves an orphaned clinical PDF in
-- the bucket with nothing left to say whose it was.
create or replace function private.purge_composition_report_objects()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from storage.objects o where o.bucket_id = 'composition-reports' and o.name = old.storage_key;
  return old;
end;
$$;
drop trigger if exists external_composition_attachment_purge on public.external_composition_attachments;
create trigger external_composition_attachment_purge
  after delete on public.external_composition_attachments
  for each row execute function private.purge_composition_report_objects();

-- ---------------------------------------------------------------------------------------------
-- Retention, and continuing consent. A withdrawn release is not merely a block on new imports:
-- the records already held stop being ones the family agreed to, so the sweep removes them too.
create or replace function private.sweep_external_composition_retention()
returns integer language plpgsql security definer set search_path = '' as $$
declare deleted_count integer;
begin
  with gone as (
    delete from public.external_composition_records r
     where r.retention_until <= now()
        or (r.subject_scope = 'child_athlete'
            and not private.biometric_consent_is_live(r.consent_id, r.athlete_id))
    returning r.id)
  select count(*) into deleted_count from gone;
  return deleted_count;
end;
$$;
revoke all on function private.sweep_external_composition_retention() from public, anon, authenticated;
select cron.unschedule('external-composition-retention')
  where exists (select 1 from cron.job where jobname = 'external-composition-retention');
select cron.schedule('external-composition-retention','55 3 * * *',
  $$select private.sweep_external_composition_retention();$$);

-- ---------------------------------------------------------------------------------------------
-- One answer to "what is this record", in SQL as well as in JavaScript. A report or export that
-- works it out from whichever columns happen to be populated will eventually get it wrong, and
-- the way it gets it wrong is by calling a clinical scan a Parent Playbook estimate.
create or replace function public.describe_composition_origin(record_payload jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case
    when record_payload->>'schema' = 'PP_BODY_COMPOSITION_REFERENCE_V1' then
      jsonb_build_object(
        'origin','external_measurement','isParentPlaybookEstimate',false,
        'label', case when exists (select 1 from jsonb_array_elements(record_payload->'outputs') o
                                   where o->>'status' = 'measured')
                 then 'Externally measured' else 'Device estimated' end)
    when record_payload->>'schema' = 'PP_BODY_COMPOSITION_ESTIMATE_V1' then
      jsonb_build_object('origin','model_estimate','isParentPlaybookEstimate',true,
        'label','Parent Playbook estimated')
    else jsonb_build_object('origin','unknown','isParentPlaybookEstimate',null,'label',null)
  end;
$$;
revoke all on function public.describe_composition_origin(jsonb) from public, anon;
grant execute on function public.describe_composition_origin(jsonb) to authenticated;
