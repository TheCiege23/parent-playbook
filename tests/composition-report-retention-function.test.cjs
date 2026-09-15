// composition-report-retention removes the stored report files that hold back a body composition record due for
// deletion, through the Storage API, and then runs the sweep. The nightly SQL sweep cannot: the database refuses to
// delete an attachment whose file is still stored, and only the Storage API removes a file (20260915200000). These run
// the handler against a recording stand-in for the service client, and pin who may call it, the order, the batches
// and every way it can stop.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const dir = path.join(__dirname, '../supabase/functions/composition-report-retention');
const load = () => import(pathToFileURL(path.join(dir, 'handler.mjs')).href);
const SERVICE_KEY = 'synthetic-service-key';

function stand({ due = [], dueError = null, removeError = null, swept = 0, sweepError = null } = {}) {
  const events = [];
  const db = {
    rpc: async (name, args) => {
      events.push(['rpc', name, args]);
      if (name === 'composition_reports_due_for_removal') return { data: dueError ? null : due, error: dueError };
      if (name === 'run_external_composition_retention') return { data: sweepError ? null : swept, error: sweepError };
      throw new Error('unexpected rpc ' + name);
    },
    from(table) { throw new Error('the function reads no table directly: ' + table); },
    storage: { from: bucket => ({ remove: async keys => { events.push(['remove', bucket, [...keys]]); return { error: removeError }; } }) },
  };
  return { db, events };
}
const call = (bearer = SERVICE_KEY) => new Request('https://project.supabase.co/functions/v1/composition-report-retention', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) }, body: '{}',
});
const keys = n => Array.from({ length: n }, (_, i) => ({ record_uuid: 'r' + i, storage_key: 'r' + i + '/report.pdf' }));

test('the reports holding back due records go through Storage, then the sweep runs', async () => {
  const { createCompositionReportRetentionHandler } = await load();
  const s = stand({ due: [...keys(2), { record_uuid: 'r1', storage_key: 'r1/report.pdf' }], swept: 2 });
  const res = await createCompositionReportRetentionHandler({ db: s.db, env: { SERVICE_KEY } })(call());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, reports_removed: 2, records_deleted: 2, more: false });
  assert.deepEqual(s.events, [
    ['rpc', 'composition_reports_due_for_removal', { p_limit: 500 }],
    ['remove', 'composition-reports', ['r0/report.pdf', 'r1/report.pdf']],
    ['rpc', 'run_external_composition_retention', undefined],
  ], 'listed, removed once each, then swept');
});

test('files go a hundred at a time, and a full batch says there is more', async () => {
  const { createCompositionReportRetentionHandler } = await load();
  const s = stand({ due: keys(250), swept: 250 });
  const res = await createCompositionReportRetentionHandler({ db: s.db, env: { SERVICE_KEY }, batch: 250 })(call());
  const body = await res.json();
  assert.deepEqual(s.events.filter(e => e[0] === 'remove').map(e => e[2].length), [100, 100, 50]);
  assert.equal(body.more, true);
  assert.equal(body.reports_removed, 250);
});

test('with nothing held back it still sweeps', async () => {
  const { createCompositionReportRetentionHandler } = await load();
  const s = stand({ due: [], swept: 3 });
  const res = await createCompositionReportRetentionHandler({ db: s.db, env: { SERVICE_KEY } })(call());
  assert.deepEqual(await res.json(), { ok: true, reports_removed: 0, records_deleted: 3, more: false });
  assert.equal(s.events.filter(e => e[0] === 'remove').length, 0);
});

test('a file Storage will not remove stops the run before the sweep, and says how many went', async () => {
  const { createCompositionReportRetentionHandler } = await load();
  const s = stand({ due: keys(150), removeError: { message: 'storage unavailable' } });
  const res = await createCompositionReportRetentionHandler({ db: s.db, env: { SERVICE_KEY } })(call());
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'could not remove every due report', reports_removed: 0 });
  assert.equal(s.events.filter(e => e[1] === 'run_external_composition_retention').length, 0);
});

test('a list or a sweep that fails is reported, not passed off as done', async () => {
  const { createCompositionReportRetentionHandler } = await load();
  const listing = stand({ dueError: { message: 'permission denied for function composition_reports_due_for_removal' } });
  const a = await createCompositionReportRetentionHandler({ db: listing.db, env: { SERVICE_KEY } })(call());
  assert.equal(a.status, 500);
  assert.equal(listing.events.filter(e => e[0] === 'remove').length, 0);
  const sweeping = stand({ due: keys(1), sweepError: { message: 'deadlock detected' } });
  const b = await createCompositionReportRetentionHandler({ db: sweeping.db, env: { SERVICE_KEY } })(call());
  assert.equal(b.status, 500);
  assert.deepEqual(await b.json(), { error: 'the reports were removed but the sweep failed', reports_removed: 1 });
});

test('only the scheduler may run it', async () => {
  const { createCompositionReportRetentionHandler } = await load();
  for (const bearer of [null, 'a-signed-in-parent', 'x.' + Buffer.from(JSON.stringify({ role: 'authenticated' })).toString('base64') + '.y']) {
    const s = stand({ due: keys(1) });
    const res = await createCompositionReportRetentionHandler({ db: s.db, env: { SERVICE_KEY } })(call(bearer));
    assert.equal(res.status, 403, String(bearer));
    assert.deepEqual(s.events, [], 'nothing is read or removed for anyone else');
  }
});

test('the entry point holds the service role and adds no logic, and the migration schedules it before the SQL sweep', () => {
  const entry = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  assert.match(entry, /import \{ createCompositionReportRetentionHandler \} from '\.\/handler\.mjs';/);
  assert.match(entry, /env: \{ SERVICE_KEY: SERVICE \},/);
  assert.doesNotMatch(entry, /\.rpc\(|\.from\(|\.storage/);
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260915200000_composition_report_removal.sql'), 'utf8');
  assert.match(migration, /cron\.schedule\('external-composition-report-retention', '45 3 \* \* \*'/);
  assert.match(migration, /functions\/v1\/composition-report-retention/);
  assert.match(migration, /grant execute on function public\.composition_reports_due_for_removal\(integer\) to service_role;/);
  assert.match(migration, /grant execute on function public\.run_external_composition_retention\(\) to service_role;/);
});
