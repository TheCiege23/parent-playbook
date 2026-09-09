-- Groundwork only, per TEAM-CONNECT-EXPANSION-PLAN.md Part E — nothing writes to these
-- columns yet. They exist so a future league-system sync (SportsEngine, most likely
-- first) has somewhere to record which external event a schedule came from, and can
-- upsert against it instead of duplicating on every re-sync.
alter table public.athlete_sports add column if not exists external_source text;
alter table public.athlete_sports add column if not exists external_ref text;

create unique index if not exists athlete_sports_external_idx
  on public.athlete_sports(external_source, external_ref)
  where external_source is not null;
;
