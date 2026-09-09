-- The redesign asks two different questions, and they are for two different readers:
--   notes         "One thing he did well"    — the child reads this in ten years
--   note_improve  "One thing to work on"     — just for the parent; shapes next week
-- Cramming both into `notes` would put a critique in the keepsake.
alter table public.games add column if not exists note_improve text;

comment on column public.games.note_improve is
  'Private to the household: what to work on. Never shown alongside the celebratory note.';;
