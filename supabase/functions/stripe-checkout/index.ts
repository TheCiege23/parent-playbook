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
    const appUrl = Deno.env.get('APP_URL') || 'https://playbook.chimaura.com';

    const { booking_id } = await req.json();
    const { data: bk } = await svc.from('bookings')
      .select('id,parent_id,trainer_id,price_cents,currency,status,paid_at, services(title)')
      .eq('id', booking_id).maybeSingle();
    if (!bk || bk.parent_id !== user.id) return json({ error: 'Booking not found' }, 404);
    if (bk.paid_at) return json({ error: 'Already paid' }, 400);
    if (bk.status !== 'confirmed') return json({ error: 'Booking is not confirmed yet' }, 400);

    const { data: tp } = await svc.from('trainer_profiles').select('stripe_account_id').eq('id', bk.trainer_id).maybeSingle();
    if (!tp?.stripe_account_id) return json({ error: 'Trainer has not set up payouts yet' }, 400);

    const feeBps = parseInt(Deno.env.get('PLATFORM_FEE_BPS') || '1500', 10);
    const amount = bk.price_cents || 0;
    const fee = Math.round(amount * feeBps / 10000);
    const title = (bk as any).services?.title || 'Training session';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price_data: { currency: bk.currency || 'usd', product_data: { name: title }, unit_amount: amount }, quantity: 1 }],
      payment_intent_data: { application_fee_amount: fee, transfer_data: { destination: tp.stripe_account_id } },
      success_url: appUrl + '/?paid=' + booking_id,
      cancel_url: appUrl + '/?paycancel=' + booking_id,
      metadata: { booking_id },
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 400);
  }
});
