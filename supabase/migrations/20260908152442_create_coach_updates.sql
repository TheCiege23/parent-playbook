-- One thread per athlete, not per coach — a family with both a cheer coach and a
-- football trainer connected sees everything about that athlete in one place, the
-- same "one home for the record" principle the games/journey table already uses.
-- 'announcement' is a visual tag on the same thread, not a separate feature — per the
-- confirmed design, a parent should not need to check two different places.
create table public.coach_updates (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  sender_id uuid not null references public.guardians(id),
  kind text not null default 'general' check (kind in ('general','workout','nutrition','announcement')),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index coach_updates_athlete_idx on public.coach_updates(athlete_id, created_at desc);

alter table public.coach_updates enable row level security;

-- Read: any guardian who can see the athlete's stats at all — owner/co_parent/
-- family_view via can_view_athlete, or a coach via can_coach_view_athlete (which
-- itself falls through to can_edit_athlete for owner/co_parent). Between the two,
-- every role that legitimately has ANY relationship to this athlete can read the
-- thread; nobody else can.
create policy cu_select on public.coach_updates
  for select using (
    private.can_view_athlete(athlete_id) or private.can_coach_view_athlete(athlete_id)
  );

-- Write: the coach relationship itself, or a full guardian (owner/co_parent) — never
-- family_view, which is read-only everywhere else in this app and stays that way here.
create policy cu_insert on public.coach_updates
  for insert with check (
    sender_id = auth.uid()
    and (private.can_edit_athlete(athlete_id) or private.can_coach_view_athlete(athlete_id))
  );

-- No update/delete policy — a sent update is part of the record, the same "we don't
-- silently rewrite what was already said" stance the app takes on consent history.
;
