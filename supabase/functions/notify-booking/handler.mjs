// notify-booking — tells the other side of a trainer booking that something happened.
//
// The logic lives here, apart from the Deno entry point, so it runs under Node's test runner
// (tests/notify-booking-function.test.cjs). The marketplace is switched off in the app, but the function is deployed
// and any signed-in account can call it, so it enforces its own rules:
//
//   - only the two people on the booking may send;
//   - each kind has a sender. Only the parent requests or reports payment; only the trainer confirms, declines or
//     completes; either may say there is a new message. Before this, either side could send any kind, so a trainer
//     could tell a parent "Payment received" or a parent could tell a trainer "Booking confirmed";
//   - the message is always one of the fixed lines below, never text from the request, and an unknown kind sends
//     nothing (it used to send a generic line to the other party);
//   - runtime error text is not echoed to the caller.
//
// Still true and recorded, not fixed: "paid" is reported by the parent's browser on return from Checkout, not by
// Stripe. The line only says a payment is complete; stripe-webhook is what records it.

import { sendPush } from '../_shared/native-push.mjs';

export const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

// Which side of the booking may send each kind.
export const SENDER = Object.freeze({
  new_request: 'parent', paid: 'parent',
  confirmed: 'trainer', declined: 'trainer', completed: 'trainer',
  message: 'either',
});

export function bookingMessage(kind, { childName, trainerName, serviceTitle }) {
  return {
    new_request: ['New booking request', childName + ' requested ' + serviceTitle],
    confirmed: ['Booking confirmed', trainerName + ' confirmed your session'],
    declined: ['Booking update', trainerName + ' could not take this session'],
    completed: ['Session completed', 'Tap to leave a review for ' + trainerName],
    paid: ['Payment received', 'Payment for ' + serviceTitle + ' is complete'],
    message: ['New message', 'You have a new message'],
  }[kind];
}

export function createNotifyBookingHandler({ callerClient, db, push, native = null, env = {} } = {}) {
  if (typeof callerClient !== 'function' || !db || !push) throw new TypeError('createNotifyBookingHandler needs callerClient, db and push');

  return async function handle(req) {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    try {
      const caller = callerClient(req.headers.get('Authorization') || '');
      const { data: { user } } = await caller.auth.getUser();
      if (!user) return json({ error: 'unauthorized' }, 401);

      const body = await req.json().catch(() => ({}));
      const bookingId = body?.booking_id;
      const kind = body?.kind;
      if (!bookingId || !Object.hasOwn(SENDER, kind || '')) return json({ error: 'bad request' }, 400);

      const { data: booking } = await db.from('bookings')
        .select('parent_id,trainer_id,child_shared, services(title), trainer_profiles(display_name)')
        .eq('id', bookingId).maybeSingle();
      if (!booking) return json({ error: 'not found' }, 404);
      const role = user.id === booking.parent_id ? 'parent' : user.id === booking.trainer_id ? 'trainer' : null;
      if (!role) return json({ error: 'forbidden' }, 403);
      if (SENDER[kind] !== 'either' && SENDER[kind] !== role) return json({ error: 'forbidden' }, 403);

      const recipient = role === 'parent' ? booking.trainer_id : booking.parent_id;
      const [title, text] = bookingMessage(kind, {
        childName: booking.child_shared?.first_name || 'your athlete',
        trainerName: booking.trainer_profiles?.display_name || 'the trainer',
        serviceTitle: booking.services?.title || 'a session',
      });

      const { data: subscriptions } = await db.from('push_subscriptions').select('*').eq('user_id', recipient);
      push.setVapidDetails(env.VAPID_SUBJECT || 'mailto:support@playbookbp.com', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
      let sent = 0;
      for (const subscription of subscriptions || []) {
        try {
          await sendPush({ push, native }, subscription, { title, body: text, url: '/' });
          sent++;
        } catch (error) {
          if (error?.statusCode === 404 || error?.statusCode === 410) await db.from('push_subscriptions').delete().eq('id', subscription.id);
        }
      }
      return json({ sent });
    } catch {
      return json({ error: 'internal_error' }, 500);
    }
  };
}
