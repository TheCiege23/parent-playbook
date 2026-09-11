-- An organization can already read its roster athletes/measurements. Its membership
-- list was still limited to guardians, leaving the organization roster empty.
-- Check the requested TEAM, not any team containing the same athlete. A direct
-- teams subquery in the policy would recurse through teams_read -> tm_select.
create or replace function private.is_admin_of_team(requested_team uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.teams t
    where t.id = requested_team and t.created_by = (select auth.uid())
  );
$$;
revoke all on function private.is_admin_of_team(uuid) from public;
grant execute on function private.is_admin_of_team(uuid) to authenticated;

create policy tm_select_org_admin on public.team_memberships
  for select to authenticated
  using (private.is_admin_of_team(team_id));

-- No INSERT/UPDATE/DELETE grants: families still control membership changes.
create index if not exists tm_team_roster_idx on public.team_memberships(team_id,id);
