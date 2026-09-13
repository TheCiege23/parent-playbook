// notify-daily is the afternoon nudge. Its whole design is "nothing on rest days — silence is the message", and it
// does not decide what a rest day is: the browser publishes the day indexes worth nudging into week_plan_days. These
// tests pin that it reads only today's index (Monday first), skips a child whose session is already done, and honours
// the weekly preference it rides on. The logic now lives in handler.mjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakeSupabase, fakeWebPush } = require('./support/fake-supabase.cjs');

const load = () => import(pathToFileURL(path.join(__dirname, '../supabase/functions/notify-daily/handler.mjs')).href);
const ENV = { SERVICE_KEY: 'sb_secret_synthetic', VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' };
const run = query => new Request('https://project.supabase.co/functions/v1/notify-daily' + query, { method: 'POST', headers: { Authorization: 'Bearer sb_secret_synthetic' } });

// 2026-09-14 is a Monday: day index 0, week starting 2026-09-14.
const world = (extra = {}) => fakeSupabase({
  week_plan_days: [
    { athlete_id: 'a1', week_start: '2026-09-14', nudge_days: [0, 2] },
    { athlete_id: 'a2', week_start: '2026-09-14', nudge_days: [1, 3] },
    { athlete_id: 'a3', week_start: '2026-09-14', nudge_days: [0] },
    { athlete_id: 'a4', week_start: '2026-09-07', nudge_days: [0] },
  ],
  sessions: [{ athlete_id: 'a3', done_on: '2026-09-14' }],
  athletes: [{ id: 'a1', first_name: 'Sam', family_id: 'f1' }, { id: 'a2', first_name: 'Ava', family_id: 'f2' }, { id: 'a3', first_name: 'Leo', family_id: 'f3' }, { id: 'a4', first_name: 'Mia', family_id: 'f4' }],
  family_members: [{ guardian_id: 'g1', family_id: 'f1' }, { guardian_id: 'g2', family_id: 'f2' }, { guardian_id: 'g3', family_id: 'f3' }, { guardian_id: 'g4', family_id: 'f4' }],
  push_subscriptions: ['g1', 'g2', 'g3', 'g4'].map((g, i) => ({ id: 's' + i, user_id: g, endpoint: 'e-' + g, p256dh: 'k', auth: 'a' })),
  notification_prefs: [],
  notification_log: [],
  ...extra,
});
const handlerWith = async (db, push, options = {}) => (await load()).createNotifyDailyHandler({ db, push, env: ENV, now: () => new Date('2026-09-14T20:12:00Z'), ...options });

test('only a child whose published plan has something today, and no session done yet, is nudged', async () => {
  const push = fakeWebPush();
  const res = await (await handlerWith(world(), push))(run('?for=2026-09-14'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual([body.dayIdx, body.weekStart, body.due, body.pending], [0, '2026-09-14', 2, 1]);
  assert.deepEqual(push.sent.map(s => [s.endpoint, s.payload.title, s.payload.url]), [['e-g1', 'Sam has something short today', '/#week']],
    'Ava has nothing today, Leo is already done, and Mia\'s plan is from last week');
});

test('the weekly preference silences it, and a bad date is refused', async () => {
  const push = fakeWebPush();
  const handle = await handlerWith(world({ notification_prefs: [{ guardian_id: 'g1', weekly: false }] }), push);
  const body = await (await handle(run('?for=2026-09-14'))).json();
  assert.equal(body.skipped, 1);
  assert.deepEqual(push.sent, []);
  assert.equal((await handle(run('?for=not-a-date'))).status, 400);
});
