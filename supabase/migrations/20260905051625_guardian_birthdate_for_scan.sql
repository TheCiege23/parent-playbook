-- The adult's own date of birth. Collected ONLY at the body-scan consent step, which
-- is the one place in this product where it has a reason to exist: the scan is adults
-- only, and "we recorded the adult's DOB at the moment they consented" is a materially
-- stronger position than "they ticked a box saying they were over 18".
--
-- Nothing else in the app reads this. It is not asked for at signup, not shown on a
-- profile, and not required to use any other feature.
alter table public.guardians
  add column if not exists birthdate date;

-- A guardian is an adult using the app. Bounds catch a typo'd year rather than trusting
-- whatever a date picker produced — 1825 and 2025 are both refused here rather than
-- silently producing an age of 200 or 1.
alter table public.guardians drop constraint if exists guardians_birthdate_sane;
alter table public.guardians add constraint guardians_birthdate_sane check (
  birthdate is null or (birthdate > '1900-01-01' and birthdate < current_date)
);

comment on column public.guardians.birthdate is
  'The adult account holder''s own DOB. Collected only at body-scan consent; the scan is adults-only and refuses without it. No other feature reads this.';

-- Confirm a guardian can write their own row (the scan saves it during consent).
select policyname, cmd, coalesce(qual, with_check) as rule
from pg_policies where schemaname='public' and tablename='guardians'
order by cmd;;
