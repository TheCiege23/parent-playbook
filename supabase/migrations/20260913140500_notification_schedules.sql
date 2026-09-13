-- The four push jobs, all in the repository. notify-weekly and notify-gameday were scheduled by migrations;
-- notify-daily ('daily-nudge') and notify-measure ('measure-nudge') were created directly in the live project and
-- existed nowhere else, so a project rebuilt from these migrations sent neither. Found on 2026-09-13 by comparing
-- cron.job with supabase/migrations (the migration history itself has no gap: the jobs were never in a migration).
--
-- daily-nudge is reproduced exactly as it runs: 20:12 UTC, which is 4:12pm US Eastern in daylight saving and
-- 3:12pm in winter. After school, before dinner.
--
-- measure-nudge is corrected. It ran on '14 14 1-7 * 0', meant as "the first Sunday of the month". But when a
-- schedule restricts both the day of the month and the day of the week, cron runs it when EITHER matches: on days
-- 1 to 7 of every month, and on every Sunday. It ran on Sunday 13 September. It now runs every Sunday at 14:14 UTC
-- (10:14am Eastern in daylight saving, 9:14am in winter), and notify-measure returns early unless the New York date
-- is in the first seven days of the month, where tests/notify-measure-function.test.cjs can hold the rule.
-- tests/notify-schedules.test.cjs refuses any schedule in these migrations that sets both day fields.
--
-- The service role key is read from Vault when the job fires, as in the other two push jobs.

select cron.unschedule('daily-nudge') where exists (select 1 from cron.job where jobname = 'daily-nudge');

select cron.schedule('daily-nudge', '12 20 * * *', $job$
  select net.http_post(
    url     := 'https://xqvqjkdxykowwpcmyudz.supabase.co/functions/v1/notify-daily',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='service_role_key')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$job$);

select cron.unschedule('measure-nudge') where exists (select 1 from cron.job where jobname = 'measure-nudge');

select cron.schedule('measure-nudge', '14 14 * * 0', $job$
  select net.http_post(
    url     := 'https://xqvqjkdxykowwpcmyudz.supabase.co/functions/v1/notify-measure',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='service_role_key')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$job$);
