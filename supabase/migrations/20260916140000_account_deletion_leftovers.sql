-- Deleting an account no longer stops at a coach update it sent, a report it filed, or an organization record it saved.
--
-- supabase/functions/delete-account removes a parent's data and then the login. Anything still pointing at the login
-- with NO ACTION refuses that last step, and the parent is told their data went but the login did not. Read from the
-- live schema on 2026-09-16, and decided with the user that day:
--
--   - coach_updates.sender_id and coach_update_reports.reported_by (NOT NULL, to guardians). Coach invitations are on
--     since 20260916120000, so an ordinary coach sends updates and an ordinary parent reports them. A sent update is
--     part of the record (20260908152442), so both stay and lose only their author: the columns become nullable and
--     are cleared when the guardian goes. The coach screens already show "A coach" or "A parent" for a sender they
--     cannot name, and neither trigger on coach_updates fires on update.
--   - created_by on company_body_assessments, company_reference_assessments, company_composition_results and
--     company_api_keys (NOT NULL, to auth.users). Any account that starts a roster administers an organization. Its
--     records stay with the families and the organization, and keep the creator's id: each record carries it again as
--     createdBy, which the payload checks compare with the column and the SDK record contract requires, and clearing
--     it would also re-run the composition provider guard. So only the link to the login goes. Once the login and its
--     guardian row are deleted, the id no longer resolves to anyone. Inserts still name the caller: every insert
--     policy on these tables requires created_by = auth.uid(), and create_company_api_key() sets it the same way.
--
-- The rest is done by the function, not here: it deletes the account's camp listings, closes the join code of its
-- rosters, revokes its API keys, hands invitations it made as an invited co-parent to the child's household, and
-- clears the nullable biometric_consents.revoked_by, camps.reviewed_by, coach_update_reports.reviewed_by and
-- company_api_keys.revoked_by. Left for later, by decision: staff and marketplace references (trainer review columns,
-- which have update guards, company_composition_providers.approved_by, external_composition_attachments.verified_by,
-- which a check ties to a verified status) and bookings, payments and reviews, which are financial records.
--
-- Counted read-only on 2026-09-16, the live project held no coach update and no report, one adult reference record,
-- no body copy, no composition result and no API key.

alter table public.coach_updates alter column sender_id drop not null;
alter table public.coach_updates drop constraint coach_updates_sender_id_fkey;
alter table public.coach_updates add constraint coach_updates_sender_id_fkey
  foreign key (sender_id) references public.guardians(id) on delete set null;

alter table public.coach_update_reports alter column reported_by drop not null;
alter table public.coach_update_reports drop constraint coach_update_reports_reported_by_fkey;
alter table public.coach_update_reports add constraint coach_update_reports_reported_by_fkey
  foreign key (reported_by) references public.guardians(id) on delete set null;

alter table public.company_body_assessments drop constraint company_body_assessments_created_by_fkey;
alter table public.company_reference_assessments drop constraint company_reference_assessments_created_by_fkey;
alter table public.company_composition_results drop constraint company_composition_results_created_by_fkey;
alter table public.company_api_keys drop constraint company_api_keys_created_by_fkey;
