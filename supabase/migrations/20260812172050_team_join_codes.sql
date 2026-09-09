-- Team codes. A coach shares one code; a parent types it during setup and the sport,
-- level, practice days, game day and season dates are filled in for them — the steps
-- most likely to be got wrong or skipped, and the ones the whole weekly plan depends on.
--
-- DELIBERATELY NOT A MEMBERSHIP. Redeeming a code writes NOTHING linking the child to the
-- team, and the coach never gains visibility of any child, household or parent. A code is
-- a preset, not an enrolment. That is what makes it safe for a coach to post publicly to
-- a team chat: no parent is opting their child into someone else's view by using it.
alter table public.teams
  add column if not exists join_code     text,
  add column if not exists level         text,
  add column if not exists practice_days smallint[] not null default '{}',
  add column if not exists game_day      smallint,
  add column if not exists season_start  date,
  add column if not exists season_end    date,
  add column if not exists uses          integer not null default 0,
  add column if not exists is_active     boolean not null default true;

alter table public.teams drop constraint if exists teams_game_day_range;
alter table public.teams add constraint teams_game_day_range
  check (game_day is null or (game_day between 0 and 6));

-- Case-insensitive and unique: parents will type it however they like.
create unique index if not exists teams_join_code_uidx on public.teams (upper(join_code))
  where join_code is not null;

-- Look up a code WITHOUT exposing the teams table. Returns only what the setup form needs
-- — no created_by, no counts, nothing about who else has used it.
create or replace function public.team_by_code(p_code text)
returns table(name text, sport_key text, level text,
              practice_days smallint[], game_day smallint,
              season_start date, season_end date)
language sql stable security definer
set search_path = ''
as $$
  select t.name, t.sport_key, t.level, t.practice_days, t.game_day, t.season_start, t.season_end
  from public.teams t
  where t.join_code is not null
    and upper(t.join_code) = upper(btrim(p_code))
    and t.is_active
  limit 1;
$$;

-- Aggregate counter only, so a coach can see "14 families used this" and nothing else.
create or replace function public.team_code_used(p_code text)
returns void
language sql volatile security definer
set search_path = ''
as $$
  update public.teams set uses = uses + 1
  where join_code is not null and upper(join_code) = upper(btrim(p_code)) and is_active;
$$;

revoke all on function public.team_by_code(text)   from public;
revoke all on function public.team_code_used(text) from public;
grant execute on function public.team_by_code(text)   to anon, authenticated;
grant execute on function public.team_code_used(text) to anon, authenticated;;
