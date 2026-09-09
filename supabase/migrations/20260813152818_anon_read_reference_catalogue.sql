-- The account now comes LAST in onboarding: a parent picks a sport, a season and goals,
-- and is shown a real generated week BEFORE being asked for an email. Every one of those
-- screens runs with no session, so the reference catalogue has to be readable by anon.
--
-- None of these four tables holds anything about a child. They are the product's
-- catalogue: sport names, position codes, metric definitions, and coaching content that
-- carries its own public citations. Nothing here is private, and anyone could read all
-- of it by signing up free in twenty seconds — the previous restriction was theatre.
--
-- Drafts stay hidden: anon only ever sees status='published'.
-- To reverse: drop the four *_read_anon policies. Nothing else depends on them.

drop policy if exists sports_read_anon on public.sports;
create policy sports_read_anon on public.sports for select to anon using (true);

drop policy if exists positions_read_anon on public.positions;
create policy positions_read_anon on public.positions for select to anon using (true);

drop policy if exists metrics_read_anon on public.metrics;
create policy metrics_read_anon on public.metrics for select to anon using (true);

-- Deliberately narrower than the authenticated policy: published rows only, so an
-- unfinished drill can never leak out through the signup flow.
drop policy if exists drills_read_anon on public.drills;
create policy drills_read_anon on public.drills for select to anon using (status = 'published');;
