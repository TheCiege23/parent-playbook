-- Parent Playbook — 0004 seed: football config + general growth metrics
insert into public.sports(key,name,level_vocab,selectable,sort) values
 ('general','General Athleticism','[]'::jsonb,false,99),
 ('football','Football','["Flag","Pee Wee","Junior","Senior","Freshman","JV","Varsity"]'::jsonb,true,1);

insert into public.metrics(sport_key,key,name,unit,lower_is_better,is_general,sort) values
 ('general','height','Height','in',false,true,1),
 ('general','weight','Weight','lb',false,true,2);

insert into public.positions(sport_key,code,name,sort) values
 ('football','QB','Quarterback',1),
 ('football','RB','Running Back',2),
 ('football','WR','Wide Receiver',3),
 ('football','TE','Tight End',4),
 ('football','OL','Offensive Line',5),
 ('football','DL','Defensive Line',6),
 ('football','LB','Linebacker',7),
 ('football','CB','Cornerback',8),
 ('football','S','Safety',9),
 ('football','K','Kicker / Punter',10),
 ('football','ATH','Athlete / Multiple',11);

insert into public.metrics(sport_key,key,name,unit,lower_is_better,is_general,sort) values
 ('football','dash_40','40-yard dash','s',true,false,1),
 ('football','dash_20','20-yard dash','s',true,false,2),
 ('football','dash_10','10-yard split','s',true,false,3),
 ('football','shuttle','5-10-5 shuttle','s',true,false,4),
 ('football','vertical','Vertical jump','in',false,false,5),
 ('football','broad_jump','Broad jump','in',false,false,6),
 ('football','catch_radius','Catch radius','in',false,false,7),
 ('football','catch_pct','Catch %','%',false,false,8);

insert into public.activities(sport_key,title,focus,age_min,age_max,duration_min,description,what_to_say,common_mistakes,when_to_stop) values
 ('football','Ladder footwork & coordination','coordination',5,9,10,
   'Quick-feet patterns through an agility ladder (or chalk boxes). Builds coordination and body control that helps every position.',
   'Cue “light feet, eyes up.” Celebrate rhythm over speed.',
   'Going too fast and losing form; staring down at the feet the whole time.',
   'Stop when form gets sloppy or interest fades — 10 minutes is plenty.'),
 ('football','Soft-hands catching','catching',5,10,12,
   'Short tosses focused on catching with the hands (not the chest), eyes tracking the ball all the way in.',
   'Cue “reach and squeeze, watch it in.” Praise the tracking, not just the catch.',
   'Trapping the ball against the body; taking eyes off it early.',
   'Stop after ~12 minutes or once frustration rises; end on a good catch.'),
 ('football','Athletic stance & first step','first-step',6,11,8,
   'Practice a balanced athletic stance and an explosive first step forward on a “go” cue.',
   'Cue “ready position, explode on go.” Keep it playful with reaction races.',
   'Standing too upright; false-stepping backward before going forward.',
   'A few focused reps beat many sloppy ones — stop around 8 minutes.'),
 ('football','Ball security & handoffs','ball-security',6,12,10,
   'Carry the ball high and tight through gentle contact bumps; practice clean handoffs.',
   'Cue “high and tight, five points of pressure.”',
   'Carrying the ball loose or away from the body.',
   'Keep contact light and brief; stop if it stops being fun.'),
 ('football','Confidence walkthrough','confidence',7,14,5,
   'Walk through this week’s plays slowly with no pressure, so game situations feel familiar.',
   'Cue “you’ve already done this — you’ve got it.” Focus on effort and fun.',
   'Turning it into a drill or critique session.',
   'Five calm minutes is the goal — end with encouragement.');;
