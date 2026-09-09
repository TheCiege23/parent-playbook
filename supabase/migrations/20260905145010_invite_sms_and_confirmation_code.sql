-- ===================================================================
--  INVITES: a phone number, and a code that makes the link insufficient
-- ===================================================================
-- Until now the token in the URL was the entire credential. A text message forwarded
-- once -- to the group chat, to the wrong Karen, to a phone left on a kitchen counter --
-- handed a stranger standing access to a child's photos and schedule. That is the single
-- weakest thing in the product, and it gets weaker the moment invites go out by SMS,
-- because SMS is the medium people forward without thinking.
--
-- So the link stops being sufficient. Possession of the link plus knowledge of a code
-- that travelled the same channel is still not two factors in the textbook sense, but it
-- does defeat the actual threat: a forwarded message read by someone who was not the
-- intended recipient, and a token guessed or scraped in transit.
--
-- The code is never stored. Only a SHA-256 of code+token, so the hash of one invite's
-- code is useless against another, and a database read yields nothing enterable.

alter table public.athlete_invites
  add column if not exists invited_phone  text,
  add column if not exists code_hash      text,
  add column if not exists code_attempts  smallint not null default 0,
  add column if not exists code_issued_at timestamptz,
  add column if not exists sent_via       text;

-- E.164 or nothing. A number stored in whatever shape a parent typed it is a number the
-- SMS gateway rejects at send time, which is the worst moment to find out.
alter table public.athlete_invites drop constraint if exists athlete_invites_phone_e164;
alter table public.athlete_invites add constraint athlete_invites_phone_e164
  check (invited_phone is null or invited_phone ~ '^\+[1-9][0-9]{7,14}$');

-- ===================================================================
--  ISSUE A CODE
-- ===================================================================
-- Returns the plaintext ONCE, to an editor, and never again -- the row keeps only the
-- hash. The editor needs it in the clear because until the SMS sender is registered they
-- are the delivery mechanism: they read it off the screen into their own Messages app.
create or replace function public.issue_invite_code(p_invite_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  i public.athlete_invites;
  g bytea;
  v_code text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into i from public.athlete_invites where id = p_invite_id for update;
  if not found then raise exception 'invite_not_found'; end if;
  if not private.can_edit_athlete(i.athlete_id) then raise exception 'forbidden'; end if;
  if i.revoked_at is not null or i.accepted_at is not null then
    raise exception 'invite_no_longer_active';
  end if;

  -- Four crypto-random bytes folded into six digits. random() is seeded and predictable;
  -- for the one secret standing between a forwarded text and a child's data it is not
  -- good enough, and gen_random_bytes costs nothing here.
  g := extensions.gen_random_bytes(4);
  v_code := lpad(((get_byte(g,0)::bigint * 16777216
                 + get_byte(g,1)::bigint * 65536
                 + get_byte(g,2)::bigint * 256
                 + get_byte(g,3)::bigint) % 1000000)::text, 6, '0');

  update public.athlete_invites
     set code_hash      = encode(extensions.digest(v_code || ':' || i.token, 'sha256'), 'hex'),
         code_attempts  = 0,          -- re-issuing clears the lockout, deliberately:
         code_issued_at = now()       -- the editor re-issuing IS the authorised recovery
   where id = i.id;

  return v_code;
end;
$$;

revoke all on function public.issue_invite_code(uuid) from public, anon;
grant execute on function public.issue_invite_code(uuid) to authenticated;

-- ===================================================================
--  PREVIEW -- now says whether a code is wanted, and where it went
-- ===================================================================
-- Recreated rather than replaced: the return shape changes, and a stale row type is how
-- a preview silently starts returning the wrong column in the wrong slot.
drop function if exists public.invite_preview(text);
create function public.invite_preview(p_token text)
returns table(athlete_first_name text, inviter text, invite_role public.access_role,
              status text, athlete_age integer, sport_name text,
              needs_code boolean, sent_hint text)
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
                        'not_found'::text, null::int, null::text, false, null::text;
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
           -- Enough for the right person to know which message to look in, useless to
           -- anyone else. Never the address itself.
           case
             when i.code_hash is null       then null
             when i.invited_phone is not null then 'the text ending ' || right(i.invited_phone, 4)
             when i.invited_email is not null then 'the email to ' ||
                  left(i.invited_email, 1) || '•••@' || split_part(i.invited_email, '@', 2)
             else 'the message they sent you'
           end
    from public.athletes a
    left join public.guardians g on g.id = i.created_by
    left join public.athlete_sports asp
           on asp.athlete_id = a.id and asp.is_primary = true
    left join public.sports s on s.key = asp.sport_key
    where a.id = i.athlete_id;
end;
$$;

-- ===================================================================
--  ACCEPT -- the code is checked before any access is granted
-- ===================================================================
-- The old one-argument function is DROPPED, not left beside this one. Postgres resolves
-- an exact arity match ahead of a defaulted parameter, so leaving accept_invite(text) in
-- place would mean every existing caller silently kept the codeless path -- the check
-- would be present, deployed, and never once executed.
drop function if exists public.accept_invite(text);
create function public.accept_invite(p_token text, p_code text default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  i public.athlete_invites;
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;

  select * into i from public.athlete_invites where token = p_token for update;
  if not found                       then raise exception 'invite_not_found'; end if;
  if i.revoked_at is not null        then raise exception 'invite_revoked'; end if;
  if i.accepted_at is not null       then raise exception 'invite_already_used'; end if;
  if i.expires_at < now()            then raise exception 'invite_expired'; end if;

  if i.code_hash is not null then
    -- Cap first. Checking the code before the cap turns the counter into a speed bump
    -- rather than a wall: six digits is a million guesses, which is nothing to a script.
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

  insert into public.athlete_access(athlete_id, guardian_id, role, granted_by)
    values (i.athlete_id, me, i.role, i.created_by)
    on conflict (athlete_id, guardian_id)
    do update set role = excluded.role, revoked_at = null;

  update public.athlete_invites
    set accepted_by = me, accepted_at = now()
    where id = i.id;

  insert into public.access_log(actor_id, athlete_id, action, detail)
    values (me, i.athlete_id, 'accept_invite',
            jsonb_build_object('invite_id', i.id, 'role', i.role,
                               'code_required', i.code_hash is not null));

  return i.athlete_id;
end;
$$;

revoke all on function public.accept_invite(text, text) from public, anon;
grant execute on function public.accept_invite(text, text) to authenticated;
grant execute on function public.invite_preview(text) to anon, authenticated;;
