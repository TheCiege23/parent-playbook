// Native push for the App Store and Play Store builds (supabase/functions/_shared/native-push.mjs).
// The iOS and Android apps register an APNs or FCM device token in push_subscriptions as an
// apns:<token> / fcm:<token> endpoint. These tests sign with real generated keys and verify the signatures, so a malformed
// JWT fails here rather than as a silent 403 from Apple or Google on launch day.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { webcrypto, createPublicKey, verify } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { fakeSupabase, fakeWebPush } = require('./support/fake-supabase.cjs');

const functions = path.join(__dirname, '../supabase/functions');
const loadNative = () => import(pathToFileURL(path.join(functions, '_shared/native-push.mjs')).href);
const loadPolicy = () => import(pathToFileURL(path.join(functions, '_shared/push-policy.mjs')).href);
const subtle = webcrypto.subtle;

async function pkcs8Pem(algorithm, usages) {
  const pair = await subtle.generateKey(algorithm, true, usages);
  const der = Buffer.from(await subtle.exportKey('pkcs8', pair.privateKey));
  const spki = Buffer.from(await subtle.exportKey('spki', pair.publicKey));
  return { pem: '-----BEGIN PRIVATE KEY-----\n' + der.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n', spki };
}
const part = (jwt, i) => JSON.parse(Buffer.from(jwt.split('.')[i], 'base64url').toString());

function fakeFetch(respond) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body = {} } = (await respond(url, init, calls.length)) || {};
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('iOS: an ES256 provider token Apple can verify, sent to the production host for the bundle', async () => {
  const { createNativePush } = await loadNative();
  const key = await pkcs8Pem({ name: 'ECDSA', namedCurve: 'P-256' }, ['sign', 'verify']);
  const fetch = fakeFetch(() => ({ status: 200 }));
  const native = createNativePush({
    config: { apns: { keyId: 'ABC123DEFG', teamId: 'TEAM123456', privateKey: key.pem.replace(/\n/g, '\\n'), bundleId: 'com.playbookbp.app', environment: 'production' } },
    fetch, now: () => Date.parse('2026-10-06T12:00:00Z'), subtle,
  });
  assert.deepEqual(native.configured, { ios: true, android: false });
  await native.send({ endpoint: 'apns:devicetoken01' }, { title: 'Week ready', body: 'Sam’s week is ready', url: '/#week' });

  const [{ url, init }] = fetch.calls;
  assert.equal(url, 'https://api.push.apple.com/3/device/devicetoken01');
  assert.equal(init.headers['apns-topic'], 'com.playbookbp.app');
  assert.equal(init.headers['apns-push-type'], 'alert');
  assert.deepEqual(JSON.parse(init.body), { aps: { alert: { title: 'Week ready', body: 'Sam’s week is ready' }, sound: 'default' }, url: '/#week' });

  const jwt = init.headers.authorization.replace(/^bearer /, '');
  assert.deepEqual(part(jwt, 0), { alg: 'ES256', kid: 'ABC123DEFG' });
  assert.deepEqual(part(jwt, 1), { iss: 'TEAM123456', iat: Math.floor(Date.parse('2026-10-06T12:00:00Z') / 1000) });
  const [h, c, s] = jwt.split('.');
  const ok = verify('sha256', Buffer.from(h + '.' + c), { key: createPublicKey({ key: key.spki, format: 'der', type: 'spki' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  assert.equal(ok, true, 'the signature verifies against the key pair');

  await native.send({ endpoint: 'apns:devicetoken02' }, { title: 't', body: 'b' });
  assert.equal(fetch.calls[1].init.headers.authorization, init.headers.authorization, 'the provider token is reused, not re-signed per send');
});

test('iOS: a token Apple says is gone is reported as 410 so it is reaped; other failures are not', async () => {
  const { createNativePush } = await loadNative();
  const key = await pkcs8Pem({ name: 'ECDSA', namedCurve: 'P-256' }, ['sign', 'verify']);
  const replies = { gone: { status: 410, body: { reason: 'Unregistered' } }, bad: { status: 400, body: { reason: 'BadDeviceToken' } }, busy: { status: 429, body: { reason: 'TooManyRequests' } } };
  const fetch = fakeFetch(url => replies[url.split('/').pop()]);
  const native = createNativePush({ config: { apns: { keyId: 'K', teamId: 'T', privateKey: key.pem, bundleId: 'b', environment: 'sandbox' } }, fetch, subtle });
  for (const [token, code] of [['gone', 410], ['bad', 410], ['busy', 429]]) {
    await assert.rejects(native.send({ endpoint: 'apns:' + token }, { title: 't', body: 'b' }), e => e.statusCode === code, token);
  }
  assert.match(fetch.calls[0].url, /^https:\/\/api\.sandbox\.push\.apple\.com\//, 'sandbox builds go to the sandbox host');
});

test('Android: RS256 service-account assertion, cached OAuth token, FCM v1 message with the deep link in data', async () => {
  const { createNativePush } = await loadNative();
  const key = await pkcs8Pem({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, ['sign', 'verify']);
  const fetch = fakeFetch((url, init) => url.startsWith('https://oauth2.googleapis.com/')
    ? { body: { access_token: 'ya29.synthetic', expires_in: 3600 } }
    : /"token":"dead"/.test(init.body) ? { status: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } } : { body: { name: 'projects/x/messages/1' } });
  const native = createNativePush({
    config: { fcm: { project_id: 'parent-playbook', client_email: 'push@parent-playbook.iam.gserviceaccount.com', private_key: key.pem } },
    fetch, subtle,
  });
  assert.deepEqual(native.configured, { ios: false, android: true });
  await native.send({ endpoint: 'fcm:fcmtoken01' }, { title: 'Game day', body: 'Good luck', url: '/#journey' });
  await native.send({ endpoint: 'fcm:fcmtoken02' }, { title: 'x', body: 'y' });

  const oauth = fetch.calls.filter(c => c.url.startsWith('https://oauth2.googleapis.com/'));
  assert.equal(oauth.length, 1, 'one OAuth exchange covers both sends');
  const assertion = decodeURIComponent(oauth[0].init.body.split('assertion=')[1]);
  assert.equal(part(assertion, 0).alg, 'RS256');
  assert.equal(part(assertion, 1).scope, 'https://www.googleapis.com/auth/firebase.messaging');
  const [h, c, s] = assertion.split('.');
  assert.equal(verify('sha256', Buffer.from(h + '.' + c), createPublicKey({ key: key.spki, format: 'der', type: 'spki' }), Buffer.from(s, 'base64url')), true);

  const send = fetch.calls.find(call => call.url.includes('fcm.googleapis.com'));
  assert.equal(send.url, 'https://fcm.googleapis.com/v1/projects/parent-playbook/messages:send');
  assert.equal(send.init.headers.authorization, 'Bearer ya29.synthetic');
  const message = JSON.parse(send.init.body).message;
  assert.equal(message.token, 'fcmtoken01');
  assert.deepEqual(message.notification, { title: 'Game day', body: 'Good luck' });
  assert.deepEqual(message.data, { url: '/#journey' });

  await assert.rejects(native.send({ endpoint: 'fcm:dead' }, { title: 't', body: 'b' }), e => e.statusCode === 410);
});

test('a platform without secrets fails loudly instead of pretending to send', async () => {
  const { createNativePush, sendPush } = await loadNative();
  const native = createNativePush({ config: {}, fetch: async () => { throw new Error('must not be called'); }, subtle });
  await assert.rejects(native.send({ endpoint: 'apns:x' }, {}), /apns: not configured/);
  await assert.rejects(native.send({ endpoint: 'fcm:x' }, {}), /fcm: not configured/);
  await assert.rejects(sendPush({ push: fakeWebPush(), native: null }, { endpoint: 'apns:x' }, {}), /native push not configured/);
});

test('delivery routes web rows to Web Push and native rows to Apple/Google, and reaps dead tokens from both', async () => {
  const { deliver } = await loadPolicy();
  const subscriptions = [
    { id: 's1', user_id: 'g1', endpoint: 'e1', p256dh: 'k', auth: 'a' },
    { id: 's2', user_id: 'g1', endpoint: 'apns:ios-live', p256dh: 'native', auth: 'native' },
    { id: 's3', user_id: 'g1', endpoint: 'fcm:android-gone', p256dh: 'native', auth: 'native' },
    { id: 's4', user_id: 'g1', endpoint: 'https://push.example/e4', p256dh: 'k', auth: 'a' },
  ];
  const db = fakeSupabase({ push_subscriptions: subscriptions.map(s => ({ ...s })), notification_log: [] });
  const push = fakeWebPush();
  const nativeSent = [];
  const native = {
    async send(subscription, payload) {
      if (subscription.endpoint === 'fcm:android-gone') throw Object.assign(new Error('fcm: UNREGISTERED'), { statusCode: 410 });
      nativeSent.push({ endpoint: subscription.endpoint, payload });
    },
  };
  const tally = await deliver({ db, push, native, subscriptions, message: () => ['Title', 'Body'], dry: false, url: '/#week', kind: 'weekly', vapid: { publicKey: 'p', privateKey: 'q' } });
  assert.equal(tally.sent, 3);
  assert.equal(tally.reaped, 1);
  assert.deepEqual(push.sent.map(s => s.endpoint), ['e1', 'https://push.example/e4'], 'browser rows still go to Web Push');
  assert.deepEqual(nativeSent, [{ endpoint: 'apns:ios-live', payload: { title: 'Title', body: 'Body', url: '/#week' } }]);
  assert.deepEqual(db.tables.push_subscriptions.map(s => s.id), ['s1', 's2', 's4']);
});

test('only apns: and fcm: endpoints are native; a browser endpoint never reaches Apple or Google', async () => {
  const { nativePlatformOf } = await loadNative();
  assert.equal(nativePlatformOf('apns:abc'), 'ios');
  assert.equal(nativePlatformOf('fcm:abc'), 'android');
  for (const e of ['https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/abc', '', null, undefined]) assert.equal(nativePlatformOf(e), null, String(e));
});

test('the two direct senders route through sendPush rather than calling Web Push themselves', () => {
  const fs = require('node:fs');
  for (const name of ['notify-booking', 'notify-trainer-review']) {
    const src = fs.readFileSync(path.join(functions, name, 'handler.mjs'), 'utf8');
    assert.match(src, /sendPush\(\{ push, native \}/, name);
    assert.doesNotMatch(src, /sendNotification/, name + ' must route through sendPush');
  }
});
