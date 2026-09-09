-- 7. Drill media: the design's three states include a 6-8s LOOP (MP4 + WebM sibling).
-- The bucket was images-only, so a loop could not be uploaded at all. Size cap raised
-- from 5MB to 20MB — the spec says loops stay under 1.5MB, so this is headroom, not
-- permission to upload a 100MB clip.
update storage.buckets
set allowed_mime_types = array[
      'image/jpeg','image/png','image/webp','image/svg+xml','image/avif',
      'video/mp4','video/webm'],
    file_size_limit = 20971520
where id = 'drill-images';

-- 8. notification_log: RLS is on with no policies, which the linter flags as INFO.
-- That is deliberate — the edge functions use the service role, which bypasses RLS,
-- and no client should ever read anyone's send history. Making the denial EXPLICIT
-- states the intent in the schema instead of leaving it to be inferred from absence.
drop policy if exists nl_no_client_access on public.notification_log;
create policy nl_no_client_access on public.notification_log
  for select to authenticated, anon using (false);;
