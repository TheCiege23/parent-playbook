-- The metrics picker is ordered by `sort`, but the values collided (dash_40 and height
-- were both 1, dash_20 and weight both 2), so the list interleaved two unrelated series:
--   40-yard dash · Height · 20-yard dash · Weight · 10-yard split …
-- Height and weight are the two things a parent actually records, and the only ones that
-- feed growth-spurt detection. They lead now, and every value is distinct so the order
-- is stable rather than arbitrary.
update public.metrics set sort = v.sort
from (values
  ('height',1),('weight',2),
  ('dash_40',3),('dash_20',4),('dash_10',5),('shuttle',6),
  ('vertical',7),('broad_jump',8),
  ('catch_radius',9),('catch_pct',10),
  ('plank_hold',11),('flexibility_reach',12),('pushups_1min',13),('situps_1min',14)
) as v(key,sort)
where public.metrics.key = v.key;;
