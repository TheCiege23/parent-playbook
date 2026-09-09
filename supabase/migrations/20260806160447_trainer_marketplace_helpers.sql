-- Is the caller a marketplace admin?
create or replace function private.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where guardian_id = (select auth.uid()));
$$;

-- Does the calling trainer hold a live (non-expired, non-revoked) grant to this athlete?
create or replace function private.trainer_can_view_athlete(ath uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from trainer_athlete_grants g
    where g.athlete_id = ath
      and g.trainer_id = (select auth.uid())
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
  );
$$;

revoke all on function private.is_admin() from public, anon;
revoke all on function private.trainer_can_view_athlete(uuid) from public, anon;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.trainer_can_view_athlete(uuid) to authenticated;;
