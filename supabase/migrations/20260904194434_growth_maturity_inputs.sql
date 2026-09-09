-- Growth & maturation. Everything here is arithmetic on self-reported numbers —
-- no body scan, no photo, no biometric identifier. That distinction is deliberate:
-- body-composition scanning of minors is regulated biometric data (Illinois BIPA and
-- friends carry a private right of action), and it would reverse the product's own
-- "no weight tracking suggested under 13" decision.

-- Sex at birth. Required for BOTH the mid-parental height formula and every published
-- growth reference — pediatric growth charts are sex-specific and there is no way to
-- compute this correctly without it. Optional, asked only in Growth and only when the
-- parent opts into the prediction, never in onboarding.
do $$ begin
  create type public.sex_at_birth as enum ('male','female');
exception when duplicate_object then null; end $$;

alter table public.athletes
  add column if not exists sex_at_birth public.sex_at_birth;

-- The parents' OWN adult heights, in inches. This is adult self-reported data about
-- the guardians, not anything measured off the child — a materially lower-risk input
-- than the child's body, and the only extra thing Tanner mid-parental height needs.
alter table public.athletes
  add column if not exists mother_height_in numeric(4,1),
  add column if not exists father_height_in numeric(4,1);

-- Sanity bounds. A typo of 68 -> 680 would otherwise put a 6-year-old's predicted
-- adult height in the hundreds of feet, which is the kind of absurd output that
-- destroys trust in every other number on the screen.
alter table public.athletes drop constraint if exists athletes_parent_height_sane;
alter table public.athletes add constraint athletes_parent_height_sane check (
  (mother_height_in is null or mother_height_in between 48 and 84) and
  (father_height_in is null or father_height_in between 48 and 84)
);

-- The age cut-off date a league uses to place a child in an age band. Relative age is
-- computed against this, and it varies by league — USA Football commonly uses a fixed
-- calendar date, so it is stored per sport rather than assumed.
alter table public.athlete_sports
  add column if not exists age_cutoff_md text;
alter table public.athlete_sports drop constraint if exists athlete_sports_cutoff_fmt;
alter table public.athlete_sports add constraint athlete_sports_cutoff_fmt check (
  age_cutoff_md is null or age_cutoff_md ~ '^\d{2}-\d{2}$'
);

comment on column public.athletes.sex_at_birth is
  'Growth references and the mid-parental height formula are sex-specific. Optional; only collected for the Growth prediction.';
comment on column public.athletes.mother_height_in is 'Guardian-reported adult height, inches. Input to Tanner mid-parental height.';
comment on column public.athlete_sports.age_cutoff_md is
  'League age cut-off as MM-DD. Used for relative age only. Null means unknown, and relative age is hidden rather than guessed.';;
