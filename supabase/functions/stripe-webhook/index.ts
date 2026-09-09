import Stripe from 'npm:stripe@16';
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text();
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, Deno.env.get('STRIPE_WEBHOOK_SECRET')!);
  } catch (e) {
    return new Response('Bad signature: ' + String((e as Error)?.message || e), { status: 400 });
  }
  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as Stripe.Checkout.Session;
    const bookingId = s.metadata?.booking_id;
    if (bookingId) {
      const { data: bk } = await svc.from('bookings').select('parent_id,trainer_id,price_cents,currency').eq('id', bookingId).maybeSingle();
      const feeBps = parseInt(Deno.env.get('PLATFORM_FEE_BPS') || '1500', 10);
      const amount = s.amount_total ?? bk?.price_cents ?? 0;
      await svc.from('payments').insert({
        booking_id: bookingId, parent_id: bk?.parent_id, trainer_id: bk?.trainer_id,
        amount_cents: amount, platform_fee_cents: Math.round(amount * feeBps / 10000),
        currency: (s.currency || bk?.currency || 'usd'),
        stripe_payment_intent: (typeof s.payment_intent === 'string' ? s.payment_intent : null),
        status: 'captured',
      });
      await svc.from('bookings').update({ paid_at: new Date().toISOString() }).eq('id', bookingId);
    }
  }

  // Premium subscriptions (item 8): the subscription object itself carries
  // metadata.guardian_id (set at creation in stripe-subscribe), so renewals and
  // cancellations resolve the same way a first payment does — no session lookup needed.
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const guardianId = sub.metadata?.guardian_id;
    if (guardianId) {
      const periodEnd = (sub as any).current_period_end ? new Date((sub as any).current_period_end * 1000).toISOString() : null;
      await svc.from('subscriptions').update({
        stripe_subscription_id: sub.id,
        status: sub.status === 'active' || sub.status === 'trialing' ? 'active' : (sub.status === 'past_due' ? 'past_due' : 'canceled'),
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      }).eq('guardian_id', guardianId);
    }
  }

  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
});
