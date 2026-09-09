-- The daily nudge must not fire on a rest day — "nothing on rest days, silence is the
-- message". But whether today is a rest day is decided by buildProgram, which lives in
-- the browser. Reimplementing it in the scheduler would create two engines that drift,
-- and the message would eventually describe a week the app doesn't show.
--
-- So the CLIENT publishes what it rendered. One row per athlete per week, overwritten
-- on every render. The scheduler reads it and never computes anything.
--
-- Deliberately NOT a copy of the plan: no drill titles, no notes, no child's name.
-- Just which day indexes are nudge-able, so a leak of this table says nothing about
-- anyone. `nudge_days` is Mon=0..Sun=6, matching DAY_LABELS.
create table if not exists public.week_plan_days (
  athlete_id  uuid not null references public.athletes(id) on delete cascade,
  week_start  date not null,
  nudge_days  smallint[] not null default '{}',
  updated_at  timestamptz not null default now(),
  primary key (athlete_id, week_start)
);

alter table public.week_plan_days enable row level security;

drop policy if exists wpd_write on public.week_plan_days;
drop policy if exists wpd_read  on public.week_plan_days;

-- Only someone who can edit the athlete may publish, and only they can read it back.
create policy wpd_read on public.week_plan_days
  for select to authenticated using (private.can_edit_athlete(athlete_id));
create policy wpd_write on public.week_plan_days
  for insert to authenticated with check (private.can_edit_athlete(athlete_id));
drop policy if exists wpd_update on public.week_plan_days;
create policy wpd_update on public.week_plan_days
  for update to authenticated using (private.can_edit_athlete(athlete_id))
  with check (private.can_edit_athlete(athlete_id));

comment on table public.week_plan_days is
  'Published by the browser after each week render. Day indexes only — never titles or names. Read by notify-daily so the scheduler never has to reimplement buildProgram.';;
