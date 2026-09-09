
-- aa_select_org queried team_memberships directly inside its USING clause, which put it
-- back under team_memberships's own RLS (can_view_athlete only) — an org admin's EXISTS
-- check could never see the very membership row it needed. Route through a SECURITY
-- DEFINER helper, same fix already proven correct for ath/asp/meas_select_org.
create or replace function private.is_team_admin_for_athlete(ath uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.team_memberships tm
    join public.teams t on t.id = tm.team_id
    where tm.athlete_id = ath and t.created_by = auth.uid()
  );
$$;

drop policy aa_select_org on public.athlete_access;
create policy aa_select_org on public.athlete_access
  for select using (
    role = 'coach' and private.is_team_admin_for_athlete(athlete_id)
  );
;
