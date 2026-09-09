
-- Undo the mistake: this was created in public by accident and the cron job never
-- calls it. The real one lives in private, updated below.
drop function if exists public.sweep_biometric_retention();

create or replace function private.sweep_biometric_retention()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  -- 'video' added alongside 'photo': the jump-capture engine (js/jump-measure.js) makes
  -- the exact same on-device, never-uploaded, retention-scheduled promise on its consent
  -- screen as the body scan does, on the same 12-month schedule, and an unenforced
  -- schedule is the specific thing BIPA 15(a) prohibits.
  with gone as (
    delete from public.measurements
     where source in ('photo', 'video')
       and measured_on < (current_date - interval '12 months')
    returning athlete_id
  )
  select count(*) into n from gone;

  if n > 0 then
    insert into public.access_log(actor_id, athlete_id, action, detail)
    values (null, null, 'biometric_retention_sweep',
            jsonb_build_object('deleted', n, 'cutoff', (current_date - interval '12 months')::date));
  end if;

  return n;
end;
$$;
;
