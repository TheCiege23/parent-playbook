-- ================= app_admins =================
create policy app_admins_read on app_admins for select to authenticated
  using (private.is_admin());

-- ================= trainer_profiles =================
create policy tp_read on trainer_profiles for select to authenticated
  using (status = 'approved' or id = (select auth.uid()) or private.is_admin());
create policy tp_insert on trainer_profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy tp_update on trainer_profiles for update to authenticated
  using (id = (select auth.uid()) or private.is_admin())
  with check (id = (select auth.uid()) or private.is_admin());
create policy tp_delete on trainer_profiles for delete to authenticated
  using (id = (select auth.uid()) or private.is_admin());

-- Guard: only an admin may change a trainer's status (prevents self-approval / self-unsuspend)
create or replace function private.guard_trainer_status() returns trigger
  language plpgsql security definer set search_path = public as $$
  begin
    if NEW.status is distinct from OLD.status and not private.is_admin() then
      raise exception 'Only an admin can change trainer status';
    end if;
    return NEW;
  end $$;
create trigger trg_guard_trainer_status before update on trainer_profiles
  for each row execute function private.guard_trainer_status();

-- helper: is a trainer approved (for public listing joins)
create or replace function private.trainer_is_approved(tid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from trainer_profiles p where p.id = tid and p.status = 'approved');
$$;
grant execute on function private.trainer_is_approved(uuid) to authenticated;

-- ================= trainer_sports =================
create policy ts_read on trainer_sports for select to authenticated
  using (private.trainer_is_approved(trainer_id) or trainer_id = (select auth.uid()) or private.is_admin());
create policy ts_write on trainer_sports for all to authenticated
  using (trainer_id = (select auth.uid()) or private.is_admin())
  with check (trainer_id = (select auth.uid()) or private.is_admin());

-- ================= services =================
create policy sv_read on services for select to authenticated
  using ((is_active and private.trainer_is_approved(trainer_id)) or trainer_id = (select auth.uid()) or private.is_admin());
create policy sv_write on services for all to authenticated
  using (trainer_id = (select auth.uid()) or private.is_admin())
  with check (trainer_id = (select auth.uid()) or private.is_admin());

-- ================= verifications / credentials / references (private) =================
create policy tv_read on trainer_verifications for select to authenticated
  using (trainer_id = (select auth.uid()) or private.is_admin());
create policy tv_insert on trainer_verifications for insert to authenticated
  with check (trainer_id = (select auth.uid()) or private.is_admin());
create policy tv_admin_upd on trainer_verifications for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy tc_read on trainer_credentials for select to authenticated
  using (trainer_id = (select auth.uid()) or private.is_admin());
create policy tc_insert on trainer_credentials for insert to authenticated
  with check (trainer_id = (select auth.uid()) or private.is_admin());
create policy tc_admin_upd on trainer_credentials for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy tr_read on trainer_references for select to authenticated
  using (trainer_id = (select auth.uid()) or private.is_admin());
create policy tr_insert on trainer_references for insert to authenticated
  with check (trainer_id = (select auth.uid()) or private.is_admin());
create policy tr_admin_upd on trainer_references for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- ================= bookings =================
create policy bk_read on bookings for select to authenticated
  using (parent_id = (select auth.uid()) or trainer_id = (select auth.uid()) or private.is_admin());
create policy bk_insert on bookings for insert to authenticated
  with check (parent_id = (select auth.uid()));
create policy bk_update on bookings for update to authenticated
  using (parent_id = (select auth.uid()) or trainer_id = (select auth.uid()) or private.is_admin())
  with check (parent_id = (select auth.uid()) or trainer_id = (select auth.uid()) or private.is_admin());

-- ================= trainer_athlete_grants =================
create policy gr_read on trainer_athlete_grants for select to authenticated
  using (trainer_id = (select auth.uid()) or granted_by = (select auth.uid()) or private.is_admin());
create policy gr_insert on trainer_athlete_grants for insert to authenticated
  with check (granted_by = (select auth.uid()) and private.can_edit_athlete(athlete_id));
create policy gr_update on trainer_athlete_grants for update to authenticated
  using (granted_by = (select auth.uid()) or private.is_admin())
  with check (granted_by = (select auth.uid()) or private.is_admin());

-- ================= booking_messages =================
create policy bm_read on booking_messages for select to authenticated
  using (exists (select 1 from bookings b where b.id = booking_id
                 and ((select auth.uid()) in (b.parent_id, b.trainer_id))) or private.is_admin());
create policy bm_insert on booking_messages for insert to authenticated
  with check (sender_id = (select auth.uid())
    and exists (select 1 from bookings b where b.id = booking_id
                and ((select auth.uid()) in (b.parent_id, b.trainer_id))));

-- ================= payments (reads only; writes via service role/webhook) =================
create policy pm_read on payments for select to authenticated
  using (parent_id = (select auth.uid()) or trainer_id = (select auth.uid()) or private.is_admin());

-- ================= reviews =================
create policy rv_read on reviews for select to authenticated
  using (is_published or parent_id = (select auth.uid()) or private.is_admin());
create policy rv_insert on reviews for insert to authenticated
  with check (parent_id = (select auth.uid())
    and exists (select 1 from bookings b where b.id = booking_id
                and b.parent_id = (select auth.uid()) and b.status = 'completed'));
create policy rv_update on reviews for update to authenticated
  using (parent_id = (select auth.uid()) or private.is_admin())
  with check (parent_id = (select auth.uid()) or private.is_admin());

-- ================= trainer_reports =================
create policy rp_read on trainer_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or private.is_admin());
create policy rp_insert on trainer_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));
create policy rp_admin_upd on trainer_reports for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- ================= trainer_review_actions (admin only) =================
create policy tra_read on trainer_review_actions for select to authenticated
  using (private.is_admin());
create policy tra_insert on trainer_review_actions for insert to authenticated
  with check (private.is_admin());;
