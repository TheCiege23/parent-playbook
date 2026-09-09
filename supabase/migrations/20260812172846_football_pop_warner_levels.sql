-- Football's level list held school-team names (Freshman/JV/Varsity) plus a couple of
-- youth ones, but not the Pop Warner ladder that most under-12 football in the US
-- actually uses — Tiny Mites, Mighty Mites, Junior Pee Wee. A parent whose child plays
-- Mighty Mites had no correct option, and a team code carrying that level would set a
-- value the dropdown could not display. Ordered youngest to oldest.
update public.sports
set level_vocab = '["Flag","Tiny Mites","Mighty Mites","Junior Pee Wee","Pee Wee","Junior","Senior","Middle School","Freshman","JV","Varsity"]'::jsonb
where key = 'football';;
