-- Covering indexes on foreign keys flagged by the performance advisor.
create index if not exists access_log_actor_id_idx        on public.access_log(actor_id);
create index if not exists athlete_access_granted_by_idx   on public.athlete_access(granted_by);
create index if not exists athlete_invites_accepted_by_idx on public.athlete_invites(accepted_by);
create index if not exists athlete_invites_created_by_idx  on public.athlete_invites(created_by);
create index if not exists athlete_sports_sport_key_idx    on public.athlete_sports(sport_key);
create index if not exists athletes_created_by_idx         on public.athletes(created_by);
create index if not exists consent_records_guardian_id_idx on public.consent_records(guardian_id);
create index if not exists families_created_by_idx         on public.families(created_by);
create index if not exists family_members_guardian_id_idx  on public.family_members(guardian_id);
create index if not exists goals_created_by_idx            on public.goals(created_by);
create index if not exists goals_sport_key_idx             on public.goals(sport_key);
create index if not exists measurements_created_by_idx     on public.measurements(created_by);
create index if not exists schedule_events_created_by_idx  on public.schedule_events(created_by);
create index if not exists schedule_events_team_id_idx     on public.schedule_events(team_id);
create index if not exists team_memberships_team_id_idx    on public.team_memberships(team_id);
create index if not exists teams_created_by_idx            on public.teams(created_by);;
