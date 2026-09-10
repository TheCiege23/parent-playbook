-- The initial company-assessment migration kept its security-definer policy helpers
-- non-executable by authenticated sessions. PostgreSQL checks EXECUTE privileges even
-- when a function is reached from an RLS expression, so valid writes were denied.
-- Expose only the roster-admin decision and a combined write decision. The underlying
-- consent lookup stays private and never returns consent details.

grant execute on function private.can_manage_company_body_assessment(uuid,uuid) to authenticated;

create or replace function private.can_write_company_body_assessment(
  requested_team uuid, requested_athlete uuid, requested_consent uuid, requested_retention timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_manage_company_body_assessment(requested_team,requested_athlete)
    and private.can_use_company_body_consent(requested_consent,requested_athlete,requested_retention);
$$;
revoke all on function private.can_write_company_body_assessment(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.can_write_company_body_assessment(uuid,uuid,uuid,timestamptz) to authenticated;

drop policy if exists company_body_insert on public.company_body_assessments;
create policy company_body_insert on public.company_body_assessments for insert to authenticated
  with check (created_by=auth.uid()
    and private.can_write_company_body_assessment(team_id,athlete_id,consent_id,retention_until));

drop policy if exists company_body_update on public.company_body_assessments;
create policy company_body_update on public.company_body_assessments for update to authenticated
  using (private.can_manage_company_body_assessment(team_id,athlete_id))
  with check (created_by=auth.uid()
    and private.can_write_company_body_assessment(team_id,athlete_id,consent_id,retention_until));
