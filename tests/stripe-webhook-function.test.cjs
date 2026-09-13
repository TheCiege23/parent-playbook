// stripe-webhook records marketplace payments and premium subscription changes. Stripe delivers each event at
// least once, retries on anything but a 2xx, and does not promise order. Before these tests the function lost
// events whose database write failed, because it still answered 200, and recorded a payment again on every
// redelivery, because nothing checked. The logic now lives in handler.mjs; these tests run it with a stand-in
// signature verifier and an in-memory Supabase.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakeSupabase } = require('./support/fake-supabase.cjs');

const dir = path.join(__dirname, '../supabase/functions/stripe-webhook');
const load = () => import(pathToFileURL(path.join(dir, 'handler.mjs')).href);
const NOW = new Date('2026-09-13T12:00:00Z');

const delivery = (event, signature = 't=1,v1=synthetic') => new Request('https://project.supabase.co/functions/v1/stripe-webhook', {
  method: 'POST', headers: signature ? { 'stripe-signature': signature } : {}, body: JSON.stringify(event),
});
const trusting = async body => JSON.parse(body);
const checkout = (overrides = {}) => ({
  type: 'checkout.session.completed',
  data: { object: { metadata: { booking_id: 'b1' }, amount_total: 10000, currency: 'usd', payment_intent: 'pi_synthetic_1', ...overrides } },
});
const bookings = () => [{ id: 'b1', parent_id: 'p1', trainer_id: 't1', price_cents: 9000, currency: 'usd', paid_at: null }];

test('a missing or invalid signature is refused before anything is read or written, without echoing why', async () => {
  const { createStripeWebhookHandler } = await load();
  const db = fakeSupabase({ bookings: bookings() });
  let verified = 0;
  const handle = createStripeWebhookHandler({ db, verifyEvent: async () => { verified++; throw new Error('No signatures found matching the expected signature for payload: secret-detail'); } });

  const missing = await handle(delivery(checkout(), null));
  assert.equal(missing.status, 400);
  assert.equal(verified, 0, 'without a signature header the verifier is not even called');

  const invalid = await handle(delivery(checkout()));
  assert.equal(invalid.status, 400);
  assert.equal(await invalid.text(), 'Bad signature');
  assert.deepEqual(db.log, []);
});

test('a completed checkout records one captured payment with the platform fee, and marks the booking paid', async () => {
  const { createStripeWebhookHandler } = await load();
  const db = fakeSupabase({ bookings: bookings(), payments: [] });
  const res = await createStripeWebhookHandler({ db, verifyEvent: trusting, feeBps: 1500, now: () => NOW })(delivery(checkout()));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { received: true });
  assert.deepEqual(db.tables.payments, [{
    booking_id: 'b1', parent_id: 'p1', trainer_id: 't1', amount_cents: 10000, platform_fee_cents: 1500,
    currency: 'usd', stripe_payment_intent: 'pi_synthetic_1', status: 'captured',
  }]);
  assert.equal(db.tables.bookings[0].paid_at, NOW.toISOString());
});

test('a redelivered checkout records nothing twice and does not move the paid time', async () => {
  const { createStripeWebhookHandler } = await load();
  const db = fakeSupabase({ bookings: bookings(), payments: [] });
  const first = createStripeWebhookHandler({ db, verifyEvent: trusting, now: () => NOW });
  const later = createStripeWebhookHandler({ db, verifyEvent: trusting, now: () => new Date('2026-09-14T09:00:00Z') });
  assert.equal((await first(delivery(checkout()))).status, 200);
  assert.equal((await later(delivery(checkout()))).status, 200);
  assert.equal(db.tables.payments.length, 1, 'Stripe redelivers events; each payment is recorded once');
  assert.equal(db.tables.bookings[0].paid_at, NOW.toISOString(), 'the first paid time stands');

  // Without a payment intent, the booking's captured payment is the identity.
  const noIntent = fakeSupabase({ bookings: bookings(), payments: [] });
  const handle = createStripeWebhookHandler({ db: noIntent, verifyEvent: trusting, now: () => NOW });
  await handle(delivery(checkout({ payment_intent: null })));
  await handle(delivery(checkout({ payment_intent: null })));
  assert.equal(noIntent.tables.payments.length, 1);
});

test('a racing delivery that hits a unique violation counts as recorded, not as a failure', async () => {
  const { createStripeWebhookHandler } = await load();
  const db = fakeSupabase({ bookings: bookings(), payments: [] }, { errors: { 'insert:payments': { code: '23505', message: 'duplicate key value' } } });
  const res = await createStripeWebhookHandler({ db, verifyEvent: trusting, now: () => NOW })(delivery(checkout()));
  assert.equal(res.status, 200);
  assert.equal(db.tables.bookings[0].paid_at, NOW.toISOString());
});

test('any other database failure answers 500, so Stripe delivers the event again', async () => {
  const { createStripeWebhookHandler } = await load();
  for (const failure of ['select:bookings', 'select:payments', 'insert:payments', 'update:bookings']) {
    const db = fakeSupabase({ bookings: bookings(), payments: [] }, { errors: { [failure]: { code: '08006', message: 'connection failure' } } });
    const res = await createStripeWebhookHandler({ db, verifyEvent: trusting, now: () => NOW })(delivery(checkout()));
    assert.equal(res.status, 500, failure + ' must not be acknowledged');
    assert.ok(!(await res.text()).includes('connection failure'), 'the database message is not echoed to the caller');
  }
  const subscriptions = fakeSupabase({ subscriptions: [{ guardian_id: 'g1', status: 'inactive' }] }, { errors: { 'update:subscriptions': { code: '08006', message: 'x' } } });
  const sub = { type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active', metadata: { guardian_id: 'g1' } } } };
  assert.equal((await createStripeWebhookHandler({ db: subscriptions, verifyEvent: trusting })(delivery(sub))).status, 500);
});

test('subscription events set the guardian\'s status and period end, in the order they arrive', async () => {
  const { createStripeWebhookHandler, subscriptionStatus } = await load();
  assert.deepEqual(['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'].map(subscriptionStatus),
    ['active', 'active', 'past_due', 'canceled', 'canceled', 'canceled', 'canceled', 'canceled']);

  const db = fakeSupabase({ subscriptions: [{ guardian_id: 'g1', status: 'inactive' }] });
  const handle = createStripeWebhookHandler({ db, verifyEvent: trusting, now: () => NOW });
  const event = (type, status) => ({ type, data: { object: { id: 'sub_1', status, current_period_end: 1790000000, metadata: { guardian_id: 'g1' } } } });

  await handle(delivery(event('customer.subscription.created', 'active')));
  assert.deepEqual(db.tables.subscriptions[0], {
    guardian_id: 'g1', status: 'active', stripe_subscription_id: 'sub_1',
    current_period_end: new Date(1790000000 * 1000).toISOString(), updated_at: NOW.toISOString(),
  });

  // Pinned, not endorsed: a late "updated" after a "deleted" wins, because arrival order is applied as-is.
  // Fixing it needs the event time stored beside the subscription, which is a schema change.
  await handle(delivery(event('customer.subscription.deleted', 'canceled')));
  await handle(delivery(event('customer.subscription.updated', 'active')));
  assert.equal(db.tables.subscriptions[0].status, 'active');
});

test('events with nothing to record are acknowledged without a write', async () => {
  const { createStripeWebhookHandler } = await load();
  const db = fakeSupabase({ bookings: bookings(), subscriptions: [{ guardian_id: 'g1', status: 'inactive' }] });
  const handle = createStripeWebhookHandler({ db, verifyEvent: trusting });
  for (const event of [
    { type: 'invoice.paid', data: { object: {} } },
    checkout({ metadata: { guardian_id: 'g1' } }), // a premium checkout carries no booking
    { type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active', metadata: {} } } },
  ]) {
    assert.equal((await handle(delivery(event))).status, 200);
  }
  assert.deepEqual(db.log, []);
});

test('the entry point verifies with Stripe\'s own verifier and adds no logic', () => {
  const entry = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  assert.match(entry, /import \{ createStripeWebhookHandler \} from '\.\/handler\.mjs';/);
  assert.match(entry, /stripe\.webhooks\.constructEventAsync\(body, signature, webhookSecret\)/);
  assert.doesNotMatch(entry, /\.from\(/);
});
