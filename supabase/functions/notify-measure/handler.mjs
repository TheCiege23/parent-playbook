// notify-measure — the monthly "stand them against the wall" nudge.
//
// The growth feature sits empty without it. A percentile needs one height; a percentile CROSSING, the part a doctor
// actually asks about, needs readings months apart, and nobody measures their child unprompted. Deliberately
// monthly: children do not visibly grow in a week, and a reminder that arrives before there is anything to see is
// how a parent learns to ignore the app.
//
// This is the lowest-priority message the product sends, so it yields to the others: a household that has had two
// or more messages this week does not get it. It goes only to people who can write a measurement (owner or
// co-parent), only for children the CDC stature reference covers (2 to 20, with a recorded sex), and only when the
// last height is more than 30 days old or missing.
//
// The logic lives here, apart from the Deno entry point, so it runs under Node's test runner
// (tests/notify-measure-function.test.cjs). Send policy is in ../_shared/push-policy.mjs.

import { isScheduler, bearerOf, inQuietHours, localHour, weeklyCounts, optedOut, namesByGuardian, joinNames, deliver, vapidMissing } from '../_shared/push-policy.mjs';

export const CAP_HEADROOM = 2;
export const STALE_DAYS = 30;

// No guilt, no streak, no "you haven't...". A two-minute job with the honest reason attached.
export function measureMessage(names) {
  if (!names.length) return null;
  if (names.length === 1) return [`Time to measure ${names[0]}?`, 'Takes a minute against a door frame. Two readings is what makes a trend.'];
  return ['Time for a measure-up?', `${joinNames(names)} are both due. A minute each against a door frame.`];
}

const unique = values => [...new Set(values)];

export function createNotifyMeasureHandler({ db, push, env = {}, now = () => new Date() } = {}) {
  if (!db || !push) throw new TypeError('createNotifyMeasureHandler needs db and push');

  return async function handle(req) {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    try {
      if (!isScheduler(bearerOf(req), env.SERVICE_KEY)) return json({ error: 'forbidden' }, 403);
      const params = new URL(req.url).searchParams;
      const dry = params.get('dry') === '1';
      const force = params.get('force') === '1';
      const at = now();
      if (!dry && !force && inQuietHours(at)) return json({ ok: true, skipped: 'quiet_hours', hour: localHour(at) });

      // Only athletes a growth read can do something with: the percentile needs a sex, and the reference spans 2 to 20.
      const { data: children, error } = await db.from('athletes')
        .select('id, first_name, family_id, birthdate, sex_at_birth')
        .not('sex_at_birth', 'is', null)
        .not('birthdate', 'is', null);
      if (error) return json({ error: 'could not read athletes' }, 500);

      const cutoff = new Date(at.getTime() - STALE_DAYS * 86400000).toISOString().slice(0, 10);
      const eligible = [];
      for (const child of children || []) {
        const age = (at.getTime() - new Date(child.birthdate + 'T00:00:00Z').getTime()) / (365.25 * 86400000);
        if (age < 2 || age > 20) continue;
        const { data: last } = await db.from('measurements')
          .select('measured_on').eq('athlete_id', child.id).eq('metric_key', 'height')
          .order('measured_on', { ascending: false }).limit(1);
        const lastOn = last && last[0] ? last[0].measured_on : null;
        if (!lastOn || lastOn < cutoff) eligible.push(child);
      }
      if (!eligible.length) return json({ ok: true, candidates: (children || []).length, due: 0, sent: 0 });

      const familyIds = unique(eligible.map(child => child.family_id));
      const { data: memberships } = await db.from('family_members').select('guardian_id, family_id, role').in('family_id', familyIds);
      // Only people who can write a measurement. Nudging family view to do something row-level security will refuse is
      // worse than staying quiet.
      const writers = (memberships || []).filter(m => m.role === 'owner' || m.role === 'co_parent');
      const guardianIds = unique(writers.map(m => m.guardian_id));
      if (!guardianIds.length) return json({ ok: true, due: eligible.length, sent: 0, note: 'no writers' });

      const { data: subscriptions } = await db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', guardianIds);
      if (!subscriptions || !subscriptions.length) return json({ ok: true, due: eligible.length, subscriptions: 0, sent: 0 });

      // Rides the weekly preference, like notify-daily.
      const declined = await optedOut(db, guardianIds, 'weekly');
      const names = namesByGuardian(writers, eligible);

      const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
      if (!dry && vapidMissing(vapid)) return json({ error: 'VAPID keys are not configured', sent: 0 }, 500);

      // Headroom rather than the plain cap. An unreadable log yields nothing: it fails open like the cap.
      const counts = (await weeklyCounts(db, unique(subscriptions.map(s => s.user_id)), at)) || {};
      const tally = await deliver({
        db, push, subscriptions, dry, url: '/#growth', kind: 'measure', vapid,
        skip: id => ((counts[id] || 0) >= CAP_HEADROOM ? 'yielded' : declined.has(id) ? 'opted_out' : null),
        message: id => measureMessage(names.get(id) || []),
      });
      return json({ ok: true, dry, candidates: (children || []).length, due: eligible.length, subscriptions: subscriptions.length, ...tally });
    } catch {
      return json({ error: 'internal_error' }, 500);
    }
  };
}
