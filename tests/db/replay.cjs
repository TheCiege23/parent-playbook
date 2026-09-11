// Replay the real Parent Playbook migration history into the disposable isolated cluster.
// Each migration runs in its own transaction. A failure is recorded and replay continues,
// so the report can state exactly which migrations could not run here and why.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function harnessContext() {
  const psql = process.env.PP_DB_PSQL;
  const conn = process.env.PP_DB_CONN;
  if (!psql || !conn) {
    throw new Error('Run this through tests/db/run.cjs. It creates a disposable cluster and supplies PP_DB_PSQL and PP_DB_CONN; this file will not connect to a server it did not create.');
  }
  return { psql, conn: JSON.parse(conn) };
}
const { psql: PSQL, conn: CONN } = harnessContext();
const REPO = path.resolve(__dirname, '..', '..');
// PP_DB_MIGRATIONS lets the handover package verify itself: same replay, different source.
const MIGRATIONS = process.env.PP_DB_MIGRATIONS || path.join(REPO, 'supabase/migrations');
const SCRATCH = __dirname;

function psqlFile(file, { single = true } = {}) {
  const args = [...CONN, '-v', 'ON_ERROR_STOP=1', '-X', '-q'];
  if (single) args.push('--single-transaction');
  args.push('-f', file);
  try {
    const out = execFileSync(PSQL, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    return { ok: true, out };
  } catch (error) {
    return { ok: false, out: (error.stdout || '') + (error.stderr || '') };
  }
}

const results = [];
const preamble = psqlFile(path.join(SCRATCH, '00-preamble.sql'));
results.push({ file: '00-preamble.sql (harness)', ...preamble });
if (!preamble.ok) { console.log(preamble.out); process.exit(1); }

const files = fs.readdirSync(MIGRATIONS).filter(n => n.endsWith('.sql')).sort();
const HOOKS = { '20260730143035_identity_and_access.sql': '05-post-identity-seed.sql' };
for (const name of files) {
  const r = psqlFile(path.join(MIGRATIONS, name));
  results.push({ file: name, ok: r.ok, out: r.out.trim() });
  if (HOOKS[name]) {
    const h = psqlFile(path.join(SCRATCH, HOOKS[name]));
    results.push({ file: HOOKS[name] + ' (harness hook)', ok: h.ok, out: h.out.trim() });
  }
}

// Harness steps are counted apart from migrations. Folding them into one total made the
// summary contradict itself: the file count said 79 while succeeded said 80, because the
// preamble and the post-identity seed hook were being credited as migrations. A report whose
// own three numbers do not reconcile invites doubt about everything else in it, and the
// question this file exists to answer is about the real migration history, not about the
// harness that hosts it.
const isHarness = r => / \(harness( hook)?\)$/.test(r.file);
const migrations = results.filter(r => !isHarness(r));
const harness = results.filter(isHarness);
const failedMigrations = migrations.filter(r => !r.ok);
const failedHarness = harness.filter(r => !r.ok);
const failed = [...failedMigrations, ...failedHarness];
// One results row per migration file, or the counts below describe something other than
// what was on disk.
if (migrations.length !== files.length) {
  throw new Error(`replay recorded ${migrations.length} migration results for ${files.length} files on disk`);
}
console.log('MIGRATION REPLAY');
console.log('  migration files     :', files.length);
console.log('  migrations applied  :', migrations.length - failedMigrations.length);
console.log('  migrations failed   :', failedMigrations.length);
console.log('  harness steps       :', `${harness.length - failedHarness.length}/${harness.length}`,
  '(' + harness.map(h => h.file.replace(/ \(harness( hook)?\)$/, '')).join(', ') + ')');
console.log('');
for (const f of failed) {
  const firstError = (f.out.split('\n').find(l => /ERROR|FATAL/.test(l)) || f.out.split('\n')[0] || '').trim();
  console.log('  FAILED', f.file, '->', firstError.slice(0, 200));
}
fs.writeFileSync(path.join(process.env.PP_DB_OUT || SCRATCH, 'replay-report.json'), JSON.stringify(results, null, 2));
