-- Camp listings: the database holds the rules the submission form already showed.
--
-- js/camps.js checked a submission in the browser, but public.camps accepted whatever a signed-in account sent
-- straight to the API. Any account may insert a pending listing (camps_insert), and an administrator reviews
-- pending listings on a screen that renders each sign-up link as a clickable href. HTML escaping does not
-- neutralise a javascript: URL, so the one screen with an administrator's session in it was the one a crafted
-- listing could reach. Raised by the 2026-09-14 audit. js/camps.js also stops rendering a link that is not a web
-- address, so the rule holds where a link is used as well as where it is stored.
--
--   - the sign-up link is http or https, with no whitespace, at most 2048 characters;
--   - the contact email has one @, a dot after it and no whitespace, at most 254 characters;
--   - each age is 0 to 19, the form's own bounds, and the youngest is not above the oldest;
--   - a camp does not end before it starts.
--
-- A listing may still leave either date or either age blank. Checked first, read-only: on 2026-09-15 the live
-- camps table held no rows, so nothing already stored is refused.

alter table public.camps
  add constraint camps_external_signup_url_check
    check (char_length(external_signup_url) <= 2048 and external_signup_url ~* '^https?://[^[:space:]]+$'),
  add constraint camps_contact_email_check
    check (char_length(contact_email) <= 254 and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  add constraint camps_ages_check
    check ((age_min is null or age_min between 0 and 19)
       and (age_max is null or age_max between 0 and 19)
       and (age_min is null or age_max is null or age_min <= age_max)),
  add constraint camps_dates_check
    check (start_date is null or end_date is null or start_date <= end_date);
