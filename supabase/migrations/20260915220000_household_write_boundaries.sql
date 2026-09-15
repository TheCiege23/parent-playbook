-- A signed-in parent writes only inside their own household.
--
-- Three policies let a signed-in account write outside the household it belongs to. They were found on 2026-09-15 while
-- 20260915180000_child_creation_requires_consent.sql was being written, each definition was confirmed that day with a
-- read-only query of the live project's policies, and tests/db reproduced each one (AD01, AD03, AD08, AD15, AD17, AD19,
-- AD20) before this migration:
--
--   ath_update (20260730143035) checked private.can_edit_athlete(id) before and after a change. That function reads the
--     child as stored, so the check never looked at the household the child was being written into, and an owner, a
--     co-parent or a co-parent invited to that one child could move the child into any household. The household it left
--     lost the child; the household it joined gained a child nobody there had consented for; and the guarantee of
--     20260915180000, which is checked only when a child is created, stopped describing it. That migration's header
--     named this as something it did not cover.
--
--   consent_ins (20260730143302) checked only that a consent named its author. Any signed-in account could put consent
--     records, granted or refused, on any child, including another family's. private.require_athlete_consent() counts
--     only a guardian of the child's household, so such a row could not let a child be created, but it sat on the child's
--     record looking like consent.
--
--   fm_insert (20260730143035) checked only that the writer edits the household, so an owner or co-parent could make any
--     account a member, as owner if they liked, without an invite. fm_update let the same writer point an existing
--     membership at any account, which is the same addition in two steps, or change a role, so a co-parent could make
--     themselves owner, and an owner may delete the household and every child in it. Membership decides whose children
--     the push notification jobs tell a parent about, who delete-account hands a household and its consents to, and whose
--     consent private.require_athlete_consent() counts.
--
-- Nothing legitimate needs what these allowed. Every writer was checked:
--   - No client code writes athletes.family_id: the Edit screen (js/screen-edit.js) and the Growth inputs (js/maturity.js)
--     update other columns. No edge function or migration changes it.
--   - No client code writes consent_records or family_members. public.create_athlete_onboarding() records a new child's
--     consents and, for a new household, its creator's membership, and private.handle_new_family() makes whoever creates a
--     household its owner. Both are SECURITY DEFINER functions owned by the tables' owner, which row-level security does
--     not bind.
--   - An invite never creates a membership. public.accept_invite() (20260912123000) grants athlete_access to the invited
--     child, or to every child in the household for a family-wide invite, also as SECURITY DEFINER.
--   - supabase/functions/delete-account hands consent records to the guardian who stays, and removes the departing
--     membership, as the service role, which bypasses row-level security.
-- Counted read-only on 2026-09-15, the live project held 2 households, each with a single membership (its creator, as
-- owner); 2 children, each in the household of the parent who added them; and 6 consent records, every one from a member
-- of its child's household. No existing row is one these rules now refuse.
--
-- So, for a signed-in account:
--   - a child stays in the household it was added to. ath_update still decides who may edit a child, and the row it writes
--     must now name the household the child is already in. An invited co-parent keeps editing the child as before;
--   - a consent names its author and a child in a household the author belongs to. Consent is the household's to give: a
--     co-parent invited to one child has access to that child but is not a member of its household, and cannot record
--     one;
--   - a membership cannot be added or changed at all. fm_insert and fm_update are dropped, as ath_insert was; fm_select
--     and fm_delete are unchanged. Table grants are left alone: row-level security is the boundary here, and with no
--     policy for a command it refuses it.
--
-- What this does not do. The service role, the table owner and any SECURITY DEFINER function are not bound by row-level
-- security, so they can still change a child's household, write any consent row and add any member. An editor can still
-- remove a member (fm_delete). And athlete_access, which accept_invite() writes, keeps its own policies unchanged: an
-- editor of a child can still grant an account access to that child directly (aa_insert), or change a grant (aa_update),
-- without an invite. That is the same kind of gap for per-child access, and is left for its own change.

-- ---------------------------------------------------------------------------------------------
-- A child stays in its household.

-- Whether the child, as stored, is in this household. Inside ath_update's WITH CHECK it reads the child as it was before
-- the update, so it compares the household the new row names with the one the child is in.
create or replace function private.athlete_in_household(ath uuid, fam uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.athletes a where a.id = ath and a.family_id = fam);
$$;
revoke all on function private.athlete_in_household(uuid, uuid) from public;
grant execute on function private.athlete_in_household(uuid, uuid) to authenticated;

alter policy ath_update on public.athletes
  with check (private.can_edit_athlete(id) and private.athlete_in_household(id, family_id));

-- ---------------------------------------------------------------------------------------------
-- A consent is given by the child's household.

-- Whether the caller is a member of the household the child, as stored, is in.
create or replace function private.is_household_guardian_of(ath uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.athletes a
    join public.family_members m on m.family_id = a.family_id
   where a.id = ath and m.guardian_id = (select auth.uid()));
$$;
revoke all on function private.is_household_guardian_of(uuid) from public;
grant execute on function private.is_household_guardian_of(uuid) to authenticated;

alter policy consent_ins on public.consent_records
  with check (guardian_id = (select auth.uid()) and private.is_household_guardian_of(athlete_id));

-- ---------------------------------------------------------------------------------------------
-- Membership comes with the household, never from a signed-in write.
drop policy fm_insert on public.family_members;
drop policy fm_update on public.family_members;
