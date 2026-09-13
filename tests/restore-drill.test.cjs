// tools/restore-drill.cjs is the check for a restore made by the hosting provider, the kind a real
// incident would use and nobody has yet checked. Against a database it runs in tests/db/restore-deletion.cjs
// (R12 and R13). These tests cover what does not need one: the verdict for every way a restored copy can
// differ, and that connection secrets never reach a process's argument list.
const test = require('node:test');
const assert = require('node:assert/strict');
const { connectionEnv, evaluate, main } = require('../tools/restore-drill.cjs');

const inventory = (objects) => ({ schema_fingerprint: 'f-' + Object.keys(objects).length, total: Object.keys(objects).length, objects });
const good = () => ({
  inventory: { ok: true, value: inventory({ 'table public.athletes': 'r|rls=true', 'policy public.athletes.read': 'select' }) },
  rls: { ok: true, value: 'athletes,teams' },
  excessGrants: { ok: true, value: '' },
  retention: { ok: true, value: { 'biometric-retention': true, 'company-body-assessment-retention': true } },
  rows: { ok: true, value: { athletes: 12, teams: 3 } },
  authUsers: { ok: true, value: 9 },
});
const failed = result => result.checks.filter(check => !check.ok).map(check => check.id);

test('a faithful copy passes every check', () => {
  const result = evaluate(good(), good());
  assert.equal(result.schema, 'PP_RESTORE_DRILL_V1');
  assert.deepEqual(failed(result), []);
  assert.equal(result.ok, true);
});

test('each way a restored copy can be wrong fails its own check', () => {
  const cases = [
    ['a table lost row-level security', t => { t.rls.value = 'teams'; t.inventory.value = inventory({ 'table public.athletes': 'r|rls=false', 'policy public.athletes.read': 'select' }); }, ['schema', 'rls']],
    ['a policy did not come back', t => { t.inventory.value = inventory({ 'table public.athletes': 'r|rls=true' }); }, ['schema']],
    ['tenants gained TRUNCATE', t => { t.excessGrants.value = 'authenticated:athletes:TRUNCATE'; }, ['privileges']],
    ['a retention job is missing', t => { delete t.retention.value['company-body-assessment-retention']; }, ['retention']],
    ['a retention job came back disabled', t => { t.retention.value['biometric-retention'] = false; }, ['retention']],
    ['a table lost rows', t => { t.rows.value.athletes = 11; }, ['rows']],
    ['accounts are missing', t => { t.authUsers.value = 8; }, ['auth_users']],
    ['the copy could not be read', t => { t.rows = { ok: false, error: 'FATAL: password authentication failed' }; }, ['rows']],
  ];
  for (const [what, damage, expected] of cases) {
    const target = good();
    damage(target);
    const result = evaluate(good(), target);
    assert.equal(result.ok, false, what);
    assert.deepEqual(failed(result), expected, what);
  }
});

test('a flattened AND chain is reported as formatting; a real regrouping or a changed literal still fails', () => {
  // The case found on the disposable cluster's own dump and restore, verbatim.
  const source = good();
  const target = good();
  source.inventory.value = inventory({ 'constraint public.t.label_check': 'CHECK ((((char_length(label) >= 1) AND (char_length(label) <= 100)) AND (label = btrim(label))))' });
  target.inventory.value = inventory({ 'constraint public.t.label_check': 'CHECK (((char_length(label) >= 1) AND (char_length(label) <= 100) AND (label = btrim(label))))' });
  const result = evaluate(source, target);
  assert.equal(result.ok, true);
  assert.deepEqual(result.checks.find(check => check.id === 'schema').detail.formattingOnly, ['constraint public.t.label_check'], 'formatting differences stay visible');

  source.inventory.value = inventory({ 'constraint public.t.c': 'CHECK (((a = 1) OR (b = 2)) AND (c = 3))' });
  target.inventory.value = inventory({ 'constraint public.t.c': 'CHECK ((a = 1) OR ((b = 2) AND (c = 3)))' });
  assert.deepEqual(failed(evaluate(source, target)), ['schema'], 'regrouping OR with AND changes meaning');

  source.inventory.value = inventory({ 'constraint public.t.c': "CHECK ((x = 'a(b)'))" });
  target.inventory.value = inventory({ 'constraint public.t.c': "CHECK ((x = 'ab'))" });
  assert.deepEqual(failed(evaluate(source, target)), ['schema'], 'parentheses inside a literal are data');

  source.inventory.value = inventory({ 'constraint public.t.c': 'CHECK ((x IS NOT NULL))' });
  target.inventory.value = inventory({ 'constraint public.t.c': 'CHECK (x IS NOT NULL AND y IS NOT NULL)' });
  assert.deepEqual(failed(evaluate(source, target)), ['schema']);
});

test('row drift is reported, and forgiven only when a restore to an earlier moment is declared', () => {
  const target = good();
  target.rows.value.athletes = 10;
  target.authUsers.value = 8;
  assert.deepEqual(failed(evaluate(good(), target)), ['rows', 'auth_users']);
  const allowed = evaluate(good(), target, { allowRowDrift: true });
  assert.equal(allowed.ok, true);
  const rows = allowed.checks.find(check => check.id === 'rows');
  assert.deepEqual(rows.detail.drift, [{ table: 'athletes', source: 12, target: 10 }], 'forgiven drift is still reported');
  // Drift never excuses a structural difference.
  target.excessGrants.value = 'anon:teams:TRIGGER';
  assert.deepEqual(failed(evaluate(good(), target, { allowRowDrift: true })), ['privileges']);
});

test('a comparison of nothing is not a pass', () => {
  const empty = () => { const s = good(); s.rls.value = ''; s.rows.value = {}; s.retention.value = {}; return s; };
  assert.deepEqual(failed(evaluate(empty(), empty())), ['rls', 'retention', 'rows']);
});

test('connection strings become PG environment variables, never arguments', () => {
  const env = connectionEnv('postgresql://postgres.ref:p%40ss%3Aword@db.example.invalid:6543/postgres?sslmode=require', 'PP_RESTORE_SOURCE');
  assert.deepEqual(env, { PGHOST: 'db.example.invalid', PGPORT: '6543', PGDATABASE: 'postgres', PGUSER: 'postgres.ref', PGPASSWORD: 'p@ss:word', PGSSLMODE: 'require' });
  assert.throws(() => connectionEnv('https://db.example.invalid/postgres', 'PP_RESTORE_TARGET'), /PP_RESTORE_TARGET must be a postgresql:\/\/ URL/);
  assert.throws(() => connectionEnv('not a url', 'PP_RESTORE_TARGET'), /is not a postgresql:\/\/ URL/);
});

test('the drill refuses to run without two different databases', () => {
  const quiet = { error: console.error };
  console.error = () => {};
  try {
    assert.equal(main([], {}), 2);
    const same = 'postgresql://u@db.example.invalid:5432/postgres';
    assert.equal(main([], { PP_RESTORE_SOURCE: same, PP_RESTORE_TARGET: same }), 2);
  } finally { console.error = quiet.error; }
});
