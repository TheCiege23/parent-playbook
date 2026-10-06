// stripe-subscribe: starts Stripe Checkout for a guardian's premium subscription.
//
// The logic lives here, apart from the Deno entry point, so it runs under Node's test runner
// (tests/stripe-subscribe-function.test.cjs).
//
// Three price points are assigned once per guardian and kept stable. A single fixed price can't tell you what
// the market will bear, so every new subscriber is deterministically bucketed into one of three, and the
// bucket rides along so conversion can be read back per price point later. js/core.js computes the same
// bucket in the browser.
//
// Two things the earlier version did not: the Stripe customer is created with an idempotency key, so a double
// click or a retry does not leave a second customer; and a failed save of the subscription row stops before
// Checkout opens. Otherwise a guardian could pay for a subscription whose webhook has no row to update.

import { stripeReturnBase } from '../_shared/stripe-return.mjs';

export const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

export async function priceBucket(guardianId) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(guardianId));
  return ['a', 'b', 'c'][new Uint8Array(digest)[0] % 3];
}

export function createStripeSubscribeHandler({ callerClient, db, stripe, prices = {}, appUrl = 'https://playbookbp.com' } = {}) {
  if (typeof callerClient !== 'function' || !db || !stripe) throw new TypeError('createStripeSubscribeHandler needs callerClient, db and stripe');

  return async function handle(req) {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    try {
      const caller = callerClient(req.headers.get('Authorization') || '');
      const { data: { user } } = await caller.auth.getUser();
      if (!user) return json({ error: 'unauthorized' }, 401);
      const back = stripeReturnBase(appUrl, await req.json().catch(() => ({})));

      const { data: sub, error: subError } = await db.from('subscriptions').select('*').eq('guardian_id', user.id).maybeSingle();
      if (subError) return json({ error: 'Could not start the subscription' }, 500);
      if (sub?.status === 'active') return json({ error: 'Already premium' }, 400);

      const bucket = sub?.price_bucket || await priceBucket(user.id);
      const priceId = prices[bucket];
      if (!priceId) return json({ error: 'Pricing not configured' }, 500);

      let customerId = sub?.stripe_customer_id || null;
      if (!customerId) {
        const customer = await stripe.customers.create(
          { email: user.email, metadata: { guardian_id: user.id } },
          { idempotencyKey: 'premium-customer-' + user.id },
        );
        customerId = customer.id;
      }

      if (!sub) {
        const { error } = await db.from('subscriptions').insert({ guardian_id: user.id, price_bucket: bucket, stripe_customer_id: customerId, status: 'inactive' });
        if (error) return json({ error: 'Could not start the subscription' }, 500);
      } else if (!sub.stripe_customer_id) {
        const { error } = await db.from('subscriptions').update({ stripe_customer_id: customerId }).eq('guardian_id', user.id);
        if (error) return json({ error: 'Could not start the subscription' }, 500);
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: { metadata: { guardian_id: user.id } },
        metadata: { guardian_id: user.id },
        success_url: back + '?premium=success',
        cancel_url: back + '?premium=cancel',
      });
      return json({ url: session.url });
    } catch {
      return json({ error: 'Could not start the subscription' }, 500);
    }
  };
}
