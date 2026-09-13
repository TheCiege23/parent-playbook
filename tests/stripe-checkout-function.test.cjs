// stripe-checkout opens Stripe Checkout for a parent's booking. The marketplace is switched off in the app, but
// the function is deployed and any signed-in account can call it, so every check it makes has to hold on its
// own: ownership, confirmation, payment state, price, and a trainer who can be paid. Before these tests it also
// echoed Stripe's error text to the browser. The logic now lives in handler.mjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakeSupabase, callerAs } = require('./support/fake-supabase.cjs');

const dir = path.join(__dirname, '../supabase/functions/stripe-checkout');
const load = () => import(pathToFileURL(path.join(dir, 'handler.mjs')).href);
const BOOKING = '5b0c6f1e-7d2a-4c3b-9e8f-0a1b2c3d4e5f';
const PARENT = { id: 'p1', email: 'synthetic-parent@example.invalid' };

const post = body => new Request('https://project.supabase.co/functions/v1/stripe-checkout', {
  method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const world = (booking = {}, trainer = { id: 't1', stripe_account_id: 'acct_synthetic' }) => fakeSupabase({
  bookings: [{ id: BOOKING, parent_id: 'p1', trainer_id: 't1', price_cents: 10000, currency: 'usd', status: 'confirmed', paid_at: null, services: { title: 'Speed session' }, ...booking }],
  trainer_profiles: trainer ? [trainer] : [],
});
function fakeStripe({ fail } = {}) {
  const calls = [];
  return {
    calls,
    checkout: { sessions: { create: async params => { calls.push(params); if (fail) throw fail; return { url: 'https://checkout.stripe.test/s/1' }; } } },
  };
}

test('an owner\'s confirmed, unpaid booking opens Checkout with the platform fee sent to the trainer', async () => {
  const { createStripeCheckoutHandler } = await load();
  const stripe = fakeStripe();
  const res = await createStripeCheckoutHandler({ callerClient: callerAs(PARENT), db: world(), stripe, appUrl: 'https://playbookbp.com', feeBps: 1500 })(post({ booking_id: BOOKING }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { url: 'https://checkout.stripe.test/s/1' });
  assert.deepEqual(stripe.calls, [{
    mode: 'payment',
    line_items: [{ price_data: { currency: 'usd', product_data: { name: 'Speed session' }, unit_amount: 10000 }, quantity: 1 }],
    payment_intent_data: { application_fee_amount: 1500, transfer_data: { destination: 'acct_synthetic' } },
    success_url: 'https://playbookbp.com/?paid=' + BOOKING,
    cancel_url: 'https://playbookbp.com/?paycancel=' + BOOKING,
    metadata: { booking_id: BOOKING },
  }]);
});

test('no Checkout opens for a caller who is not signed in or does not own the booking', async () => {
  const { createStripeCheckoutHandler } = await load();
  for (const [user, body, status] of [
    [null, { booking_id: BOOKING }, 401],
    [{ id: 'someone-else' }, { booking_id: BOOKING }, 404],
    [PARENT, { booking_id: 'not-a-uuid' }, 404],
    [PARENT, {}, 404],
    [PARENT, { booking_id: '11111111-1111-4111-8111-111111111111' }, 404],
  ]) {
    const stripe = fakeStripe();
    const res = await createStripeCheckoutHandler({ callerClient: callerAs(user), db: world(), stripe })(post(body));
    assert.equal(res.status, status, JSON.stringify({ user, body }));
    assert.deepEqual(stripe.calls, []);
  }
});

test('a paid, unconfirmed or unpriced booking, or a trainer without payouts, is refused before Stripe', async () => {
  const { createStripeCheckoutHandler } = await load();
  for (const [db, message] of [
    [world({ paid_at: '2026-09-01T00:00:00Z' }), 'Already paid'],
    [world({ status: 'requested' }), 'Booking is not confirmed yet'],
    [world({ price_cents: 0 }), 'Booking has no price'],
    [world({ price_cents: null }), 'Booking has no price'],
    [world({}, { id: 't1', stripe_account_id: null }), 'Trainer has not set up payouts yet'],
    [world({}, null), 'Trainer has not set up payouts yet'],
  ]) {
    const stripe = fakeStripe();
    const res = await createStripeCheckoutHandler({ callerClient: callerAs(PARENT), db, stripe })(post({ booking_id: BOOKING }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, message);
    assert.deepEqual(stripe.calls, []);
  }
});

test('an unexpected Stripe or database failure answers a plain 500 without echoing its message', async () => {
  const { createStripeCheckoutHandler } = await load();
  const stripeDown = await createStripeCheckoutHandler({ callerClient: callerAs(PARENT), db: world(), stripe: fakeStripe({ fail: new Error('Invalid API Key provided: sk_live_****secret') }) })(post({ booking_id: BOOKING }));
  assert.equal(stripeDown.status, 500);
  assert.ok(!(await stripeDown.text()).includes('sk_live'));

  const dbDown = fakeSupabase({}, { errors: { 'select:bookings': { code: '08006', message: 'connection failure' } } });
  const res = await createStripeCheckoutHandler({ callerClient: callerAs(PARENT), db: dbDown, stripe: fakeStripe() })(post({ booking_id: BOOKING }));
  assert.equal(res.status, 500);
  assert.ok(!(await res.text()).includes('connection failure'));
});

test('the entry point uses the publishable key for the caller and adds no logic', () => {
  const entry = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  assert.match(entry, /import \{ createStripeCheckoutHandler \} from '\.\/handler\.mjs';/);
  assert.doesNotMatch(entry, /Deno\.env\.get\('SUPABASE_ANON_KEY'\)/);
  assert.match(entry, /createClient\(URL, PUBLISHABLE, \{ global: \{ headers: \{ Authorization: auth \} \} \}\)/);
  assert.doesNotMatch(entry, /\.from\(/);
});
