// stripe-connect: creates, or resumes, a trainer's Stripe Express payout account and returns its onboarding link.
//
// The logic lives here, apart from the Deno entry point, so it runs under Node's test runner
// (tests/stripe-connect-function.test.cjs). The marketplace is switched off in the app, but this function is
// deployed and callable by any signed-in account, so it acts only for an existing trainer profile.
//
// The earlier version ignored a failed save of the new account id. The next attempt then found no account and
// created a second Stripe account for the same trainer. Now the account is created with an idempotency key,
// so a retry returns the same one, and a failed save answers 500 before any onboarding link is issued.

import { stripeReturnBase } from '../_shared/stripe-return.mjs';

export const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

export function createStripeConnectHandler({ callerClient, db, stripe, appUrl = 'https://playbookbp.com' } = {}) {
  if (typeof callerClient !== 'function' || !db || !stripe) throw new TypeError('createStripeConnectHandler needs callerClient, db and stripe');

  return async function handle(req) {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    try {
      const caller = callerClient(req.headers.get('Authorization') || '');
      const { data: { user } } = await caller.auth.getUser();
      if (!user) return json({ error: 'unauthorized' }, 401);
      const back = stripeReturnBase(appUrl, await req.json().catch(() => ({})));

      const { data: profile, error: profileError } = await db.from('trainer_profiles').select('id,stripe_account_id').eq('id', user.id).maybeSingle();
      if (profileError) return json({ error: 'Could not start payout setup' }, 500);
      if (!profile) return json({ error: 'Not a trainer profile' }, 400);

      let account = profile.stripe_account_id || null;
      if (!account) {
        const created = await stripe.accounts.create({
          type: 'express', country: 'US',
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          business_type: 'individual', metadata: { guardian_id: user.id },
        }, { idempotencyKey: 'express-account-' + user.id });
        account = created.id;
        const { error: saveError } = await db.from('trainer_profiles').update({ stripe_account_id: account }).eq('id', user.id);
        if (saveError) return json({ error: 'Could not save the payout account; try again' }, 500);
      }

      const link = await stripe.accountLinks.create({
        account,
        refresh_url: back + '?stripe=refresh',
        return_url: back + '?stripe=return',
        type: 'account_onboarding',
      });
      return json({ url: link.url });
    } catch {
      return json({ error: 'Could not start payout setup' }, 500);
    }
  };
}
