-- A coarse, honest first pass — not a substitute for a human, and not pretending to be
-- one. Runs server-side as a trigger (not a client-side check) specifically so it can't
-- be bypassed by a client that skips the check: the same reasoning behind every RLS
-- policy in this project. False positives are the acceptable failure mode here (an
-- admin looks at an innocent message and dismisses it); false negatives are not, so the
-- pattern list errs toward catching more, not fewer.
alter table public.coach_updates add column if not exists auto_flagged boolean not null default false;

create or replace function private.flag_coach_update()
returns trigger
language plpgsql
as $function$
declare
  lowered text := lower(new.body);
begin
  -- High-signal on their own: crisis/self-harm language, or a request for explicit
  -- images. Neither has an innocent reading in a coach-to-family channel about a child.
  if lowered ~ '(kill myself|suicide|self.?harm|want to die|hurt myself|send (a |me )?(a )?(nude|naked)|nude photo)'
  -- Only concerning as a specific phrase — the individual words (secret, alone, drugs,
  -- between us) all have completely ordinary coaching uses on their own, so only the
  -- combined phrase is checked, to keep false positives from swamping real signal.
  or lowered ~ '(our secret|just between us|keep this between us|don''t tell your parents|dont tell your parents|delete this message|meet me alone|come alone|without your parents|no one (else )?needs to know)'
  then
    new.auto_flagged := true;
  end if;
  return new;
end;
$function$;

drop trigger if exists coach_updates_flag_trigger on public.coach_updates;
create trigger coach_updates_flag_trigger
  before insert on public.coach_updates
  for each row execute function private.flag_coach_update();

-- A specific, named report — distinct from a flag the system raised on its own. A
-- guardian reports a message; the coach who sent it cannot report or dismiss their own.
create table public.coach_update_reports (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.coach_updates(id) on delete cascade,
  reported_by uuid not null references public.guardians(id),
  reason text not null check (char_length(reason) between 1 and 1000),
  status text not null default 'open' check (status in ('open','reviewed','dismissed')),
  reviewed_by uuid references public.guardians(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.coach_update_reports enable row level security;

-- Only a guardian who can see the athlete's family-side record may report — deliberately
-- NOT can_coach_view_athlete(), so the coach who sent a message can never be the one
-- reporting or reviewing it.
create policy cur_insert on public.coach_update_reports
  for insert with check (
    reported_by = auth.uid()
    and exists (
      select 1 from public.coach_updates cu
      where cu.id = update_id and private.can_view_athlete(cu.athlete_id)
    )
  );

-- A reporter can see their own report's status; otherwise admin-only.
create policy cur_select on public.coach_update_reports
  for select using (reported_by = auth.uid() or private.is_admin());

create policy cur_update_admin on public.coach_update_reports
  for update using (private.is_admin()) with check (private.is_admin());
;
