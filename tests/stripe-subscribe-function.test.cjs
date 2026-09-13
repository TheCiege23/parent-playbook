// stripe-subscribe opens Checkout for premium, the paid path that is live in the app. What must not happen:
// charging a guardian who is already premium, a second Stripe customer from a double click, a price bucket that
// changes between visits, or a Checkout session for a guardian whose subscription row was never saved, since
// the webhook would then have nothing to mark active. The logic now lives in handler.mjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakeSupabase, callerAs } = require('./support/fake-supabase.cjs');

const dir = path.join(__dirname, '../supabase/functions/stripe-subscribe');
const load = () => import(pathToFileURL(path.join(dir, 'handler.mjs')).href);
const GUARDIAN = { id: 'aaaaaaaa-0000-4000-8000-00000000000a', email: 'synthetic-guardian@example.invalid' };
const PRICES = { a: 'price_a', b: 'price_b', c: 'price_c' };
const expectedBucket = id => ['a', 'b', 'c'][crypto.createHash('sha256').update(id).digest()[0] % 3];

const post = () => new Request('https://project.supabase.co/functions/v1/stripe-subscribe', { method: 'POST', headers: { Authorization: 'Bearer user-token' }, body: '{}' });
function fakeStripe() {
  const calls = [];
  return {
    calls,
    customers: { create: async (params, options) => { calls.push(['customer', params, options]); return { id: 'cus_synthetic' }; } },
    checkout: { sessions: { create: async params => { calls.push(['session', params]); return { url: 'https://checkout.stripe.test/s/premium' }; } } },
  };
}

test('a new guardian gets a stable bucket, one customer, a saved row, then Checkout carrying their id', async () => {
  const { createStripeSubscribeHandler, priceBucket } = await load();
  const bucket = expectedBucket(GUARDIAN.id);
  assert.equal(await priceBucket(GUARDIAN.id), bucket, 'the bucket must match js/core.js and stay stable');

  const db = fakeSupabase({ subscriptions: [] });
  const stripe = fakeStripe();
  const res = await createStripeSubscribeHandler({ callerClient: callerAs(GUARDIAN), db, stripe, prices: PRICES, appUrl: 'https://playbookbp.com' })(post());
  assert.equal(res.status, 200);
  assert.deepEqual(stripe.calls[0], ['customer', { email: GUARDIAN.email, metadata: { guardian_id: GUARDIAN.id } }, { idempotencyKey: 'premium-customer-' + GUARDIAN.id }]);
  assert.deepEqual(db.tables.subscriptions, [{ guardian_id: GUARDIAN.id, price_bucket: bucket, stripe_customer_id: 'cus_synthetic', status: 'inactive' }]);
  const [, session] = stripe.calls[1];
  assert.equal(session.line_items[0].price, PRICES[bucket]);
  assert.deepEqual(session.subscription_data, { metadata: { guardian_id: GUARDIAN.id } }, 'the webhook resolves renewals from this');
  assert.equal(session.customer, 'cus_synthetic');
});

test('a returning guardian keeps their bucket and customer, and an active one is not charged again', async () => {
  const { createStripeSubscribeHandler } = await load();
  const returning = fakeSupabase({ subscriptions: [{ guardian_id: GUARDIAN.id, price_bucket: 'c', stripe_customer_id: 'cus_existing', status: 'canceled' }] });
  const stripe = fakeStripe();
  await createStripeSubscribeHandler({ callerClient: callerAs(GUARDIAN), db: returning, stripe, prices: PRICES })(post());
  assert.deepEqual(stripe.calls.map(call => call[0]), ['session'], 'no second customer');
  assert.equal(stripe.calls[0][1].line_items[0].price, 'price_c');
  assert.deepEqual(returning.log, []);

  const active = fakeSupabase({ subscriptions: [{ guardian_id: GUARDIAN.id, price_bucket: 'a', stripe_customer_id: 'cus_existing', status: 'active' }] });
  const refused = fakeStripe();
  const res = await createStripeSubscribeHandler({ callerClient: callerAs(GUARDIAN), db: active, stripe: refused, prices: PRICES })(post());
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Already premium');
  assert.deepEqual(refused.calls, []);

  const noCustomer = fakeSupabase({ subscriptions: [{ guardian_id: GUARDIAN.id, price_bucket: 'b', stripe_customer_id: null, status: 'inactive' }] });
  await createStripeSubscribeHandler({ callerClient: callerAs(GUARDIAN), db: noCustomer, stripe: fakeStripe(), prices: PRICES })(post());
  assert.equal(noCustomer.tables.subscriptions[0].stripe_customer_id, 'cus_synthetic');
});

test('a subscription row that cannot be saved stops before Checkout opens', async () => {
  const { createStripeSubscribeHandler } = await load();
  for (const [tables, failure] of [
    [{ subscriptions: [] }, 'insert:subscriptions'],
    [{ subscriptions: [{ guardian_id: GUARDIAN.id, price_bucket: 'a', stripe_customer_id: null, status: 'inactive' }] }, 'update:subscriptions'],
    [{ subscriptions: [] }, 'select:subscriptions'],
  ]) {
    const db = fakeSupabase(tables, { errors: { [failure]: { code: '08006', message: 'connection failure' } } });
    const stripe = fakeStripe();
    const res = await createStripeSubscribeHandler({ callerClient: callerAs(GUARDIAN), db, stripe, prices: PRICES })(post());
    assert.equal(res.status, 500, failure);
    assert.ok(!stripe.calls.some(call => call[0] === 'session'), failure + ' must not open Checkout');
  }
});

test('no Checkout without a signed-in guardian or a configured price', async () => {
  const { createStripeSubscribeHandler } = await load();
  const stripe = fakeStripe();
  assert.equal((await createStripeSubscribeHandler({ callerClient: callerAs(null), db: fakeSupabase({ subscriptions: [] }), stripe, prices: PRICES })(post())).status, 401);
  const res = await createStripeSubscribeHandler({ callerClient: callerAs(GUARDIAN), db: fakeSupabase({ subscriptions: [] }), stripe, prices: {} })(post());
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'Pricing not configured');
  assert.deepEqual(stripe.calls, []);
});

test('the entry point uses the publishable key for the caller and adds no logic', () => {
  const entry = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  assert.match(entry, /import \{ createStripeSubscribeHandler \} from '\.\/handler\.mjs';/);
  assert.doesNotMatch(entry, /Deno\.env\.get\('SUPABASE_ANON_KEY'\)/);
  assert.match(entry, /createClient\(URL, PUBLISHABLE, \{ global: \{ headers: \{ Authorization: auth \} \} \}\)/);
  assert.doesNotMatch(entry, /\.from\(/);
});
