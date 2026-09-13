// notify-gameday is the night-before-a-game push, and the reason a parent grants notifications at all. A game day is
// stored Monday-first (Mon=0 … Sun=6) while JavaScript counts Sunday as 0, and mixing the two shifts every game by a
// day. These tests pin the day match, and that a game out of season, after the season, or cancelled for tomorrow
// sends nothing, and that the game-day preference is honoured. The logic now lives in handler.mjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakeSupabase, fakeWebPush } = require('./support/fake-supabase.cjs');

const load = () => import(pathToFileURL(path.join(__dirname, '../supabase/functions/notify-gameday/handler.mjs')).href);
const ENV = { SERVICE_KEY: 'sb_secret_synthetic', VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' };
const run = query => new Request('https://project.supabase.co/functions/v1/notify-gameday' + query, { method: 'POST', headers: { Authorization: 'Bearer sb_secret_synthetic' } });

// 2026-09-19 is a Saturday: Monday-first index 5.
const world = (extra = {}) => fakeSupabase({
  athlete_sports: [
    { athlete_id: 'a1', sport_key: 'football', game_day: 5, season_state: 'in_season', season_start: '2026-08-15', season_end: '2026-11-30' },
    { athlete_id: 'a2', sport_key: 'soccer', game_day: 5, season_state: 'offseason' },
    { athlete_id: 'a3', sport_key: 'baseball', game_day: 5, season_end: '2026-09-01' },
    { athlete_id: 'a4', sport_key: 'football', game_day: 5 },
    { athlete_id: 'a5', sport_key: 'football', game_day: 6 },
  ],
  schedule_exceptions: [{ athlete_id: 'a4', on_date: '2026-09-19' }],
  athletes: [1, 2, 3, 4, 5].map(n => ({ id: 'a' + n, first_name: ['Sam', 'Ava', 'Leo', 'Mia', 'Kai'][n - 1], family_id: 'f' + n })),
  family_members: [1, 2, 3, 4, 5].map(n => ({ guardian_id: 'g' + n, family_id: 'f' + n })),
  push_subscriptions: [1, 2, 3, 4, 5].map(n => ({ id: 's' + n, user_id: 'g' + n, endpoint: 'e' + n, p256dh: 'k', auth: 'a' })),
  notification_prefs: [],
  notification_log: [],
  ...extra,
});
const handlerWith = async (db, push) => (await load()).createNotifyGamedayHandler({ db, push, env: ENV, now: () => new Date('2026-09-18T23:00:00Z') });

test('tomorrow\'s game is matched Monday-first, and out-of-season, finished or cancelled games send nothing', async () => {
  const push = fakeWebPush();
  const res = await (await handlerWith(world(), push))(run('?for=2026-09-19'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual([body.tomorrow, body.dayIndex, body.athletes], ['2026-09-19', 5, 1]);
  assert.deepEqual(push.sent.map(s => [s.endpoint, s.payload.title]), [['e1', 'Sam has a game tomorrow']]);
  assert.equal(push.sent[0].payload.body, 'Light dinner, early night. Tap for the three things to say on the drive.');
});

test('the game-day preference silences it', async () => {
  const push = fakeWebPush();
  const body = await (await (await handlerWith(world({ notification_prefs: [{ guardian_id: 'g1', weekly: true, game_day: false }] }), push))(run('?for=2026-09-19'))).json();
  assert.equal(body.skipped, 1);
  assert.deepEqual(push.sent, []);
});
