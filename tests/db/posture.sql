-- Production posture check. Read-only: this query never writes, and never reads row content.
--
-- FM12 asks for operating evidence. A runbook nobody executes is prose, so this is the runbook as
-- a query: one command that answers "is production in the state we believe it is?" and returns a
-- structured verdict rather than something a human has to eyeball.
--
-- Every check here exists because something actually went wrong or could have:
--   * excess_tenant_grants   — 51 of 53 tables handed TRUNCATE to anon and authenticated, and
--                              TRUNCATE is not subject to row-level security (found 2026-09-10)
--   * auto_rls_guardrail     — the event trigger that enables RLS on new tables existed in
--                              production and in no migration, so a restore silently lost it
--   * retention_overdue      — a retention sweep that runs and "succeeds" over zero eligible rows
--                              proves the job fires, not that it deletes; this checks the outcome
--   * composition_gate       — the gate must stay closed while no licensed model exists
--
-- Run it with tools/operations-check.cjs, which asserts the verdict and exits non-zero on failure.

with

rls_off as (
  select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb) as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
),

excess_grants as (
  select coalesce(jsonb_agg(distinct c.relname order by c.relname), '[]'::jsonb) as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(array['anon','authenticated']) as g(role)
  cross join unnest(array['TRUNCATE','TRIGGER','REFERENCES']) as pr(priv)
  where n.nspname = 'public' and c.relkind in ('r','p')
    and has_table_privilege(g.role, c.oid, pr.priv)
),

-- A SECURITY DEFINER function whose search_path is UNSET lets the caller control name resolution
-- inside code running as the owner. That is the escalation shape, and it is what this checks.
--
-- A pinned-but-not-empty path is a weaker invariant, not a hole. Four functions here
-- (guard_trainer_status, is_admin, trainer_can_view_athlete, trainer_is_approved) pin
-- search_path=public rather than ''. That is safe only while no untrusted role can create objects
-- in public to shadow a name — so the next check verifies exactly that, instead of this one
-- failing on a proxy. Supabase's own linter takes the same view: it flags unset, not pinned.
unpinned_definers as (
  select coalesce(jsonb_agg(p.proname order by p.proname), '[]'::jsonb) as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('private','public') and p.prosecdef
    and (p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'))
),

-- The condition that makes a non-empty pinned search_path safe. If a tenant role could create in
-- a schema those functions resolve names through, every one of them becomes hijackable.
tenant_schema_write as (
  select jsonb_object_agg(role || ' on ' || sch, has_schema_privilege(role, sch, 'CREATE')) as detail
  from unnest(array['anon','authenticated']) as r(role)
  cross join unnest(array['public','private']) as x(sch)
),

guardrail as (
  select jsonb_build_object(
    'event_trigger_present', (select count(*) from pg_event_trigger where evtname = 'ensure_rls') = 1,
    'event_trigger_enabled', coalesce((select evtenabled = 'O' from pg_event_trigger where evtname = 'ensure_rls'), false),
    'anon_can_execute', has_function_privilege('anon','public.rls_auto_enable()','EXECUTE'),
    'authenticated_can_execute', has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE')
  ) as detail
),

retention_jobs as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', j.jobname, 'active', j.active, 'schedule', j.schedule,
           'runs', (select count(*) from cron.job_run_details d where d.jobid = j.jobid),
           'last_status', (select d.status from cron.job_run_details d where d.jobid = j.jobid
                           order by d.start_time desc limit 1)
         ) order by j.jobname), '[]'::jsonb) as detail
  from cron.job j
  where j.jobname like '%retention%'
),

-- The outcome, not the schedule: has any sweep left a row alive past its own retention date?
-- Counts only. No row content is read.
retention_overdue as (
  select jsonb_build_object(
    'company_composition_results', (select count(*) from public.company_composition_results where retention_until <= now()),
    'company_body_assessments',    (select count(*) from public.company_body_assessments where retention_until <= now()),
    'company_reference_assessments',(select count(*) from public.company_reference_assessments where retention_until <= now())
  ) as detail
),

composition_gate as (
  select jsonb_build_object(
    'registered_providers', (select count(*) from public.company_composition_providers),
    'stored_results', (select count(*) from public.company_composition_results)
  ) as detail
)

select jsonb_pretty(jsonb_build_object(
  'captured_at', to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'server_version', current_setting('server_version'),
  'checks', jsonb_build_object(
    'rls_enabled_on_every_public_table', jsonb_build_object(
      'pass', (select jsonb_array_length(detail) = 0 from rls_off),
      'detail', (select detail from rls_off)),
    'no_excess_tenant_grants', jsonb_build_object(
      'pass', (select jsonb_array_length(detail) = 0 from excess_grants),
      'detail', (select detail from excess_grants)),
    'definer_functions_pin_search_path', jsonb_build_object(
      'pass', (select jsonb_array_length(detail) = 0 from unpinned_definers),
      'detail', (select detail from unpinned_definers)),
    'tenant_roles_cannot_create_schema_objects', jsonb_build_object(
      'pass', (select not bool_or(value::boolean) from tenant_schema_write, jsonb_each_text(detail)),
      'detail', (select detail from tenant_schema_write)),
    'auto_rls_guardrail_intact', jsonb_build_object(
      'pass', (select (detail->>'event_trigger_present')::boolean
                  and (detail->>'event_trigger_enabled')::boolean
                  and not (detail->>'anon_can_execute')::boolean
                  and not (detail->>'authenticated_can_execute')::boolean from guardrail),
      'detail', (select detail from guardrail)),
    'retention_jobs_registered_and_healthy', jsonb_build_object(
      'pass', (select bool_and((j->>'active')::boolean
                        and ((j->>'runs')::integer = 0 or j->>'last_status' = 'succeeded'))
               from retention_jobs, jsonb_array_elements(detail) j),
      'detail', (select detail from retention_jobs)),
    'nothing_retained_past_its_retention_date', jsonb_build_object(
      'pass', (select (detail->>'company_composition_results')::integer = 0
                  and (detail->>'company_body_assessments')::integer = 0
                  and (detail->>'company_reference_assessments')::integer = 0 from retention_overdue),
      'detail', (select detail from retention_overdue)),
    'composition_gate_closed', jsonb_build_object(
      'pass', (select (detail->>'registered_providers')::integer = 0
                  and (detail->>'stored_results')::integer = 0 from composition_gate),
      'detail', (select detail from composition_gate))
  )
)) as posture;
