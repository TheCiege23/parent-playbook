import Stripe from 'npm:stripe@16';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

// Three price points, assigned once per guardian and kept stable. This is the whole
// point of item 8: a single fixed price can't tell you what the market will bear, so
// every new subscriber is deterministically bucketed into one of three, and the
// bucket rides along so conversion can be read back per price point later.
async function bucketFor(guardianId: string): Promise<'a'|'b'|'c'> {
  const enc = new TextEncoder().encode(guardianId);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const n = new Uint8Array(digest)[0];
  return (['a','b','c'] as const)[n % 3];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const auth = req.headers.get('Authorization') || '';
    const uc = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await uc.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);
    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
    const appUrl = Deno.env.get('APP_URL') || 'https://playbookbp.com';

    let { data: sub } = await svc.from('subscriptions').select('*').eq('guardian_id', user.id).maybeSingle();
    if (sub?.status === 'active') return json({ error: 'Already premium' }, 400);

    const bucket = sub?.price_bucket || await bucketFor(user.id);
    const priceId = { a: Deno.env.get('STRIPE_PRICE_BUCKET_A'), b: Deno.env.get('STRIPE_PRICE_BUCKET_B'), c: Deno.env.get('STRIPE_PRICE_BUCKET_C') }[bucket];
    if (!priceId) return json({ error: 'Pricing not configured' }, 500);

    let customerId = sub?.stripe_customer_id as string | null | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { guardian_id: user.id } });
      customerId = customer.id;
    }

    if (!sub) {
      await svc.from('subscriptions').insert({ guardian_id: user.id, price_bucket: bucket, stripe_customer_id: customerId, status: 'inactive' });
    } else if (!sub.stripe_customer_id) {
      await svc.from('subscriptions').update({ stripe_customer_id: customerId }).eq('guardian_id', user.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { guardian_id: user.id } },
      metadata: { guardian_id: user.id },
      success_url: appUrl + '/?premium=success',
      cancel_url: appUrl + '/?premium=cancel',
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 400);
  }
});
