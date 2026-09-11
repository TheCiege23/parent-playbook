-- Manual input for the separate maturity-offset estimate. This is not inferred
-- from a photo: the parent measures from a hard sitting surface to the top of the
-- head and records it alongside standing height and body mass in one session.
insert into public.metrics (sport_key,key,name,unit,lower_is_better,is_general,sort)
values ('general','sitting_height','Sitting height','in',false,true,8)
on conflict do nothing;

comment on table public.measurements is
  'Parent-entered performance and growth observations plus versioned derived scan lengths. Maturity-offset input batches use a PP_MATURITY_INPUT_V1 note and require same-session height, sitting height and weight.';
