// stripe-connect creates a trainer's Stripe payout account and returns its onboarding link. The marketplace is
// switched off in the app, but the function is deployed and callable, so it must act only for a trainer profile.
// And it must never leave a trainer with two Stripe accounts: before these tests, a failed save of the new
// account id was ignored, so the next attempt created another. The logic now lives in handler.mjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakeSupabase, callerAs } = require('./support/fake-supabase.cjs');

const dir = path.join(__dirname, '../supabase/functions/stripe-connect');
const load = () => import(pathToFileURL(path.join(dir, 'handler.mjs')).href);
const TRAINER = { id: 't1', email: 'synthetic-trainer@example.invalid' };

const post = () => new Request('https://project.supabase.co/functions/v1/stripe-connect', { method: 'POST', headers: { Authorization: 'Bearer user-token' }, body: '{}' });
function fakeStripe() {
  const calls = [];
  return {
    calls,
    accounts: { create: async (params, options) => { calls.push(['account', params, options]); return { id: 'acct_synthetic' }; } },
    accountLinks: { create: async params => { calls.push(['link', params]); return { url: 'https://connect.stripe.test/onboarding' }; } },
  };
}

test('a trainer without an account gets one, saved before the onboarding link is issued', async () => {
  const { createStripeConnectHandler } = await load();
  const db = fakeSupabase({ trainer_profiles: [{ id: 't1', stripe_account_id: null }] });
  const stripe = fakeStripe();
  const res = await createStripeConnectHandler({ callerClient: callerAs(TRAINER), db, stripe, appUrl: 'https://playbookbp.com' })(post());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { url: 'https://connect.stripe.test/onboarding' });
  assert.equal(stripe.calls[0][0], 'account');
  assert.deepEqual(stripe.calls[0][2], { idempotencyKey: 'express-account-t1' }, 'a retry must return the same Stripe account');
  assert.equal(db.tables.trainer_profiles[0].stripe_account_id, 'acct_synthetic');
  assert.deepEqual(stripe.calls[1], ['link', { account: 'acct_synthetic', refresh_url: 'https://playbookbp.com/?stripe=refresh', return_url: 'https://playbookbp.com/?stripe=return', type: 'account_onboarding' }]);
});

test('a trainer with an account resumes onboarding without a second account', async () => {
  const { createStripeConnectHandler } = await load();
  const db = fakeSupabase({ trainer_profiles: [{ id: 't1', stripe_account_id: 'acct_existing' }] });
  const stripe = fakeStripe();
  await createStripeConnectHandler({ callerClient: callerAs(TRAINER), db, stripe })(post());
  assert.deepEqual(stripe.calls.map(call => call[0]), ['link']);
  assert.equal(stripe.calls[0][1].account, 'acct_existing');
  assert.deepEqual(db.log, []);
});

test('an account id that cannot be saved stops before an onboarding link', async () => {
  const { createStripeConnectHandler } = await load();
  const db = fakeSupabase({ trainer_profiles: [{ id: 't1', stripe_account_id: null }] }, { errors: { 'update:trainer_profiles': { code: '08006', message: 'connection failure' } } });
  const stripe = fakeStripe();
  const res = await createStripeConnectHandler({ callerClient: callerAs(TRAINER), db, stripe })(post());
  assert.equal(res.status, 500);
  assert.ok(!stripe.calls.some(call => call[0] === 'link'));
  assert.ok(!(await res.text()).includes('connection failure'));
});

test('nobody but a signed-in trainer reaches Stripe', async () => {
  const { createStripeConnectHandler } = await load();
  const stripe = fakeStripe();
  assert.equal((await createStripeConnectHandler({ callerClient: callerAs(null), db: fakeSupabase({ trainer_profiles: [] }), stripe })(post())).status, 401);
  const parent = await createStripeConnectHandler({ callerClient: callerAs({ id: 'p1' }), db: fakeSupabase({ trainer_profiles: [] }), stripe })(post());
  assert.equal(parent.status, 400);
  assert.equal((await parent.json()).error, 'Not a trainer profile');
  assert.deepEqual(stripe.calls, []);
});

test('the entry point uses the publishable key for the caller and adds no logic', () => {
  const entry = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  assert.match(entry, /import \{ createStripeConnectHandler \} from '\.\/handler\.mjs';/);
  assert.doesNotMatch(entry, /Deno\.env\.get\('SUPABASE_ANON_KEY'\)/);
  assert.match(entry, /createClient\(URL, PUBLISHABLE, \{ global: \{ headers: \{ Authorization: auth \} \} \}\)/);
  assert.doesNotMatch(entry, /\.from\(/);
});
