// notify-trainer-review — tells a Pro Trainer applicant that a review decision landed.
//
// Before this, "Request more info" wrote a note into an admin-only table and the applicant only found out anything
// by happening to open the app. The queue stalled on people who had no idea they had been asked for something.
//
// The logic lives here, apart from the Deno entry point, so it runs under Node's test runner
// (tests/notify-trainer-review-function.test.cjs). Only an admin may announce a decision, checked against
// app_admins with the service role rather than anything the caller sent. The messages are deliberately vague about
// negative outcomes: a push notification lands on a lock screen other people can read, and the detail belongs
// behind the login. Runtime error text is no longer echoed to the caller.

export const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

export const REVIEW_MESSAGES = Object.freeze({
  needs_info: ['We need one more thing', 'Open Parent Playbook to see what to update.'],
  approved: ['You\'re approved 🎉', 'Your trainer profile is live. Next: services and payouts.'],
  reinstated: ['Your profile is live again', 'Your listing has been reinstated.'],
  rejected: ['Application update', 'There\'s an update on your application.'],
  suspended: ['Your profile is paused', 'Your listing is temporarily unlisted.'],
});

export function createNotifyTrainerReviewHandler({ callerClient, db, push, env = {} } = {}) {
  if (typeof callerClient !== 'function' || !db || !push) throw new TypeError('createNotifyTrainerReviewHandler needs callerClient, db and push');

  return async function handle(req) {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    try {
      const caller = callerClient(req.headers.get('Authorization') || '');
      const { data: { user } } = await caller.auth.getUser();
      if (!user) return json({ error: 'unauthorized' }, 401);

      const { data: admin } = await db.from('app_admins').select('guardian_id').eq('guardian_id', user.id).maybeSingle();
      if (!admin) return json({ error: 'forbidden' }, 403);

      const body = await req.json().catch(() => ({}));
      const trainerId = body?.trainer_id;
      const kind = body?.kind;
      if (!trainerId || !Object.hasOwn(REVIEW_MESSAGES, kind || '')) return json({ error: 'bad request' }, 400);

      // Confirm the trainer exists before pushing at whatever id we were handed.
      const { data: profile } = await db.from('trainer_profiles').select('id').eq('id', trainerId).maybeSingle();
      if (!profile) return json({ error: 'not found' }, 404);

      const [title, text] = REVIEW_MESSAGES[kind];
      const { data: subscriptions } = await db.from('push_subscriptions').select('*').eq('user_id', trainerId);
      push.setVapidDetails(env.VAPID_SUBJECT || 'mailto:support@playbookbp.com', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

      let sent = 0;
      for (const subscription of subscriptions || []) {
        try {
          await push.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({ title, body: text, url: '/' }));
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
