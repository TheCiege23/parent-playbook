-- ============================================================================
-- B1 — screening enforcement.
--
-- Before this, "Background check" and "SafeSport" were buttons with nothing
-- behind them: an admin could mark either one "passed" with zero evidence on
-- the record, and a trainer could INSERT their own rows pre-marked "passed"
-- (tv_insert only checks trainer_id; only UPDATE was admin-gated).
--
-- Enforcement lives in the database, not the client, because this is the
-- control that decides whether an adult is listed to other people's children.
-- ============================================================================

-- One row per (trainer, kind). The app already assumes this — it deletes the
-- set and re-inserts on every submit — but nothing enforced it.
create unique index if not exists trainer_verifications_trainer_kind_uidx
  on public.trainer_verifications (trainer_id, kind);

-- What counts as evidence for each kind of check.
--   identity          — a scanned ID on file
--   safesport         — a training certificate, plus the date it lapses
--   background_check  — either a provider result (provider + external_ref, for
--                       a Checkr/Sterling-style integration) OR an uploaded
--                       report; either way an expiry, because a background
--                       check is a snapshot, not a permanent fact
create or replace function private.verification_evidence_ok(
  p_kind         public.verification_kind,
  p_provider     text,
  p_external_ref text,
  p_doc_path     text,
  p_expires_at   timestamptz
) returns boolean
language sql immutable
set search_path = ''
as $$
  select case p_kind
    when 'identity'         then p_doc_path is not null
    when 'safesport'        then p_doc_path is not null and p_expires_at is not null
    when 'background_check' then (
                                   (p_provider is not null and p_external_ref is not null)
                                   or p_doc_path is not null
                                 ) and p_expires_at is not null
    else true
  end;
$$;

-- Runs as the CALLER (not security definer) so private.is_admin() reflects
-- whoever is actually writing the row.
create or replace function private.tv_guard()
returns trigger
language plpgsql
as $$
begin
  -- A trainer may create their own placeholder rows and attach documents, but
  -- may never self-certify or forge a provider result.
  if not private.is_admin() then
    if new.status not in ('not_started','pending','submitted') then
      raise exception 'Only an admin can set a screening check to "%"', new.status
        using errcode = '42501';
    end if;
    new.provider       := null;
    new.external_ref   := null;
    new.result_summary := null;
    new.completed_at   := null;
    new.reviewed_by    := null;
  end if;

  if new.status = 'passed' then
    if not private.verification_evidence_ok(
         new.kind, new.provider, new.external_ref, new.doc_path, new.expires_at) then
      raise exception
        'Cannot pass "%" with no evidence on record. Identity needs a document; SafeSport needs a certificate and an expiry; a background check needs a provider result or an uploaded report, plus an expiry.',
        new.kind using errcode = '23514';
    end if;
    if new.expires_at is not null and new.expires_at <= now() then
      raise exception 'Cannot pass "%" with an expiry in the past', new.kind
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tv_guard on public.trainer_verifications;
create trigger tv_guard
  before insert or update on public.trainer_verifications
  for each row execute function private.tv_guard();

-- Is this trainer's screening complete AND currently in date?
-- SECURITY DEFINER on purpose: it is used inside the trainer_profiles read
-- policy, and a browsing parent cannot read trainer_verifications directly.
create or replace function private.trainer_screening_ok(p_trainer uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select count(distinct v.kind) = 3
    from public.trainer_verifications v
   where v.trainer_id = p_trainer
     and v.kind in ('identity','background_check','safesport')
     and v.status = 'passed'
     and (v.expires_at is null or v.expires_at > now());
$$;

-- A trainer cannot be approved until all three checks are passed and in date.
create or replace function private.tp_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'approved'
     and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if not private.trainer_screening_ok(new.id) then
      raise exception
        'Cannot approve this trainer: identity, background check, and SafeSport must all be passed and unexpired.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tp_guard on public.trainer_profiles;
create trigger tp_guard
  before insert or update on public.trainer_profiles
  for each row execute function private.tp_guard();

-- Listing gate. Expiry is enforced live at read time rather than by a nightly
-- job, so a lapsed background check unlists the trainer the moment it lapses
-- with no scheduled task to fail. Owner and admin still see their own row.
drop policy if exists tp_read on public.trainer_profiles;
create policy tp_read on public.trainer_profiles for select using (
  (status = 'approved' and private.trainer_screening_ok(id))
  or id = (select auth.uid())
  or private.is_admin()
);;
