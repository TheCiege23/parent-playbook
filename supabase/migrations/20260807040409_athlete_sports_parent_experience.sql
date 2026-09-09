-- The parent's own playing experience with this sport, for the "Coach's Corner"
-- peer notes. Optional; null = not shared. Values: kid | jr_high | hs | college | pro.
alter table athlete_sports add column if not exists parent_experience text;;
