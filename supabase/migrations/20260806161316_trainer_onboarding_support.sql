-- Allow a trainer to submit/resubmit their OWN application (draft/needs_info → submitted),
-- but still block self-approval / self-reinstatement. Admins can do anything.
create or replace function private.guard_trainer_status() returns trigger
  language plpgsql security definer set search_path = public as $$
  begin
    if NEW.status is distinct from OLD.status and not private.is_admin() then
      if not (OLD.status in ('draft','submitted','needs_info') and NEW.status in ('draft','submitted')) then
        raise exception 'Only an admin can change trainer status';
      end if;
    end if;
    return NEW;
  end $$;

-- Tighten insert: a non-admin may only create their own profile as draft/submitted.
drop policy if exists tp_insert on trainer_profiles;
create policy tp_insert on trainer_profiles for insert to authenticated
  with check (id = (select auth.uid()) and (status in ('draft','submitted') or private.is_admin()));

-- Store exactly what the trainer attested to (and when).
alter table trainer_profiles add column if not exists attestations jsonb;

-- Let trainers manage their own screening rows while the application is open.
create policy tc_delete on trainer_credentials for delete to authenticated
  using (trainer_id = (select auth.uid()) or private.is_admin());
create policy tv_delete on trainer_verifications for delete to authenticated
  using (trainer_id = (select auth.uid()) or private.is_admin());;
