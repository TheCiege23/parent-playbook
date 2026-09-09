-- Athlete Journey diary: games, milestones, media
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  game_date date not null,
  season text,
  opponent text,
  home_away text check (home_away in ('home','away','neutral')),
  our_score int,
  their_score int,
  result text check (result in ('win','loss','tie','na')),
  notes text,
  stats jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  milestone_date date not null,
  title text not null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  game_id uuid references public.games(id) on delete set null,
  kind text not null check (kind in ('photo','video')),
  path text not null,
  caption text,
  taken_on date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists games_athlete_date_idx on public.games(athlete_id, game_date desc);
create index if not exists milestones_athlete_date_idx on public.milestones(athlete_id, milestone_date desc);
create index if not exists media_athlete_created_idx on public.media(athlete_id, created_at desc);
create index if not exists media_game_idx on public.media(game_id);

alter table public.games enable row level security;
alter table public.milestones enable row level security;
alter table public.media enable row level security;

-- games
create policy games_select on public.games for select using (private.can_view_athlete(athlete_id));
create policy games_insert on public.games for insert with check (private.can_edit_athlete(athlete_id));
create policy games_update on public.games for update using (private.can_edit_athlete(athlete_id)) with check (private.can_edit_athlete(athlete_id));
create policy games_delete on public.games for delete using (private.can_edit_athlete(athlete_id));

-- milestones
create policy milestones_select on public.milestones for select using (private.can_view_athlete(athlete_id));
create policy milestones_insert on public.milestones for insert with check (private.can_edit_athlete(athlete_id));
create policy milestones_update on public.milestones for update using (private.can_edit_athlete(athlete_id)) with check (private.can_edit_athlete(athlete_id));
create policy milestones_delete on public.milestones for delete using (private.can_edit_athlete(athlete_id));

-- media
create policy media_select on public.media for select using (private.can_view_athlete(athlete_id));
create policy media_insert on public.media for insert with check (private.can_edit_athlete(athlete_id));
create policy media_update on public.media for update using (private.can_edit_athlete(athlete_id)) with check (private.can_edit_athlete(athlete_id));
create policy media_delete on public.media for delete using (private.can_edit_athlete(athlete_id));;
