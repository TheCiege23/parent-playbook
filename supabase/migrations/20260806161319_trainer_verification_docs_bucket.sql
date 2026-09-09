-- Private bucket for trainer verification documents (cert PDFs, ID).
insert into storage.buckets (id, name, public)
  values ('trainer-verification-docs','trainer-verification-docs', false)
  on conflict (id) do nothing;

-- Trainer can write/read/delete only their own folder (first path segment = their uid);
-- admins can read/delete everything (service role bypasses RLS entirely). Parents blocked.
create policy tvd_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'trainer-verification-docs'
    and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy tvd_select on storage.objects for select to authenticated
  using (bucket_id = 'trainer-verification-docs'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or private.is_admin()));
create policy tvd_delete on storage.objects for delete to authenticated
  using (bucket_id = 'trainer-verification-docs'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or private.is_admin()));;
