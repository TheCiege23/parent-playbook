
create or replace function private.can_org_view_athlete(ath uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_edit_athlete(ath)
  or exists (
    select 1 from public.team_memberships tm
    join public.teams t on t.id = tm.team_id
    where tm.athlete_id = ath and t.created_by = auth.uid()
  );
$$;

create policy ath_select_org on public.athletes
  for select using (private.can_org_view_athlete(id));

create policy asp_select_org on public.athlete_sports
  for select using (private.can_org_view_athlete(athlete_id));

create policy meas_select_org on public.measurements
  for select using (private.can_org_view_athlete(athlete_id));

create policy aa_select_org on public.athlete_access
  for select using (
    role = 'coach' and exists (
      select 1 from public.team_memberships tm
      join public.teams t on t.id = tm.team_id
      where tm.athlete_id = athlete_access.athlete_id and t.created_by = auth.uid()
    )
  );

drop policy teams_read on public.teams;
create policy teams_read on public.teams
  for select using (
    created_by = auth.uid()
    or exists (
      select 1 from public.team_memberships tm
      where tm.team_id = teams.id and private.can_view_athlete(tm.athlete_id)
    )
  );

drop function public.team_by_code(text);
create function public.team_by_code(p_code text)
returns table(id uuid, name text, sport_key text, level text, practice_days smallint[], game_day smallint, season_start date, season_end date)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.name, t.sport_key, t.level, t.practice_days, t.game_day, t.season_start, t.season_end
  from public.teams t
  where t.join_code is not null
    and upper(t.join_code) = upper(btrim(p_code))
    and t.is_active
  limit 1;
$$;
;
