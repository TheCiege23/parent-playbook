-- Give a team administrator only the minimum consent reference needed to persist an
-- already-visible roster assessment. Guardian identity, release detail and other
-- consent rows remain hidden behind biometric_consents RLS.
create or replace function public.company_body_active_consent(
  requested_team uuid, requested_athlete uuid, requested_engine text)
returns table(consent_id uuid, retention_until date)
language sql stable security definer set search_path = '' as $$
  select c.id,c.retention_until
  from public.biometric_consents c
  where private.can_manage_company_body_assessment(requested_team,requested_athlete)
    and c.athlete_id=requested_athlete
    and c.scan_engine=requested_engine
    and c.revoked_at is null
    and c.retention_until>=current_date
  order by c.granted_at desc,c.id desc
  limit 1;
$$;
revoke all on function public.company_body_active_consent(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.company_body_active_consent(uuid,uuid,text) to authenticated;
