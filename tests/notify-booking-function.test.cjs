// notify-booking pushes a booking update to the other side. Before this, either participant could send any kind, so a
// trainer could push "Payment received" at a parent and a parent could push "Booking confirmed" at a trainer, and an
// unknown kind still sent a generic line. These tests pin who may send what, that the recipient is always the other
// person, and that the text is one of the fixed lines. The logic now lives in handler.mjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakeSupabase, fakeWebPush, callerAs } = require('./support/fake-supabase.cjs');

const load = () => import(pathToFileURL(path.join(__dirname, '../supabase/functions/notify-booking/handler.mjs')).href);
const post = body => new Request('https://project.supabase.co/functions/v1/notify-booking', { method: 'POST', headers: { Authorization: 'Bearer user-token' }, body: JSON.stringify(body) });
const world = () => fakeSupabase({
  bookings: [{ id: 'b1', parent_id: 'p1', trainer_id: 't1', child_shared: { first_name: 'Sam' }, services: { title: 'Speed session' }, trainer_profiles: { display_name: 'Coach Kim' } }],
  push_subscriptions: [{ id: 'sp', user_id: 'p1', endpoint: 'parent-device', p256dh: 'k', auth: 'a' }, { id: 'st', user_id: 't1', endpoint: 'trainer-device', p256dh: 'k', auth: 'a' }],
});
const send = async (userId, body) => {
  const push = fakeWebPush();
  const res = await (await load()).createNotifyBookingHandler({ callerClient: callerAs(userId ? { id: userId } : null), db: world(), push, env: { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' } })(post(body));
  return { status: res.status, sent: push.sent };
};

test('each kind can only be sent by its side of the booking, and always reaches the other side', async () => {
  const cases = [
    ['p1', 'new_request', 200, 'trainer-device', ['New booking request', 'Sam requested Speed session']],
    ['p1', 'paid', 200, 'trainer-device', ['Payment received', 'Payment for Speed session is complete']],
    ['t1', 'confirmed', 200, 'parent-device', ['Booking confirmed', 'Coach Kim confirmed your session']],
    ['t1', 'declined', 200, 'parent-device', ['Booking update', 'Coach Kim could not take this session']],
    ['t1', 'completed', 200, 'parent-device', ['Session completed', 'Tap to leave a review for Coach Kim']],
    ['p1', 'message', 200, 'trainer-device', ['New message', 'You have a new message']],
    ['t1', 'message', 200, 'parent-device', ['New message', 'You have a new message']],
    ['t1', 'paid', 403],
    ['t1', 'new_request', 403],
    ['p1', 'confirmed', 403],
    ['p1', 'completed', 403],
  ];
  for (const [user, kind, status, endpoint, line] of cases) {
    const { status: got, sent } = await send(user, { booking_id: 'b1', kind });
    assert.equal(got, status, user + ' ' + kind);
    if (status === 200) assert.deepEqual(sent.map(s => [s.endpoint, s.payload.title, s.payload.body]), [[endpoint, ...line]], user + ' ' + kind);
    else assert.deepEqual(sent, [], user + ' ' + kind + ' must not send');
  }
});

test('outsiders, unknown kinds and missing bookings send nothing', async () => {
  for (const [user, body, status] of [
    [null, { booking_id: 'b1', kind: 'message' }, 401],
    ['stranger', { booking_id: 'b1', kind: 'message' }, 403],
    ['p1', { booking_id: 'b1', kind: 'refund_issued' }, 400],
    ['p1', { booking_id: 'b1', kind: '__proto__' }, 400],
    ['p1', { booking_id: 'b1' }, 400],
    ['p1', { booking_id: 'nope', kind: 'message' }, 404],
  ]) {
    const { status: got, sent } = await send(user, body);
    assert.equal(got, status, JSON.stringify({ user, body }));
    assert.deepEqual(sent, []);
  }
});
