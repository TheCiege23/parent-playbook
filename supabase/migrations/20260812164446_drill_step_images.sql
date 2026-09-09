-- Step-by-step images for drills. A parent mid-drill in a garden can glance at a picture;
-- they cannot read a paragraph. Images are instructional content, not family data, so they
-- live in a PUBLIC bucket — nothing here is ever about a specific child.
--
-- Shape: [{ "path": "football/ball-security-1.jpg", "alt": "Ball tucked high against the ribs" }]
-- alt is required by convention, not constraint, because these render as <img> and a
-- screen reader with no alt text is the accessibility gap E3 was about.
alter table public.drills
  add column if not exists images jsonb not null default '[]'::jsonb;

-- Guard the shape: an array, capped at 6 so a drill card can't turn into a slideshow.
alter table public.drills
  drop constraint if exists drills_images_shape;
alter table public.drills
  add constraint drills_images_shape
  check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 6);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('drill-images','drill-images', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/svg+xml'];

-- Anyone may read (they are public instructional images); only admins may write.
drop policy if exists drill_images_read on storage.objects;
create policy drill_images_read on storage.objects for select
  using (bucket_id = 'drill-images');

drop policy if exists drill_images_write on storage.objects;
create policy drill_images_write on storage.objects for insert to authenticated
  with check (bucket_id = 'drill-images' and private.is_admin());

drop policy if exists drill_images_update on storage.objects;
create policy drill_images_update on storage.objects for update to authenticated
  using (bucket_id = 'drill-images' and private.is_admin())
  with check (bucket_id = 'drill-images' and private.is_admin());

drop policy if exists drill_images_delete on storage.objects;
create policy drill_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'drill-images' and private.is_admin());;
