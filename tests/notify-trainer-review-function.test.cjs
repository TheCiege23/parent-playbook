// notify-trainer-review tells a trainer applicant a review decision landed. Only an admin may send it, the message is
// one of a fixed set that says nothing specific on a lock screen other people can read, and it pushes only at a
// trainer profile that exists. The logic now lives in handler.mjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakeSupabase, fakeWebPush, callerAs } = require('./support/fake-supabase.cjs');

const load = () => import(pathToFileURL(path.join(__dirname, '../supabase/functions/notify-trainer-review/handler.mjs')).href);
const post = body => new Request('https://project.supabase.co/functions/v1/notify-trainer-review', { method: 'POST', headers: { Authorization: 'Bearer user-token' }, body: JSON.stringify(body) });
const world = () => fakeSupabase({
  app_admins: [{ guardian_id: 'admin1' }],
  trainer_profiles: [{ id: 't1' }],
  push_subscriptions: [{ id: 's1', user_id: 't1', endpoint: 'e1', p256dh: 'k', auth: 'a' }, { id: 's2', user_id: 't1', endpoint: 'gone', p256dh: 'k', auth: 'a' }],
});
const handlerWith = async (user, db, push) => (await load()).createNotifyTrainerReviewHandler({ callerClient: callerAs(user), db, push, env: { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' } });

test('only an admin can announce a decision, of a known kind, to a trainer who exists', async () => {
  for (const [user, body, status] of [
    [null, { trainer_id: 't1', kind: 'approved' }, 401],
    [{ id: 'trainer-themself' }, { trainer_id: 't1', kind: 'approved' }, 403],
    [{ id: 'admin1' }, { trainer_id: 't1', kind: 'banned_for_life' }, 400],
    [{ id: 'admin1' }, { trainer_id: 't1', kind: 'constructor' }, 400],
    [{ id: 'admin1' }, { kind: 'approved' }, 400],
    [{ id: 'admin1' }, { trainer_id: 'nobody', kind: 'approved' }, 404],
  ]) {
    const push = fakeWebPush();
    const res = await (await handlerWith(user, world(), push))(post(body));
    assert.equal(res.status, status, JSON.stringify({ user, body }));
    assert.deepEqual(push.sent, []);
  }
});

test('the trainer gets the fixed line for the decision, and a dead subscription is reaped', async () => {
  const db = world();
  const push = fakeWebPush();
  const res = await (await handlerWith({ id: 'admin1' }, db, push))(post({ trainer_id: 't1', kind: 'needs_info' }));
  assert.deepEqual(await res.json(), { sent: 1 });
  assert.deepEqual(push.sent[0].payload, { title: 'We need one more thing', body: 'Open Parent Playbook to see what to update.', url: '/' });
  assert.deepEqual(db.tables.push_subscriptions.map(s => s.endpoint), ['e1']);
});
