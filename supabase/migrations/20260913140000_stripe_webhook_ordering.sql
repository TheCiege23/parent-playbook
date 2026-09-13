-- Stripe delivers each webhook event at least once and does not promise order. Two consequences the
-- stripe-webhook function could not handle on its own:
--
--   1. Two deliveries of the same checkout racing each other could both pass the function's "already
--      recorded?" check and record the payment twice. The unique index below makes the second insert fail with
--      23505, which the function already treats as "already recorded". It is partial: a payment row with no
--      payment intent is unconstrained, and the function keys those by booking instead. Checked first, read-only:
--      on 2026-09-13 the live payments table held no rows, so no duplicate intents.
--
--   2. A late customer.subscription.updated could overwrite a newer cancellation, because events were applied in
--      arrival order. subscriptions.stripe_event_at now holds the Stripe creation time of the last event applied,
--      and apply_stripe_subscription_event applies an event only if it is not older than that. Stripe's `created`
--      is whole seconds, so two events stamped the same second still apply in arrival order.

create unique index if not exists payments_stripe_payment_intent_key
  on public.payments (stripe_payment_intent)
  where stripe_payment_intent is not null;

alter table public.subscriptions add column if not exists stripe_event_at timestamptz;
comment on column public.subscriptions.stripe_event_at is
  'Stripe creation time of the last subscription event applied to this row. apply_stripe_subscription_event ignores older events.';

create or replace function public.apply_stripe_subscription_event(
  p_guardian_id uuid,
  p_subscription_id text,
  p_status text,
  p_current_period_end timestamptz,
  p_event_at timestamptz
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  last_applied timestamptz;
begin
  if p_guardian_id is null or p_event_at is null or p_status is null or p_status not in ('active', 'past_due', 'canceled') then
    raise exception 'a guardian, the event time and a known status are required' using errcode = '22023';
  end if;

  -- Locked, so two deliveries for the same guardian are compared one after the other.
  select s.stripe_event_at into last_applied
    from public.subscriptions s
   where s.guardian_id = p_guardian_id
     for update;
  if not found then
    return 'no_subscription';
  end if;
  if last_applied is not null and last_applied > p_event_at then
    return 'stale';
  end if;

  update public.subscriptions
     set stripe_subscription_id = p_subscription_id,
         status = p_status,
         current_period_end = p_current_period_end,
         stripe_event_at = p_event_at,
         updated_at = now()
   where guardian_id = p_guardian_id;
  return 'applied';
end
$$;

comment on function public.apply_stripe_subscription_event(uuid, text, text, timestamptz, timestamptz) is
  'Applies a Stripe subscription event unless an event created later has already been applied. Service role only: it is what makes a guardian premium.';

revoke all on function public.apply_stripe_subscription_event(uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_stripe_subscription_event(uuid, text, text, timestamptz, timestamptz) to service_role;
