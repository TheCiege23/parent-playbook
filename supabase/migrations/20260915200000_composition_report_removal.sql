-- Report files are removed through the Storage API, never by a DELETE on storage.objects.
--
-- 20260912100000 removed a report's storage.objects row from a trigger when its attachment row was deleted. On Supabase
-- that DELETE is refused: storage.protect_delete(), a statement-level trigger on storage.objects, raises 42501 "Direct
-- deletion from storage tables is not allowed. Use the Storage API instead." unless the Storage API itself set
-- storage.allow_delete_query, and being statement-level it fires even when the DELETE matches nothing. So once a report
-- was attached, deleting its record failed, and so did everything that cascades to one: deleting the athlete, deleting
-- the account, and the retention sweep, whose single DELETE would have failed whole and stopped removing expired and
-- withdrawn records for every family. Found on 2026-09-15 with read-only catalog queries against production, which then
-- held no attachments, so nothing had failed yet. tests/db stubs storage without Supabase's trigger, which is why the
-- suite passed; tests/db/00-preamble.sql now reproduces it.
--
-- Supabase refuses that DELETE for a reason: removing the row from SQL leaves the file's bytes behind with nothing
-- pointing at them. Setting storage.allow_delete_query here would silence the error and orphan exactly the clinical
-- documents the old trigger meant to remove. Instead:
--
--   - an attachment, and so its record, athlete or account, cannot be deleted while its file is still stored. The
--     trigger below says so plainly and deletes nothing itself;
--   - every path removes the file through the Storage API first: the composition store's remove()
--     (js/composition-import-supabase.mjs), supabase/functions/delete-athlete and supabase/functions/delete-account;
--   - delete-athlete first asks, as the caller, whether they may delete the athlete (public.can_delete_athlete), so a
--     refused caller never costs a family a stored report;
--   - the retention sweep deletes the due records that hold no stored report. Those that do are listed by
--     public.composition_reports_due_for_removal() for supabase/functions/composition-report-retention, which removes
--     the files through the Storage API as the service role and then runs the sweep through
--     public.run_external_composition_retention(). That job runs at 03:45 UTC, before the SQL sweep at 03:55.

-- ---------------------------------------------------------------------------------------------
-- An attachment goes only after its file has.
drop trigger if exists external_composition_attachment_purge on public.external_composition_attachments;
drop function if exists private.purge_composition_report_objects();

create or replace function private.refuse_attachment_delete_with_stored_report()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from storage.objects o where o.bucket_id = 'composition-reports' and o.name = old.storage_key) then
    raise exception 'A report file is still stored for this record. Remove it through the Storage API before deleting the attachment, its record, the athlete or the account.'
      using errcode = '55000';
  end if;
  return old;
end;
$$;
revoke all on function private.refuse_attachment_delete_with_stored_report() from public, anon, authenticated;

drop trigger if exists external_composition_attachment_requires_removed_report on public.external_composition_attachments;
create trigger external_composition_attachment_requires_removed_report
  before delete on public.external_composition_attachments
  for each row execute function private.refuse_attachment_delete_with_stored_report();

-- Whether a record still has a report file in storage.
create or replace function private.composition_record_has_stored_report(record uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.external_composition_attachments a
    join storage.objects o on o.bucket_id = 'composition-reports' and o.name = a.storage_key
   where a.record_uuid = record);
$$;
revoke all on function private.composition_record_has_stored_report(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Retention, and continuing consent, as 20260912100000 defined them, less the records whose report file is still
-- stored: those wait for composition-report-retention, which can remove the file and then runs this again.
create or replace function private.sweep_external_composition_retention()
returns integer language plpgsql security definer set search_path = '' as $$
declare deleted_count integer;
begin
  with gone as (
    delete from public.external_composition_records r
     where (r.retention_until <= now()
            or (r.subject_scope = 'child_athlete'
                and not private.biometric_consent_is_live(r.consent_id, r.athlete_id)))
       and not private.composition_record_has_stored_report(r.id)
    returning r.id)
  select count(*) into deleted_count from gone;
  return deleted_count;
end;
$$;
revoke all on function private.sweep_external_composition_retention() from public, anon, authenticated;

-- The stored report files holding back a due record, by the sweep's own condition, oldest first. For the service role
-- only: the edge function that can remove a file.
create or replace function public.composition_reports_due_for_removal(p_limit integer default 500)
returns table (record_uuid uuid, storage_key text)
language sql stable security definer set search_path = '' as $$
  select a.record_uuid, a.storage_key
    from public.external_composition_records r
    join public.external_composition_attachments a on a.record_uuid = r.id
    join storage.objects o on o.bucket_id = 'composition-reports' and o.name = a.storage_key
   where r.retention_until <= now()
      or (r.subject_scope = 'child_athlete'
          and not private.biometric_consent_is_live(r.consent_id, r.athlete_id))
   order by r.retention_until, a.storage_key
   limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;
revoke all on function public.composition_reports_due_for_removal(integer) from public, anon, authenticated;
grant execute on function public.composition_reports_due_for_removal(integer) to service_role;

-- The sweep, for the same edge function to run once the files are gone.
create or replace function public.run_external_composition_retention()
returns integer language sql security definer set search_path = '' as $$
  select private.sweep_external_composition_retention();
$$;
revoke all on function public.run_external_composition_retention() from public, anon, authenticated;
grant execute on function public.run_external_composition_retention() to service_role;

-- ---------------------------------------------------------------------------------------------
-- Deleting an athlete deletes their imported results, and the audit of each delete ran with the athlete row already
-- gone: its insert named the athlete, access_log's foreign key refused it, and so an athlete with any imported result
-- could not be deleted at all, report or not. Found on 2026-09-15 by the new athlete case in tests/db (R32b); production
-- then held no imported results. The body scan audit (20260913170000) already keeps no link to an athlete that is being
-- deleted, and this now does the same, keeping the id in the detail as that one does.
create or replace function private.audit_external_composition_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ath uuid := coalesce(new.athlete_id, old.athlete_id);
begin
  insert into public.access_log(actor_id, athlete_id, action, detail)
  values ((select auth.uid()),
    case when exists (select 1 from public.athletes a where a.id = ath) then ath end,
    'external_composition_record_' || lower(tg_op),
    -- Identifiers and provenance only. No measured value reaches the audit trail: an audit row
    -- naming somebody's body fat percentage is itself health data, retained on a different
    -- schedule from the record it describes.
    jsonb_build_object(
      'record_id', coalesce(new.record_id, old.record_id),
      'athlete_id', ath,
      'subject_scope', coalesce(new.subject_scope, old.subject_scope),
      'source_class', coalesce(new.source_class, old.source_class),
      'device_model', coalesce(new.device_model, old.device_model),
      'team_id', coalesce(new.team_id, old.team_id),
      'measured_at', coalesce(new.measured_at, old.measured_at)));
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The question delete-athlete asks before it removes a report, answered for the caller exactly as the athletes delete
-- policy (ath_delete) answers it: a family owner or co-parent of the athlete's household.
create or replace function public.can_delete_athlete(p_athlete uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.athletes a where a.id = p_athlete and private.is_family_editor(a.family_id));
$$;
revoke all on function public.can_delete_athlete(uuid) from public, anon;
grant execute on function public.can_delete_athlete(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The files the SQL sweep cannot remove. The service role key is read from Vault when the job fires, as in the push jobs.
select cron.unschedule('external-composition-report-retention')
  where exists (select 1 from cron.job where jobname = 'external-composition-report-retention');
select cron.schedule('external-composition-report-retention', '45 3 * * *', $job$
  select net.http_post(
    url     := 'https://xqvqjkdxykowwpcmyudz.supabase.co/functions/v1/composition-report-retention',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='service_role_key')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);
