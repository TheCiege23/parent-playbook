// notify-weekly — the Sunday "your week is ready" nudge.
//
// A training app you have to remember to open is a training app you stop opening. This is the one message that
// brings a parent back, so it is deliberately quiet: once a week, one line, no badges, no streak-shaming,
// nothing urgent. It does NOT recompute the training plan; buildProgram lives in the browser, and a second
// engine here would drift until the message described a week the app does not show. It says only what the
// database can prove: whose plan is ready. Called by pg_cron, never by a person.
//
// The logic lives here, apart from the Deno entry point, so it runs under Node's test runner
// (tests/notify-weekly-function.test.cjs). Send policy is in ../_shared/push-policy.mjs.
//
// Fixed here: this function ignored notification_prefs.weekly. That column is the "week ahead" switch in
// Account & settings, and notify-daily and notify-measure already treat it as the parent's answer to routine
// reminders, so the one message it is named for kept arriving after a parent turned it off.

import { isScheduler, bearerOf, inQuietHours, localHour, overCap, optedOut, namesByGuardian, joinNames, deliver, vapidMissing } from '../_shared/push-policy.mjs';

export function weeklyMessage(names) {
  // Nobody gets nagged about an account they never finished setting up.
  if (!names.length) return null;
  if (names.length === 1) return [`${names[0]}'s week is ready`, 'Tap to see this week\'s plan.'];
  return ['This week\'s plans are ready', `${joinNames(names)} — tap to see them.`];
}

const unique = values => [...new Set(values)];

export function createNotifyWeeklyHandler({ db, push, env = {}, now = () => new Date() } = {}) {
  if (!db || !push) throw new TypeError('createNotifyWeeklyHandler needs db and push');

  return async function handle(req) {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    try {
      if (!isScheduler(bearerOf(req), env.SERVICE_KEY)) return json({ error: 'forbidden' }, 403);
      const params = new URL(req.url).searchParams;
      const dry = params.get('dry') === '1';
      const force = params.get('force') === '1';
      const at = now();
      if (!dry && !force && inQuietHours(at)) return json({ ok: true, skipped: 'quiet_hours', hour: localHour(at) });

      const { data: subscriptions, error } = await db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth');
      if (error) return json({ error: 'could not read push subscriptions' }, 500);
      if (!subscriptions || !subscriptions.length) return json({ ok: true, subscriptions: 0, sent: 0 });

      const guardianIds = unique(subscriptions.map(s => s.user_id));
      const { data: memberships } = await db.from('family_members').select('guardian_id, family_id').in('guardian_id', guardianIds);
      const familyIds = unique((memberships || []).map(m => m.family_id));
      const { data: children } = familyIds.length
        ? await db.from('athletes').select('first_name, family_id').in('family_id', familyIds)
        : { data: [] };
      const names = namesByGuardian(memberships, children);

      const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
      // A dry run exercises the data path without keys, so the logic is testable before secrets exist.
      if (!dry && vapidMissing(vapid)) return json({ error: 'VAPID keys are not configured for edge functions', sent: 0 }, 500);

      const capped = await overCap(db, guardianIds, at);
      const declined = await optedOut(db, guardianIds, 'weekly');
      const tally = await deliver({
        db, push, subscriptions, dry, url: '/#week', kind: 'weekly', vapid,
        skip: id => (capped.has(id) ? 'capped' : declined.has(id) ? 'opted_out' : null),
        message: id => weeklyMessage(names.get(id) || []),
      });
      return json({ ok: true, dry, subscriptions: subscriptions.length, ...tally });
    } catch {
      return json({ error: 'internal_error' }, 500);
    }
  };
}
