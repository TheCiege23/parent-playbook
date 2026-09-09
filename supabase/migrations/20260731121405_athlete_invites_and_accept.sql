-- Parent Playbook — athlete invites (share-link access) + redemption RPCs
create table public.athlete_invites (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  role public.access_role not null default 'family_view',
  token text not null unique
    default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  invited_email text,
  created_by uuid not null references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint invite_role_chk check (role in ('co_parent','family_view'))
);
create index ai_athlete_idx on public.athlete_invites(athlete_id);
create index ai_token_idx on public.athlete_invites(token);

alter table public.athlete_invites enable row level security;

create policy ainv_select on public.athlete_invites for select to authenticated using (private.can_edit_athlete(athlete_id));
create policy ainv_insert on public.athlete_invites for insert to authenticated with check (private.can_edit_athlete(athlete_id) and created_by = auth.uid());
create policy ainv_update on public.athlete_invites for update to authenticated using (private.can_edit_athlete(athlete_id)) with check (private.can_edit_athlete(athlete_id));
create policy ainv_delete on public.athlete_invites for delete to authenticated using (private.can_edit_athlete(athlete_id));

-- preview an invite (used on the redeem screen before the invitee decides to join)
create or replace function public.invite_preview(p_token text)
returns table (athlete_first_name text, inviter text, invite_role public.access_role, status text)
language plpgsql stable security definer set search_path = '' as $$
declare
  i public.athlete_invites;
begin
  select * into i from public.athlete_invites where token = p_token;
  if not found then
    return query select null::text, null::text, null::public.access_role, 'not_found'::text;
    return;
  end if;

  return query
    select a.first_name,
           coalesce(g.display_name, 'A parent'),
           i.role,
           case
             when i.revoked_at is not null then 'revoked'
             when i.accepted_at is not null then 'accepted'
             when i.expires_at < now() then 'expired'
             else 'pending'
           end
    from public.athletes a
    left join public.guardians g on g.id = i.created_by
    where a.id = i.athlete_id;
end;
$$;

-- redeem an invite: grants the current user access to the athlete
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  i public.athlete_invites;
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_authenticated';
  end if;

  select * into i from public.athlete_invites where token = p_token for update;
  if not found then
    raise exception 'invite_not_found';
  end if;
  if i.revoked_at is not null then
    raise exception 'invite_revoked';
  end if;
  if i.accepted_at is not null then
    raise exception 'invite_already_used';
  end if;
  if i.expires_at < now() then
    raise exception 'invite_expired';
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
    values (me, i.athlete_id, 'accept_invite', jsonb_build_object('invite_id', i.id, 'role', i.role));

  return i.athlete_id;
end;
$$;

grant execute on function public.invite_preview(text) to authenticated, anon;
grant execute on function public.accept_invite(text) to authenticated;;
