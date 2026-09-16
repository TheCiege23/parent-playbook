// send-invite-sms texts an invitation. Without its rules it would be an open SMS relay with Parent Playbook's
// return address, so they are pinned here: only an owner or co-parent can trigger it, the number comes only from
// the invite row, a six-digit code is required, is the only free text accepted and must be the one issued for the
// invite, a blank display name never reads as "A invited you", a missing sender configuration
// names exactly what is missing, and a failed send is reported and not marked as sent. The logic now lives in
// handler.mjs; these tests use an in-memory Supabase and a recording fetch.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakeSupabase, callerWithTables } = require('./support/fake-supabase.cjs');

const dir = path.join(__dirname, '../supabase/functions/send-invite-sms');
const load = () => import(pathToFileURL(path.join(dir, 'handler.mjs')).href);
const PARENT = { id: 'p1' };
const CONFIG = { TWILIO_ACCOUNT_SID: 'AC_synthetic', TWILIO_AUTH_TOKEN: 'auth_synthetic', TWILIO_PHONE_NUMBER: '+15550000000', SITE_URL: 'https://playbookbp.com' };

const post = (body, auth = 'Bearer user-token') => new Request('https://project.supabase.co/functions/v1/send-invite-sms', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body),
});
// issue_invite_code() stores sha256(code || ':' || token) as hex; the invite row here holds the hash of `code`.
const hashOf = (code, token) => crypto.createHash('sha256').update(code + ':' + token).digest('hex');
const service = (invite = {}, code = '123456', displayName = 'Jordan Parent') => fakeSupabase({
  athlete_invites: [{ id: 'i1', athlete_id: 'a1', role: 'family_view', scope: 'athlete', token: 'tok1', invited_phone: '+15551234567', created_by: 'p1', expires_at: '2026-09-20T12:00:00Z', accepted_at: null, revoked_at: null,
    code_hash: code === null ? null : hashOf(code, invite.token ?? 'tok1'), ...invite }],
  athletes: [{ id: 'a1', first_name: 'Sam', family_id: 'f1' }],
  guardians: [{ id: 'p1', display_name: displayName }],
});
const owner = callerWithTables(PARENT, { athlete_access: [{ athlete_id: 'a1', guardian_id: 'p1', role: 'owner', revoked_at: null }] });
function recordingFetch(status = 201) {
  const calls = [];
  return { calls, fetch: async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(status < 300 ? { sid: 'SM_synthetic' } : { message: 'The To number is not a valid mobile number' }), { status }); } };
}
const handlerWith = async (options) => (await load()).createSendInviteSmsHandler({ env: CONFIG, ...options });

test('an owner\'s invite is texted to the number on the invite row, with the link, the code and the opt-out line', async () => {
  const net = recordingFetch();
  const db = service();
  const res = await (await handlerWith({ callerClient: owner, db, fetch: net.fetch }))(post({ invite_id: 'i1', code: '123456', to: '+19995550000', body: 'free SMS' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, sid: 'SM_synthetic' });

  assert.equal(net.calls.length, 1);
  assert.equal(net.calls[0].url, 'https://api.twilio.com/2010-04-01/Accounts/AC_synthetic/Messages.json');
  assert.equal(net.calls[0].init.headers.Authorization, 'Basic ' + Buffer.from('AC_synthetic:auth_synthetic').toString('base64'));
  const form = new URLSearchParams(net.calls[0].init.body);
  assert.equal(form.get('To'), '+15551234567', 'the number comes only from the invite row');
  assert.equal(form.get('From'), '+15550000000');
  assert.equal(form.get('Body'), "Jordan invited you to follow Sam's season on Parent Playbook.\n\nhttps://playbookbp.com/?invite=tok1\n\nYour code: 123456\n\nReply STOP to opt out.");
  assert.ok(!net.calls[0].init.body.includes('free SMS') && !net.calls[0].init.body.includes('9995550000'));
  assert.equal(db.tables.athlete_invites[0].sent_via, 'text');
});

test('an API key pair and a Messaging Service are preferred when configured', async () => {
  const net = recordingFetch();
  const env = { ...CONFIG, TWILIO_API_KEY: 'SK_synthetic', TWILIO_API_SECRET: 'secret_synthetic', TWILIO_MESSAGING_SERVICE_SID: 'MG_synthetic' };
  await (await handlerWith({ callerClient: owner, db: service({ scope: 'family' }, '654321'), fetch: net.fetch, env }))(post({ invite_id: 'i1', code: '654321' }));
  assert.equal(net.calls[0].init.headers.Authorization, 'Basic ' + Buffer.from('SK_synthetic:secret_synthetic').toString('base64'));
  const form = new URLSearchParams(net.calls[0].init.body);
  assert.equal(form.get('MessagingServiceSid'), 'MG_synthetic');
  assert.equal(form.get('From'), null);
  assert.match(form.get('Body'), /^Jordan invited you to follow the family's sports journey/);
});

test('without exactly six digits of code, nothing is looked up or sent', async () => {
  for (const code of [undefined, '', '12345', '1234567', 'abcdef', '123456 and a paragraph of text']) {
    const net = recordingFetch();
    const db = service();
    const res = await (await handlerWith({ callerClient: owner, db, fetch: net.fetch }))(post({ invite_id: 'i1', code }));
    assert.equal(res.status, 400, String(code));
    assert.equal((await res.json()).error, 'code_required');
    assert.equal(net.calls.length, 0);
  }
});

test('a code that is not the one issued for the invite is not texted, and only an editor learns that', async () => {
  // A text that asks for six digits which cannot open the invite strands its recipient.
  for (const [what, db] of [
    ['a different code', service({}, '999999')],
    ['an invite with no code issued', service({}, null)],
    ['the hash of this code with another token', service({ code_hash: hashOf('123456', 'other-token') })],
  ]) {
    const net = recordingFetch();
    const res = await (await handlerWith({ callerClient: owner, db, fetch: net.fetch }))(post({ invite_id: 'i1', code: '123456' }));
    assert.equal(res.status, 400, what);
    assert.equal((await res.json()).error, 'code_mismatch', what);
    assert.equal(net.calls.length, 0, what + ' must not send');
    assert.equal(db.tables.athlete_invites[0].sent_via, undefined, what);
  }
  const net = recordingFetch();
  const stranger = await (await handlerWith({ callerClient: callerWithTables({ id: 'x9' }, {}), db: service({}, '999999'), fetch: net.fetch }))(post({ invite_id: 'i1', code: '123456' }));
  assert.equal(stranger.status, 403, 'the permission gate answers before the code is compared');
});

test('with no display name the text says "You\'re invited", never "A invited you"', async () => {
  for (const [scope, opening] of [
    ['athlete', "You're invited to follow Sam's season on Parent Playbook."],
    ['family', "You're invited to follow the family's sports journey on Parent Playbook."],
  ]) {
    for (const displayName of [null, '', '   ']) {
      const net = recordingFetch();
      const res = await (await handlerWith({ callerClient: owner, db: service({ scope }, '123456', displayName), fetch: net.fetch }))(post({ invite_id: 'i1', code: '123456' }));
      assert.equal(res.status, 200);
      const body = new URLSearchParams(net.calls[0].init.body).get('Body');
      assert.ok(body.startsWith(opening + '\n\n'), `${scope}, ${JSON.stringify(displayName)}: ${body}`);
      assert.doesNotMatch(body, /\bA (invited|parent)\b/);
      assert.match(body, /Your code: 123456/);
    }
  }
});

test('only an owner or co-parent can send, and a used, revoked or numberless invite is not sent', async () => {
  const cases = [
    [callerWithTables(PARENT, {}), post({ invite_id: 'i1', code: '123456' }, null), service(), 401],
    [callerWithTables({ id: 'x9' }, {}), post({ invite_id: 'i1', code: '123456' }), service(), 403],
    [callerWithTables(PARENT, { athlete_access: [{ athlete_id: 'a1', guardian_id: 'p1', role: 'family_view', revoked_at: null }] }), post({ invite_id: 'i1', code: '123456' }), service(), 403],
    [owner, post({ invite_id: 'i1', code: '123456' }), service({ revoked_at: '2026-09-12T00:00:00Z' }), 409],
    [owner, post({ invite_id: 'i1', code: '123456' }), service({ invited_phone: null }), 400],
    [owner, post({ invite_id: 'nope', code: '123456' }), service(), 404],
  ];
  for (const [callerClient, request, db, status] of cases) {
    const net = recordingFetch();
    const res = await (await handlerWith({ callerClient, db, fetch: net.fetch }))(request);
    assert.equal(res.status, status);
    assert.equal(net.calls.length, 0);
  }
});

test('a missing sender configuration names exactly what is missing and sends nothing', async () => {
  const net = recordingFetch();
  const res = await (await handlerWith({ callerClient: owner, db: service(), fetch: net.fetch, env: { TWILIO_ACCOUNT_SID: 'AC_synthetic' } }))(post({ invite_id: 'i1', code: '123456' }));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.deepEqual(body.missing, ['TWILIO_AUTH_TOKEN (or TWILIO_API_KEY + TWILIO_API_SECRET)', 'TWILIO_PHONE_NUMBER (or TWILIO_MESSAGING_SERVICE_SID)']);
  assert.equal(net.calls.length, 0);
});

test('a rejected text is reported and not marked as sent, and database errors are not echoed', async () => {
  const net = recordingFetch(400);
  const db = service();
  const res = await (await handlerWith({ callerClient: owner, db, fetch: net.fetch }))(post({ invite_id: 'i1', code: '123456' }));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'send_failed');
  assert.equal(db.tables.athlete_invites[0].sent_via, undefined);

  const broken = fakeSupabase({}, { errors: { 'select:athlete_invites': { code: '08006', message: 'connection to 10.0.0.5 failed' } } });
  const failed = await (await handlerWith({ callerClient: owner, db: broken, fetch: recordingFetch().fetch }))(post({ invite_id: 'i1', code: '123456' }));
  assert.equal(failed.status, 500);
  assert.ok(!(await failed.text()).includes('10.0.0.5'));
});

test('the entry point uses the publishable key for the caller and adds no logic', () => {
  const entry = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  assert.match(entry, /import \{ createSendInviteSmsHandler \} from '\.\/handler\.mjs';/);
  assert.doesNotMatch(entry, /Deno\.env\.get\('SUPABASE_ANON_KEY'\)/);
  assert.doesNotMatch(entry, /\.from\(/);
});
