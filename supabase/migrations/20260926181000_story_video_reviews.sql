create table public.story_video_reviews (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.media on delete cascade,
  requested_by uuid references public.guardians on delete set null,
  consent_version text not null check(consent_version='openai-frames-v1'),
  status text not null default 'processing' check(status in ('processing','ready','failed')),
  model text, result jsonb, created_at timestamptz not null default now()
);
alter table public.story_video_reviews enable row level security;
grant select on public.story_video_reviews to authenticated;
create policy story_review_read on public.story_video_reviews for select to authenticated using
  (exists(select 1 from public.media m where m.id=media_id and private.can_edit_athlete(m.athlete_id)));
create function public.story_review_allowed(p_media uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.media m where m.id=p_media and m.kind='video' and private.can_edit_athlete(m.athlete_id));
$$;
create function public.begin_story_video_review(p_media uuid,p_consent text) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
  if p_consent<>'openai-frames-v1' or not public.story_review_allowed(p_media) then raise exception 'Not authorized' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  if (select count(*) from public.story_video_reviews where requested_by=auth.uid() and created_at>now()-interval '1 day')>=20
    or exists(select 1 from public.story_video_reviews where requested_by=auth.uid() and created_at>now()-interval '1 minute') then
    raise exception 'Review limit reached. Try later.' using errcode='P0001';end if;
  insert into public.story_video_reviews(media_id,requested_by,consent_version) values(p_media,auth.uid(),p_consent) returning id into rid;
  return rid;
end;$$;
revoke all on function public.story_review_allowed(uuid),public.begin_story_video_review(uuid,text) from public,anon;
grant execute on function public.story_review_allowed(uuid),public.begin_story_video_review(uuid,text) to authenticated;
