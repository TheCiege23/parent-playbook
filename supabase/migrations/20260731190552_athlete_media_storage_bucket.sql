-- Private bucket for athlete photos/videos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'athlete-media',
  'athlete-media',
  false,
  104857600,
  array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','video/mp4','video/quicktime','video/webm']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Storage object policies keyed on first path segment = athlete_id.
-- UUID-guarded so a non-uuid first segment (other apps on this shared
-- project) can never raise a cast error and break their storage queries.
create policy athlete_media_select on storage.objects for select using (
  bucket_id = 'athlete-media'
  and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       then private.can_view_athlete((storage.foldername(name))[1]::uuid)
       else false end
);

create policy athlete_media_insert on storage.objects for insert with check (
  bucket_id = 'athlete-media'
  and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       then private.can_edit_athlete((storage.foldername(name))[1]::uuid)
       else false end
);

create policy athlete_media_update on storage.objects for update using (
  bucket_id = 'athlete-media'
  and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       then private.can_edit_athlete((storage.foldername(name))[1]::uuid)
       else false end
) with check (
  bucket_id = 'athlete-media'
  and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       then private.can_edit_athlete((storage.foldername(name))[1]::uuid)
       else false end
);

create policy athlete_media_delete on storage.objects for delete using (
  bucket_id = 'athlete-media'
  and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       then private.can_edit_athlete((storage.foldername(name))[1]::uuid)
       else false end
);;
