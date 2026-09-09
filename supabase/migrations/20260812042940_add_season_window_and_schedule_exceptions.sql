-- 1. Season window. A weekly game day is meaningless out of season — without this the
-- plan shows "Game day" every Saturday in August when the season starts in September.
alter table public.athlete_sports
  add column if not exists season_start date,
  add column if not exists season_end   date;

alter table public.athlete_sports drop constraint if exists athlete_sports_season_range;
alter table public.athlete_sports add constraint athlete_sports_season_range
  check (season_start is null or season_end is null or season_end >= season_start);

comment on column public.athlete_sports.season_start is
  'First game date (approximate is fine). Before this, game_day is ignored and the week is treated as preseason / camp.';

-- 2. Cancellations. Rain days, cancelled practice, a bye. Removing the session frees the
-- week''s load budget, so the scheduler can offer an at-home alternative for that day.
create table if not exists public.schedule_exceptions (
  id          uuid primary key default gen_random_uuid(),
  athlete_id  uuid not null references public.athletes(id) on delete cascade,
  on_date     date not null,
  kind        text not null check (kind in ('practice','game')),
  reason      text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (athlete_id, on_date)
);

create index if not exists schedule_exceptions_lookup_idx
  on public.schedule_exceptions (athlete_id, on_date);

alter table public.schedule_exceptions enable row level security;

drop policy if exists sx_select on public.schedule_exceptions;
create policy sx_select on public.schedule_exceptions for select to authenticated
  using (private.can_view_athlete(athlete_id));
drop policy if exists sx_insert on public.schedule_exceptions;
create policy sx_insert on public.schedule_exceptions for insert to authenticated
  with check (private.can_edit_athlete(athlete_id));
drop policy if exists sx_update on public.schedule_exceptions;
create policy sx_update on public.schedule_exceptions for update to authenticated
  using (private.can_edit_athlete(athlete_id)) with check (private.can_edit_athlete(athlete_id));
drop policy if exists sx_delete on public.schedule_exceptions;
create policy sx_delete on public.schedule_exceptions for delete to authenticated
  using (private.can_edit_athlete(athlete_id));

comment on table public.schedule_exceptions is
  'Days the team session did NOT happen. buildProgram drops these from the committed load, which frees budget for an at-home session that day.';;
