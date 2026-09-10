-- Applied by the harness immediately after 20260730143035_identity_and_access.sql.
-- Creates the SYNTHETIC guardian row that the later hard-coded app_admins seed FKs to,
-- so the real marketplace migration text can replay unmodified. No production data.
insert into public.guardians(id, display_name)
values ('74ea7be3-beb7-4c95-9594-ca8047a11f54', 'synthetic seed admin')
on conflict (id) do nothing;
