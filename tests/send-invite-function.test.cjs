// send-invite emails an invitation to follow a child's season. It is the product's only growth path and also a
// way to make Parent Playbook send mail to someone, so its guarantees are pinned here: only an owner or co-parent
// can trigger it, the recipient is never taken from the request, names from the database are escaped before they
// reach HTML, a failed send is reported, and database or runtime error text is not echoed. The logic now lives in
// handler.mjs; these tests use an in-memory Supabase and a recording fetch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakeSupabase, callerWithTables } = require('./support/fake-supabase.cjs');

const dir = path.join(__dirname, '../supabase/functions/send-invite');
const load = () => import(pathToFileURL(path.join(dir, 'handler.mjs')).href);
const NOW = new Date('2026-09-13T12:00:00Z');
const PARENT = { id: 'p1' };
const TEMPLATE = '<html><h1>{{invite_headline}}</h1><p>{{invite_intro}}</p><p>{{role_label}}</p><a href="{{invite_url}}">Open</a><p>{{athlete_first}} {{inviter_full}}</p></html>';

const post = (body, auth = 'Bearer user-token') => new Request('https://project.supabase.co/functions/v1/send-invite', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body),
});

function service(invite = {}, extra = {}) {
  return fakeSupabase({
    athlete_invites: [{ id: 'i1', athlete_id: 'a1', role: 'family_view', scope: 'athlete', token: 'tok en/1', invited_email: 'grandma@example.invalid', created_by: 'p1', expires_at: '2026-09-20T12:00:00Z', accepted_at: null, revoked_at: null, ...invite }],
    athletes: [{ id: 'a1', first_name: 'Sam', birthdate: '2016-01-01', family_id: 'f1' }, { id: 'a2', first_name: 'Ava', birthdate: '2018-01-01', family_id: 'f1' }],
    guardians: [{ id: 'p1', display_name: 'Jordan Parent' }],
    athlete_sports: [{ athlete_id: 'a1', sport_key: 'football', is_primary: true }],
    sports: [{ key: 'football', name: 'Football' }],
    ...extra,
  });
}
const owner = callerWithTables(PARENT, { athlete_access: [{ athlete_id: 'a1', guardian_id: 'p1', role: 'owner', revoked_at: null }] });

function recordingFetch({ template = TEMPLATE, resendStatus = 200 } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/emails/invite.html')) return new Response(template, { status: 200 });
    return new Response(JSON.stringify(resendStatus === 200 ? { id: 'email_1' } : { message: 'domain not verified: internal detail' }), { status: resendStatus });
  };
  return { calls, fetch, sends: () => calls.filter(call => call.url === 'https://api.resend.com/emails') };
}
const handlerWith = async (options) => (await load()).createSendInviteHandler({ env: { RESEND_API_KEY: 're_synthetic', SITE_URL: 'https://playbookbp.com' }, now: () => NOW, ...options });

test('an owner\'s invite is mailed to the address on the invite row, never one from the request', async () => {
  const net = recordingFetch();
  const handle = await handlerWith({ callerClient: owner, db: service(), fetch: net.fetch });
  const res = await handle(post({ invite_id: 'i1', to: 'attacker@example.invalid', email: 'attacker@example.invalid' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, id: 'email_1', to: 'grandma@example.invalid' });

  assert.equal(net.sends().length, 1);
  const sent = JSON.parse(net.sends()[0].init.body);
  assert.deepEqual(sent.to, ['grandma@example.invalid']);
  assert.equal(sent.subject, "Jordan wants you to follow Sam's season");
  assert.equal(sent.reply_to, 'support@playbookbp.com');
  assert.equal(net.sends()[0].init.headers.Authorization, 'Bearer re_synthetic');
  assert.match(sent.html, /href="https:\/\/playbookbp\.com\/\?invite=tok%20en%2F1"/, 'the link is built from the stored token, encoded');
  assert.match(sent.html, /Sam is 10 years old and plays Football\./);
  assert.ok(!JSON.stringify(sent).includes('attacker'));
});

test('names from the database are escaped before they reach the email HTML', async () => {
  const net = recordingFetch();
  const db = service();
  db.tables.athletes[0].first_name = '<img src=x onerror=alert(1)>';
  db.tables.guardians[0].display_name = 'Jordan "<b>" Parent';
  const res = await (await handlerWith({ callerClient: owner, db, fetch: net.fetch }))(post({ invite_id: 'i1' }));
  assert.equal(res.status, 200);
  const html = JSON.parse(net.sends()[0].init.body).html;
  assert.ok(!html.includes('<img'), 'no markup from a stored name');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /Jordan &quot;&lt;b&gt;&quot; Parent/);
});

test('a family-wide invite says so and counts the children', async () => {
  const net = recordingFetch();
  const res = await (await handlerWith({ callerClient: owner, db: service({ scope: 'family' }), fetch: net.fetch }))(post({ invite_id: 'i1' }));
  assert.equal(res.status, 200);
  const sent = JSON.parse(net.sends()[0].init.body);
  assert.equal(sent.subject, 'Jordan invited you to Parent Playbook for the whole family');
  assert.match(sent.html, /all 2 children in the household/);
});

test('only an owner or co-parent can send, through athlete access or family membership', async () => {
  const cases = [
    ['no Authorization header', callerWithTables(PARENT, {}), post({ invite_id: 'i1' }, null), 401],
    ['not signed in', callerWithTables(null, {}), post({ invite_id: 'i1' }), 401],
    ['no invite id', owner, post({}), 400],
    ['family view access', callerWithTables(PARENT, { athlete_access: [{ athlete_id: 'a1', guardian_id: 'p1', role: 'family_view', revoked_at: null }] }), post({ invite_id: 'i1' }), 403],
    ['revoked owner access', callerWithTables(PARENT, { athlete_access: [{ athlete_id: 'a1', guardian_id: 'p1', role: 'owner', revoked_at: '2026-09-01T00:00:00Z' }] }), post({ invite_id: 'i1' }), 403],
    ['a stranger', callerWithTables({ id: 'x9' }, {}), post({ invite_id: 'i1' }), 403],
  ];
  for (const [what, callerClient, request, status] of cases) {
    const net = recordingFetch();
    const res = await (await handlerWith({ callerClient, db: service(), fetch: net.fetch }))(request);
    assert.equal(res.status, status, what);
    assert.equal(net.sends().length, 0, what + ' must not send');
  }

  const coParentByFamily = callerWithTables(PARENT, { athletes: [{ id: 'a1', family_id: 'f1' }], family_members: [{ family_id: 'f1', guardian_id: 'p1', role: 'co_parent' }] });
  const net = recordingFetch();
  assert.equal((await (await handlerWith({ callerClient: coParentByFamily, db: service(), fetch: net.fetch }))(post({ invite_id: 'i1' }))).status, 200);
});

test('an invite that is gone, used, revoked or has no address is not sent, and database errors are not echoed', async () => {
  for (const [db, status] of [
    [service({ id: 'other' }), 404],
    [service({ revoked_at: '2026-09-12T00:00:00Z' }), 409],
    [service({ accepted_at: '2026-09-12T00:00:00Z' }), 409],
    [service({ invited_email: null }), 400],
  ]) {
    const net = recordingFetch();
    assert.equal((await (await handlerWith({ callerClient: owner, db, fetch: net.fetch }))(post({ invite_id: 'i1' }))).status, status);
    assert.equal(net.sends().length, 0);
  }
  const broken = fakeSupabase({}, { errors: { 'select:athlete_invites': { code: '08006', message: 'connection to 10.0.0.5 failed' } } });
  const res = await (await handlerWith({ callerClient: owner, db: broken, fetch: recordingFetch().fetch }))(post({ invite_id: 'i1' }));
  assert.equal(res.status, 500);
  assert.ok(!(await res.text()).includes('10.0.0.5'));
});

test('without an email key, a failed send or a wrong template, the caller is told and nothing looks delivered', async () => {
  const unconfigured = recordingFetch();
  const noKey = (await load()).createSendInviteHandler({ callerClient: owner, db: service(), fetch: unconfigured.fetch, env: {}, now: () => NOW });
  const res = await noKey(post({ invite_id: 'i1' }));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'email_not_configured');
  assert.equal(unconfigured.calls.length, 0);

  const rejected = recordingFetch({ resendStatus: 422 });
  const failed = await (await handlerWith({ callerClient: owner, db: service(), fetch: rejected.fetch }))(post({ invite_id: 'i1' }));
  assert.equal(failed.status, 502);
  const body = await failed.json();
  assert.deepEqual(body, { error: 'send_failed', status: 422 });

  const wrongFile = recordingFetch({ template: '<html>the site 404 page</html>' });
  const wrong = await (await handlerWith({ callerClient: owner, db: service(), fetch: wrongFile.fetch }))(post({ invite_id: 'i1' }));
  assert.equal(wrong.status, 500);
  assert.equal(wrongFile.sends().length, 0, 'an email without its link is never sent');
});

test('the entry point uses the publishable key for the caller and adds no logic', () => {
  const entry = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  assert.match(entry, /import \{ createSendInviteHandler \} from '\.\/handler\.mjs';/);
  assert.doesNotMatch(entry, /Deno\.env\.get\('SUPABASE_ANON_KEY'\)/);
  assert.doesNotMatch(entry, /\.from\(/);
});
