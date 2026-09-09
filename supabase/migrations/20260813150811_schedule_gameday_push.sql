-- 23:00 UTC daily = 7pm Eastern, i.e. the evening before a game. The function itself
-- decides whether tomorrow is actually a game day for anyone, so running nightly is
-- cheap and there is no per-team schedule to maintain here.
select cron.unschedule('gameday-push') where exists (select 1 from cron.job where jobname = 'gameday-push');

select cron.schedule('gameday-push', '0 23 * * *', $job$
  select net.http_post(
    url     := 'https://xqvqjkdxykowwpcmyudz.supabase.co/functions/v1/notify-gameday',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='service_role_key')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$job$);;
