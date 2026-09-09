-- Two named notification types instead of one vague "turn on". Nobody grants push to
-- an unspecified request; they will for a game-day reminder.
-- Defaults are ON so an existing subscriber keeps getting the Sunday message they
-- already opted into — this table records preference, not permission. Permission still
-- lives in the browser and in push_subscriptions.
create table if not exists public.notification_prefs (
  guardian_id uuid primary key references auth.users(id) on delete cascade,
  weekly      boolean not null default true,
  game_day    boolean not null default true,
  updated_at  timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

drop policy if exists np_select on public.notification_prefs;
drop policy if exists np_upsert on public.notification_prefs;
drop policy if exists np_update on public.notification_prefs;

create policy np_select on public.notification_prefs
  for select using (guardian_id = auth.uid());
create policy np_upsert on public.notification_prefs
  for insert with check (guardian_id = auth.uid());
create policy np_update on public.notification_prefs
  for update using (guardian_id = auth.uid()) with check (guardian_id = auth.uid());

comment on table public.notification_prefs is
  'Per-guardian push preferences. A missing row means both types are on — see the COALESCE in notify-weekly / notify-gameday.';;
