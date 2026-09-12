-- A parent-facing invite belongs to the household, not to whichever child's
-- Profile screen happened to be open when it was created. Coach access remains
-- athlete-scoped: a trainer connected to one child must not inherit siblings.
alter table public.athlete_invites
  add column if not exists scope text not null default 'athlete';

alter table public.athlete_invites
  drop constraint if exists athlete_invites_scope_chk;
alter table public.athlete_invites
  add constraint athlete_invites_scope_chk
  check (scope in ('athlete', 'family'));

-- Parent and family-view invitations created before this migration express the
-- same household intent. Mark them family-wide and repair already accepted
-- invitations so existing recipients immediately see every current sibling.
update public.athlete_invites
   set scope = 'family'
 where role in ('co_parent', 'family_view');

insert into public.athlete_access(athlete_id, guardian_id, role, granted_by)
select sibling.id, i.accepted_by, i.role, i.created_by
  from public.athlete_invites i
  join public.athletes anchor on anchor.id = i.athlete_id
  join public.athletes sibling on sibling.family_id = anchor.family_id
 where i.scope = 'family'
   and i.role in ('co_parent', 'family_view')
   and i.accepted_by is not null
   and i.accepted_at is not null
on conflict (athlete_id, guardian_id)
do update set
  role = case
    when public.athlete_access.role = 'owner' then public.athlete_access.role
    else excluded.role
  end,
  revoked_at = null;

-- The preview adds scope and household size. It intentionally does not expose
-- sibling names before authentication; the bearer of the link only learns that
-- the invitation covers the household.
drop function if exists public.invite_preview(text);
create function public.invite_preview(p_token text)
returns table(athlete_first_name text, inviter text, invite_role public.access_role,
              status text, athlete_age integer, sport_name text,
              needs_code boolean, sent_hint text, invite_scope text,
              athlete_count integer)
language plpgsql
stable security definer
set search_path to ''
as $$
declare
  i public.athlete_invites;
begin
  select * into i from public.athlete_invites where token = p_token;
  if not found then
    return query select null::text, null::text, null::public.access_role,
                        'not_found'::text, null::int, null::text, false,
                        null::text, null::text, null::int;
    return;
  end if;

  return query
    select a.first_name,
           coalesce(nullif(trim(g.display_name), ''), 'A parent'),
           i.role,
           case
             when i.revoked_at is not null      then 'revoked'
             when i.accepted_at is not null     then 'accepted'
             when i.expires_at < now()          then 'expired'
             when i.code_attempts >= 5          then 'locked'
             else 'pending'
           end,
           case when a.birthdate is null then null
                else extract(year from age(a.birthdate))::int end,
           s.name,
           (i.code_hash is not null),
           case
             when i.code_hash is null          then null
             when i.invited_phone is not null  then 'the text ending ' || right(i.invited_phone, 4)
             when i.invited_email is not null  then 'the email to ' ||
                  left(i.invited_email, 1) || '•••@' || split_part(i.invited_email, '@', 2)
             else 'the message they sent you'
           end,
           i.scope,
           case when i.scope = 'family'
             then (select count(*)::int from public.athletes x where x.family_id = a.family_id)
             else 1
           end
      from public.athletes a
      left join public.guardians g on g.id = i.created_by
      left join public.athlete_sports asp
             on asp.athlete_id = a.id and asp.is_primary = true
      left join public.sports s on s.key = asp.sport_key
     where a.id = i.athlete_id;
end;
$$;

-- One successful family invite creates one access row for every child currently
-- in the household. Keeping the rows explicit preserves per-child revocation and
-- avoids turning a family viewer into a household editor.
drop function if exists public.accept_invite(text, text);
create function public.accept_invite(p_token text, p_code text default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  i public.athlete_invites;
  me uuid := auth.uid();
  v_family_id uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;

  select * into i from public.athlete_invites where token = p_token for update;
  if not found                       then raise exception 'invite_not_found'; end if;
  if i.revoked_at is not null        then raise exception 'invite_revoked'; end if;
  if i.accepted_at is not null       then raise exception 'invite_already_used'; end if;
  if i.expires_at < now()            then raise exception 'invite_expired'; end if;

  if i.code_hash is not null then
    if i.code_attempts >= 5 then raise exception 'invite_locked'; end if;

    if p_code is null or
       encode(extensions.digest(regexp_replace(p_code, '\s', '', 'g') || ':' || i.token, 'sha256'), 'hex')
         is distinct from i.code_hash then
      update public.athlete_invites set code_attempts = code_attempts + 1 where id = i.id;
      insert into public.access_log(actor_id, athlete_id, action, detail)
        values (me, i.athlete_id, 'invite_code_failed',
                jsonb_build_object('invite_id', i.id, 'attempt', i.code_attempts + 1));
      raise exception 'invite_code_wrong';
    end if;
  end if;

  insert into public.guardians(id) values (me) on conflict (id) do nothing;

  if i.scope = 'family' and i.role in ('co_parent', 'family_view') then
    select a.family_id into v_family_id from public.athletes a where a.id = i.athlete_id;

    insert into public.athlete_access(athlete_id, guardian_id, role, granted_by)
    select a.id, me, i.role, i.created_by
      from public.athletes a
     where a.family_id = v_family_id
    on conflict (athlete_id, guardian_id)
    do update set
      role = case
        when public.athlete_access.role = 'owner' then public.athlete_access.role
        else excluded.role
      end,
      revoked_at = null;

    insert into public.access_log(actor_id, athlete_id, action, detail)
    select me, a.id, 'accept_invite',
           jsonb_build_object('invite_id', i.id, 'role', i.role,
                              'scope', 'family',
                              'code_required', i.code_hash is not null)
      from public.athletes a
     where a.family_id = v_family_id;
  else
    insert into public.athlete_access(athlete_id, guardian_id, role, granted_by)
      values (i.athlete_id, me, i.role, i.created_by)
      on conflict (athlete_id, guardian_id)
      do update set
        role = case
          when public.athlete_access.role = 'owner' then public.athlete_access.role
          else excluded.role
        end,
        revoked_at = null;

    insert into public.access_log(actor_id, athlete_id, action, detail)
      values (me, i.athlete_id, 'accept_invite',
              jsonb_build_object('invite_id', i.id, 'role', i.role,
                                 'scope', i.scope,
                                 'code_required', i.code_hash is not null));
  end if;

  update public.athlete_invites
     set accepted_by = me, accepted_at = now()
   where id = i.id;

  return i.athlete_id;
end;
$$;

revoke all on function public.accept_invite(text, text) from public, anon;
grant execute on function public.accept_invite(text, text) to authenticated;
grant execute on function public.invite_preview(text) to anon, authenticated;
