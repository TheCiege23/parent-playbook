-- An athlete with an organization body assessment or a company composition result can be deleted.
--
-- Deleting an athlete cascades to their company_body_assessments (20260910001500) and company_composition_results
-- (20260910190000), and each cascaded delete is audited by a trigger that runs with the athlete row already gone. Both
-- audits wrote that athlete's id to access_log.athlete_id, access_log's foreign key to athletes refused the insert, and
-- so the whole athlete delete failed: through delete-athlete, and with the household through delete-account. Found on
-- 2026-09-15 after the same failure was reproduced for external composition records (tests/db R32b, fixed in
-- 20260915200000), and reproduced for these two by tests/db AC01 to AC06 before this migration. Counted read-only that
-- day, the live project held no rows in either table, so no deletion had failed yet.
--
-- The fix is the one the body scan audit (20260913170000) already uses: an audit row keeps no link to an athlete that is
-- gone, instead of failing the delete. While the athlete exists nothing changes. The body assessment audit now keeps the
-- athlete's id in its detail, as the body scan audit does; the composition result audit already carries it for a child as
-- subject_reference, so its detail keeps exactly the keys tests/db E04 pins.
--
-- The other writers of access_log.athlete_id were checked and are unaffected: invite acceptance and invite codes, the
-- results API's reads and its delete, and composition attachment verification all run while the athlete exists; the
-- retention sweeps, the reference assessment audit and the provider audit write no athlete.

create or replace function private.audit_company_body_assessment_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ath uuid := coalesce(new.athlete_id, old.athlete_id);
begin
  insert into public.access_log(actor_id,athlete_id,action,detail)
  values ((select auth.uid()),
    case when exists (select 1 from public.athletes a where a.id = ath) then ath end,
    'company_body_assessment_'||lower(tg_op),
    jsonb_build_object('team_id',coalesce(new.team_id,old.team_id),'assessment_id',coalesce(new.assessment_id,old.assessment_id),
      'athlete_id',ath));
  return coalesce(new,old);
end;
$$;

create or replace function private.audit_company_composition_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ath uuid := coalesce(new.athlete_id, old.athlete_id);
begin
  insert into public.access_log(actor_id,athlete_id,action,detail)
  values ((select auth.uid()),
    case when exists (select 1 from public.athletes a where a.id = ath) then ath end,
    'company_composition_result_'||lower(tg_op),
    jsonb_build_object('team_id',coalesce(new.team_id,old.team_id),'result_id',coalesce(new.result_id,old.result_id),
      'assessment_id',coalesce(new.assessment_id,old.assessment_id),
      'subject_reference',coalesce(new.subject_reference,old.subject_reference),'subject_scope',coalesce(new.subject_scope,old.subject_scope),
      'provider_id',coalesce(new.provider_id,old.provider_id),'model_id',coalesce(new.model_id,old.model_id),'model_version',coalesce(new.model_version,old.model_version)));
  return coalesce(new,old);
end;
$$;
