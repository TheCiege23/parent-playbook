-- ===================================================================
--  BIOMETRIC CONSENT — the written release, recorded per athlete
-- ===================================================================
-- Body geometry taken from photographs is a biometric identifier under the Illinois
-- Biometric Information Privacy Act, the Texas Capture or Use of Biometric Identifier
-- Act and Washington's My Health My Data Act. All three want the same three things,
-- and this table is where each of them is evidenced rather than asserted:
--
--   1. A WRITTEN RELEASE obtained BEFORE capture, from the subject or, for a minor,
--      their legally authorised representative.  -> one row, granted_at, guardian_id
--   2. A published RETENTION SCHEDULE that is actually honoured.
--      -> retention_until, set at grant time, never open-ended
--   3. DESTRUCTION when the purpose is satisfied or the schedule expires.
--      -> revoked_at, plus the nightly sweep that acts on retention_until
--
-- policy_version pins the exact wording agreed to. When the release text changes the
-- version changes, existing consents stop matching, and the parent is asked again --
-- which is the only honest way to handle a release whose terms have moved.
create table if not exists public.biometric_consents (
  id                uuid primary key default gen_random_uuid(),
  athlete_id        uuid not null references public.athletes(id) on delete cascade,
  -- The adult who gave it. For a minor this is the legally authorised representative;
  -- the athlete is the subject, never the signer.
  guardian_id       uuid not null references auth.users(id) on delete cascade,
  subject_is_minor  boolean not null,
  subject_age_years int,
  policy_version    text not null,
  -- Which engine was consented to. On-device geometry and a third-party service are
  -- materially different disclosures, so a consent to one is not a consent to the other.
  scan_engine       text not null,
  retention_until   date not null,
  granted_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  revoked_by        uuid references auth.users(id),
  method            text not null default 'in_app_written_release',
  detail            jsonb
);

create index if not exists biometric_consents_active_idx
  on public.biometric_consents (athlete_id) where revoked_at is null;
create index if not exists biometric_consents_retention_idx
  on public.biometric_consents (retention_until) where revoked_at is null;

alter table public.biometric_consents enable row level security;

-- Viewing follows the athlete: a grandparent with family view can see THAT a consent
-- exists, which is the transparency half of the same statutes.
drop policy if exists bioc_select on public.biometric_consents;
create policy bioc_select on public.biometric_consents
  for select using (private.can_view_athlete(athlete_id));

-- Granting requires edit rights AND that the row is stamped with the caller's own id.
-- Without the second half an editor could record a release in another guardian's name.
drop policy if exists bioc_ins on public.biometric_consents;
create policy bioc_ins on public.biometric_consents
  for insert with check (private.can_edit_athlete(athlete_id) and guardian_id = auth.uid());

-- Revocation is an UPDATE, never a DELETE: the record that consent was once given and
-- then withdrawn is itself the compliance artefact.
drop policy if exists bioc_upd on public.biometric_consents;
create policy bioc_upd on public.biometric_consents
  for update using (private.can_edit_athlete(athlete_id))
  with check (private.can_edit_athlete(athlete_id));

-- ===================================================================
--  THE MEASUREMENTS THE ON-DEVICE ENGINE PRODUCES
-- ===================================================================
-- All five are lengths a tape measure could also have produced, which is the line the
-- product holds: no girths, no volumes, no composition. They are registered in `metrics`
-- so Growth renders them with a real name and unit, and so a parent can type one in by
-- hand -- a scan is a faster tape measure, not a separate kind of truth.
--
-- Deliberately absent: any ratio. Ape index and sitting-height ratio are computed for
-- display because they are the genuinely informative numbers, but a ratio stored as a
-- metric acquires a trend line and an implied direction, and there is no good or bad
-- value for a child's proportions.
insert into public.metrics (sport_key, key, name, unit, lower_is_better, is_general, sort)
values
  ('general', 'wingspan',       'Wingspan',       'in', false, true, 3),
  ('general', 'standing_reach', 'Standing reach', 'in', false, true, 4),
  ('general', 'shoulder_width', 'Shoulder width', 'in', false, true, 5),
  ('general', 'torso_length',   'Torso length',   'in', false, true, 6),
  ('general', 'leg_length',     'Leg length',     'in', false, true, 7)
on conflict do nothing;;
