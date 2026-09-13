// The four scheduled notification functions each used to carry their own copy of the send policy: who counts as the
// scheduler, quiet hours, the four-a-week cap, and the delivery loop that reaps dead subscriptions. It now lives once
// in supabase/functions/_shared/push-policy.mjs. These tests pin it, and check that every notification entry point
// is only wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakeSupabase, fakeWebPush } = require('./support/fake-supabase.cjs');

const functions = path.join(__dirname, '../supabase/functions');
const load = () => import(pathToFileURL(path.join(functions, '_shared/push-policy.mjs')).href);
const jwt = claims => ['header', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'signature'].join('.');

test('only the injected service key, or a token whose verified role is service_role, is the scheduler', async () => {
  const { isScheduler } = await load();
  assert.equal(isScheduler('sb_secret_synthetic', 'sb_secret_synthetic'), true);
  assert.equal(isScheduler(jwt({ role: 'service_role' }), 'sb_secret_synthetic'), true);
  assert.equal(isScheduler(jwt({ role: 'authenticated', sub: 'p1' }), 'sb_secret_synthetic'), false, 'a signed-in parent is not the scheduler');
  assert.equal(isScheduler(jwt({ role: 'anon' }), 'sb_secret_synthetic'), false);
  for (const bearer of ['', 'not-a-token', 'a.b', 'x.%%%.y', 'sb_secret_other']) assert.equal(isScheduler(bearer, 'sb_secret_synthetic'), false, bearer);
});

test('quiet hours run from 9pm to 7am New York time, on both sides of daylight saving', async () => {
  const { inQuietHours, localHour } = await load();
  const at = iso => new Date(iso);
  assert.equal(inQuietHours(at('2026-09-14T00:59:00Z')), false, '8:59pm EDT');
  assert.equal(inQuietHours(at('2026-09-14T01:00:00Z')), true, '9:00pm EDT');
  assert.equal(inQuietHours(at('2026-09-14T10:59:00Z')), true, '6:59am EDT');
  assert.equal(inQuietHours(at('2026-09-14T11:00:00Z')), false, '7:00am EDT');
  assert.equal(inQuietHours(at('2026-01-15T11:59:00Z')), true, '6:59am EST');
  assert.equal(inQuietHours(at('2026-01-15T12:00:00Z')), false, '7:00am EST');
  assert.equal(localHour(at('2026-09-14T04:00:00Z')), 0, 'midnight is hour 0, not 24');
});

test('the weekly cap counts the last seven days, and an unreadable log caps nobody', async () => {
  const { overCap, weeklyCounts, WEEKLY_CAP } = await load();
  const now = new Date('2026-09-13T20:00:00Z');
  const recent = '2026-09-12T12:00:00Z';
  const db = fakeSupabase({ notification_log: [
    ...Array.from({ length: WEEKLY_CAP }, () => ({ guardian_id: 'g1', sent_at: recent })),
    { guardian_id: 'g2', sent_at: recent }, { guardian_id: 'g2', sent_at: recent }, { guardian_id: 'g2', sent_at: recent },
    ...Array.from({ length: 6 }, () => ({ guardian_id: 'g3', sent_at: '2026-09-05T12:00:00Z' })),
  ] });
  assert.deepEqual([...await overCap(db, ['g1', 'g2', 'g3'], now)], ['g1'], 'messages older than a week do not count');

  const broken = fakeSupabase({}, { errors: { 'select:notification_log': { code: '08006', message: 'down' } } });
  assert.equal(await weeklyCounts(broken, ['g1'], now), null);
  assert.deepEqual([...await overCap(broken, ['g1'], now)], [], 'fails open: bookkeeping trouble never mutes a family');
});

test('children are named per guardian without duplicates, and lists read naturally', async () => {
  const { namesByGuardian, joinNames } = await load();
  const names = namesByGuardian(
    [{ guardian_id: 'g1', family_id: 'f1' }, { guardian_id: 'g1', family_id: 'f2' }, { guardian_id: 'g2', family_id: 'f2' }],
    [{ family_id: 'f1', first_name: 'Sam' }, { family_id: 'f2', first_name: 'Ava' }, { family_id: 'f2', first_name: 'Sam' }, { family_id: 'f2', first_name: null }],
  );
  assert.deepEqual(names.get('g1'), ['Sam', 'Ava']);
  assert.deepEqual(names.get('g2'), ['Ava', 'Sam']);
  assert.deepEqual([[], ['Sam'], ['Sam', 'Ava'], ['Sam', 'Ava', 'Leo']].map(joinNames), ['', 'Sam', 'Sam and Ava', 'Sam, Ava and Leo']);
});

test('delivery reaps dead subscriptions, reports other failures, logs only real sends, and a dry run sends nothing', async () => {
  const { deliver } = await load();
  const subscriptions = ['e1', 'gone', 'expired', 'broken'].map((endpoint, i) => ({ id: 's' + i, user_id: 'g1', endpoint, p256dh: 'k', auth: 'a' }));
  const db = fakeSupabase({ push_subscriptions: subscriptions.map(s => ({ ...s })), notification_log: [] });
  const push = fakeWebPush();
  const vapid = { publicKey: 'pub', privateKey: 'priv' };
  const tally = await deliver({ db, push, subscriptions, message: () => ['Title', 'Body'], dry: false, url: '/#week', kind: 'weekly', vapid });
  assert.equal(tally.sent, 1);
  assert.equal(tally.reaped, 2);
  assert.deepEqual(tally.failures.map(f => f.code), [403], 'a VAPID mismatch is reported, never mistaken for nobody subscribed');
  assert.deepEqual(db.tables.push_subscriptions.map(s => s.endpoint), ['e1', 'broken']);
  assert.deepEqual(db.tables.notification_log, [{ guardian_id: 'g1', kind: 'weekly' }]);
  assert.deepEqual(push.sent[0].payload, { title: 'Title', body: 'Body', url: '/#week' });

  const dryPush = fakeWebPush();
  const dryDb = fakeSupabase({ notification_log: [] });
  const preview = await deliver({ db: dryDb, push: dryPush, subscriptions, message: () => ['T', 'B'], dry: true, url: '/', kind: 'weekly', vapid: {} });
  assert.equal(preview.sent, 4);
  assert.deepEqual(dryPush.sent, []);
  assert.deepEqual(dryPush.vapid, [], 'a dry run needs no keys');
  assert.deepEqual(dryDb.log, []);
});

test('every notification entry point wires its handler and adds no logic', () => {
  for (const name of ['notify-weekly', 'notify-daily', 'notify-gameday', 'notify-measure', 'notify-trainer-review', 'notify-booking']) {
    const entry = fs.readFileSync(path.join(functions, name, 'index.ts'), 'utf8');
    assert.match(entry, /from '\.\/handler\.mjs';/, name);
    assert.doesNotMatch(entry, /Deno\.env\.get\('SUPABASE_ANON_KEY'\)/, name + ' must not read the legacy anon key');
    assert.doesNotMatch(entry, /\.from\(|sendNotification/, name + ' must not query or send from the entry point');
  }
});
