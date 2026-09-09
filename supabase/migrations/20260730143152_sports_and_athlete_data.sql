-- Parent Playbook — 0002 sport configuration + athlete data
create type public.goal_type as enum ('skill','physical');
create type public.goal_status as enum ('active','achieved','paused','archived');
create type public.measure_source as enum ('manual','guided','photo','import');

create table public.sports (
  key text primary key,
  name text not null,
  level_vocab jsonb not null default '[]',
  selectable boolean not null default true,
  sort int not null default 0
);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  sport_key text not null references public.sports(key) on delete cascade,
  code text not null,
  name text not null,
  sort int not null default 0,
  unique (sport_key, code)
);

create table public.metrics (
  id uuid primary key default gen_random_uuid(),
  sport_key text not null references public.sports(key) on delete cascade,
  key text not null,
  name text not null,
  unit text,
  lower_is_better boolean not null default false,
  is_general boolean not null default false,
  sort int not null default 0,
  unique (sport_key, key)
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  sport_key text not null references public.sports(key) on delete cascade,
  title text not null,
  focus text,
  age_min int,
  age_max int,
  duration_min int,
  description text,
  what_to_say text,
  common_mistakes text,
  when_to_stop text,
  created_at timestamptz not null default now()
);
create index activities_sport_age_idx on public.activities(sport_key, age_min, age_max);

create table public.athlete_sports (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  sport_key text not null references public.sports(key),
  positions text[] not null default '{}',
  level text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (athlete_id, sport_key)
);
create index athlete_sports_athlete_idx on public.athlete_sports(athlete_id);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  type public.goal_type not null,
  sport_key text references public.sports(key),
  key text,
  label text not null,
  status public.goal_status not null default 'active',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index goals_athlete_idx on public.goals(athlete_id);

create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  metric_key text not null,
  sport_key text,
  value numeric not null,
  unit text,
  measured_on date not null default current_date,
  conditions text,
  note text,
  source public.measure_source not null default 'manual',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index measurements_athlete_metric_idx on public.measurements(athlete_id, metric_key, measured_on);

alter table public.sports enable row level security;
alter table public.positions enable row level security;
alter table public.metrics enable row level security;
alter table public.activities enable row level security;
alter table public.athlete_sports enable row level security;
alter table public.goals enable row level security;
alter table public.measurements enable row level security;

create policy sports_read on public.sports for select to authenticated using (true);
create policy positions_read on public.positions for select to authenticated using (true);
create policy metrics_read on public.metrics for select to authenticated using (true);
create policy activities_read on public.activities for select to authenticated using (true);

create policy asp_select on public.athlete_sports for select to authenticated using (public.can_view_athlete(athlete_id));
create policy asp_ins on public.athlete_sports for insert to authenticated with check (public.can_edit_athlete(athlete_id));
create policy asp_upd on public.athlete_sports for update to authenticated using (public.can_edit_athlete(athlete_id)) with check (public.can_edit_athlete(athlete_id));
create policy asp_del on public.athlete_sports for delete to authenticated using (public.can_edit_athlete(athlete_id));

create policy goals_select on public.goals for select to authenticated using (public.can_view_athlete(athlete_id));
create policy goals_ins on public.goals for insert to authenticated with check (public.can_edit_athlete(athlete_id));
create policy goals_upd on public.goals for update to authenticated using (public.can_edit_athlete(athlete_id)) with check (public.can_edit_athlete(athlete_id));
create policy goals_del on public.goals for delete to authenticated using (public.can_edit_athlete(athlete_id));

create policy meas_select on public.measurements for select to authenticated using (public.can_view_athlete(athlete_id));
create policy meas_ins on public.measurements for insert to authenticated with check (public.can_edit_athlete(athlete_id));
create policy meas_upd on public.measurements for update to authenticated using (public.can_edit_athlete(athlete_id)) with check (public.can_edit_athlete(athlete_id));
create policy meas_del on public.measurements for delete to authenticated using (public.can_edit_athlete(athlete_id));

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;;
