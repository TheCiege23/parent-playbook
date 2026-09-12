-- Covering indexes for the two foreign keys the external composition tables added, in the same
-- spirit as 20260806151527_covering_indexes_on_foreign_keys.sql.
--
-- consent_id is the one that matters. It sits on a cascade path: deleting a biometric release
-- deletes the records taken under it, and without an index Postgres has to scan the whole table
-- to find them. The scan is free today because the table is empty and expensive exactly when it
-- is not.
--
-- verified_by never cascades — it is plain NO ACTION against auth.users — but the same scan
-- happens when an account is removed, and a referential check that has to read every clinical
-- attachment to answer "is this user referenced" is worth one index.
create index if not exists external_composition_consent_idx
  on public.external_composition_records(consent_id) where consent_id is not null;
create index if not exists external_composition_attachment_verifier_idx
  on public.external_composition_attachments(verified_by) where verified_by is not null;
