// notify-weekly is the Sunday "your week is ready" push, sent by pg_cron. The rule it broke: a parent who switched the
// week ahead off in Account & settings kept receiving it, because the function never read notification_prefs.weekly.
// These tests pin that fix and the rest of its behaviour: scheduler only, quiet hours, one line per parent naming
// their children, the weekly cap, and no sends without VAPID keys. The logic now lives in handler.mjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakeSupabase, fakeWebPush } = require('./support/fake-supabase.cjs');

const load = () => import(pathToFileURL(path.join(__dirname, '../supabase/functions/notify-weekly/handler.mjs')).href);
const SUNDAY_AFTERNOON = new Date('2026-09-13T20:12:00Z');
const ENV = { SERVICE_KEY: 'sb_secret_synthetic', VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' };
const run = (query = '', bearer = 'sb_secret_synthetic') => new Request('https://project.supabase.co/functions/v1/notify-weekly' + query, { method: 'POST', headers: bearer ? { Authorization: 'Bearer ' + bearer } : {} });

const world = (extra = {}) => fakeSupabase({
  push_subscriptions: [
    { id: 's1', user_id: 'g1', endpoint: 'e1', p256dh: 'k', auth: 'a' },
    { id: 's2', user_id: 'g2', endpoint: 'e2', p256dh: 'k', auth: 'a' },
    { id: 's3', user_id: 'g3', endpoint: 'e3', p256dh: 'k', auth: 'a' },
  ],
  family_members: [{ guardian_id: 'g1', family_id: 'f1' }, { guardian_id: 'g2', family_id: 'f2' }, { guardian_id: 'g3', family_id: 'f3' }],
  athletes: [{ first_name: 'Sam', family_id: 'f1' }, { first_name: 'Ava', family_id: 'f2' }, { first_name: 'Leo', family_id: 'f2' }],
  notification_prefs: [],
  notification_log: [],
  ...extra,
});
const handlerWith = async (db, push, options = {}) => (await load()).createNotifyWeeklyHandler({ db, push, env: ENV, now: () => SUNDAY_AFTERNOON, ...options });

test('each subscribed parent gets one line naming their children, and a parent with none is not nagged', async () => {
  const db = world();
  const push = fakeWebPush();
  const res = await (await handlerWith(db, push))(run());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sent, 2);
  assert.equal(body.skipped, 1, 'g3 has no children on the account');
  assert.deepEqual(push.sent.map(s => [s.endpoint, s.payload.title, s.payload.body]), [
    ['e1', "Sam's week is ready", "Tap to see this week's plan."],
    ['e2', "This week's plans are ready", 'Ava and Leo — tap to see them.'],
  ]);
  assert.deepEqual(db.tables.notification_log.map(r => [r.guardian_id, r.kind]), [['g1', 'weekly'], ['g2', 'weekly']]);
});

test('a parent who turned the week ahead off does not get it', async () => {
  const push = fakeWebPush();
  const res = await (await handlerWith(world({ notification_prefs: [{ guardian_id: 'g1', weekly: false, game_day: true }, { guardian_id: 'g2', weekly: true }] }), push))(run());
  assert.equal(res.status, 200);
  assert.deepEqual(push.sent.map(s => s.endpoint), ['e2'], 'g1 opted out; a row with weekly on, or no row at all, means send');
});

test('a parent already at the weekly cap is skipped', async () => {
  const push = fakeWebPush();
  const log = Array.from({ length: 4 }, () => ({ guardian_id: 'g2', kind: 'daily', sent_at: '2026-09-12T12:00:00Z' }));
  const body = await (await (await handlerWith(world({ notification_log: log }), push))(run())).json();
  assert.equal(body.cappedOut, 1);
  assert.deepEqual(push.sent.map(s => s.endpoint), ['e1']);
});

test('only the scheduler can run it, and quiet hours hold unless the run is forced or dry', async () => {
  const push = fakeWebPush();
  const handle = await handlerWith(world(), push, { now: () => new Date('2026-09-14T02:00:00Z') }); // 10pm EDT
  assert.equal((await handle(run('', null))).status, 403);
  assert.equal((await handle(run('', 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role: 'authenticated' })).toString('base64url') + '.sig'))).status, 403);
  const quiet = await (await handle(run())).json();
  assert.equal(quiet.skipped, 'quiet_hours');
  assert.deepEqual(push.sent, []);
  assert.equal((await (await handle(run('?force=1'))).json()).sent, 2);
});

test('without VAPID keys nothing is sent, but a dry run still previews who would be', async () => {
  const push = fakeWebPush();
  const db = world();
  const handle = await handlerWith(db, push, { env: { SERVICE_KEY: 'sb_secret_synthetic' } });
  const res = await handle(run());
  assert.equal(res.status, 500);
  assert.deepEqual(push.sent, []);
  const dry = await (await handle(run('?dry=1'))).json();
  assert.equal(dry.sent, 2);
  assert.equal(dry.preview.length, 2);
  assert.deepEqual(push.sent, []);
  assert.deepEqual(db.tables.notification_log, []);
});
