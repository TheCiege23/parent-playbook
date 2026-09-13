// tools/operations-check.cjs asserts a production posture snapshot, and tests/db/posture.sql is the
// query that produces one. Nothing tested either, and they drifted from the migrations: on
// 2026-09-12 external_composition_records gained a retention sweep, and the posture query never
// learned to count what that sweep leaves behind. A table could keep rows past their retention date
// while production still reported a clean posture. These tests hold the query, the checker and the
// migrations to each other, and prove the checker fails every way a snapshot can be wrong.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const posture = fs.readFileSync(path.join(root, 'tests/db/posture.sql'), 'utf8').replace(/\r\n/g, '\n');
const checkTool = path.join(root, 'tools/operations-check.cjs');
const migrationsDir = path.join(root, 'supabase/migrations');
const migrations = fs.readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort()
  .map(name => fs.readFileSync(path.join(migrationsDir, name), 'utf8').replace(/\r\n/g, '\n'));

function expectedChecks() {
  const source = fs.readFileSync(checkTool, 'utf8');
  const block = source.match(/const EXPECTED_CHECKS = \[([\s\S]*?)\];/);
  assert.ok(block, 'tools/operations-check.cjs no longer declares EXPECTED_CHECKS where this test looks for it');
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
}

test('posture.sql emits exactly the checks operations-check.cjs asserts', () => {
  const emitted = [...posture.matchAll(/^\s*'([a-z_]+)', jsonb_build_object\(\s*\n\s*'pass',/gm)].map(m => m[1]);
  assert.ok(emitted.length > 0, 'no checks found in posture.sql; the pattern has stopped matching it');
  assert.deepEqual([...emitted].sort(), [...expectedChecks()].sort());
});

test('every retention sweep that deletes by retention date is counted by the posture check', () => {
  // The latest definition of each sweep is the one the database runs.
  const sweeps = new Map();
  for (const sql of migrations) {
    for (const m of sql.matchAll(/create or replace function private\.(sweep_[a-z_]*retention)\(\)[\s\S]*?\$\$;/g)) sweeps.set(m[1], m[0]);
  }
  const tables = new Set();
  for (const body of sweeps.values()) {
    for (const d of body.matchAll(/delete from public\.([a-z_]+)(?:\s+[a-z]\b)?\s+where[^;]*?retention_until\s*<=\s*now\(\)/g)) tables.add(d[1]);
  }
  assert.ok(tables.size >= 4, 'expected at least the four date-based sweeps; found: ' + [...tables].join(', '));

  const gaps = [];
  for (const table of tables) {
    if (!new RegExp('from public\\.' + table + ' where retention_until <= now\\(\\)').test(posture)) gaps.push(table + ' is not counted');
    if (!new RegExp("\\(detail->>'" + table + "'\\)::integer = 0").test(posture)) gaps.push(table + ' is counted but not required to be zero');
  }
  assert.deepEqual(gaps, [],
    'a migration sweeps these tables by retention date, but tests/db/posture.sql does not check the outcome');
});

test('every scheduled retention sweep has a job name the posture check selects', () => {
  const jobs = [];
  for (const sql of migrations) {
    for (const m of sql.matchAll(/cron\.schedule\(\s*'([^']+)'\s*,\s*'[^']+'\s*,\s*\$\w*\$\s*select private\.(sweep_[a-z_]+)\(\)/g)) {
      jobs.push({ job: m[1], sweep: m[2] });
    }
  }
  const retention = jobs.filter(job => /retention/.test(job.sweep));
  assert.ok(retention.length >= 5, 'expected at least five scheduled retention sweeps; found ' + retention.length);
  assert.match(posture, /where j\.jobname like '%retention%'/, 'posture.sql selects retention jobs by name');
  assert.deepEqual(retention.filter(job => !job.job.includes('retention')).map(job => job.job), [],
    'these retention jobs are named so that posture.sql never sees whether they run');
});

function snapshot(t, mutate) {
  const recorded = JSON.parse(fs.readFileSync(path.join(root, 'tools/ops-evidence/posture-2026-09-10.json'), 'utf8'));
  if (mutate) mutate(recorded.checks);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-posture-'));
  t.after(() => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'posture.json');
  fs.writeFileSync(file, JSON.stringify(recorded));
  return file;
}
const verify = (...args) => spawnSync(process.execPath, [checkTool, '--verify', ...args], { encoding: 'utf8', windowsHide: true });

test('operations-check passes the recorded snapshot and fails each way a snapshot can be wrong', t => {
  const clean = verify(snapshot(t));
  assert.equal(clean.status, 0, clean.stdout);
  assert.match(clean.stdout, /Production matches the posture this repository expects/);

  const failing = verify(snapshot(t, checks => { checks.no_excess_tenant_grants = { pass: false, detail: ['athletes'] }; }));
  assert.equal(failing.status, 1);
  assert.match(failing.stdout, /FAIL\s+no_excess_tenant_grants/);

  const missing = verify(snapshot(t, checks => { delete checks.composition_gate_closed; }));
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /MISSING from the snapshot[\s\S]*composition_gate_closed/);

  const unknown = verify(snapshot(t, checks => { checks.something_new = { pass: true, detail: null }; }));
  assert.equal(unknown.status, 1);
  assert.match(unknown.stdout, /UNKNOWN in the snapshot[\s\S]*something_new/);

  // Only a literal true passes. A string that merely looks like one does not.
  const stringly = verify(snapshot(t, checks => { checks.rls_enabled_on_every_public_table.pass = 'true'; }));
  assert.equal(stringly.status, 1);
});

test('a waiver is printed as a forgiven failure, never as a pass, and forgives only what it names', t => {
  const file = snapshot(t, checks => {
    checks.composition_gate_closed = { pass: false, detail: { registered_providers: 1, stored_results: 0 } };
  });
  const waived = verify(file, '--allow', 'composition_gate_closed');
  assert.equal(waived.status, 0);
  assert.match(waived.stdout, /WAIVED composition_gate_closed/);
  assert.doesNotMatch(waived.stdout, /PASS\s+composition_gate_closed/);
  assert.match(waived.stdout, /A waiver is a debt, not a pass/);
  assert.equal(verify(file, '--allow', 'no_excess_tenant_grants').status, 1);
});

test('operations-check refuses to run without a readable snapshot', () => {
  assert.equal(spawnSync(process.execPath, [checkTool], { encoding: 'utf8', windowsHide: true }).status, 2);
  assert.equal(verify(path.join(os.tmpdir(), 'pp-no-such-posture-' + process.pid + '.json')).status, 2);
});
