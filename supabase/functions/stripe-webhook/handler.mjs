// stripe-webhook: records what Stripe reports about marketplace payments and premium subscriptions.
//
// The logic lives here, apart from the Deno entry point, so it runs under Node's test runner
// (tests/stripe-webhook-function.test.cjs). Stripe delivers each event at least once, retries whenever it
// does not get a 2xx, and does not promise order. The earlier version answered 200 even when its database
// writes failed, so Stripe stopped retrying and the event was lost. It also inserted a new payment row on
// every redelivery, because the payments table has no uniqueness on the payment intent. So:
//
//   - a failed database read or write answers 500, and Stripe retries;
//   - a payment already recorded for the same payment intent (or, without one, for the same booking) is not
//     recorded again, and a unique violation from a racing delivery counts as already recorded;
//   - a booking's paid_at is set once and not moved by a redelivery;
//   - a signature failure answers 400 without echoing the verifier's message.
//
// Not fixed here, and pinned by the tests: subscription events are applied in the order they arrive, so a
// late customer.subscription.updated can overwrite a newer cancellation. Fixing that needs the event time
// stored beside the subscription, which is a schema change.

const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json' });
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export const SUBSCRIPTION_EVENTS = Object.freeze(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']);

export function subscriptionStatus(stripeStatus) {
  if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'active';
  if (stripeStatus === 'past_due') return 'past_due';
  return 'canceled';
}

export function createStripeWebhookHandler({ verifyEvent, db, feeBps = 1500, now = () => new Date() } = {}) {
  if (typeof verifyEvent !== 'function' || !db) throw new TypeError('createStripeWebhookHandler needs verifyEvent(body, signature) and db');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) throw new TypeError('feeBps must be an integer from 0 to 10000');

  return async function handle(req) {
    const signature = req.headers.get('stripe-signature');
    const body = await req.text();
    if (!signature) return new Response('Bad signature', { status: 400 });
    let event;
    try {
      event = await verifyEvent(body, signature);
    } catch {
      return new Response('Bad signature', { status: 400 });
    }

    // Every database failure becomes a 500 so Stripe delivers the event again.
    const failed = () => reply(500, { error: 'The event could not be recorded; Stripe will retry.' });

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const bookingId = session.metadata?.booking_id;
      if (bookingId) {
        const { data: booking, error: bookingError } = await db.from('bookings')
          .select('parent_id,trainer_id,price_cents,currency').eq('id', bookingId).maybeSingle();
        if (bookingError) return failed();

        const intent = typeof session.payment_intent === 'string' ? session.payment_intent : null;
        const existing = intent
          ? db.from('payments').select('id').eq('stripe_payment_intent', intent).limit(1)
          : db.from('payments').select('id').eq('booking_id', bookingId).eq('status', 'captured').limit(1);
        const { data: already, error: existingError } = await existing;
        if (existingError) return failed();

        if (!already || already.length === 0) {
          const amount = session.amount_total ?? booking?.price_cents ?? 0;
          const { error: insertError } = await db.from('payments').insert({
            booking_id: bookingId, parent_id: booking?.parent_id, trainer_id: booking?.trainer_id,
            amount_cents: amount, platform_fee_cents: Math.round(amount * feeBps / 10000),
            currency: session.currency || booking?.currency || 'usd',
            stripe_payment_intent: intent,
            status: 'captured',
          });
          // 23505: a concurrent delivery recorded it first. That is the outcome we wanted.
          if (insertError && insertError.code !== '23505') return failed();
        }

        const { error: paidError } = await db.from('bookings').update({ paid_at: now().toISOString() }).eq('id', bookingId).is('paid_at', null);
        if (paidError) return failed();
      }
    }

    // Premium subscriptions: the subscription carries metadata.guardian_id, set at creation in stripe-subscribe,
    // so renewals and cancellations resolve the same way a first payment does.
    if (SUBSCRIPTION_EVENTS.includes(event.type)) {
      const subscription = event.data.object;
      const guardianId = subscription.metadata?.guardian_id;
      if (guardianId) {
        const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null;
        const { error } = await db.from('subscriptions').update({
          stripe_subscription_id: subscription.id,
          status: subscriptionStatus(subscription.status),
          current_period_end: periodEnd,
          updated_at: now().toISOString(),
        }).eq('guardian_id', guardianId);
        if (error) return failed();
      }
    }

    return reply(200, { received: true });
  };
}
