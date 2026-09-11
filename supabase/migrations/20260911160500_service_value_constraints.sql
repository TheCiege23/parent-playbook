-- What a service may cost, how long it may last, and how many athletes it may hold.
--
-- services.price_cents, duration_min and max_group_size are plain int columns with nothing
-- behind them, so the database would accept a session priced at -4000 cents. The browser
-- was the only thing checking, and it was checking badly: the guard was
--
--   if(priceV===''||isNaN(parseFloat(priceV)))
--
-- and parseFloat('-40') is a number, so a typed minus sign went straight through to a row
-- that money() renders to parents as -$40.00 on a listing that feeds a payments flow. The
-- `||` fallbacks had the same hole from the other side: parseInt('-5',10)||60 is -5,
-- because -5 is truthy, so the fallback only ever caught NaN and zero.
--
-- The client-side checks have landed. These are here because a constraint in the browser is
-- a suggestion: the table is reachable through PostgREST by any approved trainer, and the
-- rule about what a price may be belongs with the data, not with one screen that happens to
-- write it.
--
-- Zero is allowed for a price — a free introductory session is a real thing to offer — but
-- not for a duration, and a group holds at least one athlete. max_group_size is nullable
-- and stays nullable; null means "not specified" and is not the same as zero.
--
-- NOT VALID, then VALIDATE, deliberately. Adding a plain CHECK takes an ACCESS EXCLUSIVE
-- lock while it scans every row; NOT VALID applies to new writes immediately and takes only
-- a SHARE UPDATE EXCLUSIVE lock for the scan afterwards. This table is small today, so the
-- difference does not matter yet — but the VALIDATE step is also what makes an existing bad
-- row fail loudly here, naming the constraint, instead of failing later inside somebody's
-- unrelated deploy.
alter table public.services
  add constraint services_price_cents_not_negative
    check (price_cents >= 0) not valid;

alter table public.services
  add constraint services_duration_min_positive
    check (duration_min > 0) not valid;

alter table public.services
  add constraint services_max_group_size_at_least_one
    check (max_group_size is null or max_group_size >= 1) not valid;

alter table public.services validate constraint services_price_cents_not_negative;
alter table public.services validate constraint services_duration_min_positive;
alter table public.services validate constraint services_max_group_size_at_least_one;

comment on constraint services_price_cents_not_negative on public.services is
  'A price may be zero (a free introductory session) but never negative. parseFloat("-40") is a number, so the browser''s isNaN check never caught this.';
comment on constraint services_duration_min_positive on public.services is
  'A session lasts at least a minute. parseInt("-5",10)||60 is -5, so the default never caught this either.';
comment on constraint services_max_group_size_at_least_one on public.services is
  'Null means unspecified and stays allowed; a stated group size is at least one athlete.';
