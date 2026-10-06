// notify-daily — the afternoon nudge, 4:12pm: after school, before dinner.
//
// Design handoff, platform §6. The rule that shapes this function is "nothing on rest days — silence is the
// message". Whether today is a rest day is decided by buildProgram, which lives in the BROWSER; a second engine
// here would drift. So this computes nothing: the client publishes which day indexes are nudge-able into
// week_plan_days after every week render, and this reads them. A household that has not opened the app this week
// has no row and gets silence, which is correct.
//
// The logic lives here, apart from the Deno entry point, so it runs under Node's test runner
// (tests/notify-daily-function.test.cjs). Send policy is in ../_shared/push-policy.mjs.

import { isScheduler, bearerOf, inQuietHours, localHour, overCap, optedOut, namesByGuardian, joinNames, deliver, vapidMissing } from '../_shared/push-policy.mjs';

// Mon=0 … Sun=6, matching DAY_LABELS in program.js.
export const mondayFirst = date => (date.getUTCDay() + 6) % 7;
const isoDay = date => date.toISOString().slice(0, 10);
export function mondayOf(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - mondayFirst(day));
  return isoDay(day);
}

// No guilt, no streak warnings, no comparison. Screen 4 of the design is an explicit do-not-build list and this is
// the message it guards.
export function dailyMessage(names) {
  if (!names.length) return null;
  if (names.length === 1) return [`${names[0]} has something short today`, 'Tap to see it — it takes about ten minutes.'];
  return ['Something short today', `${joinNames(names)} both have a session. Tap to see them.`];
}

const unique = values => [...new Set(values)];

export function createNotifyDailyHandler({ db, push, native = null, env = {}, now = () => new Date() } = {}) {
  if (!db || !push) throw new TypeError('createNotifyDailyHandler needs db and push');

  return async function handle(req) {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    try {
      if (!isScheduler(bearerOf(req), env.SERVICE_KEY)) return json({ error: 'forbidden' }, 403);
      const params = new URL(req.url).searchParams;
      const dry = params.get('dry') === '1';
      const force = params.get('force') === '1';
      const at = now();
      if (!dry && !force && inQuietHours(at)) return json({ ok: true, skipped: 'quiet_hours', hour: localHour(at) });

      const forParam = params.get('for');
      const today = forParam ? new Date(forParam + 'T12:00:00Z') : at;
      if (isNaN(today.getTime())) return json({ error: 'bad ?for= date' }, 400);
      const dayIdx = mondayFirst(today);
      const weekStart = mondayOf(today);

      // Whose plan has something to do TODAY.
      const { data: plans, error } = await db.from('week_plan_days').select('athlete_id, nudge_days').eq('week_start', weekStart);
      if (error) return json({ error: 'could not read week plans' }, 500);
      const due = (plans || []).filter(plan => Array.isArray(plan.nudge_days) && plan.nudge_days.includes(dayIdx));
      if (!due.length) return json({ ok: true, weekStart, dayIdx, plans: (plans || []).length, due: 0, sent: 0 });

      // A session already ticked off today is not something to nudge about.
      const athleteIds = due.map(plan => plan.athlete_id);
      const { data: done } = await db.from('sessions').select('athlete_id').eq('done_on', isoDay(today)).in('athlete_id', athleteIds);
      const doneSet = new Set((done || []).map(row => row.athlete_id));
      const pending = athleteIds.filter(id => !doneSet.has(id));
      if (!pending.length) return json({ ok: true, weekStart, dayIdx, due: due.length, allDone: true, sent: 0 });

      const { data: children } = await db.from('athletes').select('id, first_name, family_id').in('id', pending);
      const familyIds = unique((children || []).map(child => child.family_id));
      const { data: memberships } = familyIds.length
        ? await db.from('family_members').select('guardian_id, family_id').in('family_id', familyIds)
        : { data: [] };
      const guardianIds = unique((memberships || []).map(m => m.guardian_id));
      if (!guardianIds.length) return json({ ok: true, sent: 0, note: 'no guardians' });

      const { data: subscriptions } = await db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', guardianIds);
      if (!subscriptions || !subscriptions.length) return json({ ok: true, subscriptions: 0, sent: 0 });

      // The daily nudge rides on the weekly preference: a parent who turned the week ahead off is telling us they do
      // not want the routine reminders.
      const declined = await optedOut(db, guardianIds, 'weekly');
      const names = namesByGuardian(memberships, children);

      const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
      if (!dry && vapidMissing(vapid)) return json({ error: 'VAPID keys are not configured for edge functions', sent: 0 }, 500);

      const capped = await overCap(db, unique(subscriptions.map(s => s.user_id)), at);
      const tally = await deliver({
        db, push, native, subscriptions, dry, url: '/#week', kind: 'daily', vapid,
        skip: id => (capped.has(id) ? 'capped' : declined.has(id) ? 'opted_out' : null),
        message: id => dailyMessage(names.get(id) || []),
      });
      return json({ ok: true, dry, weekStart, dayIdx, due: due.length, pending: pending.length, subscriptions: subscriptions.length, ...tally });
    } catch {
      return json({ error: 'internal_error' }, 500);
    }
  };
}
