-- One row per completed session. Until now nothing recorded that a plan was ever
-- followed, so the app couldn't tell a good week from a skipped one.
create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  athlete_id  uuid not null references public.athletes(id) on delete cascade,
  done_on     date not null,
  title       text not null,
  kind        text,                    -- skill | strength | speed | play | move | practice | game
  week_index  int,                     -- weeksSince(athlete.created_at) when logged
  minutes     int check (minutes is null or (minutes >= 0 and minutes <= 600)),
  note        text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (athlete_id, done_on, title)  -- tapping "done" twice is idempotent
);

create index if not exists sessions_athlete_date_idx on public.sessions (athlete_id, done_on desc);

alter table public.sessions enable row level security;

drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions for select to authenticated
  using (private.can_view_athlete(athlete_id));

drop policy if exists sessions_insert on public.sessions;
create policy sessions_insert on public.sessions for insert to authenticated
  with check (private.can_edit_athlete(athlete_id));

drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions for update to authenticated
  using (private.can_edit_athlete(athlete_id)) with check (private.can_edit_athlete(athlete_id));

drop policy if exists sessions_delete on public.sessions;
create policy sessions_delete on public.sessions for delete to authenticated
  using (private.can_edit_athlete(athlete_id));

comment on table public.sessions is
  'Completed training sessions. Written by the "Mark done" action on the week screen; drives the weekly count and streak.';;
