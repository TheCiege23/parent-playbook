-- Explicit, revocable story grants; existing stats-only coach grants stay unchanged.
create table public.story_coach_grants (
  athlete_id uuid references public.athletes on delete cascade,
  coach_id uuid references public.guardians on delete cascade,
  enabled boolean not null default false,
  primary key (athlete_id,coach_id)
);
create table public.story_shared_media (
  media_id uuid references public.media on delete cascade,
  coach_id uuid references public.guardians on delete cascade,
  primary key (media_id,coach_id)
);
create table public.story_contributions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes on delete cascade,
  author_id uuid references public.guardians on delete set null default auth.uid(),
  title text not null check (length(title) between 1 and 160),
  note text check (length(note)<=4000),
  kind text not null check (kind in ('note','photo','video')),
  storage_path text unique,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.guardians on delete set null,
  reviewed_at timestamptz,
  check ((kind='note' and storage_path is null) or
    (kind in ('photo','video') and storage_path ~ ('^'||athlete_id::text||'/'||id::text||'\.(jpg|png|webp|mp4|mov|webm)$')))
);
create index on public.story_contributions(athlete_id,created_at desc);
create function private.story_can_contribute(ath uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.can_edit_athlete(ath) or (private.can_coach_view_athlete(ath) and exists
    (select 1 from public.story_coach_grants g where g.athlete_id=ath and g.coach_id=auth.uid() and g.enabled));
$$;
create function private.story_media_shared(mid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists (select 1 from public.story_shared_media s join public.media m on m.id=s.media_id
    join public.story_coach_grants g on g.athlete_id=m.athlete_id and g.coach_id=s.coach_id
    where s.media_id=mid and s.coach_id=auth.uid() and g.enabled and private.can_coach_view_athlete(m.athlete_id));
$$;
alter table public.story_coach_grants enable row level security;
alter table public.story_shared_media enable row level security;
alter table public.story_contributions enable row level security;
grant select,insert,update,delete on public.story_coach_grants to authenticated;
grant select,insert,delete on public.story_shared_media to authenticated;
grant select,insert,delete on public.story_contributions to authenticated;
create policy story_grant_read on public.story_coach_grants for select to authenticated using
  (private.can_edit_athlete(athlete_id) or (coach_id=auth.uid() and private.can_coach_view_athlete(athlete_id)));
create policy story_grant_manage on public.story_coach_grants for all to authenticated using (private.can_edit_athlete(athlete_id)) with check
  (private.can_edit_athlete(athlete_id) and exists(select 1 from public.athlete_access a where a.athlete_id=story_coach_grants.athlete_id and a.guardian_id=coach_id and a.role='coach' and a.revoked_at is null));
create policy story_share_read on public.story_shared_media for select to authenticated using
  (private.story_media_shared(media_id) or exists(select 1 from public.media m where m.id=media_id and private.can_edit_athlete(m.athlete_id)));
create policy story_share_insert on public.story_shared_media for insert to authenticated with check
  (exists(select 1 from public.media m join public.story_coach_grants g on g.athlete_id=m.athlete_id and g.coach_id=story_shared_media.coach_id where m.id=media_id and private.can_edit_athlete(m.athlete_id) and g.enabled));
create policy story_share_delete on public.story_shared_media for delete to authenticated using
  (exists(select 1 from public.media m where m.id=media_id and private.can_edit_athlete(m.athlete_id)));
create policy story_selected_media on public.media for select to authenticated using (private.story_media_shared(id));
create function private.story_path_shared(p text) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.media m where m.path=p and private.story_media_shared(m.id));
$$;
create policy story_selected_media_storage on storage.objects for select to authenticated using
  (bucket_id='athlete-media' and private.story_path_shared(name));
create policy story_contribution_read on public.story_contributions for select to authenticated using
  (private.can_edit_athlete(athlete_id) or (status='approved' and private.can_view_athlete(athlete_id)) or (author_id=auth.uid() and private.story_can_contribute(athlete_id)));
create policy story_contribution_insert on public.story_contributions for insert to authenticated with check
  (author_id=auth.uid() and private.story_can_contribute(athlete_id) and status='pending' and reviewed_by is null and reviewed_at is null);
create policy story_contribution_delete on public.story_contributions for delete to authenticated using
  (private.can_edit_athlete(athlete_id) or (author_id=auth.uid() and status='pending' and private.story_can_contribute(athlete_id)));
create function public.review_story_contribution(contribution_id uuid,decision text) returns void language plpgsql security definer set search_path='' as $$
declare ath uuid;
begin
  if decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
  select athlete_id into ath from public.story_contributions where id=contribution_id for update;
  if ath is null or not private.can_edit_athlete(ath) then raise exception 'Not authorized' using errcode='42501'; end if;
  update public.story_contributions set status=decision,reviewed_by=auth.uid(),reviewed_at=now() where id=contribution_id;
end;$$;
revoke all on function public.review_story_contribution(uuid,text) from public,anon;
grant execute on function public.review_story_contribution(uuid,text) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('story-contributions','story-contributions',false,104857600,array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm']);
create function private.story_contribution_file(p text,writing boolean) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.story_contributions c where c.storage_path=p and (
    case when writing then c.author_id=auth.uid() and c.status='pending' and private.story_can_contribute(c.athlete_id)
    else private.can_edit_athlete(c.athlete_id) or (c.status='approved' and private.can_view_athlete(c.athlete_id)) or (c.author_id=auth.uid() and private.story_can_contribute(c.athlete_id)) end));
$$;
create policy story_files_read on storage.objects for select to authenticated using (bucket_id='story-contributions' and private.story_contribution_file(name,false));
create policy story_files_insert on storage.objects for insert to authenticated with check (bucket_id='story-contributions' and private.story_contribution_file(name,true));
create policy story_files_delete on storage.objects for delete to authenticated using (bucket_id='story-contributions' and private.story_contribution_file(name,true));
