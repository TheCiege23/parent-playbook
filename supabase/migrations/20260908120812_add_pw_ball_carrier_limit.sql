
alter table public.athlete_sports
  add column if not exists pw_ball_carrier_lb numeric;

comment on column public.athlete_sports.pw_ball_carrier_lb is
  'Parent-entered local-league ball-carrier weight limit (lb) for Pop Warner football, optional. Division-eligibility weight bands are set nationally and computed client-side (js/pop-warner.js); this one number varies by local league/conference and cannot be derived, so it is entered by hand.';
;
