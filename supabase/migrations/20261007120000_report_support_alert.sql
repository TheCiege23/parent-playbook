-- Email support the moment a parent reports a coach's message, so every report is reviewed within 24 hours.
--
-- "Report this message" only inserted a row into coach_update_reports; nobody heard about it until an admin opened
-- Team Connect safety. Now:
--   * an AFTER INSERT trigger asks the notify-report function to email support@playbookbp.com about that report;
--   * a cron job every 15 minutes asks it to email anything still unsent, because net.http_post is fire-and-forget
--     and a request lost to a timeout or a Resend outage would otherwise never be retried;
--   * support_alerted_at is stamped by the function only after Resend accepts the email, so each report is emailed
--     once and a failed one is retried by the sweep.
-- The trigger swallows its own errors: a parent's report must be saved even if the alert cannot be queued, and the
-- sweep will still find it. The service role key is read from Vault when the request is made, as in the push jobs.

alter table public.coach_update_reports add column if not exists support_alerted_at timestamptz;

create or replace function private.alert_support_on_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform net.http_post(
      url     := 'https://xqvqjkdxykowwpcmyudz.supabase.co/functions/v1/notify-report',
      headers := jsonb_build_object(
                   'Content-Type','application/json',
                   'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='service_role_key')
                 ),
      body    := jsonb_build_object('report_id', new.id),
      timeout_milliseconds := 30000
    );
  exception when others then
    raise warning 'report alert not queued for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function private.alert_support_on_report() from public;

drop trigger if exists coach_update_reports_alert_support on public.coach_update_reports;
create trigger coach_update_reports_alert_support
  after insert on public.coach_update_reports
  for each row execute function private.alert_support_on_report();

select cron.unschedule('report-alert-sweep') where exists (select 1 from cron.job where jobname = 'report-alert-sweep');

select cron.schedule('report-alert-sweep', '*/15 * * * *', $job$
  select net.http_post(
    url     := 'https://xqvqjkdxykowwpcmyudz.supabase.co/functions/v1/notify-report',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='service_role_key')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$job$);
