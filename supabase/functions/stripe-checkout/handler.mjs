// stripe-checkout: starts Stripe Checkout for a parent's confirmed booking with a trainer.
//
// The logic lives here, apart from the Deno entry point, so it runs under Node's test runner
// (tests/stripe-checkout-function.test.cjs). The marketplace is switched off in the app, but this function is
// deployed and any signed-in account can call it, so it checks everything itself: the caller owns the
// booking, the booking is confirmed, unpaid and priced, and the trainer can receive payouts. A malformed
// booking id is answered exactly like someone else's booking. Unexpected failures answer a plain 500 rather
// than echoing a Stripe or database message to the browser.

export const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createStripeCheckoutHandler({ callerClient, db, stripe, appUrl = 'https://playbookbp.com', feeBps = 1500 } = {}) {
  if (typeof callerClient !== 'function' || !db || !stripe) throw new TypeError('createStripeCheckoutHandler needs callerClient, db and stripe');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) throw new TypeError('feeBps must be an integer from 0 to 10000');

  return async function handle(req) {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    try {
      const caller = callerClient(req.headers.get('Authorization') || '');
      const { data: { user } } = await caller.auth.getUser();
      if (!user) return json({ error: 'unauthorized' }, 401);

      const body = await req.json().catch(() => ({}));
      const bookingId = body?.booking_id;
      if (typeof bookingId !== 'string' || !UUID.test(bookingId)) return json({ error: 'Booking not found' }, 404);

      const { data: booking, error: bookingError } = await db.from('bookings')
        .select('id,parent_id,trainer_id,price_cents,currency,status,paid_at, services(title)')
        .eq('id', bookingId).maybeSingle();
      if (bookingError) return json({ error: 'Could not start checkout' }, 500);
      if (!booking || booking.parent_id !== user.id) return json({ error: 'Booking not found' }, 404);
      if (booking.paid_at) return json({ error: 'Already paid' }, 400);
      if (booking.status !== 'confirmed') return json({ error: 'Booking is not confirmed yet' }, 400);
      const amount = booking.price_cents;
      if (!Number.isInteger(amount) || amount <= 0) return json({ error: 'Booking has no price' }, 400);

      const { data: trainer, error: trainerError } = await db.from('trainer_profiles').select('stripe_account_id').eq('id', booking.trainer_id).maybeSingle();
      if (trainerError) return json({ error: 'Could not start checkout' }, 500);
      if (!trainer?.stripe_account_id) return json({ error: 'Trainer has not set up payouts yet' }, 400);

      const fee = Math.round(amount * feeBps / 10000);
      const title = booking.services?.title || 'Training session';
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price_data: { currency: booking.currency || 'usd', product_data: { name: title }, unit_amount: amount }, quantity: 1 }],
        payment_intent_data: { application_fee_amount: fee, transfer_data: { destination: trainer.stripe_account_id } },
        success_url: appUrl + '/?paid=' + bookingId,
        cancel_url: appUrl + '/?paycancel=' + bookingId,
        metadata: { booking_id: bookingId },
      });
      return json({ url: session.url });
    } catch {
      return json({ error: 'Could not start checkout' }, 500);
    }
  };
}
