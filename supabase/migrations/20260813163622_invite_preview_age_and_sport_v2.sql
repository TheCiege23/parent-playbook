-- Adds athlete_age and sport_name so the invite page can say "he's nine, plays running
-- back" — enough for a grandmother to recognise the child without exposing anything.
--
-- This page is effectively PUBLIC to anyone holding the link, so the ceiling is
-- deliberate: first name, age as an integer (never the birthdate, which identifies),
-- and the sport. Never a surname, a photo, or the existence of a sibling.
--
-- Keeps the original shape: a not_found row is still RETURNED rather than empty, so the
-- client can tell "no such invite" from "the call failed".
drop function if exists public.invite_preview(text);

create function public.invite_preview(p_token text)
returns table(athlete_first_name text, inviter text, invite_role access_role,
              status text, athlete_age int, sport_name text)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  i public.athlete_invites;
begin
  select * into i from public.athlete_invites where token = p_token;
  if not found then
    return query select null::text, null::text, null::public.access_role,
                        'not_found'::text, null::int, null::text;
    return;
  end if;

  return query
    select a.first_name,
           coalesce(nullif(trim(g.display_name), ''), 'A parent'),
           i.role,
           case
             when i.revoked_at is not null   then 'revoked'
             when i.accepted_at is not null  then 'accepted'
             when i.expires_at < now()       then 'expired'
             else 'pending'
           end,
           case when a.birthdate is null then null
                else extract(year from age(a.birthdate))::int end,
           s.name
    from public.athletes a
    left join public.guardians g on g.id = i.created_by
    left join public.athlete_sports asp
           on asp.athlete_id = a.id and asp.is_primary = true
    left join public.sports s on s.key = asp.sport_key
    where a.id = i.athlete_id;
end;
$function$;

revoke all on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;;
