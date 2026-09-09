-- Where the athlete is in the year, asked directly instead of inferred from dates.
-- Nullable on purpose: every existing row predates the question, and buildProgram
-- falls back to deriving the state from season_start/season_end when it is null.
alter table public.athlete_sports
  add column if not exists season_state text;

alter table public.athlete_sports
  drop constraint if exists athlete_sports_season_state_chk;

alter table public.athlete_sports
  add constraint athlete_sports_season_state_chk
  check (season_state is null or season_state in ('in_season','offseason','between_sports'));

comment on column public.athlete_sports.season_state is
  'in_season | offseason | between_sports. NULL = not asked; buildProgram derives it from season_start/season_end instead.';;
