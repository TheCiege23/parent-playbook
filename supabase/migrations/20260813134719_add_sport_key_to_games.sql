-- Journey groups by sport, then season. Without this every game for a two-sport
-- athlete lands in one jumbled list. Backfilled to the primary sport, which is what
-- every existing row was logged against.
alter table public.games
  add column if not exists sport_key text;

update public.games g
set sport_key = s.sport_key
from public.athlete_sports s
where g.sport_key is null
  and s.athlete_id = g.athlete_id
  and s.is_primary = true;

-- single-sport athletes whose row isn't flagged primary
update public.games g
set sport_key = s.sport_key
from public.athlete_sports s
where g.sport_key is null
  and s.athlete_id = g.athlete_id
  and (select count(*) from public.athlete_sports x where x.athlete_id = g.athlete_id) = 1;

create index if not exists games_athlete_sport_idx
  on public.games (athlete_id, sport_key, game_date desc);

comment on column public.games.sport_key is
  'Which sport this game belongs to. Defaults to the athlete''s primary sport at logging time. NULL groups under the primary sport in the Journey.';;
