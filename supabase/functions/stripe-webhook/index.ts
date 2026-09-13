// stripe-webhook: the Deno entry point. What it records, and why failures answer 500, is in handler.mjs.
import Stripe from 'npm:stripe@16';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createStripeWebhookHandler } from './handler.mjs';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

Deno.serve(createStripeWebhookHandler({
  verifyEvent: (body: string, signature: string) => stripe.webhooks.constructEventAsync(body, signature, webhookSecret),
  db: createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
  feeBps: parseInt(Deno.env.get('PLATFORM_FEE_BPS') || '1500', 10),
}));
