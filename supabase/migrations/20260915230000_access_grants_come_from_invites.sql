-- Access to a child comes from an invitation, not from a signed-in write.
--
-- public.athlete_access holds per-child grants. Its write policies (20260730143035, unchanged since) asked one question,
-- private.can_edit_athlete(athlete_id), of an insert and of an update alike. So anyone who could edit a child could
-- grant any account any role on that child — including `owner`, which edits — without an invitation, and could re-point
-- an existing grant at another account, upgrade it, or bring back one the household had revoked. That includes a
-- co-parent who was themselves invited to that one child. Found on 2026-09-15 alongside the household policies fixed in
-- 20260915220000_household_write_boundaries.sql, whose header left this for its own change; reproduced by tests/db
-- AE01 to AE06 before this migration, on a cluster built from the real migration history.
--
-- Nothing legitimate needs any of it. Every writer was checked:
--   - public.accept_invite() (20260912123000) is the only writer of grants, and the invited guardian runs it themselves
--     by accepting an invitation someone sent them: one grant for the invited child, or one for every child in the
--     household for a family-wide invitation, upgrading or bringing back a grant that guardian already had. It is
--     SECURITY DEFINER, owned by the tables' owner, so row-level security does not bind it.
--   - No client code writes this table. It is read by the sign-in check, the app shell, the week rail, the Profile
--     screen, calendar sync and the organization and coach screens; the Profile screen's "who can see them" list only
--     lists who has access and which invitations are pending, and offers no control that grants, revokes or removes.
--   - supabase/functions/delete-account clears `granted_by` as the service role when that account goes, and
--     supabase/functions/_shared/invite-access.mjs reads a grant to decide who may send an invitation.
--   - 20260912123000 backfilled sibling grants for family invitations already accepted, and 20260813214236 deleted
--     rows that only downgraded a guardian in the UI. Both ran as the migration's owner, not as a tenant.
--   - athlete_invites still accepts only the roles `co_parent` and `family_view` (invite_role_chk, 20260731121405), so
--     no invitation can produce an `owner` or a `coach` grant. Either could only ever have come from a direct write.
-- Counted read-only on 2026-09-15, the live project held 4 grants, all live, 2 co-parent and 2 family viewer, none of
-- them `owner` or `coach`, each recording who granted it, against 5 invitations of which 2 were accepted.
--
-- So, for a signed-in account:
--   - a grant cannot be created at all. aa_insert is dropped, as ath_insert and fm_insert were;
--   - the only update left is a revocation: the row written must be revoked, and must still name the athlete, the
--     guardian and the role the stored grant does. An editor can end someone's access; nobody signed in can grant,
--     re-point, upgrade, or bring back a grant;
--   - aa_delete is unchanged, so an editor can still remove a grant outright rather than revoke it, and aa_select and
--     aa_select_org are unchanged.
--
-- What this does not do. The service role, the table owner and any SECURITY DEFINER function are not bound by
-- row-level security, so they can still write any grant — which is how an accepted invitation works. An editor
-- revoking a grant may rewrite `granted_by` in the same statement; it records who granted the access and grants
-- nothing. An editor can still revoke or delete another editor's grant, as before. And a guardian cannot revoke their
-- own grant to walk away from a child they were invited to: no screen offers it, and giving them one means a policy of
-- its own, not a wider rule here.

-- ---------------------------------------------------------------------------------------------
-- A grant is created by accepting an invitation.
drop policy aa_insert on public.athlete_access;

-- Whether the stored grant with this id is this athlete's, this guardian's, with this role. Inside aa_update's WITH
-- CHECK it reads the grant as it was before the update, so the row being written has to still say what it said.
create or replace function private.access_grant_is(grant_id uuid, ath uuid, guardian uuid, grant_role public.access_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.athlete_access g
    where g.id = grant_id and g.athlete_id = ath and g.guardian_id = guardian and g.role = grant_role);
$$;
revoke all on function private.access_grant_is(uuid, uuid, uuid, public.access_role) from public;
grant execute on function private.access_grant_is(uuid, uuid, uuid, public.access_role) to authenticated;

alter policy aa_update on public.athlete_access
  using (private.can_edit_athlete(athlete_id))
  with check (private.can_edit_athlete(athlete_id)
    and revoked_at is not null
    and private.access_grant_is(id, athlete_id, guardian_id, role));
