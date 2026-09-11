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

const failed = results.filter(r => !r.ok);
console.log('MIGRATION REPLAY');
console.log('  total files applied :', files.length);
console.log('  succeeded           :', results.length - failed.length - 0);
console.log('  failed              :', failed.length);
console.log('');
for (const f of failed) {
  const firstError = (f.out.split('\n').find(l => /ERROR|FATAL/.test(l)) || f.out.split('\n')[0] || '').trim();
  console.log('  FAILED', f.file, '->', firstError.slice(0, 200));
}
fs.writeFileSync(path.join(process.env.PP_DB_OUT || SCRATCH, 'replay-report.json'), JSON.stringify(results, null, 2));
