-- Parent Playbook — 0003 teams, schedule, weekly playbook, consent
create type public.event_type as enum ('practice','training','gym','game','rest','other');
create type public.consent_type as enum ('account','child_data','sharing','third_party','media');

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  state text,
  sport_key text references public.sports(key),
  league text,
  division text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index teams_search_idx on public.teams(sport_key, state, division);

create table public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  season text,
  jersey text,
  created_at timestamptz not null default now(),
  unique (athlete_id, team_id, season)
);
create index tm_athlete_idx on public.team_memberships(athlete_id);

create table public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  type public.event_type not null,
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  venue_name text,
  address text,
  opponent_name text,
  opponent_city text,
  opponent_state text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index events_athlete_start_idx on public.schedule_events(athlete_id, starts_at);

create table public.playbook_weeks (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  week_start date not null,
  plan jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (athlete_id, week_start)
);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references auth.users(id),
  athlete_id uuid references public.athletes(id) on delete cascade,
  consent_type public.consent_type not null,
  granted boolean not null default true,
  method text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index consent_athlete_idx on public.consent_records(athlete_id);

alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;
alter table public.schedule_events enable row level security;
alter table public.playbook_weeks enable row level security;
alter table public.consent_records enable row level security;

create policy teams_read on public.teams for select to authenticated using (true);
create policy teams_ins on public.teams for insert to authenticated with check (created_by = auth.uid());
create policy teams_upd on public.teams for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy teams_del on public.teams for delete to authenticated using (created_by = auth.uid());

create policy tm_select on public.team_memberships for select to authenticated using (public.can_view_athlete(athlete_id));
create policy tm_ins on public.team_memberships for insert to authenticated with check (public.can_edit_athlete(athlete_id));
create policy tm_upd on public.team_memberships for update to authenticated using (public.can_edit_athlete(athlete_id)) with check (public.can_edit_athlete(athlete_id));
create policy tm_del on public.team_memberships for delete to authenticated using (public.can_edit_athlete(athlete_id));

create policy ev_select on public.schedule_events for select to authenticated using (public.can_view_athlete(athlete_id));
create policy ev_ins on public.schedule_events for insert to authenticated with check (public.can_edit_athlete(athlete_id));
create policy ev_upd on public.schedule_events for update to authenticated using (public.can_edit_athlete(athlete_id)) with check (public.can_edit_athlete(athlete_id));
create policy ev_del on public.schedule_events for delete to authenticated using (public.can_edit_athlete(athlete_id));

create policy pw_select on public.playbook_weeks for select to authenticated using (public.can_view_athlete(athlete_id));
create policy pw_ins on public.playbook_weeks for insert to authenticated with check (public.can_edit_athlete(athlete_id));
create policy pw_upd on public.playbook_weeks for update to authenticated using (public.can_edit_athlete(athlete_id)) with check (public.can_edit_athlete(athlete_id));
create policy pw_del on public.playbook_weeks for delete to authenticated using (public.can_edit_athlete(athlete_id));

create policy consent_select on public.consent_records for select to authenticated using (guardian_id = auth.uid() or public.can_edit_athlete(athlete_id));
create policy consent_ins on public.consent_records for insert to authenticated with check (guardian_id = auth.uid());

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;;
