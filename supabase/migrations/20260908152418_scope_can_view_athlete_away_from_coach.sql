-- Explicit role list, matching can_edit_athlete's existing style — a 'coach' row no
-- longer satisfies "can view this athlete at all" via this function. Every existing
-- caller (athletes/athlete_sports/games/measurements/media SELECT policies, the
-- athlete-media storage bucket) is unchanged for owner/co_parent/family_view, because
-- all three are still listed explicitly below.
create or replace function private.can_view_athlete(ath uuid)
returns boolean
language sql stable security definer set search_path = ''
as $function$
  select exists (select 1 from public.athletes a
      join public.family_members m on m.family_id = a.family_id
      where a.id = ath and m.guardian_id = auth.uid())
     or exists (select 1 from public.athlete_access g
      where g.athlete_id = ath and g.guardian_id = auth.uid() and g.revoked_at is null
        and g.role in ('owner','co_parent','family_view'));
$function$;

-- The coach-specific counterpart. OR's in can_edit_athlete() so an owner/co_parent
-- (who already sees everything) isn't accidentally locked out of whatever gets built
-- against this function — they just reach it through the broader grant instead.
create or replace function private.can_coach_view_athlete(ath uuid)
returns boolean
language sql stable security definer set search_path = ''
as $function$
  select private.can_edit_athlete(ath)
     or exists (select 1 from public.athlete_access g
      where g.athlete_id = ath and g.guardian_id = auth.uid() and g.revoked_at is null
        and g.role = 'coach');
$function$;

-- Additive SELECT policies (RLS policies OR together) — a coach-role row now reaches
-- exactly these three tables and nothing else. No policy is added for games or media,
-- so RLS denies both by default for a coach, same as it would for a stranger.
create policy ath_select_coach on public.athletes
  for select using (private.can_coach_view_athlete(id));
create policy asp_select_coach on public.athlete_sports
  for select using (private.can_coach_view_athlete(athlete_id));
create policy meas_select_coach on public.measurements
  for select using (private.can_coach_view_athlete(athlete_id));
;
