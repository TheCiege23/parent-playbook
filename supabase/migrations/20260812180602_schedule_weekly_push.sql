-- 22:00 UTC Sunday = 6pm US Eastern in daylight saving, 5pm once the clocks change.
-- Early evening on purpose: the plan is for the week AHEAD, so a parent reading it on
-- Sunday still has time to think about Monday.
--
-- The service role key is read from Vault at fire time rather than baked into the job
-- definition, so rotating the key does not require rewriting the schedule.
select cron.schedule(
  'weekly-plan-push',
  '0 22 * * 0',
  $job$
  select net.http_post(
    url     := 'https://xqvqjkdxykowwpcmyudz.supabase.co/functions/v1/notify-weekly',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='service_role_key')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);;
