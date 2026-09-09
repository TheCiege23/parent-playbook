-- Wrap auth.uid() as (select auth.uid()) so the planner evaluates it once
-- per query (initplan) instead of once per row. Behavior is identical.

-- guardians
alter policy guardians_self_select on public.guardians using (id = (select auth.uid()));
alter policy guardians_self_insert on public.guardians with check (id = (select auth.uid()));
alter policy guardians_self_update on public.guardians using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- families
alter policy families_insert on public.families with check (created_by = (select auth.uid()));
alter policy families_delete on public.families using (
  exists (select 1 from public.family_members m
          where m.family_id = families.id and m.guardian_id = (select auth.uid()) and m.role = 'owner'::family_role));

-- athlete_access
alter policy aa_select on public.athlete_access using ((guardian_id = (select auth.uid())) or private.can_edit_athlete(athlete_id));

-- access_log
alter policy log_insert on public.access_log with check (actor_id = (select auth.uid()));

-- teams
alter policy teams_ins on public.teams with check (created_by = (select auth.uid()));
alter policy teams_upd on public.teams using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
alter policy teams_del on public.teams using (created_by = (select auth.uid()));

-- consent_records
alter policy consent_select on public.consent_records using ((guardian_id = (select auth.uid())) or private.can_edit_athlete(athlete_id));
alter policy consent_ins on public.consent_records with check (guardian_id = (select auth.uid()));

-- athlete_invites
alter policy ainv_insert on public.athlete_invites with check (private.can_edit_athlete(athlete_id) and (created_by = (select auth.uid())));;
