
-- join_code had no uniqueness guarantee — team_by_code does `where upper(join_code)=upper(p_code) limit 1`,
-- so two teams sharing a code would resolve unpredictably to whichever sorts first. Now that
-- teams_read is tightened (creator/roster-member only), a client can no longer check "is this
-- code taken" by querying teams directly, so this has to be enforced in the database, not
-- client-side, before self-serve team creation ships.
create unique index teams_join_code_uniq on public.teams (upper(join_code)) where join_code is not null;
;
