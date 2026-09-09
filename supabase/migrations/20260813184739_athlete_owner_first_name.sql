-- Family view copy names who does the doing ("CeeJay marks these off") rather than
-- using the passive voice. The client cannot work this out for itself: the owner
-- reaches the athlete through family_members, and an invited viewer is not IN that
-- family, so RLS correctly hides it.
--
-- Returns a FIRST NAME and nothing else, and only to someone who can already see the
-- athlete. No email, no surname, no id.
create or replace function public.athlete_owner_first_name(p_athlete uuid)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  full_name text;
begin
  -- Gate: the caller must already have access to this athlete. Without this the
  -- function would leak one household member's name to any signed-in user.
  if not exists (
    select 1 from public.athlete_access x
    where x.athlete_id = p_athlete and x.guardian_id = auth.uid() and x.revoked_at is null
    union all
    select 1 from public.athletes a
    join public.family_members m on m.family_id = a.family_id
    where a.id = p_athlete and m.guardian_id = auth.uid()
  ) then
    return null;
  end if;

  select g.display_name into full_name
  from public.athletes a
  join public.family_members m on m.family_id = a.family_id
  join public.guardians g on g.id = m.guardian_id
  where a.id = p_athlete and m.role = 'owner'
  order by m.created_at
  limit 1;

  if full_name is null or trim(full_name) = '' then return null; end if;
  return split_part(trim(full_name), ' ', 1);
end;
$$;

revoke all on function public.athlete_owner_first_name(uuid) from public;
grant execute on function public.athlete_owner_first_name(uuid) to authenticated;;
