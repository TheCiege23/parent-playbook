-- Team Connect: a parent can invite a coach to one child.
--
-- The invite sheet has offered "Team Connect (coach)" since 2026-09-08, when 20260908152406 added the `coach` access
-- role and 20260908152418 gave it its own narrower read policies, and accept_invite() (20260912123000) writes whatever
-- role an athlete-scoped invitation names. But invite_role_chk (20260731121405) was never widened, so every coach
-- invitation was refused at insert and the parent saw "Could not create the invite". No coach could ever be connected.
-- Found on 2026-09-16 while preparing the signed-in regression checklist; the user chose to turn coach invitations on.
--
-- What a coach reaches is unchanged by this migration, and is what the invite sheet, the invitation email and the
-- privacy policy already describe: for that one child, the profile (ath_select_coach), sports (asp_select_coach),
-- measurements (meas_select_coach) and body scan records (body_scan_assessment_select), and sending coach updates
-- (20260908152442, moderated by 20260908170649). Never games, journey, photos, sessions or the weekly plan, never
-- another child in the household, never an edit: private.can_view_athlete() and private.can_edit_athlete() list
-- owner, co_parent and family_view explicitly and leave coach out.
--
-- A coach invitation is for one child. The sheet writes it with scope 'athlete', one row per chosen child, and
-- accept_invite() already treats a coach row as athlete-scoped whatever its scope says. The new constraint makes the
-- rule hold in the table too, so a family-scoped coach invitation cannot exist to be misread later.
--
-- Nothing else changes: an invitation still needs edit rights on the child to create (ainv_insert), a code to accept
-- once one is issued, and `owner` is still not a role any invitation can carry. Counted read-only on 2026-09-16, the
-- live project held 5 invitations — 3 co-parent and 2 family view, all family-scoped, none for a coach — so no stored
-- row is refused by either constraint.

alter table public.athlete_invites drop constraint invite_role_chk;
alter table public.athlete_invites add constraint invite_role_chk
  check (role in ('co_parent', 'family_view', 'coach'));

alter table public.athlete_invites add constraint athlete_invites_coach_one_child_chk
  check (role <> 'coach' or scope = 'athlete');
