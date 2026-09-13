// Restore and deletion rehearsals, executed against the disposable cluster that
// tests/db/run.cjs creates. NEVER point this at production.
//
// These answer two questions the security suite deliberately does not, because both
// need committed state that survives a transaction:
//
//   Deletion — when a record is deleted, is it actually gone? Not "did the DELETE
//   return success", but: is the row absent, is the deletion recorded, does the audit
//   trail avoid keeping a copy of the values that were supposed to be deleted, and
//   does the scheduled retention sweep really remove expired rows?
//
//   Restore — if this database were rebuilt from a dump, would it come back the same?
//   The interesting failures are not missing tables. They are row-level security
//   silently arriving disabled, and table privileges arriving wider than they left,
//   because those restore as configuration rather than as data and a restored copy
//   that looks complete can be wide open.
//
// Cases here COMMIT. Each one cleans up after itself, and the whole file runs against a
// cluster that is destroyed afterwards regardless.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BINDIR = process.env.PP_DB_BINDIR;
const PORT = process.env.PP_DB_PORT;
const USER = process.env.PP_DB_USER;
const DB = process.env.PP_DB_NAME;
if (!PORT || !USER || !DB) {
  throw new Error('Run this through tests/db/run.cjs. It creates a disposable cluster and supplies the connection; this file will not connect to a server it did not create.');
}
const EXE = process.platform === 'win32' ? '.exe' : '';
const bin = name => (BINDIR ? path.join(BINDIR, name + EXE) : name + EXE);
const connTo = database => ['-h', '127.0.0.1', '-p', PORT, '-U', USER, '-d', database];

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ADMIN_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ADMIN_B = 'bbbbbbbb-0000-4000-8000-00000000000b';

// Losing the connection is not an answer about the schema. See the note in
// security-tests.cjs: a killed backend puts the cluster into crash recovery and any
// statement in flight returns a connection error that says nothing about the database.
const CONNECTION_FAULT = /connection to server|server closed the connection unexpectedly|is in recovery mode|not yet accepting connections|Connection refused|could not connect/i;
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Runs SQL and returns trimmed output. Throws with the server's message on error.
function sql(text, { database = DB, expectError = false } = {}) {
  const file = path.join(os.tmpdir(), 'pp-reh-' + Math.random().toString(36).slice(2) + '.sql');
  fs.writeFileSync(file, text, 'utf8');
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const out = execFileSync(bin('psql'), [...connTo(database), '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-f', file],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        if (expectError) throw new Error('expected an error, but the statement succeeded');
        return out.trim();
      } catch (error) {
        if (error.status === undefined) throw error; // our own assertion, not psql's
        const detail = ((error.stdout || '') + (error.stderr || '')).trim() || error.message;
        if (attempt < 20 && CONNECTION_FAULT.test(detail)) { pause(500); continue; }
        if (expectError) {
          const line = detail.split('\n').find(l => /ERROR:/.test(l)) || '';
          return line.replace(/^.*ERROR:\s*/, '').trim();
        }
        throw new Error(detail.split('\n').slice(0, 4).join(' | '));
      }
    }
  } finally { try { fs.unlinkSync(file); } catch {} }
}

const results = [];
function check(id, group, description, fn) {
  try {
    fn();
    results.push({ id, group, description, ok: true });
  } catch (error) {
    results.push({ id, group, description, ok: false, error: error.message });
  }
}
const eq = (actual, expected, what) => {
  if (String(actual) !== String(expected)) throw new Error(`${what}: expected ${expected}, got ${actual}`);
};

// A committed record, cleaned up by the case that made it.
const RESULT_ID = 'rehearsal-result-001';
const ASSESSMENT_ID = 'rehearsal-assessment-001';

// The table requires retention_until > captured_at and no more than 400 days after it,
// so an already-expired row is made by dating the whole record in the past — not by
// pointing retention backwards, which the schema rightly refuses.
const LIVE = { captured: '2026-09-10T04:00:00Z', created: '2026-09-10T04:00:00Z', saved: '2026-09-10T04:05:00Z', retention: '2026-10-10T04:00:00Z' };
const EXPIRED = { captured: '2024-01-01T00:00:00Z', created: '2024-01-01T00:00:00Z', saved: '2024-01-01T00:05:00Z', retention: '2024-02-01T00:00:00Z' };

function insertRecord({ result = RESULT_ID, assessment = ASSESSMENT_ID, team = ORG_A, dates = LIVE } = {}) {
  const d = dates;
  const payload = `public.test_composition_payload('${result}','${assessment}','synthetic-subject-001','adult_reference','${team}','${ADMIN_A}','synthetic-permission-001','${d.captured}','${d.created}','${d.saved}','${d.retention}')`;
  sql(`insert into public.company_composition_results(
    result_id,assessment_id,team_id,subject_reference,subject_scope,athlete_id,consent_reference,created_by,
    provider_id,model_id,model_version,captured_at,created_at_source,saved_at,retention_until,record)
  values ('${result}','${assessment}','${team}','synthetic-subject-001','adult_reference',null,'synthetic-permission-001','${ADMIN_A}',
    'synthetic-provider','synthetic-composition-model','0.0.1-test','${d.captured}','${d.created}','${d.saved}','${d.retention}',${payload});`);
}

// A JWT claim set with set_config(...,true) is transaction-local, and `set local role`
// is too. Running the statements one per implicit transaction would drop both before the
// DELETE ran — the delete would then be attempted as the table owner with no claims,
// which silently changes what the case is testing. Everything acting as a user goes
// through here, in one explicit transaction that commits.
function asUser(uid, statements) {
  return sql([
    'begin;',
    `select set_config('request.jwt.claims','{"sub":"${uid}","role":"authenticated"}',true);`,
    'set local role authenticated;',
    statements,
    'commit;',
  ].join('\n'));
}
const cleanup = () => sql(`delete from public.company_composition_results where result_id like 'rehearsal-%';
  delete from public.access_log where detail->>'result_id' like 'rehearsal-%';`);

// =============================================================== D. deletion rehearsal
check('D01', 'deletion', 'an owning org admin deleting a record removes the row', () => {
  cleanup(); insertRecord();
  eq(sql(`select count(*) from public.company_composition_results where result_id='${RESULT_ID}';`), 1, 'row present before delete');
  asUser(ADMIN_A, `delete from public.company_composition_results where result_id='${RESULT_ID}';`);
  eq(sql(`select count(*) from public.company_composition_results where result_id='${RESULT_ID}';`), 0, 'row absent after delete');
  cleanup();
});

check('D02', 'deletion', 'the deletion is recorded as its own audit action', () => {
  cleanup(); insertRecord();
  asUser(ADMIN_A, `delete from public.company_composition_results where result_id='${RESULT_ID}';`);
  eq(sql(`select count(*) from public.access_log
    where action='company_composition_result_delete' and detail->>'result_id'='${RESULT_ID}';`), 1, 'one delete audit row');
  eq(sql(`select detail->>'assessment_id' from public.access_log
    where action='company_composition_result_delete' and detail->>'result_id'='${RESULT_ID}';`), ASSESSMENT_ID, 'audit names the assessment');
  cleanup();
});

check('D03', 'deletion', 'the audit trail does not retain the values that were deleted', () => {
  // The property that decides whether deletion means anything. If the audit row copied
  // the payload, the outputs would survive the delete inside the audit table and the
  // record would only appear to be gone.
  cleanup(); insertRecord();
  asUser(ADMIN_A, `delete from public.company_composition_results where result_id='${RESULT_ID}';`);
  const detail = sql(`select detail::text from public.access_log
    where action='company_composition_result_delete' and detail->>'result_id'='${RESULT_ID}';`);
  for (const key of ['outputs', 'lean_mass', 'uncertainty', 'measurements', 'value']) {
    if (detail.includes(key)) throw new Error(`the delete audit row retains "${key}": ${detail.slice(0, 200)}`);
  }
  cleanup();
});

check('D04', 'deletion', 'an admin of another organization cannot delete the record', () => {
  cleanup(); insertRecord();
  asUser(ADMIN_B, `delete from public.company_composition_results where result_id='${RESULT_ID}';`);
  // RLS makes the row invisible rather than raising: the delete affects nothing.
  eq(sql(`select count(*) from public.company_composition_results where result_id='${RESULT_ID}';`), 1,
    'the row survives a cross-organization delete');
  cleanup();
});

check('D05', 'deletion', 'the retention sweep removes an expired row and leaves a current one', () => {
  cleanup();
  insertRecord({ result: 'rehearsal-expired-001', assessment: 'rehearsal-assessment-expired', dates: EXPIRED });
  insertRecord({ result: 'rehearsal-current-001', assessment: 'rehearsal-assessment-current', dates: LIVE });
  sql('select private.sweep_company_composition_retention();');
  eq(sql(`select count(*) from public.company_composition_results where result_id='rehearsal-expired-001';`), 0, 'expired row swept');
  eq(sql(`select count(*) from public.company_composition_results where result_id='rehearsal-current-001';`), 1, 'current row kept');
  cleanup();
});

check('D06', 'deletion', 'the sweep records its deletions in the audit trail', () => {
  cleanup();
  insertRecord({ result: 'rehearsal-expired-002', assessment: 'rehearsal-assessment-expired-2', dates: EXPIRED });
  sql('select private.sweep_company_composition_retention();');
  eq(sql(`select count(*) from public.access_log
    where action='company_composition_result_delete' and detail->>'result_id'='rehearsal-expired-002';`), 1,
    'a scheduled deletion is audited like any other');
  cleanup();
});

check('D07', 'deletion', 'tenant roles cannot run the retention sweep themselves', () => {
  const error = sql(`begin; set local role authenticated; select private.sweep_company_composition_retention(); commit;`, { expectError: true });
  if (!/permission denied|does not exist/i.test(error)) throw new Error('expected a permission failure, got: ' + error);
});

// =============================================================== R. restore rehearsal
// =============================================================== D. the live deletion rehearsal
// tests/company-deletion-live-rls.sql is written to run against production, with the owner's
// authorization, as an organization administrator under row-level security. It is only worth running
// there once it is known to pass where it should and fail where it should, so both are proven here.
const LIVE_DELETION = fs.readFileSync(path.join(__dirname, '..', 'company-deletion-live-rls.sql'), 'utf8');
const rehearsalResidue = () => sql(`select (select count(*) from public.teams where name = 'Synthetic Deletion Organization')
  + (select count(*) from public.company_body_assessments where assessment_id like 'deletion-rehearsal-%')
  + (select count(*) from public.company_reference_assessments where assessment_id like 'deletion-rehearsal-%')
  + (select count(*) from public.access_log where detail->>'assessment_id' like 'deletion-rehearsal-%');`);

check('D08', 'deletion', 'the live deletion rehearsal passes under row-level security and leaves nothing behind', () => {
  const out = sql(LIVE_DELETION);
  if (!/"ok" : true/.test(out)) throw new Error('the rehearsal did not report ok: ' + out.slice(-300));
  eq(rehearsalResidue(), 0, 'rows left behind by a rehearsal that ends in rollback');
});

check('D09', 'deletion', 'the live deletion rehearsal fails when another account is allowed to delete', () => {
  const marker = "select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true); -- another account";
  if (LIVE_DELETION.split(marker).length !== 2) throw new Error('the other-account step was not found exactly once');
  const broken = LIVE_DELETION.replace(marker, "select set_config('request.jwt.claim.sub', (select actor_id::text from company_deletion_context), true); -- another account");
  const message = sql(broken, { expectError: true });
  if (!/row-level security did not refuse it/.test(message)) throw new Error('the rehearsal failed for a different reason: ' + message);
  eq(rehearsalResidue(), 0, 'rows left behind by the failed rehearsal');
});

const DUMP = path.join(os.tmpdir(), 'pp-rehearsal-dump.sql');
const RESTORED = 'pp_restore_rehearsal';

check('R01', 'restore', 'the database dumps without error', () => {
  cleanup(); insertRecord();
  execFileSync(bin('pg_dump'), ['-h', '127.0.0.1', '-p', PORT, '-U', USER, '-d', DB, '-f', DUMP],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const bytes = fs.statSync(DUMP).size;
  if (bytes < 10000) throw new Error('the dump is implausibly small: ' + bytes + ' bytes');
});

check('R02', 'restore', 'the dump restores into an empty database without error', () => {
  try { execFileSync(bin('dropdb'), ['-h', '127.0.0.1', '-p', PORT, '-U', USER, '--if-exists', RESTORED], { stdio: 'ignore', windowsHide: true }); } catch {}
  execFileSync(bin('createdb'), ['-h', '127.0.0.1', '-p', PORT, '-U', USER, RESTORED],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  // ON_ERROR_STOP makes this fail loudly rather than restoring most of a database.
  execFileSync(bin('psql'), [...connTo(RESTORED), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', DUMP],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
});

const countBoth = query => [sql(query), sql(query, { database: RESTORED })];

check('R03', 'restore', 'the restored copy has the same schema objects', () => {
  for (const [what, query] of [
    ['tables', `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r';`],
    ['policies', `select count(*) from pg_policies where schemaname='public';`],
    ['functions', `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private');`],
    ['triggers', `select count(*) from pg_trigger where not tgisinternal;`],
    ['constraints', `select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public';`],
    ['indexes', `select count(*) from pg_indexes where schemaname='public';`],
  ]) {
    const [original, restored] = countBoth(query);
    eq(restored, original, `${what} after restore`);
  }
});

check('R04', 'restore', 'row-level security is still enabled on every table that had it', () => {
  // The failure worth catching. RLS is table configuration, not data: a restore that
  // brings back every row while leaving relrowsecurity false looks complete and is open.
  const query = `select string_agg(c.relname, ',' order by c.relname) from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity;`;
  const [original, restored] = countBoth(query);
  eq(restored, original, 'the set of RLS-enabled tables after restore');
  const [, restoredCount] = countBoth(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity;`);
  if (Number(restoredCount) === 0) throw new Error('no table has RLS enabled in the restored copy');
});

check('R05', 'restore', 'tenant roles gain no privilege through the restore', () => {
  // The other configuration-shaped failure: privileges restore separately from rows, so
  // a restored copy can hand anon or authenticated more than the original ever granted.
  const query = `select coalesce(string_agg(grantee||':'||table_name||':'||privilege_type, ',' order by grantee, table_name, privilege_type), 'none')
    from information_schema.role_table_grants
    where table_schema='public' and grantee in ('anon','authenticated')
      and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES');`;
  const [original, restored] = countBoth(query);
  eq(original, 'none', 'the source database should already grant no TRUNCATE/TRIGGER/REFERENCES');
  eq(restored, 'none', 'the restored database must not grant them either');
});

check('R06', 'restore', 'the restored copy holds the same rows', () => {
  const query = `select count(*)::text || ':' || coalesce(md5(string_agg(result_id||assessment_id||record::text, '|' order by result_id)), 'empty')
    from public.company_composition_results;`;
  const [original, restored] = countBoth(query);
  eq(restored, original, 'composition rows after restore');
  if (original.startsWith('0:')) throw new Error('the rehearsal compared zero rows, which proves nothing');
});

check('R07', 'restore', 'the restored copy still refuses a payload the original refused', () => {
  // Constraints and the allowlist function must come back as behaviour, not just as
  // catalog entries. A record with no outputs was accepted by an earlier version of the
  // SQL allowlist; it must stay rejected on both sides.
  const probe = `select private.company_composition_payload_is_allowed(
    jsonb_build_object('schema','PP_COMPANY_COMPOSITION_RESULT_V1'),
    'x','x','x','adult_reference','${ORG_A}','${ADMIN_A}','x',
    '2026-09-10T04:00:00Z','2026-09-10T04:00:00Z','2026-09-10T04:05:00Z','2026-10-10T04:00:00Z','p','m','v');`;
  const [original, restored] = countBoth(probe);
  eq(original, 'f', 'the original rejects a payload missing its required keys');
  eq(restored, 'f', 'the restored copy rejects it too');
});

// R04 and R05 are the two checks the buyer claim rests on, and both are of the shape
// that passes whether or not it is looking at anything. These damage the restored copy
// on purpose and require the comparison to notice, then undo the damage. Without them,
// "RLS survived the restore" could mean the query matched nothing on both sides.
check('R09', 'restore', 'the RLS comparison detects a table whose policy protection was lost', () => {
  const rlsSet = `select string_agg(c.relname, ',' order by c.relname) from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity;`;
  const victim = sql(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity order by c.relname limit 1;`, { database: RESTORED });
  if (!victim) throw new Error('no RLS-enabled table to probe with');
  sql(`alter table public.${victim} disable row level security;`, { database: RESTORED });
  try {
    const [original, damaged] = countBoth(rlsSet);
    if (original === damaged) throw new Error('the comparison did not notice RLS being turned off on ' + victim);
  } finally {
    sql(`alter table public.${victim} enable row level security;`, { database: RESTORED });
  }
  const [original, repaired] = countBoth(rlsSet);
  eq(repaired, original, 'the restored copy after the probe was undone');
});

check('R10', 'restore', 'the privilege comparison detects a widened grant', () => {
  const grants = `select coalesce(string_agg(grantee||':'||table_name||':'||privilege_type, ',' order by grantee, table_name, privilege_type), 'none')
    from information_schema.role_table_grants
    where table_schema='public' and grantee in ('anon','authenticated')
      and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES');`;
  sql('grant truncate on public.company_composition_results to authenticated;', { database: RESTORED });
  try {
    const [, damaged] = countBoth(grants);
    if (damaged === 'none') throw new Error('the comparison did not notice TRUNCATE being granted to authenticated');
  } finally {
    sql('revoke truncate on public.company_composition_results from authenticated;', { database: RESTORED });
  }
  const [, repaired] = countBoth(grants);
  eq(repaired, 'none', 'the restored copy after the probe was undone');
});

check('R11', 'restore', 'the rehearsal artifacts are removed', () => {
  try { fs.unlinkSync(DUMP); } catch {}
  execFileSync(bin('dropdb'), ['-h', '127.0.0.1', '-p', PORT, '-U', USER, '--if-exists', RESTORED],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  cleanup();
  eq(sql(`select count(*) from public.company_composition_results where result_id like 'rehearsal-%';`), 0, 'rehearsal rows removed');
  if (fs.existsSync(DUMP)) throw new Error('the dump file was not removed');
});

// =============================================================== report
console.log('RESTORE AND DELETION REHEARSAL');
console.log('cluster: 127.0.0.1:' + PORT + ' (disposable), rehearsal rows committed then removed');
let failures = 0;
let group = null;
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log('\n[' + group + ']'); }
  console.log('  ' + (r.ok ? 'PASS ' : 'FAIL ') + r.id + ' ' + r.description);
  if (!r.ok) { failures++; console.log('        ' + r.error); }
}
console.log('\nTOTAL: ' + (results.length - failures) + '/' + results.length + ' pass, ' + failures + ' fail');
if (failures) process.exitCode = 1;
