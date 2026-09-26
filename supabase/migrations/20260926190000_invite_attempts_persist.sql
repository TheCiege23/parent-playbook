-- Raising an exception after incrementing code_attempts rolls that increment back.
-- A wrong code returns NULL without granting access, so PostgREST commits the
-- attempt and audit record. Revoked/expired/locked invites still raise errors.
-- Preserve existing legacy invitations, but new rows cannot be accepted before
-- issue_invite_code has completed, including a failed or abandoned issuance.
create function private.lock_unissued_invite() returns trigger
language plpgsql set search_path to '' as $$
begin
  new.code_hash := 'unissued';
  new.code_attempts := 0;
  return new;
end;
$$;
revoke all on function private.lock_unissued_invite() from public, anon, authenticated;
create trigger lock_unissued_invite before insert on public.athlete_invites
for each row execute function private.lock_unissued_invite();

create or replace function public.accept_invite(p_token text, p_code text default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  i public.athlete_invites;
  me uuid := auth.uid();
  v_family_id uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select * into i from public.athlete_invites where token = p_token for update;
  if not found then raise exception 'invite_not_found'; end if;
  if i.revoked_at is not null then raise exception 'invite_revoked'; end if;
  if i.accepted_at is not null then raise exception 'invite_already_used'; end if;
  if i.expires_at < now() then raise exception 'invite_expired'; end if;
  if i.code_hash is not null then
    if i.code_attempts >= 5 then raise exception 'invite_locked'; end if;
    if p_code is null or
      encode(extensions.digest(regexp_replace(p_code, '\s', '', 'g') || ':' || i.token, 'sha256'), 'hex')
        is distinct from i.code_hash then
      update public.athlete_invites set code_attempts = code_attempts + 1 where id = i.id;
      insert into public.access_log(actor_id, athlete_id, action, detail)
        values (me, i.athlete_id, 'invite_code_failed',
                jsonb_build_object('invite_id', i.id, 'attempt', i.code_attempts + 1));
      return null;
    end if;
  end if;
  insert into public.guardians(id) values (me) on conflict (id) do nothing;
  if i.scope = 'family' and i.role in ('co_parent', 'family_view') then
    select a.family_id into v_family_id from public.athletes a where a.id = i.athlete_id;
    insert into public.athlete_access(athlete_id, guardian_id, role, granted_by)
      select a.id, me, i.role, i.created_by from public.athletes a where a.family_id = v_family_id
      on conflict (athlete_id, guardian_id) do update set
        role = case when public.athlete_access.role = 'owner' then public.athlete_access.role else excluded.role end,
        revoked_at = null;
    insert into public.access_log(actor_id, athlete_id, action, detail)
      select me, a.id, 'accept_invite', jsonb_build_object('invite_id', i.id, 'role', i.role,
        'scope', 'family', 'code_required', i.code_hash is not null)
      from public.athletes a where a.family_id = v_family_id;
  else
    insert into public.athlete_access(athlete_id, guardian_id, role, granted_by)
      values (i.athlete_id, me, i.role, i.created_by)
      on conflict (athlete_id, guardian_id) do update set
        role = case when public.athlete_access.role = 'owner' then public.athlete_access.role else excluded.role end,
        revoked_at = null;
    insert into public.access_log(actor_id, athlete_id, action, detail)
      values (me, i.athlete_id, 'accept_invite', jsonb_build_object('invite_id', i.id, 'role', i.role,
        'scope', i.scope, 'code_required', i.code_hash is not null));
  end if;
  update public.athlete_invites set accepted_by = me, accepted_at = now() where id = i.id;
  return i.athlete_id;
end;
$$;
revoke all on function public.accept_invite(text, text) from public, anon;
grant execute on function public.accept_invite(text, text) to authenticated;
