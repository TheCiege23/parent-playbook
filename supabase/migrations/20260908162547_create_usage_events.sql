-- Aggregate, non-identifying feature usage — "how many times was the body scan opened
-- today", never "who opened it". No user_id, no athlete_id, no IP, nothing joinable
-- back to a person or a child. This is deliberately NOT the third-party analytics /
-- session-recording privacy.html already promises the product doesn't do (see its
-- "What we do not collect" list) — it's a first-party daily counter, disclosed as its
-- own thing rather than smuggled in under that promise.
create table public.usage_events (
  event_key text not null,
  day date not null default current_date,
  count integer not null default 0,
  primary key (event_key, day),
  -- A closed allowlist, not free text — the point of aggregate telemetry is a small,
  -- known set of counters. Free text here would let the table grow unbounded and would
  -- turn "aggregate usage" into something closer to arbitrary event tracking.
  constraint usage_events_key_allowed check (event_key in (
    'view_week','view_growth','view_scan_hub','view_journey','view_profile','view_account',
    'scan_body_started','scan_jump_started','scan_reaction_started','scan_footwork_started','scan_sprint_started',
    'scan_body_saved','scan_jump_saved','scan_reaction_saved','scan_footwork_saved','scan_sprint_saved',
    'team_connect_viewed','team_connect_invite_sent','team_connect_update_sent',
    'camps_viewed','camp_submitted','signup_completed','invite_accepted'
  ))
);

alter table public.usage_events enable row level security;
-- No client policies at all: every write goes through log_usage_event() below, which
-- is SECURITY DEFINER and bypasses RLS by design. Direct table access is refused for
-- every role, which is the point — nothing about this table is meant to be queried
-- one-row-at-a-time from the app.

-- Admin-only read — aggregate as these rows are, "nobody but an operator can even look
-- at usage counts" is a stricter default than the data actually requires, and stricter
-- is the right direction to round to.
create policy usage_events_admin_select on public.usage_events
  for select using (private.is_admin());

create or replace function public.log_usage_event(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.usage_events(event_key, day, count)
  values (p_key, current_date, 1)
  on conflict (event_key, day) do update set count = usage_events.count + 1;
exception when check_violation then
  -- An unrecognised key is a client bug, not something worth failing the caller's
  -- screen render over — logUsageEvent() is fire-and-forget already, so this just
  -- makes the function itself as forgiving as its only caller expects it to be.
  null;
end;
$function$;

-- Only signed-in users can log an event — not anon — which is a real (if modest)
-- speed bump against a script spamming the counters from outside the app entirely.
revoke all on function public.log_usage_event(text) from public, anon;
grant execute on function public.log_usage_event(text) to authenticated;
;
