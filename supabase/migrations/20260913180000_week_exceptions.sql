-- A parent's one change to a week.
--
-- The weekly plan is generated, never stored, and a parent could not change it: a birthday party on
-- Thursday meant either doing the session anyway or leaving an unticked day for the plan to rebalance.
-- This table holds at most one change per athlete per week, and applyWeekChange() in js/program.js
-- applies it to the generated plan. The change can only keep or add rest:
--
--   skip  a home session becomes a rest day;
--   move  a home session swaps places with a rest day later in the week (never the evening before a game,
--         never onto a practice, a game or another session), so rest and work counts do not change;
--   swap  a home session is replaced by another card of the same kind from the same age-banded pool.
--
-- What is allowed is decided in the browser, where the plan is generated, and re-checked every time the
-- week is drawn: a change made against a plan that has since changed is ignored rather than forced.
-- The database keeps the shape honest (one change a week, a Monday, a day index, the fields each change
-- needs) and who may write it. It is not stored in schedule_exceptions: that table means "the team session
-- did not happen", allows one row per date, and notify-gameday treats any row as a cancelled game.

create table if not exists public.week_exceptions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  week_start date not null,
  op text not null check (op in ('skip', 'move', 'swap')),
  from_day smallint not null check (from_day between 0 and 6),
  -- The session the change was made against. If the plan no longer has it on that day, the change is ignored.
  from_title text not null check (length(from_title) between 1 and 200),
  to_day smallint check (to_day between 0 and 6),
  replacement_title text check (replacement_title is null or length(replacement_title) between 1 and 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint week_exceptions_athlete_id_week_start_key unique (athlete_id, week_start),
  constraint week_exceptions_monday_check check (extract(isodow from week_start) = 1),
  constraint week_exceptions_move_check check ((op = 'move') = (to_day is not null)),
  constraint week_exceptions_swap_check check ((op = 'swap') = (replacement_title is not null)),
  constraint week_exceptions_distinct_days_check check (to_day is null or to_day <> from_day)
);

comment on table public.week_exceptions is
  'At most one parent change to a generated week: skip, move to a rest day, or swap for a like card. Applied by applyWeekChange() in js/program.js, which refuses anything that would reduce rest.';

create index if not exists week_exceptions_created_by_idx on public.week_exceptions (created_by);

alter table public.week_exceptions enable row level security;

-- Anyone who can see the athlete can see the change, so a grandparent with family view sees the same week.
drop policy if exists week_exceptions_select on public.week_exceptions;
create policy week_exceptions_select on public.week_exceptions for select to authenticated
  using (private.can_view_athlete(athlete_id));
-- Changing the plan is edit rights, recorded as the caller, for the current week only. The window is a
-- week either side of today because the family's Monday and the server's can differ by a day.
drop policy if exists week_exceptions_insert on public.week_exceptions;
create policy week_exceptions_insert on public.week_exceptions for insert to authenticated
  with check (private.can_edit_athlete(athlete_id) and created_by = (select auth.uid())
    and week_start between current_date - 7 and current_date + 7);
-- Undoing is a delete. There is no update: a different change is an undo and a new change.
drop policy if exists week_exceptions_delete on public.week_exceptions;
create policy week_exceptions_delete on public.week_exceptions for delete to authenticated
  using (private.can_edit_athlete(athlete_id));

revoke all on public.week_exceptions from anon, authenticated;
grant select, insert, delete on public.week_exceptions to authenticated;
