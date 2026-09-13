// stripe-checkout: the Deno entry point. What it checks before opening Checkout is in handler.mjs.
import Stripe from 'npm:stripe@16';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createStripeCheckoutHandler } from './handler.mjs';

const URL = Deno.env.get('SUPABASE_URL')!;
// The publishable key, not the legacy anon JWT: it only creates a client carrying the caller's own
// Authorization header. It is public by design and already ships in js/core.js.
const PUBLISHABLE = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? 'sb_publishable_JKSj0ngr9nwq-YmX7yncpg_8xk2i2vJ';

Deno.serve(createStripeCheckoutHandler({
  callerClient: (auth: string) => createClient(URL, PUBLISHABLE, { global: { headers: { Authorization: auth } } }),
  db: createClient(URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
  stripe: new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' }),
  appUrl: Deno.env.get('APP_URL') || 'https://playbookbp.com',
  feeBps: parseInt(Deno.env.get('PLATFORM_FEE_BPS') || '1500', 10),
}));
