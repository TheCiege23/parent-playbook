-- Adult Training, milestone 1: a parent's own training record.
--
-- A parent's goals, a weekly gym or activity schedule with its exercises, the workouts they tick off, and weight or
-- tape measurements they enter themselves. It belongs to the signed-in guardian and nobody else:
--
--   - every table is keyed by guardian_id and readable only by that guardian. No co-parent, family viewer, coach or
--     organization policy exists, and nothing joins it to a child's athlete profile;
--   - writes need an allowlist row as well (public.adult_training_access, which only the operator writes), so the
--     feature is off in production for every account not named there, whatever the app's own flag says. Reading and
--     deleting do not need it, so a tester taken off the list can still export and delete what they recorded;
--   - weight and measurements come only from the parent (source 'manual'). Nothing here stores an estimate, a target
--     or a body-composition value;
--   - every row goes with the account: guardian_id cascades from auth.users, and supabase/functions/delete-account
--     deletes these tables explicitly before it deletes the login.
--
-- The children's rest-first rules do not apply here. An adult may schedule any day of the week.

-- ---------------------------------------------------------------------------------------------
-- The allowlist, and the check every write policy uses.
create table if not exists public.adult_training_access (
  guardian_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note text check (note is null or length(note) <= 200)
);
comment on table public.adult_training_access is
  'Accounts that may use Adult Training while it is behind a flag. Written by the operator only.';
alter table public.adult_training_access enable row level security;
drop policy if exists adult_training_access_select on public.adult_training_access;
create policy adult_training_access_select on public.adult_training_access for select to authenticated
  using (guardian_id = (select auth.uid()));
revoke all on public.adult_training_access from anon, authenticated;
grant select on public.adult_training_access to authenticated;

create or replace function private.adult_training_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.adult_training_access a where a.guardian_id = (select auth.uid()));
$$;
revoke all on function private.adult_training_allowed() from public, anon, authenticated;
grant execute on function private.adult_training_allowed() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The record.
create table if not exists public.adult_profiles (
  guardian_id uuid primary key references auth.users(id) on delete cascade,
  units text not null default 'lb' check (units in ('lb', 'kg')),
  experience text check (experience is null or experience in ('new', 'returning', 'regular')),
  -- The parent's own weekly aim. The federal baseline is shown beside it as a reference, never filled in for them.
  weekly_minutes_target smallint check (weekly_minutes_target is null or weekly_minutes_target between 0 and 1200),
  strength_days_target smallint check (strength_days_target is null or strength_days_target between 0 and 7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adult_goals (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('weight_trend', 'strength', 'mobility', 'endurance', 'energy', 'consistency')),
  label text not null check (length(label) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'achieved', 'archived')),
  created_at timestamptz not null default now()
);
create index if not exists adult_goals_guardian_idx on public.adult_goals (guardian_id);

create table if not exists public.adult_schedule_items (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references auth.users(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  title text not null check (length(title) between 1 and 80),
  kind text not null check (kind in ('strength', 'cardio', 'mobility', 'sport', 'walk', 'other')),
  duration_min smallint check (duration_min is null or duration_min between 1 and 600),
  created_at timestamptz not null default now(),
  constraint adult_schedule_items_id_guardian_key unique (id, guardian_id)
);
create index if not exists adult_schedule_items_guardian_idx on public.adult_schedule_items (guardian_id, weekday);

create table if not exists public.adult_schedule_exercises (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  guardian_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  sets smallint check (sets is null or sets between 1 and 20),
  reps smallint check (reps is null or reps between 1 and 100),
  duration_sec integer check (duration_sec is null or duration_sec between 1 and 7200),
  position smallint not null default 0 check (position between 0 and 50),
  created_at timestamptz not null default now(),
  -- An exercise can only belong to a workout of the same guardian.
  constraint adult_schedule_exercises_item_fkey foreign key (item_id, guardian_id)
    references public.adult_schedule_items (id, guardian_id) on delete cascade
);
create index if not exists adult_schedule_exercises_item_idx on public.adult_schedule_exercises (item_id, guardian_id);
create index if not exists adult_schedule_exercises_guardian_idx on public.adult_schedule_exercises (guardian_id);

create table if not exists public.adult_workout_logs (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references auth.users(id) on delete cascade,
  schedule_item_id uuid,
  done_on date not null,
  minutes smallint check (minutes is null or minutes between 1 and 600),
  created_at timestamptz not null default now(),
  -- Deleting a workout from the schedule keeps the days it was done, unlinked.
  constraint adult_workout_logs_item_fkey foreign key (schedule_item_id, guardian_id)
    references public.adult_schedule_items (id, guardian_id) on delete set null (schedule_item_id),
  constraint adult_workout_logs_once_a_day_key unique (guardian_id, done_on, schedule_item_id)
);
create index if not exists adult_workout_logs_guardian_idx on public.adult_workout_logs (guardian_id, done_on);
create index if not exists adult_workout_logs_item_idx on public.adult_workout_logs (schedule_item_id, guardian_id);

create table if not exists public.adult_body_entries (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references auth.users(id) on delete cascade,
  metric_key text not null check (metric_key in ('weight', 'waist', 'hips', 'chest', 'arm', 'thigh')),
  value numeric not null check (value > 0 and value < 2000),
  unit text not null check (unit in ('lb', 'kg', 'in', 'cm')),
  measured_on date not null,
  -- Typed in by the parent from a scale or a tape. Imports and scans are later milestones with their own sources.
  source text not null default 'manual' check (source = 'manual'),
  created_at timestamptz not null default now(),
  -- Weight in a weight unit, a tape measurement in a length unit.
  constraint adult_body_entries_metric_unit_check check ((metric_key = 'weight') = (unit in ('lb', 'kg')))
);
create index if not exists adult_body_entries_guardian_idx on public.adult_body_entries (guardian_id, metric_key, measured_on);

-- ---------------------------------------------------------------------------------------------
-- Access: the guardian, and only the guardian. Reading and deleting are always theirs; creating and changing also
-- need the allowlist. A workout or measurement dated more than a day ahead is refused (a day, because the family's
-- date and the server's can differ).
alter table public.adult_profiles enable row level security;
alter table public.adult_goals enable row level security;
alter table public.adult_schedule_items enable row level security;
alter table public.adult_schedule_exercises enable row level security;
alter table public.adult_workout_logs enable row level security;
alter table public.adult_body_entries enable row level security;

create policy adult_profiles_select on public.adult_profiles for select to authenticated using (guardian_id = (select auth.uid()));
create policy adult_profiles_delete on public.adult_profiles for delete to authenticated using (guardian_id = (select auth.uid()));
create policy adult_profiles_insert on public.adult_profiles for insert to authenticated
  with check (guardian_id = (select auth.uid()) and private.adult_training_allowed());
create policy adult_profiles_update on public.adult_profiles for update to authenticated
  using (guardian_id = (select auth.uid())) with check (guardian_id = (select auth.uid()) and private.adult_training_allowed());

create policy adult_goals_select on public.adult_goals for select to authenticated using (guardian_id = (select auth.uid()));
create policy adult_goals_delete on public.adult_goals for delete to authenticated using (guardian_id = (select auth.uid()));
create policy adult_goals_insert on public.adult_goals for insert to authenticated
  with check (guardian_id = (select auth.uid()) and private.adult_training_allowed());
create policy adult_goals_update on public.adult_goals for update to authenticated
  using (guardian_id = (select auth.uid())) with check (guardian_id = (select auth.uid()) and private.adult_training_allowed());

create policy adult_schedule_items_select on public.adult_schedule_items for select to authenticated using (guardian_id = (select auth.uid()));
create policy adult_schedule_items_delete on public.adult_schedule_items for delete to authenticated using (guardian_id = (select auth.uid()));
create policy adult_schedule_items_insert on public.adult_schedule_items for insert to authenticated
  with check (guardian_id = (select auth.uid()) and private.adult_training_allowed());
create policy adult_schedule_items_update on public.adult_schedule_items for update to authenticated
  using (guardian_id = (select auth.uid())) with check (guardian_id = (select auth.uid()) and private.adult_training_allowed());

create policy adult_schedule_exercises_select on public.adult_schedule_exercises for select to authenticated using (guardian_id = (select auth.uid()));
create policy adult_schedule_exercises_delete on public.adult_schedule_exercises for delete to authenticated using (guardian_id = (select auth.uid()));
create policy adult_schedule_exercises_insert on public.adult_schedule_exercises for insert to authenticated
  with check (guardian_id = (select auth.uid()) and private.adult_training_allowed());
create policy adult_schedule_exercises_update on public.adult_schedule_exercises for update to authenticated
  using (guardian_id = (select auth.uid())) with check (guardian_id = (select auth.uid()) and private.adult_training_allowed());

create policy adult_workout_logs_select on public.adult_workout_logs for select to authenticated using (guardian_id = (select auth.uid()));
create policy adult_workout_logs_delete on public.adult_workout_logs for delete to authenticated using (guardian_id = (select auth.uid()));
create policy adult_workout_logs_insert on public.adult_workout_logs for insert to authenticated
  with check (guardian_id = (select auth.uid()) and private.adult_training_allowed() and done_on <= current_date + 1);
create policy adult_workout_logs_update on public.adult_workout_logs for update to authenticated
  using (guardian_id = (select auth.uid()))
  with check (guardian_id = (select auth.uid()) and private.adult_training_allowed() and done_on <= current_date + 1);

create policy adult_body_entries_select on public.adult_body_entries for select to authenticated using (guardian_id = (select auth.uid()));
create policy adult_body_entries_delete on public.adult_body_entries for delete to authenticated using (guardian_id = (select auth.uid()));
create policy adult_body_entries_insert on public.adult_body_entries for insert to authenticated
  with check (guardian_id = (select auth.uid()) and private.adult_training_allowed() and measured_on <= current_date + 1);
create policy adult_body_entries_update on public.adult_body_entries for update to authenticated
  using (guardian_id = (select auth.uid()))
  with check (guardian_id = (select auth.uid()) and private.adult_training_allowed() and measured_on <= current_date + 1);

revoke all on public.adult_profiles, public.adult_goals, public.adult_schedule_items, public.adult_schedule_exercises,
  public.adult_workout_logs, public.adult_body_entries from anon, authenticated;
grant select, insert, update, delete on public.adult_profiles, public.adult_goals, public.adult_schedule_items,
  public.adult_schedule_exercises, public.adult_workout_logs, public.adult_body_entries to authenticated;
