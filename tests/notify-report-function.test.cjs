// notify-report emails support about each parent report of a coach's message, once, so the 24-hour review promised
// to App Review is something a person can keep. Only the scheduler may call it, a report is stamped only after the
// email is accepted, and the subject never names a child.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakeSupabase } = require('./support/fake-supabase.cjs');

const load = () => import(pathToFileURL(path.join(__dirname, '../supabase/functions/notify-report/handler.mjs')).href);
const post = (body, bearer = 'service-key') => new Request('https://project.supabase.co/functions/v1/notify-report', {
  method: 'POST', headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const world = () => fakeSupabase({
  coach_update_reports: [
    { id: 'r1', update_id: 'u1', reason: 'He asked Sam to <keep it secret>', status: 'open', created_at: '2026-10-07T14:00:00Z', support_alerted_at: null },
    { id: 'r2', update_id: 'u2', reason: 'Rude', status: 'open', created_at: '2026-10-07T15:00:00Z', support_alerted_at: null },
    { id: 'r3', update_id: 'u1', reason: 'Already emailed', status: 'open', created_at: '2026-10-07T13:00:00Z', support_alerted_at: '2026-10-07T13:01:00Z' },
    { id: 'r4', update_id: 'u1', reason: 'Closed', status: 'reviewed', created_at: '2026-10-07T12:00:00Z', support_alerted_at: null },
  ],
  coach_updates: [
    { id: 'u1', athlete_id: 'a1', sender_id: 'c1', body: 'our secret', auto_flagged: true },
    { id: 'u2', athlete_id: 'a1', sender_id: 'c1', body: 'You played badly', auto_flagged: false },
  ],
  athletes: [{ id: 'a1', first_name: 'Sam' }],
  guardians: [{ id: 'c1', display_name: 'Coach Dee' }],
});
const fakeResend = (status = 200) => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return new Response('{}', { status }); };
  return { sent, fetchImpl };
};
const handlerWith = async (db, resend, env = {}) => (await load()).createNotifyReportHandler({
  db, fetchImpl: resend.fetchImpl, env: { SERVICE_KEY: 'service-key', RESEND_API_KEY: 're_test', ...env }, now: () => new Date('2026-10-07T16:00:00Z'),
});

test('only the scheduler may call it, and it says so when Resend is not configured', async () => {
  const resend = fakeResend();
  assert.equal((await (await handlerWith(world(), resend))(post({}, 'a-parent-token'))).status, 403);
  assert.equal((await (await handlerWith(world(), resend, { RESEND_API_KEY: '' }))(post({}))).status, 503);
  assert.deepEqual(resend.sent, []);
});

test('the sweep emails each open, unalerted report to support once, oldest first, and stamps it', async () => {
  const db = world();
  const resend = fakeResend();
  const res = await (await handlerWith(db, resend))(post({}));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).sent, 2);
  assert.deepEqual(resend.sent.map(s => s.url), ['https://api.resend.com/emails', 'https://api.resend.com/emails']);
  assert.deepEqual(resend.sent.map(s => s.body.to), [['support@playbookbp.com'], ['support@playbookbp.com']]);
  assert.match(resend.sent[0].body.html, /He asked Sam to &lt;keep it secret&gt;/, 'the reason is escaped, not rendered');
  assert.match(resend.sent[0].body.html, /Auto-flagged too<\/td><td>Yes/);
  assert.match(resend.sent[0].body.html, /Team Connect safety/);
  const stamped = Object.fromEntries(db.tables.coach_update_reports.map(r => [r.id, r.support_alerted_at]));
  assert.equal(stamped.r1, '2026-10-07T16:00:00.000Z');
  assert.equal(stamped.r2, '2026-10-07T16:00:00.000Z');
  assert.equal(stamped.r3, '2026-10-07T13:01:00Z', 'an already-alerted report is not emailed again');
  assert.equal(stamped.r4, null, 'a closed report is not emailed');

  const again = await (await handlerWith(db, resend))(post({}));
  assert.deepEqual(await again.json(), { ok: true, pending: 0, sent: 0 });
  assert.equal(resend.sent.length, 2);
});

test('the trigger names one report, and only that one is sent', async () => {
  const db = world();
  const resend = fakeResend();
  const res = await (await handlerWith(db, resend))(post({ report_id: 'r2' }));
  assert.equal((await res.json()).sent, 1);
  assert.equal(resend.sent.length, 1);
  assert.match(resend.sent[0].body.html, /You played badly/);
  assert.equal(db.tables.coach_update_reports.find(r => r.id === 'r1').support_alerted_at, null);
});

test('a refused email leaves the report unstamped, so the next sweep retries it', async () => {
  const db = world();
  const resend = fakeResend(500);
  const res = await (await handlerWith(db, resend))(post({}));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).failures.length, 2);
  assert.ok(db.tables.coach_update_reports.filter(r => r.id === 'r1' || r.id === 'r2').every(r => r.support_alerted_at === null));
});

test('the subject gives the 24-hour deadline in Eastern time and names no child', async () => {
  const { reportEmail } = await load();
  const { subject } = reportEmail({ report: { id: 'r1', reason: 'x', created_at: '2026-10-07T14:00:00Z' }, update: null, athleteName: 'Sam', senderName: 'Coach Dee' });
  assert.equal(subject, 'Report to review by Thu, Oct 8, 10:00 AM EDT: Team Connect message');
  assert.doesNotMatch(subject, /Sam|Coach Dee/);
});

test('the migration alerts on every report insert, retries every 15 minutes, and never blocks the insert', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261007120000_report_support_alert.sql'), 'utf8');
  assert.match(sql, /add column if not exists support_alerted_at timestamptz/);
  assert.match(sql, /after insert on public\.coach_update_reports\s+for each row execute function private\.alert_support_on_report\(\)/);
  assert.match(sql, /exception when others then/);
  assert.match(sql, /security definer\s+set search_path = ''/);
  assert.match(sql, /cron\.schedule\('report-alert-sweep', '\*\/15 \* \* \* \*'/);
  assert.equal((sql.match(/functions\/v1\/notify-report'/g) || []).length, 2);
});
