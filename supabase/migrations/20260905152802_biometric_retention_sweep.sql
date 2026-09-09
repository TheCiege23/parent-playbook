-- ===================================================================
--  DESTRUCTION, ACTUALLY PERFORMED
-- ===================================================================
-- The privacy policy now publishes a retention schedule: scan measurements are kept
-- twelve months and then destroyed. Publishing that without a job that performs it
-- would be worse than never publishing it — an unhonoured retention schedule is the
-- specific thing BIPA §15(a) exists to prohibit, and it converts a compliance document
-- into evidence against you.
--
-- Scope is deliberately narrow: source = 'photo' is written by exactly one code path
-- (the body scan, in js/body-scan.js). Manual and guided measurements a parent typed in
-- are THEIRS and are never swept — a growth chart that silently erased last year is a
-- broken product, and nothing in any statute asks for it.
create or replace function private.sweep_biometric_retention()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  n integer;
begin
  with gone as (
    delete from public.measurements
     where source = 'photo'
       and measured_on < (current_date - interval '12 months')
    returning athlete_id
  )
  select count(*) into n from gone;

  -- Evidence the schedule ran. A destruction nobody can show happened is, to anyone
  -- asking the question later, indistinguishable from one that did not.
  if n > 0 then
    insert into public.access_log(actor_id, athlete_id, action, detail)
    values (null, null, 'biometric_retention_sweep',
            jsonb_build_object('deleted', n, 'cutoff', (current_date - interval '12 months')::date));
  end if;

  -- Consent rows are NOT deleted, ever. The record that a release was given on one date
  -- and expired or was withdrawn on another IS the compliance artefact; tidying it away
  -- destroys the only proof the withdrawal was honoured. They simply stop matching
  -- loadScanConsent(), which already filters on retention_until.
  return n;
end;
$$;

revoke all on function private.sweep_biometric_retention() from public, anon, authenticated;

-- Daily, early, and idempotent — a day the job misses is caught by the next run rather
-- than leaving data past its date until someone notices.
select cron.unschedule('biometric-retention')
  where exists (select 1 from cron.job where jobname = 'biometric-retention');
select cron.schedule('biometric-retention', '20 3 * * *',
                     $$select private.sweep_biometric_retention();$$);;
