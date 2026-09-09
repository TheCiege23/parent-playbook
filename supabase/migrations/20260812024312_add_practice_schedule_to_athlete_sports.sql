-- Practice schedule per athlete+sport, so the weekly plan can route AROUND team
-- practice instead of stacking home training on top of it.
-- Day encoding matches the app's week: 0=Mon, 1=Tue, ... 6=Sun.
alter table public.athlete_sports
  add column if not exists practice_days smallint[] not null default '{}',
  add column if not exists game_day smallint;

-- keep the data honest: only real weekday indexes
alter table public.athlete_sports
  drop constraint if exists athlete_sports_game_day_range;
alter table public.athlete_sports
  add constraint athlete_sports_game_day_range
  check (game_day is null or (game_day >= 0 and game_day <= 6));

alter table public.athlete_sports
  drop constraint if exists athlete_sports_practice_days_range;
alter table public.athlete_sports
  add constraint athlete_sports_practice_days_range
  check (
    practice_days <@ array[0,1,2,3,4,5,6]::smallint[]
    and array_length(practice_days, 1) is distinct from 0
  );

comment on column public.athlete_sports.practice_days is
  'Team practice days, 0=Mon..6=Sun. buildProgram() schedules rest/recovery on these and fits home sessions into the gaps.';
comment on column public.athlete_sports.game_day is
  'Usual game day, 0=Mon..6=Sun. NULL means no regular game day.';;
