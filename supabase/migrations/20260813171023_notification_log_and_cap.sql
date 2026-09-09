-- A sent-log, so the four-a-week cap is enforceable rather than aspirational.
-- Design handoff, platform §6: four a week maximum, nothing on rest days, quiet
-- 9pm–7am. Without a log the cap is unknowable — each function only sees its own run.
create table if not exists public.notification_log (
  id          bigserial primary key,
  guardian_id uuid not null references auth.users(id) on delete cascade,
  kind        text not null,
  sent_at     timestamptz not null default now()
);

create index if not exists notification_log_recent_idx
  on public.notification_log (guardian_id, sent_at desc);

alter table public.notification_log enable row level security;
-- Nobody reads this from the client. The functions use the service role, which bypasses
-- RLS; leaving zero policies means an accidental client read returns nothing rather
-- than someone else's send history.
comment on table public.notification_log is
  'One row per push actually delivered. Read by notify-* to enforce the 4/week cap. No client policies on purpose.';

-- How many messages has this guardian had in the last 7 days?
create or replace function public.notifications_sent_last_week(p_guardian uuid)
returns int language sql stable security definer set search_path to '' as $$
  select count(*)::int from public.notification_log
  where guardian_id = p_guardian and sent_at > now() - interval '7 days';
$$;;
