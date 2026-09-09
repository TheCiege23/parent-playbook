-- CeeJay accepted a test invite to his own son. That wrote an athlete_access row with
-- role 'family_view' alongside his family_members 'owner' row, and the UI read only the
-- access row — so the owner was locked out of his own child's profile.
--
-- Remove any access row that grants LESS than the guardian already has through the
-- household. These rows can only ever downgrade someone in the UI; they never grant
-- anything, because can_edit_athlete already ORs both paths.
delete from public.athlete_access x
using public.athletes a, public.family_members m
where x.athlete_id = a.id
  and m.family_id = a.family_id
  and m.guardian_id = x.guardian_id
  and m.role in ('owner','co_parent')
  and x.role = 'family_view';;
