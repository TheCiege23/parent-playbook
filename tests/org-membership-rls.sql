-- Run ONLY in an empty disposable PostgreSQL database. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
create role authenticated;
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
create table public.teams(id uuid primary key,created_by uuid);
create table public.team_memberships(id uuid primary key,team_id uuid references public.teams,athlete_id uuid);
alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;
-- Minimal fixture for the existing guardian rule; independent of the new admin rule.
create function private.can_view_athlete(ath uuid) returns boolean language sql stable as $$
 select auth.uid()='00000000-0000-0000-0000-000000000003'::uuid
 and ath='20000000-0000-0000-0000-000000000001'::uuid;
$$;
create policy tm_select on public.team_memberships for select to authenticated using(private.can_view_athlete(athlete_id));
create policy tm_ins on public.team_memberships for insert to authenticated with check(private.can_view_athlete(athlete_id));
create policy tm_upd on public.team_memberships for update to authenticated using(private.can_view_athlete(athlete_id)) with check(private.can_view_athlete(athlete_id));
create policy tm_del on public.team_memberships for delete to authenticated using(private.can_view_athlete(athlete_id));
create policy teams_read on public.teams for select to authenticated using(created_by=auth.uid() or exists(select 1 from public.team_memberships tm where tm.team_id=teams.id and private.can_view_athlete(tm.athlete_id)));
grant usage on schema private,auth to authenticated;
grant select on public.teams,public.team_memberships to authenticated;
grant insert,update,delete on public.team_memberships to authenticated;
insert into public.teams values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
insert into public.team_memberships values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002'),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001');
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ begin assert (select count(*) from public.team_memberships)=0,'Baseline should reproduce empty admin roster'; end $$;
reset role;
\ir ../supabase/migrations/20260909120000_allow_org_admin_membership_reads.sql
set local role authenticated;
do $$ begin
 assert (select count(*) from public.team_memberships)=2,'Admin A must see only its two memberships';
 assert (select count(*) from public.team_memberships where team_id='10000000-0000-0000-0000-000000000002')=0,'Shared athlete must not reveal team B membership';
 assert (select count(*) from public.teams)=1,'Team read must not recurse or expand';
end $$;
do $$ declare changed integer; begin
 begin
   insert into public.team_memberships values('30000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');
   raise exception 'Admin must not insert a membership';
 exception when insufficient_privilege then null;
 end;
 update public.team_memberships set athlete_id='20000000-0000-0000-0000-000000000002';
 get diagnostics changed=row_count;assert changed=0,'Admin must not update memberships';
 delete from public.team_memberships;
 get diagnostics changed=row_count;assert changed=0,'Admin must not delete memberships';
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$ begin assert (select count(*) from public.team_memberships)=1,'Admin B sees only its membership'; end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
do $$ begin assert (select count(*) from public.team_memberships)=2,'Guardian retains both memberships for own child'; end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
do $$ begin assert (select count(*) from public.team_memberships)=0,'Unrelated account sees nothing'; end $$;
set local request.jwt.claim.sub='';
do $$ begin assert (select count(*) from public.team_memberships)=0,'Absent identity sees nothing'; end $$;
reset role;
update public.teams set created_by='00000000-0000-0000-0000-000000000002' where id='10000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ begin assert (select count(*) from public.team_memberships)=0,'Former owner loses roster access'; end $$;
reset role;
rollback;
\echo 'Organization membership RLS checks passed; fixtures rolled back.'
