-- D4: let a drill declare which goals it actually serves, so picking "More reliable
-- hands" changes the plan instead of being decorative. Empty = applies to any goal.
alter table public.drills add column if not exists goal_keys text[] not null default '{}';

-- D6: let a drill declare which levels it suits. Deliberately NOT a volume or intensity
-- dial — level selects CONTENT, it never increases how much a child trains.
alter table public.drills add column if not exists levels text[] not null default '{}';

create index if not exists drills_goals_idx on public.drills using gin (goal_keys);

comment on column public.drills.goal_keys is
  'Goal keys this drill serves (catching, footwork, confidence, iq, speed, strength, agility, endurance). Empty = general, applies to any goal.';
comment on column public.drills.levels is
  'Level labels this drill suits, matching sports.level_vocab. Empty = all levels. Never used to raise training volume.';

-- B3: the admin's "needs more info" note has to reach the trainer. It was being written
-- to trainer_review_actions, which is admin-only, so the applicant saw generic copy and
-- had no idea what to fix.
alter table public.trainer_profiles add column if not exists review_note text;
comment on column public.trainer_profiles.review_note is
  'Latest reviewer note shown TO the trainer on their status screen. Distinct from trainer_review_actions, which is the internal audit log.';

-- Tag the six cited football drills so goals start biting immediately.
update public.drills set goal_keys = '{catching}'      where title = 'Catch it high, low & moving';
update public.drills set goal_keys = '{footwork,agility}' where title = 'Multidirectional movement game';
update public.drills set goal_keys = '{speed,agility}'  where title = 'Stop under control';
update public.drills set goal_keys = '{strength}'       where title = 'Squat, hinge & push patterns';
update public.drills set goal_keys = '{confidence}'     where title = 'Athletic stance, fall & land';
update public.drills set goal_keys = '{footwork}'       where title = 'Two-point stance & first step';;
