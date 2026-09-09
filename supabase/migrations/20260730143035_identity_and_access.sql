-- Parent Playbook — 0001 identity & access (RLS foundation)
create type public.family_role as enum ('owner','co_parent');
create type public.access_role as enum ('owner','co_parent','family_view');

create table public.guardians (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  guardian_id uuid not null references auth.users(id) on delete cascade,
  role public.family_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (family_id, guardian_id)
);

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  first_name text not null,
  nickname text,
  birthdate date,
  dominant_hand text check (dominant_hand in ('left','right','both')),
  avatar_url text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index athletes_family_idx on public.athletes(family_id);

create table public.athlete_access (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  guardian_id uuid not null references auth.users(id) on delete cascade,
  role public.access_role not null default 'family_view',
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (athlete_id, guardian_id)
);
create index aa_guardian_idx on public.athlete_access(guardian_id);
create index aa_athlete_idx on public.athlete_access(athlete_id);

create table public.access_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  athlete_id uuid references public.athletes(id) on delete set null,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index access_log_athlete_idx on public.access_log(athlete_id);

create or replace function public.is_family_member(fam uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.family_members m
    where m.family_id = fam and m.guardian_id = auth.uid());
$$;

create or replace function public.is_family_editor(fam uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.family_members m
    where m.family_id = fam and m.guardian_id = auth.uid() and m.role in ('owner','co_parent'));
$$;

create or replace function public.can_view_athlete(ath uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.athletes a
      join public.family_members m on m.family_id = a.family_id
      where a.id = ath and m.guardian_id = auth.uid())
     or exists (select 1 from public.athlete_access g
      where g.athlete_id = ath and g.guardian_id = auth.uid() and g.revoked_at is null);
$$;

create or replace function public.can_edit_athlete(ath uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.athletes a
      join public.family_members m on m.family_id = a.family_id
      where a.id = ath and m.guardian_id = auth.uid() and m.role in ('owner','co_parent'))
     or exists (select 1 from public.athlete_access g
      where g.athlete_id = ath and g.guardian_id = auth.uid() and g.revoked_at is null and g.role in ('owner','co_parent'));
$$;

create or replace function public.handle_new_family()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.guardians(id) values (auth.uid()) on conflict (id) do nothing;
  insert into public.family_members(family_id, guardian_id, role)
    values (new.id, auth.uid(), 'owner') on conflict do nothing;
  return new;
end;
$$;
create trigger trg_new_family after insert on public.families
  for each row execute function public.handle_new_family();

alter table public.guardians enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.athletes enable row level security;
alter table public.athlete_access enable row level security;
alter table public.access_log enable row level security;

create policy guardians_self_select on public.guardians for select to authenticated using (id = auth.uid());
create policy guardians_self_insert on public.guardians for insert to authenticated with check (id = auth.uid());
create policy guardians_self_update on public.guardians for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy families_select on public.families for select to authenticated using (public.is_family_member(id));
create policy families_insert on public.families for insert to authenticated with check (created_by = auth.uid());
create policy families_update on public.families for update to authenticated using (public.is_family_editor(id)) with check (public.is_family_editor(id));
create policy families_delete on public.families for delete to authenticated using (
  exists (select 1 from public.family_members m where m.family_id = id and m.guardian_id = auth.uid() and m.role = 'owner'));

create policy fm_select on public.family_members for select to authenticated using (public.is_family_member(family_id));
create policy fm_insert on public.family_members for insert to authenticated with check (public.is_family_editor(family_id));
create policy fm_update on public.family_members for update to authenticated using (public.is_family_editor(family_id)) with check (public.is_family_editor(family_id));
create policy fm_delete on public.family_members for delete to authenticated using (public.is_family_editor(family_id));

create policy ath_select on public.athletes for select to authenticated using (public.can_view_athlete(id));
create policy ath_insert on public.athletes for insert to authenticated with check (public.is_family_editor(family_id));
create policy ath_update on public.athletes for update to authenticated using (public.can_edit_athlete(id)) with check (public.can_edit_athlete(id));
create policy ath_delete on public.athletes for delete to authenticated using (public.is_family_editor(family_id));

create policy aa_select on public.athlete_access for select to authenticated using (guardian_id = auth.uid() or public.can_edit_athlete(athlete_id));
create policy aa_insert on public.athlete_access for insert to authenticated with check (public.can_edit_athlete(athlete_id));
create policy aa_update on public.athlete_access for update to authenticated using (public.can_edit_athlete(athlete_id)) with check (public.can_edit_athlete(athlete_id));
create policy aa_delete on public.athlete_access for delete to authenticated using (public.can_edit_athlete(athlete_id));

create policy log_select on public.access_log for select to authenticated using (athlete_id is not null and public.can_edit_athlete(athlete_id));
create policy log_insert on public.access_log for insert to authenticated with check (actor_id = auth.uid());

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;;
