// notify-measure is the monthly "time to measure" push, and the lowest-priority message the product sends. It goes only
// to someone who can write a measurement, only for a child the CDC stature reference covers (2 to 20, sex recorded),
// only when the last height is over 30 days old or missing, and it yields to a household that has already had two
// messages this week. The logic now lives in handler.mjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakeSupabase, fakeWebPush } = require('./support/fake-supabase.cjs');

const load = () => import(pathToFileURL(path.join(__dirname, '../supabase/functions/notify-measure/handler.mjs')).href);
const ENV = { SERVICE_KEY: 'sb_secret_synthetic', VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' };
const NOW = new Date('2026-09-06T14:14:00Z'); // the first Sunday of September, when the job sends
const run = (query = '') => new Request('https://project.supabase.co/functions/v1/notify-measure' + query, { method: 'POST', headers: { Authorization: 'Bearer sb_secret_synthetic' } });

const world = (extra = {}) => fakeSupabase({
  athletes: [
    { id: 'k1', first_name: 'Sam', family_id: 'f1', birthdate: '2016-01-01', sex_at_birth: 'male' },   // last height July: stale
    { id: 'k2', first_name: 'Ava', family_id: 'f1', birthdate: '2016-01-01', sex_at_birth: 'female' }, // measured this month
    { id: 'k3', first_name: 'Tiny', family_id: 'f1', birthdate: '2025-06-01', sex_at_birth: 'male' },  // under 2
    { id: 'k4', first_name: 'Leo', family_id: 'f1', birthdate: '2015-01-01', sex_at_birth: null },     // no sex recorded
    { id: 'k5', first_name: 'Mia', family_id: 'f1', birthdate: '2017-03-01', sex_at_birth: 'female' }, // never measured
  ],
  measurements: [
    { athlete_id: 'k1', metric_key: 'height', measured_on: '2026-05-01' },
    { athlete_id: 'k1', metric_key: 'height', measured_on: '2026-07-01' },
    { athlete_id: 'k1', metric_key: 'weight', measured_on: '2026-09-10' },
    { athlete_id: 'k2', metric_key: 'height', measured_on: '2026-09-01' },
  ],
  family_members: [{ guardian_id: 'g1', family_id: 'f1', role: 'owner' }, { guardian_id: 'g2', family_id: 'f1', role: 'family_view' }],
  push_subscriptions: [{ id: 's1', user_id: 'g1', endpoint: 'e1', p256dh: 'k', auth: 'a' }, { id: 's2', user_id: 'g2', endpoint: 'e2', p256dh: 'k', auth: 'a' }],
  notification_prefs: [],
  notification_log: [],
  ...extra,
});
const handlerWith = async (db, push, at = NOW) => (await load()).createNotifyMeasureHandler({ db, push, env: ENV, now: () => at });

test('only children the reference covers, whose last height is stale or missing, and only writers, are nudged', async () => {
  const db = world();
  const push = fakeWebPush();
  const res = await (await handlerWith(db, push))(run());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.due, 2, 'Sam (last height in July) and Mia (never measured)');
  assert.deepEqual(push.sent.map(s => [s.endpoint, s.payload.title, s.payload.body, s.payload.url]), [
    ['e1', 'Time for a measure-up?', 'Sam and Mia are both due. A minute each against a door frame.', '/#growth'],
  ], 'family view cannot write a measurement, so is not asked to');
  assert.deepEqual(db.tables.notification_log.map(r => [r.guardian_id, r.kind]), [['g1', 'measure']]);
});

test('it yields to a household that has already had two messages this week', async () => {
  const push = fakeWebPush();
  const log = [{ guardian_id: 'g1', sent_at: '2026-09-04T12:00:00Z' }, { guardian_id: 'g1', sent_at: '2026-09-05T12:00:00Z' }];
  const body = await (await (await handlerWith(world({ notification_log: log }), push))(run())).json();
  assert.equal(body.yielded, 1);
  assert.deepEqual(push.sent, []);
});

test('it sends only in the first seven days of the month, New York time, unless the run is forced or dry', async () => {
  const { localDayOfMonth, FIRST_WEEK_DAYS } = await load();
  assert.equal(FIRST_WEEK_DAYS, 7);
  assert.equal(localDayOfMonth(new Date('2026-10-01T02:00:00Z')), 30, 'still 30 September in New York');
  assert.equal(localDayOfMonth(new Date('2026-09-07T03:59:00Z')), 6, 'still Sunday 6 September in New York');

  const secondSunday = new Date('2026-09-13T14:14:00Z');
  const push = fakeWebPush();
  const skipped = await (await handlerWith(world(), push, secondSunday))(run());
  assert.deepEqual(await skipped.json(), { ok: true, skipped: 'not_first_week', day: 13 });
  assert.deepEqual(push.sent, []);

  assert.equal((await (await (await handlerWith(world(), push, secondSunday))(run('?force=1'))).json()).sent, 1);
  const dry = fakeWebPush();
  assert.equal((await (await (await handlerWith(world(), dry, secondSunday))(run('?dry=1'))).json()).sent, 1);
  assert.deepEqual(dry.sent, []);
});
