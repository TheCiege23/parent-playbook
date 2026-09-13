// notify-gameday — the night before a game.
//
// The second of the two notifications this app asks permission for. Nobody grants push to a vague request, but
// they will for a game-day reminder, so this one has to actually exist or the toggle in Account & settings is a
// lie. Deliberately narrow: it reads athlete_sports.game_day, checks the athlete is in season, drops a game
// cancelled for tomorrow, honours notification_prefs.game_day, and sends one line. It does NOT recompute the plan.
// Runs nightly from pg_cron; the message is about TOMORROW.
//
// The logic lives here, apart from the Deno entry point, so it runs under Node's test runner
// (tests/notify-gameday-function.test.cjs). Send policy is in ../_shared/push-policy.mjs.

import { isScheduler, bearerOf, inQuietHours, localHour, overCap, optedOut, namesByGuardian, joinNames, deliver, vapidMissing } from '../_shared/push-policy.mjs';

// Mon=0 … Sun=6, matching DAY_LABELS in program.js. getUTCDay() uses Sun=0, and mixing the two shifts every game
// by a day.
export const mondayFirst = date => (date.getUTCDay() + 6) % 7;
const isoDay = date => date.toISOString().slice(0, 10);

export function gamedayMessage(names) {
  if (!names.length) return null;
  if (names.length === 1) return [`${names[0]} has a game tomorrow`, 'Light dinner, early night. Tap for the three things to say on the drive.'];
  return ['Game day tomorrow', `${joinNames(names)} are playing. Tap for the game-day guidance.`];
}

// A weekly game day means nothing out of season, the same rule buildProgram applies.
export function inSeason(sport, dayIso) {
  if (sport.season_state === 'offseason' || sport.season_state === 'between_sports') return false;
  if (sport.season_start && dayIso < sport.season_start) return false;
  if (sport.season_end && dayIso > sport.season_end) return false;
  return true;
}

const unique = values => [...new Set(values)];

export function createNotifyGamedayHandler({ db, push, env = {}, now = () => new Date() } = {}) {
  if (!db || !push) throw new TypeError('createNotifyGamedayHandler needs db and push');

  return async function handle(req) {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    try {
      if (!isScheduler(bearerOf(req), env.SERVICE_KEY)) return json({ error: 'forbidden' }, 403);
      const params = new URL(req.url).searchParams;
      const dry = params.get('dry') === '1';
      const force = params.get('force') === '1';
      const at = now();
      if (!dry && !force && inQuietHours(at)) return json({ ok: true, skipped: 'quiet_hours', hour: localHour(at) });

      // ?for=YYYY-MM-DD pins "tomorrow" so this can be tested on a day that is not one.
      const forParam = params.get('for');
      const tomorrow = forParam ? new Date(forParam + 'T00:00:00Z') : new Date(at.getTime() + 86400000);
      if (isNaN(tomorrow.getTime())) return json({ error: 'bad ?for= date' }, 400);
      const dayIndex = mondayFirst(tomorrow);
      const day = isoDay(tomorrow);

      const { data: sports, error } = await db.from('athlete_sports')
        .select('athlete_id, sport_key, game_day, season_start, season_end, season_state').eq('game_day', dayIndex);
      if (error) return json({ error: 'could not read sports' }, 500);
      if (!sports || !sports.length) return json({ ok: true, tomorrow: day, matches: 0, sent: 0 });

      const inPlay = sports.filter(sport => inSeason(sport, day));
      if (!inPlay.length) return json({ ok: true, tomorrow: day, matches: sports.length, inSeason: 0, sent: 0 });

      // A cancellation logged for tomorrow removes it.
      const athleteIds = unique(inPlay.map(sport => sport.athlete_id));
      const { data: exceptions } = await db.from('schedule_exceptions').select('athlete_id').eq('on_date', day).in('athlete_id', athleteIds);
      const cancelled = new Set((exceptions || []).map(row => row.athlete_id));
      const playing = athleteIds.filter(id => !cancelled.has(id));
      if (!playing.length) return json({ ok: true, tomorrow: day, allCancelled: true, sent: 0 });

      const { data: children } = await db.from('athletes').select('id, first_name, family_id').in('id', playing);
      const familyIds = unique((children || []).map(child => child.family_id));
      const { data: memberships } = familyIds.length
        ? await db.from('family_members').select('guardian_id, family_id').in('family_id', familyIds)
        : { data: [] };
      const guardianIds = unique((memberships || []).map(m => m.guardian_id));
      if (!guardianIds.length) return json({ ok: true, tomorrow: day, sent: 0, note: 'no guardians' });

      const { data: subscriptions } = await db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', guardianIds);
      if (!subscriptions || !subscriptions.length) return json({ ok: true, tomorrow: day, subscriptions: 0, sent: 0 });

      // A missing preferences row means both types are on.
      const declined = await optedOut(db, guardianIds, 'game_day');
      const names = namesByGuardian(memberships, children);

      const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
      if (!dry && vapidMissing(vapid)) return json({ error: 'VAPID keys are not configured for edge functions', sent: 0 }, 500);

      const capped = await overCap(db, unique(subscriptions.map(s => s.user_id)), at);
      const tally = await deliver({
        db, push, subscriptions, dry, url: '/#week', kind: 'game_day', vapid,
        skip: id => (capped.has(id) ? 'capped' : declined.has(id) ? 'opted_out' : null),
        message: id => gamedayMessage(names.get(id) || []),
      });
      return json({ ok: true, dry, tomorrow: day, dayIndex, athletes: playing.length, subscriptions: subscriptions.length, ...tally });
    } catch {
      return json({ error: 'internal_error' }, 500);
    }
  };
}
