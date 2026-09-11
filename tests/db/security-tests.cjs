// Isolated database security tests for public.company_composition_results.
// Every case runs in its own transaction against a DISPOSABLE cluster created by tests/db/run.cjs
// and is ROLLED BACK. Authorization cases run as the restricted `authenticated` role with an
// emulated request JWT claim, not as the table owner.
//
// NEVER point this at production.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function harnessContext() {
  const psql = process.env.PP_DB_PSQL;
  const conn = process.env.PP_DB_CONN;
  if (!psql || !conn) {
    throw new Error('Run this through tests/db/run.cjs. It creates a disposable cluster and supplies PP_DB_PSQL and PP_DB_CONN; this file will not connect to a server it did not create.');
  }
  return { psql, conn: JSON.parse(conn) };
}
const { psql: PSQL, conn: CONN } = harnessContext();

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ADMIN_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ADMIN_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const MEMBER_C = 'cccccccc-0000-4000-8000-00000000000c';
const ATH_A = 'a1111111-1111-4111-8111-11111111111a';
const ATH_OFF = 'c1111111-1111-4111-8111-11111111111c';

const T = {
  captured: '2026-09-10T04:00:00Z', created: '2026-09-10T04:00:00Z',
  saved: '2026-09-10T04:05:00Z', retention: '2026-10-10T04:00:00Z',
};

function payloadExpr(o = {}) {
  const p = {
    result: o.result ?? 'synthetic-result-001', assessment: o.assessment ?? 'synthetic-assessment-001',
    subject: o.subject ?? 'synthetic-subject-001', scope: o.scope ?? 'adult_reference',
    team: o.team ?? ORG_A, actor: o.actor ?? ADMIN_A, consent: o.consent ?? 'synthetic-permission-001',
    captured: o.captured ?? T.captured, created: o.created ?? T.created,
    saved: o.saved ?? T.saved, retention: o.retention ?? T.retention,
  };
  return `public.test_composition_payload('${p.result}','${p.assessment}','${p.subject}','${p.scope}','${p.team}','${p.actor}','${p.consent}','${p.captured}','${p.created}','${p.saved}','${p.retention}')`;
}

function insertSql(o = {}) {
  const c = {
    result: o.result ?? 'synthetic-result-001', assessment: o.assessment ?? 'synthetic-assessment-001',
    team: o.team ?? ORG_A, subject: o.subject ?? 'synthetic-subject-001', scope: o.scope ?? 'adult_reference',
    athlete: o.athlete === undefined ? 'null' : (o.athlete === null ? 'null' : `'${o.athlete}'`),
    consent: o.consent ?? 'synthetic-permission-001', actor: o.actor ?? ADMIN_A,
    provider: o.provider ?? 'synthetic-provider', model: o.model ?? 'synthetic-composition-model',
    version: o.version ?? '0.0.1-test',
    captured: o.captured ?? T.captured, created: o.created ?? T.created,
    saved: o.saved ?? T.saved, retention: o.retention ?? T.retention,
  };
  const record = o.record ?? payloadExpr(o.payloadOverrides ?? {
    result: c.result, assessment: c.assessment, subject: c.subject, scope: c.scope,
    team: c.team, actor: c.actor, consent: c.consent,
    captured: c.captured, created: c.created, saved: c.saved, retention: c.retention,
  });
  return `insert into public.company_composition_results(
    result_id,assessment_id,team_id,subject_reference,subject_scope,athlete_id,consent_reference,created_by,
    provider_id,model_id,model_version,captured_at,created_at_source,saved_at,retention_until,record)
  values ('${c.result}','${c.assessment}','${c.team}','${c.subject}','${c.scope}',${c.athlete},'${c.consent}','${c.actor}',
    '${c.provider}','${c.model}','${c.version}','${c.captured}','${c.created}','${c.saved}','${c.retention}',${record});`;
}

// A structurally valid payload with one mutation applied, for allowlist probing.
const mutated = (expr) => `(${expr})`;
const base = payloadExpr();

function run(testCase) {
  const claims = testCase.claims
    ? `select set_config('request.jwt.claims','{"sub":"${testCase.claims}","role":"authenticated"}',true);`
    : `select set_config('request.jwt.claims','',true);`;
  const script = [
    'begin;',
    testCase.setup ? testCase.setup : '',
    claims,
    testCase.role ? `set local role ${testCase.role};` : '',
    testCase.sql,
    'rollback;',
  ].filter(Boolean).join('\n');
  const file = path.join(os.tmpdir(), 'pp-case-' + Math.random().toString(36).slice(2) + '.sql');
  fs.writeFileSync(file, script, 'utf8');
  try {
    // Not being able to reach the server is not a verdict about the policy under test.
    // On Windows a stray console control event kills a backend (0xC000013A); the
    // postmaster then crash-recovers, and any case in flight comes back as "server
    // closed the connection" or "the database system is in recovery mode". Counting
    // that as a security failure reports a breach that did not happen, so wait for the
    // server and run the case again. A genuine policy rejection arrives as an ERROR
    // from a live connection and is never retried.
    for (let attempt = 0; ; attempt++) {
      try {
        const out = execFileSync(PSQL, [...CONN, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-f', file],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        return { errored: false, out: out.trim() };
      } catch (error) {
        const text = ((error.stdout || '') + (error.stderr || '')).trim();
        if (attempt < 20 && CONNECTION_FAULT.test(text)) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
          continue;
        }
        const line = text.split('\n').find(l => /ERROR:/.test(l)) || text.split('\n')[0] || '';
        return { errored: true, out: text, error: line.replace(/^.*ERROR:\s*/, '').trim() };
      }
    }
  } finally { try { fs.unlinkSync(file); } catch {} }
}

// Failures that mean "the connection went away", never "the database said no".
// Matched against psql's own wording, which is why these are phrases and not codes.
const CONNECTION_FAULT = /connection to server|server closed the connection unexpectedly|is in recovery mode|not yet accepting connections|Connection refused|could not connect/i;

const CASES = [];
const add = (id, group, desc, spec) => CASES.push({ id, group, desc, ...spec });

// =========================================================== A. payload allowlist (SQL layer)
const allow = (payloadExprText) =>
  `select private.company_composition_payload_is_allowed(${payloadExprText},'synthetic-result-001','synthetic-assessment-001','synthetic-subject-001','adult_reference','${ORG_A}','${ADMIN_A}','synthetic-permission-001','${T.captured}','${T.created}','${T.saved}','${T.retention}','synthetic-provider','synthetic-composition-model','0.0.1-test');`;

add('A00', 'payload-allowlist', 'baseline synthetic payload is accepted', { sql: allow(base), expect: 'ok', expectOut: 't' });
const forbidden = [
  ['A01', 'top-level photos', `${base} || '{"photos":["x"]}'::jsonb`],
  ['A02', 'nested provider.landmarks', `jsonb_set(${base},'{provider,landmarks}','[[1,2]]')`],
  ['A03', 'nested outputs[0].mesh', `jsonb_set(${base},'{outputs,0,mesh}','{"vertices":[]}')`],
  ['A04', 'deep outputs[1].uncertainty.participantCode', `jsonb_set(${base},'{outputs,1,uncertainty,participantCode}','"P001"')`],
  ['A05', 'modelManifest.photoDigest', `jsonb_set(${base},'{modelManifest,photoDigest}','"abc"')`],
  ['A06', 'camelCase scanId in provider', `jsonb_set(${base},'{provider,scanId}','"S001"')`],
  ['A07', 'snake_case contour_map top level', `${base} || '{"contour_map":{}}'::jsonb`],
  ['A08', 'geometry inside an array element', `jsonb_set(${base},'{outputs,0,geometry}','{"a":1}')`],
  ['A09', 'fingerprint key', `${base} || '{"fingerprint":"x"}'::jsonb`],
];
for (const [id, desc, expr] of forbidden)
  add(id, 'payload-allowlist', 'forbidden key rejected: ' + desc, { sql: allow(mutated(expr)), expect: 'ok', expectOut: 'f' });

const unknown = [
  ['A10', 'unknown top-level notes', `${base} || '{"notes":"x"}'::jsonb`],
  ['A11', 'unknown provider.endpoint', `jsonb_set(${base},'{provider,endpoint}','"https://x.invalid"')`],
  ['A12', 'unknown modelManifest.datasetId', `jsonb_set(${base},'{modelManifest,datasetId}','"d"')`],
  ['A13', 'unknown outputs[0].confidence', `jsonb_set(${base},'{outputs,0,confidence}','0.9')`],
  ['A14', 'unknown outputs[0].uncertainty.sigma', `jsonb_set(${base},'{outputs,0,uncertainty,sigma}','1.0')`],
];
for (const [id, desc, expr] of unknown)
  add(id, 'payload-allowlist', 'unknown field rejected: ' + desc, { sql: allow(mutated(expr)), expect: 'ok', expectOut: 'f' });

const malformed = [
  ['A15', 'missing consentReference', `${base} - 'consentReference'`],
  ['A16', 'missing outputs', `${base} - 'outputs'`],
  ['A17', 'JSON null consentReference', `jsonb_set(${base},'{consentReference}','null')`],
  ['A18', 'JSON null outputs', `jsonb_set(${base},'{outputs}','null')`],
  ['A19', 'record is a JSON array', `'[]'::jsonb`],
  ['A20', 'record is a JSON string', `'"text"'::jsonb`],
  ['A21', 'record is a JSON number', `'5'::jsonb`],
  ['A22', 'outputs is an object not array', `jsonb_set(${base},'{outputs}','{}')`],
  ['A23', 'outputs empty array', `jsonb_set(${base},'{outputs}','[]')`],
  ['A24', 'outputs has 6 entries', `jsonb_set(${base},'{outputs}', (${base}->'outputs') || (${base}->'outputs') || (${base}->'outputs'))`],
  ['A25', 'undeclared metric key vo2max', `jsonb_set(${base},'{outputs,0,key}','"vo2max"')`],
  ['A26', 'invalid unit lb', `jsonb_set(${base},'{outputs,0,unit}','"lb"')`],
  ['A27', 'value is a string not a number', `jsonb_set(${base},'{outputs,0,value}','"60"')`],
  ['A28', 'value is JSON null', `jsonb_set(${base},'{outputs,0,value}','null')`],
  ['A29', 'uncertainty status invalid', `jsonb_set(${base},'{outputs,1,uncertainty,status}','"unknown"')`],
  ['A30', 'uncertainty not an object', `jsonb_set(${base},'{outputs,1,uncertainty}','"none"')`],
  ['A31', 'manifest schema wrong', `jsonb_set(${base},'{modelManifest,schema}','"OTHER_V1"')`],
  ['A32', 'trainingMethod not DXA', `jsonb_set(${base},'{modelManifest,trainingMethod}','"BIA"')`],
  ['A33', 'validationMethod not DXA', `jsonb_set(${base},'{modelManifest,validationMethod}','"BIA"')`],
  ['A34', 'rightsStatus invalid', `jsonb_set(${base},'{modelManifest,rightsStatus}','"unknown"')`],
  ['A35', 'record schema wrong', `jsonb_set(${base},'{schema}','"PP_COMPANY_BODY_ASSESSMENT_V1"')`],
  ['A36', 'provider is not an object', `jsonb_set(${base},'{provider}','"x"')`],
];
for (const [id, desc, expr] of malformed)
  add(id, 'payload-allowlist', 'malformed payload rejected: ' + desc, { sql: allow(mutated(expr)), expect: 'ok', expectOut: 'f' });

// Payload identifiers must agree with the relational columns.
const disagree = [
  ['A37', 'resultId', `jsonb_set(${base},'{resultId}','"other"')`],
  ['A38', 'assessmentId', `jsonb_set(${base},'{assessmentId}','"other"')`],
  ['A39', 'subjectId', `jsonb_set(${base},'{subjectId}','"other"')`],
  ['A40', 'subjectScope', `jsonb_set(${base},'{subjectScope}','"child_athlete"')`],
  ['A41', 'organizationId', `jsonb_set(${base},'{organizationId}','"${ORG_B}"')`],
  ['A42', 'createdBy', `jsonb_set(${base},'{createdBy}','"${ADMIN_B}"')`],
  ['A43', 'consentReference', `jsonb_set(${base},'{consentReference}','"other"')`],
  ['A44', 'capturedAt', `jsonb_set(${base},'{capturedAt}','"2026-01-01T00:00:00.000Z"')`],
  ['A45', 'createdAt', `jsonb_set(${base},'{createdAt}','"2026-01-01T00:00:00.000Z"')`],
  ['A46', 'savedAt', `jsonb_set(${base},'{savedAt}','"2026-01-01T00:00:00.000Z"')`],
  ['A47', 'retentionUntil', `jsonb_set(${base},'{retentionUntil}','"2026-12-31T00:00:00.000Z"')`],
];
for (const [id, field, expr] of disagree)
  add(id, 'payload-column-agreement', `payload ${field} disagreeing with its column is rejected`,
    { sql: allow(mutated(expr)), expect: 'ok', expectOut: 'f' });

// The same rejection must hold through a real INSERT, not just a direct function call.
// Regression cases for the NULL-safety hole found by running the migration for real:
// jsonb_typeof() of a missing key is NULL, so a plain <> comparison could not reject an
// omitted outputs/provider block. Exact key counts now close it.
const missing = [
  ['A51', 'outputs'],
  ['A52', 'provider'],
  ['A53', 'modelManifest'],
  ['A54', 'schema'],
  ['A55', 'dataScope'],
  ['A56', 'limitations'],
  ['A57', 'retentionUntil'],
];
for (const [id, field] of missing)
  add(id, 'payload-allowlist', 'omitted required block rejected: ' + field,
    { sql: allow(mutated(base + " - '" + field + "'::text")), expect: 'ok', expectOut: 'f' });
add('A58', 'payload-allowlist', 'omitted provider.version is rejected',
  { sql: allow(mutated(`${base} #- '{provider,version}'`)), expect: 'ok', expectOut: 'f' });
add('A59', 'payload-allowlist', 'omitted outputs[0].unit is rejected',
  { sql: allow(mutated(`${base} #- '{outputs,0,unit}'`)), expect: 'ok', expectOut: 'f' });
add('A60', 'payload-allowlist', 'duplicate output keys are rejected',
  { sql: allow(mutated(`jsonb_set(${base},'{outputs}', jsonb_build_array(${base}->'outputs'->0, ${base}->'outputs'->0))`)), expect: 'ok', expectOut: 'f' });
add('A61', 'payload-allowlist', 'not_provided uncertainty carrying interval fields is rejected',
  { sql: allow(mutated(`jsonb_set(${base},'{outputs,1,uncertainty,lower}','1')`)), expect: 'ok', expectOut: 'f' });
add('A62', 'payload-allowlist', 'provided uncertainty missing its method is rejected',
  { sql: allow(mutated(`${base} #- '{outputs,0,uncertainty,method}'`)), expect: 'ok', expectOut: 'f' });
add('A63', 'payload-allowlist', 'provided uncertainty with a non-numeric bound is rejected',
  { sql: allow(mutated(`jsonb_set(${base},'{outputs,0,uncertainty,lower}','\"57\"')`)), expect: 'ok', expectOut: 'f' });
add('A48', 'payload-allowlist', 'INSERT carrying a forbidden nested key is refused by the table CHECK',
  { sql: insertSql({ record: `jsonb_set(${base},'{provider,landmarks}','[[1,2]]')` }), expect: 'error', expectError: /company_composition_results_check4|violates check constraint/ });
add('A49', 'payload-allowlist', 'INSERT carrying an unknown field is refused by the table CHECK',
  { sql: insertSql({ record: `${base} || '{"notes":"x"}'::jsonb` }), expect: 'error', expectError: /violates check constraint/ });
add('A50', 'payload-allowlist', 'INSERT with SQL NULL record is refused by NOT NULL',
  { sql: insertSql({ record: 'null::jsonb' }), expect: 'error', expectError: /null value in column "record"/ });

// =========================================================== B. relational constraints
add('B01', 'scope-separation', 'adult_reference row carrying an athlete_id is refused',
  { sql: insertSql({ scope: 'adult_reference', athlete: ATH_A }), expect: 'error', expectError: /violates check constraint/ });
add('B02', 'scope-separation', 'child_athlete row with a NULL athlete_id is refused',
  { sql: insertSql({ scope: 'child_athlete', subject: ATH_A, athlete: null }), expect: 'error', expectError: /violates check constraint/ });
add('B03', 'scope-separation', 'child_athlete row whose subject_reference is not the athlete id is refused',
  { sql: insertSql({ scope: 'child_athlete', subject: 'synthetic-subject-001', athlete: ATH_A }), expect: 'error', expectError: /violates check constraint/ });
add('B04', 'scope-separation', 'well-formed child_athlete row is accepted (owner)',
  { sql: insertSql({ scope: 'child_athlete', subject: ATH_A, athlete: ATH_A }), expect: 'ok' });
add('B05', 'timestamps', 'created_at_source before captured_at is refused',
  { sql: insertSql({ created: '2026-09-10T03:00:00Z' }), expect: 'error', expectError: /violates check constraint/ });
add('B06', 'timestamps', 'saved_at before created_at_source is refused',
  { sql: insertSql({ saved: '2026-09-10T03:00:00Z' }), expect: 'error', expectError: /violates check constraint/ });
add('B07', 'retention', 'retention_until equal to captured_at is refused',
  { sql: insertSql({ retention: T.captured }), expect: 'error', expectError: /violates check constraint/ });
add('B08', 'retention', 'retention_until before captured_at is refused',
  { sql: insertSql({ retention: '2026-09-01T04:00:00Z' }), expect: 'error', expectError: /violates check constraint/ });
add('B09', 'retention', 'retention_until exactly captured_at + 400 days is accepted (boundary)',
  { sql: insertSql({ retention: '2027-10-15T04:00:00Z' }), expect: 'ok' });
add('B10', 'retention', 'retention_until at captured_at + 400 days + 1 second is refused (boundary)',
  { sql: insertSql({ retention: '2027-10-15T04:00:01Z' }), expect: 'error', expectError: /violates check constraint/ });
add('B11', 'retention', 'retention_until one second after capture is accepted (lower boundary)',
  { sql: insertSql({ retention: '2026-09-10T04:00:01Z' }), expect: 'ok' });

// =========================================================== C. RLS as real restricted roles
const seedA = `select public.test_seed_row('seeded-a','adult_reference','${ORG_A}','${ADMIN_A}');`;
const seedChildA = `select public.test_seed_row('seeded-child-a','child_athlete','${ORG_A}','${ADMIN_A}','${ATH_A}','${ATH_A}');`;
const seedB = `select public.test_seed_row('seeded-b','adult_reference','${ORG_B}','${ADMIN_B}');`;

add('C01', 'rls-anon', 'anonymous SELECT returns no rows', {
  setup: seedA, role: 'anon', sql: `select count(*) from public.company_composition_results;`,
  expect: 'error', expectError: /permission denied/ });
add('C02', 'rls-anon', 'anonymous INSERT is refused', {
  role: 'anon', sql: insertSql({}), expect: 'error', expectError: /permission denied/ });
add('C03', 'rls-member', 'non-admin authenticated member SELECT returns 0 rows', {
  setup: seedA, role: 'authenticated', claims: MEMBER_C,
  sql: `select count(*) from public.company_composition_results;`, expect: 'ok', expectOut: '0' });
add('C04', 'rls-member', 'non-admin authenticated member INSERT is refused by the policy', {
  role: 'authenticated', claims: MEMBER_C, sql: insertSql({ actor: MEMBER_C }),
  expect: 'error', expectError: /row-level security/ });
add('C05', 'rls-admin', 'org A admin INSERT of an adult reference on org A succeeds', {
  role: 'authenticated', claims: ADMIN_A, sql: insertSql({}), expect: 'ok' });
add('C06', 'rls-admin', 'org A admin INSERT for a ROSTERED child athlete succeeds', {
  role: 'authenticated', claims: ADMIN_A, sql: insertSql({ scope: 'child_athlete', subject: ATH_A, athlete: ATH_A }),
  expect: 'ok' });
add('C07', 'rls-roster', 'org A admin INSERT for an athlete NOT on the roster is refused', {
  role: 'authenticated', claims: ADMIN_A, sql: insertSql({ scope: 'child_athlete', subject: ATH_OFF, athlete: ATH_OFF }),
  expect: 'error', expectError: /row-level security/ });
add('C08', 'rls-created-by', 'org A admin cannot INSERT a row attributed to another user', {
  role: 'authenticated', claims: ADMIN_A, sql: insertSql({ actor: ADMIN_B }),
  expect: 'error', expectError: /row-level security/ });
add('C09', 'rls-cross-tenant', 'org B admin SELECT sees zero org A rows', {
  setup: seedA, role: 'authenticated', claims: ADMIN_B,
  sql: `select count(*) from public.company_composition_results;`, expect: 'ok', expectOut: '0' });
add('C10', 'rls-cross-tenant', 'org B admin INSERT into org A is refused', {
  role: 'authenticated', claims: ADMIN_B, sql: insertSql({ team: ORG_A, actor: ADMIN_B }),
  expect: 'error', expectError: /row-level security/ });
add('C11', 'rls-cross-tenant', 'org B admin UPDATE of an org A row affects 0 rows', {
  setup: seedA, role: 'authenticated', claims: ADMIN_B,
  sql: `with u as (update public.company_composition_results set model_version='tampered' where result_id='seeded-a' returning 1) select count(*) from u;`,
  expect: 'ok', expectOut: '0' });
add('C12', 'rls-cross-tenant', 'org B admin DELETE of an org A row affects 0 rows', {
  setup: seedA, role: 'authenticated', claims: ADMIN_B,
  sql: `with d as (delete from public.company_composition_results where result_id='seeded-a' returning 1) select count(*) from d;`,
  expect: 'ok', expectOut: '0' });
add('C13', 'rls-admin', 'org A admin SELECT sees only its own tenant rows', {
  setup: seedA + seedB, role: 'authenticated', claims: ADMIN_A,
  sql: `select string_agg(result_id,',' order by result_id) from public.company_composition_results;`,
  expect: 'ok', expectOut: 'seeded-a' });
add('C14', 'rls-update', 'org A admin cannot move its own row to another organization', {
  setup: seedA, role: 'authenticated', claims: ADMIN_A,
  sql: `update public.company_composition_results set team_id='${ORG_B}' where result_id='seeded-a';`,
  expect: 'error', expectError: /row-level security|violates check constraint/ });
add('C15', 'rls-update', 'org A admin cannot reassign its own row to another user', {
  setup: seedA, role: 'authenticated', claims: ADMIN_A,
  sql: `update public.company_composition_results set created_by='${ADMIN_B}' where result_id='seeded-a';`,
  expect: 'error', expectError: /row-level security|violates check constraint/ });
add('C16', 'rls-update', 'org A admin cannot change subject_reference without the payload agreeing', {
  setup: seedA, role: 'authenticated', claims: ADMIN_A,
  sql: `update public.company_composition_results set subject_reference='other-subject' where result_id='seeded-a';`,
  expect: 'error', expectError: /violates check constraint/ });
add('C17', 'rls-update', 'org A admin cannot flip an adult reference to child scope', {
  setup: seedA, role: 'authenticated', claims: ADMIN_A,
  sql: `update public.company_composition_results set subject_scope='child_athlete' where result_id='seeded-a';`,
  expect: 'error', expectError: /violates check constraint/ });
add('C18', 'rls-update', 'org A admin cannot attach an athlete to an existing adult reference', {
  setup: seedA, role: 'authenticated', claims: ADMIN_A,
  sql: `update public.company_composition_results set athlete_id='${ATH_A}' where result_id='seeded-a';`,
  expect: 'error', expectError: /violates check constraint/ });
add('C19', 'rls-update', 'org A admin cannot move a child result to an off-roster athlete', {
  setup: seedChildA, role: 'authenticated', claims: ADMIN_A,
  sql: `update public.company_composition_results set athlete_id='${ATH_OFF}', subject_reference='${ATH_OFF}' where result_id='seeded-child-a';`,
  expect: 'error', expectError: /row-level security|violates check constraint/ });
add('C20', 'rls-admin', 'org A admin DELETE of its own row succeeds', {
  setup: seedA, role: 'authenticated', claims: ADMIN_A,
  sql: `with d as (delete from public.company_composition_results where result_id='seeded-a' returning 1) select count(*) from d;`,
  expect: 'ok', expectOut: '1' });

// =========================================================== D. retention behaviour and sweep
const seedExpired = `select public.test_seed_row('expired-a','adult_reference','${ORG_A}','${ADMIN_A}','synthetic-subject-001',null,'2026-06-01T00:00:00Z','2026-07-01T00:00:00Z');`;
const seedLive = `select public.test_seed_row('live-a','adult_reference','${ORG_A}','${ADMIN_A}','synthetic-subject-002',null,'2026-09-01T00:00:00Z','2026-10-01T00:00:00Z');`;

add('D01', 'retention', 'an expired row is STILL SELECT-visible to the org admin until the sweep runs', {
  setup: seedExpired, role: 'authenticated', claims: ADMIN_A,
  sql: `select count(*) from public.company_composition_results where result_id='expired-a';`,
  expect: 'ok', expectOut: '1' });
add('D02', 'retention', 'the sweep deletes only rows past retention', {
  setup: seedExpired + seedLive,
  sql: `create temp table sweep_out as select private.sweep_company_composition_retention() as deleted;
        select (select deleted from sweep_out)::text || '|' || coalesce((select string_agg(result_id,',' order by result_id) from public.company_composition_results),'(none)');`,
  expect: 'ok', expectOut: '1|live-a' });
add('D03', 'retention', 'authenticated cannot execute the retention sweep', {
  role: 'authenticated', claims: ADMIN_A,
  sql: `select private.sweep_company_composition_retention();`,
  expect: 'error', expectError: /permission denied/ });
add('D04', 'retention', 'anon cannot execute the retention sweep', {
  role: 'anon', sql: `select private.sweep_company_composition_retention();`,
  expect: 'error', expectError: /permission denied/ });
add('D05', 'retention', 'the sweep does not touch the sibling assessment tables', {
  setup: seedExpired,
  sql: `select private.sweep_company_composition_retention()::text;`, expect: 'ok', expectOut: '1' });

// =========================================================== E. audit
add('E01', 'audit', 'INSERT writes a company_composition_result_insert audit row', {
  role: 'authenticated', claims: ADMIN_A,
  sql: insertSql({}) + `\nreset role;\nselect action from public.access_log where action like 'company_composition%' order by created_at desc limit 1;`,
  expect: 'ok', expectOut: 'company_composition_result_insert' });
add('E02', 'audit', 'DELETE writes a company_composition_result_delete audit row', {
  setup: seedA, role: 'authenticated', claims: ADMIN_A,
  sql: `delete from public.company_composition_results where result_id='seeded-a';\nreset role;\nselect count(*)::text from public.access_log where action='company_composition_result_delete';`,
  expect: 'ok', expectOut: '1' });
add('E03', 'audit', 'UPDATE writes a company_composition_result_update audit row', {
  setup: seedA, role: 'authenticated', claims: ADMIN_A,
  sql: `update public.company_composition_results set updated_at=now() where result_id='seeded-a';\nreset role;\nselect count(*)::text from public.access_log where action='company_composition_result_update';`,
  expect: 'ok', expectOut: '1' });
add('E04', 'audit', 'audit detail contains only the expected non-payload keys', {
  role: 'authenticated', claims: ADMIN_A,
  sql: insertSql({}) + `\nreset role;\nselect string_agg(k,',' order by k) from (select jsonb_object_keys((select detail from public.access_log where action='company_composition_result_insert' limit 1)) as k) s;`,
  expect: 'ok', expectOut: 'assessment_id,model_id,model_version,provider_id,result_id,subject_reference,subject_scope,team_id' });
add('E05', 'audit', 'audit detail carries no composition outputs, values or payload', {
  role: 'authenticated', claims: ADMIN_A,
  sql: insertSql({}) + `\nreset role;\nselect (detail::text ~* '(outputs|lean_mass|body_fat|uncertainty|consent_reference|dataScope|limitations|photo|landmark)')::text from public.access_log where action like 'company_composition%' order by created_at desc limit 1;`,
  expect: 'ok', expectOut: 'false' });
add('E06', 'audit', 'audit records the acting user id', {
  role: 'authenticated', claims: ADMIN_A,
  sql: insertSql({}) + `\nreset role;\nselect actor_id::text from public.access_log where action like 'company_composition%' order by created_at desc limit 1;`,
  expect: 'ok', expectOut: ADMIN_A });
add('E07', 'audit', 'the SECURITY DEFINER audit trigger cannot be invoked directly', {
  role: 'authenticated', claims: ADMIN_A,
  sql: `select private.audit_company_composition_change();`,
  expect: 'error', expectError: /trigger functions can only be called as triggers|permission denied/ });
add('E08', 'audit', 'org B admin cannot read org A composition audit rows', {
  setup: `select set_config('request.jwt.claims','{"sub":"${ADMIN_A}"}',true); ` + seedA,
  role: 'authenticated', claims: ADMIN_B,
  sql: `select count(*) from public.access_log where action like 'company_composition%';`,
  expect: 'ok', expectOut: '0' });

// =========================================================== F. function privileges and search_path
add('F01', 'function-privs', 'every new composition function pins an empty search_path', {
  sql: `select string_agg(p.proname || '=' || coalesce(array_to_string(p.proconfig,','),'NONE'), ' | ' order by p.proname)
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='private' and p.proname in ('company_composition_payload_is_allowed','can_manage_company_composition','sweep_company_composition_retention','audit_company_composition_change');`,
  expect: 'ok',
  expectOut: 'audit_company_composition_change=search_path="" | can_manage_company_composition=search_path="" | company_composition_payload_is_allowed=search_path="" | sweep_company_composition_retention=search_path=""' });
add('F02', 'function-privs', 'the payload allowlist is IMMUTABLE and not SECURITY DEFINER', {
  sql: `select (p.provolatile='i')::text || '|' || p.prosecdef::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='company_composition_payload_is_allowed';`,
  expect: 'ok', expectOut: 'true|false' });
add('F03', 'function-privs', 'can_manage_company_composition is SECURITY DEFINER and granted only to authenticated', {
  sql: `select p.prosecdef::text || '|' || array_to_string(p.proacl::text[],' ') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='can_manage_company_composition';`,
  expect: 'ok', expectOut: 'true|pptest=X/pptest authenticated=X/pptest' });
add('F04', 'function-privs', 'RLS is enabled on the composition table', {
  sql: `select relrowsecurity::text || '|' || relforcerowsecurity::text from pg_class where oid='public.company_composition_results'::regclass;`,
  expect: 'ok', expectOut: 'true|false' });
add('F05', 'function-privs', 'the cron job row exists in the scheduler catalogue', {
  sql: `select schedule from cron.job where jobname='company-composition-result-retention';`,
  expect: 'ok', expectOut: '50 3 * * *' });
add('F06', 'function-privs', 'authenticated cannot read another organization admin membership check', {
  role: 'authenticated', claims: ADMIN_B,
  sql: `select private.can_manage_company_composition('${ORG_A}',null)::text;`,
  expect: 'ok', expectOut: 'false' });
add('F07', 'function-privs', 'the roster requirement is enforced inside can_manage_company_composition', {
  role: 'authenticated', claims: ADMIN_A,
  sql: `select private.can_manage_company_composition('${ORG_A}','${ATH_A}')::text || '|' || private.can_manage_company_composition('${ORG_A}','${ATH_OFF}')::text;`,
  expect: 'ok', expectOut: 'true|false' });

// =========================================================== G. provider eligibility (CLOSED)
// These cases previously passed by SUCCEEDING, documenting that the database enforced nothing
// about provider legitimacy. A registry the tenant cannot write to, a composite foreign key, a
// BEFORE trigger and the hardened payload allowlist now reject every one of them.
add('G01', 'provider-eligibility', 'a row naming an UNREGISTERED provider is refused', {
  role: 'authenticated', claims: ADMIN_A,
  sql: insertSql({ provider: 'totally-made-up-provider', model: 'invented-model',
    record: `jsonb_set(jsonb_set(${base},'{provider,id}','"totally-made-up-provider"'),'{provider,model}','"invented-model"')` }),
  expect: 'error', expectError: /not registered for this organization|violates foreign key/ });
add('G02', 'provider-eligibility', 'a physiologically impossible value (9999 kg lean mass) is refused', {
  role: 'authenticated', claims: ADMIN_A,
  sql: insertSql({ record: `jsonb_set(${base},'{outputs,0,value}','9999')` }),
  expect: 'error', expectError: /violates check constraint/ });
add('G03', 'provider-eligibility', 'inverted uncertainty bounds (lower > upper) are refused', {
  role: 'authenticated', claims: ADMIN_A,
  sql: insertSql({ record: `jsonb_set(jsonb_set(${base},'{outputs,0,uncertainty,lower}','90'),'{outputs,0,uncertainty,upper}','10')` }),
  expect: 'error', expectError: /violates check constraint/ });
add('G04', 'provider-eligibility', 'an output label that does not match its metric key is refused', {
  role: 'authenticated', claims: ADMIN_A,
  sql: insertSql({ record: `jsonb_set(${base},'{outputs,0,label}','"Bone mineral content"')` }),
  expect: 'error', expectError: /violates check constraint/ });
add('G05', 'provider-eligibility', 'altered non-diagnostic disclosure text is refused', {
  role: 'authenticated', claims: ADMIN_A,
  sql: insertSql({ record: `jsonb_set(${base},'{limitations}','"Clinically validated body composition."')` }),
  expect: 'error', expectError: /violates check constraint/ });
add('G06', 'provider-eligibility', 'altered dataScope text is refused', {
  role: 'authenticated', claims: ADMIN_A,
  sql: insertSql({ record: `jsonb_set(${base},'{dataScope}','"Includes source photographs."')` }),
  expect: 'error', expectError: /violates check constraint/ });
add('G07', 'provider-eligibility', 'an uncertainty bound outside the metric range is refused', {
  role: 'authenticated', claims: ADMIN_A,
  sql: insertSql({ record: `jsonb_set(${base},'{outputs,0,uncertainty,upper}','900')` }),
  expect: 'error', expectError: /violates check constraint/ });
add('G08', 'provider-eligibility', 'a value below the metric minimum is refused', {
  role: 'authenticated', claims: ADMIN_A,
  sql: insertSql({ record: `jsonb_set(jsonb_set(jsonb_set(${base},'{outputs,0,value}','1'),'{outputs,0,uncertainty,lower}','1'),'{outputs,0,uncertainty,upper}','2')` }),
  expect: 'error', expectError: /violates check constraint/ });
add('G09', 'provider-eligibility', 'a well-formed row from a REGISTERED provider is still accepted', {
  role: 'authenticated', claims: ADMIN_A, sql: insertSql({}), expect: 'ok' });
add('G10', 'provider-eligibility', 'the composition table is empty in this cluster outside test transactions', {
  sql: `select count(*) from public.company_composition_results;`, expect: 'ok', expectOut: '0' });

// =========================================================== H. provider registry
// Registration is a PLATFORM operation. If an organization account could register its own
// provider, the registry would enforce nothing and the gap would simply move one table over.
const versioned = (version, extra) => insertSql({ version,
  record: extra ? extra(`jsonb_set(${base},'{provider,version}','"${version}"')`) : `jsonb_set(${base},'{provider,version}','"${version}"')` });

add('H01', 'provider-registry', 'a registered but REVOKED provider cannot store a result', {
  role: 'authenticated', claims: ADMIN_A,
  sql: versioned('0.0.2-revoked', e => `jsonb_set(${e},'{outputs}', jsonb_build_array(${base}->'outputs'->0))`),
  expect: 'error', expectError: /was revoked/ });
add('H02', 'provider-registry', 'a provider whose deployment rights had expired cannot store a result', {
  role: 'authenticated', claims: ADMIN_A,
  sql: versioned('0.0.3-expired', e => `jsonb_set(${e},'{outputs}', jsonb_build_array(${base}->'outputs'->0))`),
  expect: 'error', expectError: /rights had expired/ });
add('H03', 'provider-registry', 'an output the registration did not declare is refused', {
  role: 'authenticated', claims: ADMIN_A,
  sql: versioned('0.0.4-narrow'),
  expect: 'error', expectError: /did not declare/ });
add('H04', 'provider-registry', 'a result inside a narrow declaration is accepted', {
  role: 'authenticated', claims: ADMIN_A,
  sql: versioned('0.0.4-narrow', e => `jsonb_set(${e},'{outputs}', jsonb_build_array(${base}->'outputs'->0))`),
  expect: 'ok' });
add('H05', 'provider-registry', 'a manifest study/rights reference that disagrees with the registration is refused', {
  role: 'authenticated', claims: ADMIN_A,
  sql: versioned('0.0.5-otherstudy'),
  expect: 'error', expectError: /does not match the registered provider/ });
add('H06', 'provider-registry', 'a model version that was never registered is refused', {
  role: 'authenticated', claims: ADMIN_A,
  sql: versioned('9.9.9-unknown'),
  expect: 'error', expectError: /not registered for this organization|violates foreign key/ });

// The payload names the provider a reader renders, so it must equal the indexed columns.
add('H07', 'provider-registry', 'payload provider.id disagreeing with its column is refused', {
  role: 'authenticated', claims: ADMIN_A,
  sql: insertSql({ record: `jsonb_set(${base},'{provider,id}','"other-provider"')` }),
  expect: 'error', expectError: /violates check constraint/ });
add('H08', 'provider-registry', 'payload provider.model disagreeing with its column is refused', {
  role: 'authenticated', claims: ADMIN_A,
  sql: insertSql({ record: `jsonb_set(${base},'{provider,model}','"other-model"')` }),
  expect: 'error', expectError: /violates check constraint/ });
add('H09', 'provider-registry', 'payload provider.version disagreeing with its column is refused', {
  role: 'authenticated', claims: ADMIN_A,
  sql: insertSql({ record: `jsonb_set(${base},'{provider,version}','"0.0.9-other"')` }),
  expect: 'error', expectError: /violates check constraint/ });

// The registry itself is out of tenant reach.
const REGISTER = `insert into public.company_composition_providers(team_id,provider_id,model_id,model_version,study_id,rights_status,declared_outputs,approved_by)
  values ('${ORG_A}','self-granted','self-model','1.0.0','self-study','owned',array['lean_mass_kg'],'${ADMIN_A}');`;
add('H10', 'provider-registry', 'an organization admin cannot register a provider for itself', {
  role: 'authenticated', claims: ADMIN_A, sql: REGISTER,
  expect: 'error', expectError: /permission denied|row-level security/ });
add('H11', 'provider-registry', 'an organization admin cannot un-revoke a registration', {
  role: 'authenticated', claims: ADMIN_A,
  sql: `update public.company_composition_providers set revoked_at=null where model_version='0.0.2-revoked';`,
  expect: 'error', expectError: /permission denied|row-level security/ });
add('H12', 'provider-registry', 'an organization admin cannot delete a registration', {
  role: 'authenticated', claims: ADMIN_A,
  sql: `delete from public.company_composition_providers where model_version='0.0.1-test';`,
  expect: 'error', expectError: /permission denied|row-level security/ });
add('H13', 'provider-registry', 'anonymous users cannot read the registry', {
  role: 'anon', sql: `select count(*) from public.company_composition_providers;`,
  expect: 'error', expectError: /permission denied/ });
add('H14', 'provider-registry', 'an organization admin can read only its own registrations', {
  role: 'authenticated', claims: ADMIN_A,
  sql: `select count(*)::text from public.company_composition_providers;`, expect: 'ok', expectOut: '5' });
add('H15', 'provider-registry', 'another organization sees only its own registration', {
  role: 'authenticated', claims: ADMIN_B,
  sql: `select count(*)::text from public.company_composition_providers;`, expect: 'ok', expectOut: '1' });
add('H16', 'provider-registry', 'org A registrations do not let org B store a result on org A', {
  role: 'authenticated', claims: ADMIN_B, sql: insertSql({ team: ORG_A, actor: ADMIN_B }),
  expect: 'error', expectError: /row-level security/ });
add('H17', 'provider-registry', 'a registration with results cannot be deleted, only revoked', {
  setup: seedA, sql: `delete from public.company_composition_providers where team_id='${ORG_A}' and model_version='0.0.1-test';`,
  expect: 'error', expectError: /violates (foreign key constraint|RESTRICT setting)/ });
add('H18', 'provider-registry', 'registering a provider is audited', {
  sql: `insert into public.company_composition_providers(team_id,provider_id,model_id,model_version,study_id,rights_status,declared_outputs,approved_by)
    values ('${ORG_A}','audited-provider','audited-model','1.0.0','audited-study','owned',array['lean_mass_kg'],'${ADMIN_A}');
    select count(*)::text from public.access_log where action='company_composition_provider_insert' and detail->>'provider_id'='audited-provider';`,
  expect: 'ok', expectOut: '1' });

// The registry cannot declare outputs outside the supported dictionary.
add('H19', 'provider-registry', 'a registration declaring an unknown metric is refused', {
  sql: `insert into public.company_composition_providers(team_id,provider_id,model_id,model_version,study_id,rights_status,declared_outputs,approved_by)
    values ('${ORG_A}','x','x','1.0.0','x','owned',array['vo2max'],'${ADMIN_A}');`,
  expect: 'error', expectError: /violates check constraint/ });
add('H20', 'provider-registry', 'a registration declaring duplicate metrics is refused', {
  sql: `insert into public.company_composition_providers(team_id,provider_id,model_id,model_version,study_id,rights_status,declared_outputs,approved_by)
    values ('${ORG_A}','x','x','1.0.0','x','owned',array['lean_mass_kg','lean_mass_kg'],'${ADMIN_A}');`,
  expect: 'error', expectError: /violates check constraint/ });
add('H21', 'provider-registry', 'a registration declaring no metrics is refused', {
  sql: `insert into public.company_composition_providers(team_id,provider_id,model_id,model_version,study_id,rights_status,declared_outputs,approved_by)
    values ('${ORG_A}','x','x','1.0.0','x','owned',array[]::text[],'${ADMIN_A}');`,
  expect: 'error', expectError: /violates check constraint/ });
add('H22', 'provider-registry', 'a registration with an unsupported rights status is refused', {
  sql: `insert into public.company_composition_providers(team_id,provider_id,model_id,model_version,study_id,rights_status,declared_outputs,approved_by)
    values ('${ORG_A}','x','x','1.0.0','x','pending',array['lean_mass_kg'],'${ADMIN_A}');`,
  expect: 'error', expectError: /violates check constraint/ });
// =========================================================== I. table privileges
// Supabase grants ALL on a new public table to anon and authenticated, and that includes
// TRUNCATE. TRUNCATE is NOT subject to row-level security, so an excess grant is not cosmetic:
// it is a way around every policy in this file. The first local pass could not see this because
// the harness preamble did not reproduce Supabase default privileges; it does now.
const grantsFor = (table, grantee) => `select coalesce(string_agg(privilege_type,',' order by privilege_type),'(none)') from information_schema.role_table_grants where table_schema='public' and table_name='${table}' and grantee='${grantee}';`;
add('I01', 'table-privileges', 'anon holds no privilege at all on the results table', {
  sql: grantsFor('company_composition_results','anon'), expect: 'ok', expectOut: '(none)' });
add('I02', 'table-privileges', 'anon holds no privilege at all on the provider registry', {
  sql: grantsFor('company_composition_providers','anon'), expect: 'ok', expectOut: '(none)' });
add('I03', 'table-privileges', 'authenticated holds exactly CRUD on results, with no TRUNCATE', {
  sql: grantsFor('company_composition_results','authenticated'), expect: 'ok', expectOut: 'DELETE,INSERT,SELECT,UPDATE' });
add('I04', 'table-privileges', 'authenticated holds exactly SELECT on the provider registry', {
  sql: grantsFor('company_composition_providers','authenticated'), expect: 'ok', expectOut: 'SELECT' });

// =========================================================== J. schema-wide least privilege
// TRUNCATE is not subject to row-level security, so a tenant role holding it on ANY table in
// public defeats every policy on that table. Supabase grants it by default on every new table.
// These check the whole schema, not just the composition tables.
add('J01', 'least-privilege', 'no public table grants TRUNCATE, TRIGGER or REFERENCES to anon or authenticated', {
  sql: `select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join unnest(array['anon','authenticated']) as g(role) cross join unnest(array['TRUNCATE','TRIGGER','REFERENCES']) as pr(priv) where n.nspname='public' and c.relkind in ('r','p') and has_table_privilege(g.role, c.oid, pr.priv);`, expect: 'ok', expectOut: '0' });
add('J02', 'least-privilege', 'SELECT still reaches authenticated on every public table', {
  sql: `select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and has_table_privilege('authenticated', c.oid, 'SELECT');`, expect: 'ok' });  // non-zero and error-free is the assertion: CRUD must survive
add('J03', 'least-privilege', 'default privileges no longer hand DDL-adjacent rights to tenant roles', {
  sql: `select count(*)::text from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace cross join unnest(d.defaclacl) as a(item) where n.nspname='public' and d.defaclobjtype='r' and (a.item::text like 'anon=%' or a.item::text like 'authenticated=%') and split_part(split_part(a.item::text,'/',1),'=',2) ~ '[Dxtm]';`, expect: 'ok', expectOut: '0' });

// =========================================================== K. auto-RLS guardrail
// public.rls_auto_enable() runs on ddl_command_end and enables row level security on every new
// table in public. It existed in production but in no migration, so a restore lost it. These
// prove it is reproduced, that it actually fires, and that revoking EXECUTE does not disable it
// (the event trigger mechanism invokes the function as its owner and never consults EXECUTE).
add('K01', 'auto-rls', 'the event trigger and its function are reproduced by the migrations', {
  sql: `select (select count(*) from pg_event_trigger where evtname='ensure_rls')::text || '|' ||
        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='rls_auto_enable')::text;`,
  expect: 'ok', expectOut: '1|1' });
add('K02', 'auto-rls', 'a newly created public table gets RLS enabled automatically', {
  sql: `create table public.k02_guardrail_probe(x int);
        select relrowsecurity::text from pg_class where oid='public.k02_guardrail_probe'::regclass;`,
  expect: 'ok', expectOut: 'true' });
add('K03', 'auto-rls', 'PUBLIC, anon and authenticated hold no EXECUTE on the event-trigger function', {
  sql: `select coalesce(array_to_string(p.proacl::text[],' '),'(default)') from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='rls_auto_enable';`,
  expect: 'ok' });  // asserted precisely by K04; this records the actual ACL in the report
add('K04', 'auto-rls', 'no tenant role and no PUBLIC default can execute it', {
  sql: `select (has_function_privilege('anon','public.rls_auto_enable()','EXECUTE')::text || '|' ||
               has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE')::text);`,
  expect: 'ok', expectOut: 'false|false' });
add('K05', 'auto-rls', 'the guardrail still fires after EXECUTE was revoked', {
  sql: `revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
        create table public.k05_guardrail_probe(x int);
        select relrowsecurity::text from pg_class where oid='public.k05_guardrail_probe'::regclass;`,
  expect: 'ok', expectOut: 'true' });

// =========================================================== L. push subscription claim
//
// push_subscriptions.endpoint is UNIQUE and belongs to the BROWSER, not to whoever is
// signed in. On a shared device the second parent to enable reminders collided with the
// first parent's row: ps_insert refuses a row for another user, ps_delete reaches only your
// own rows, and there is no update policy, so there was no way to take the endpoint and no
// way to be told why. public.claim_push_subscription is the way, and it displaces another
// guardian's row only on proof the caller holds the subscription — both keys, not just the
// endpoint, because an endpoint can leak into a log while the keys stay in the browser.
//
// GUARDIAN_A and GUARDIAN_B are the two synthetic parents sharing one browser.
const GUARDIAN_A = ADMIN_A;
const GUARDIAN_B = ADMIN_B;
const EP = 'https://push.example.invalid/endpoint/synthetic-AAA';
const K1 = 'synthetic-p256dh-key-one';
const K2 = 'synthetic-auth-key-one';
const OTHER_K1 = 'synthetic-p256dh-key-two';
const OTHER_K2 = 'synthetic-auth-key-two';

const claim = (ep, k1, k2) =>
  "select public.claim_push_subscription('" + ep + "','" + k1 + "','" + k2 + "');";
// A row planted as the table owner, standing in for the parent who never logged out.
const heldBy = (uid, k1, k2) =>
  "insert into public.push_subscriptions(user_id, endpoint, p256dh, auth) values ('"
  + uid + "','" + EP + "','" + (k1 || K1) + "','" + (k2 || K2) + "');";
const ownerOf = "select user_id::text from public.push_subscriptions where endpoint = '" + EP + "';";
const rowCount = "select count(*)::text from public.push_subscriptions where endpoint = '" + EP + "';";

add('L01', 'push-claim', 'anon cannot execute the claim function at all',
  { role: 'anon', sql: claim(EP, K1, K2), expect: 'error', expectError: /permission denied for function claim_push_subscription/ });
add('L02', 'push-claim', 'authenticated with no JWT subject is refused, not treated as nobody',
  { role: 'authenticated', sql: claim(EP, K1, K2), expect: 'error', expectError: /only be claimed by a signed-in guardian/ });
add('L03', 'push-claim', 'a first subscribe on an unheld endpoint succeeds',
  { role: 'authenticated', claims: GUARDIAN_A, sql: claim(EP, K1, K2), expect: 'ok', expectOut: 't' });
add('L04', 'push-claim', 'and the row it wrote belongs to the caller, not to anyone they named',
  { role: 'authenticated', claims: GUARDIAN_A, sql: claim(EP, K1, K2) + ownerOf, expect: 'ok', expectOut: GUARDIAN_A });
add('L05', 'push-claim', 'claiming an endpoint you already hold is a no-op that succeeds',
  { setup: heldBy(GUARDIAN_A), role: 'authenticated', claims: GUARDIAN_A, sql: claim(EP, K1, K2), expect: 'ok', expectOut: 't' });
add('L06', 'push-claim', 'and re-claiming does not duplicate the row',
  { setup: heldBy(GUARDIAN_A), role: 'authenticated', claims: GUARDIAN_A, sql: claim(EP, K1, K2) + rowCount, expect: 'ok', expectOut: '1' });
add('L07', 'push-claim', 'THE CASE: the next parent on the same browser takes the endpoint',
  { setup: heldBy(GUARDIAN_A), role: 'authenticated', claims: GUARDIAN_B, sql: claim(EP, K1, K2), expect: 'ok', expectOut: 't' });
add('L08', 'push-claim', 'and the row is now theirs, so the reminders go to the right person',
  { setup: heldBy(GUARDIAN_A), role: 'authenticated', claims: GUARDIAN_B, sql: claim(EP, K1, K2) + ownerOf, expect: 'ok', expectOut: GUARDIAN_B });
add('L09', 'push-claim', 'the displaced row is gone rather than left beside the new one',
  { setup: heldBy(GUARDIAN_A), role: 'authenticated', claims: GUARDIAN_B, sql: claim(EP, K1, K2) + rowCount, expect: 'ok', expectOut: '1' });
add('L10', 'push-claim', 'NEGATIVE: an endpoint without its keys cannot be taken',
  { setup: heldBy(GUARDIAN_A), role: 'authenticated', claims: GUARDIAN_B, sql: claim(EP, OTHER_K1, OTHER_K2), expect: 'ok', expectOut: 'f' });
add('L11', 'push-claim', 'and the rightful owner keeps it when the keys do not match',
  { setup: heldBy(GUARDIAN_A), role: 'authenticated', claims: GUARDIAN_B, sql: claim(EP, OTHER_K1, OTHER_K2) + 'reset role;' + ownerOf, expect: 'ok', expectOut: GUARDIAN_A });
add('L12', 'push-claim', 'one right key is not enough — p256dh alone does not claim it',
  { setup: heldBy(GUARDIAN_A), role: 'authenticated', claims: GUARDIAN_B, sql: claim(EP, K1, OTHER_K2) + 'reset role;' + ownerOf, expect: 'ok', expectOut: GUARDIAN_A });
add('L13', 'push-claim', 'nor auth alone',
  { setup: heldBy(GUARDIAN_A), role: 'authenticated', claims: GUARDIAN_B, sql: claim(EP, OTHER_K1, K2) + 'reset role;' + ownerOf, expect: 'ok', expectOut: GUARDIAN_A });
add('L14', 'push-claim', 'an empty endpoint is refused',
  { role: 'authenticated', claims: GUARDIAN_A, sql: claim('', K1, K2), expect: 'error', expectError: /endpoint and both subscription keys are required/ });
add('L15', 'push-claim', 'an empty key is refused',
  { role: 'authenticated', claims: GUARDIAN_A, sql: claim(EP, '', K2), expect: 'error', expectError: /endpoint and both subscription keys are required/ });
add('L16', 'push-claim', 'an absurdly long endpoint is refused rather than stored',
  { role: 'authenticated', claims: GUARDIAN_A,
    sql: "select public.claim_push_subscription(repeat('x',2049),'" + K1 + "','" + K2 + "');",
    expect: 'error', expectError: /endpoint and both subscription keys are required/ });
add('L17', 'push-claim', 'the function did not loosen the table: a guardian still cannot delete another row',
  { setup: heldBy(GUARDIAN_A), role: 'authenticated', claims: GUARDIAN_B,
    sql: "delete from public.push_subscriptions where endpoint = '" + EP + "';reset role;" + rowCount,
    expect: 'ok', expectOut: '1' });
add('L18', 'push-claim', 'nor read one: ps_select still scopes to your own rows',
  { setup: heldBy(GUARDIAN_A), role: 'authenticated', claims: GUARDIAN_B, sql: rowCount, expect: 'ok', expectOut: '0' });
add('L19', 'push-claim', 'anon still cannot read the table directly either',
  { setup: heldBy(GUARDIAN_A), role: 'anon', sql: rowCount, expect: 'ok', expectOut: '0' });

// =========================================================== M. service value constraints
//
// price_cents, duration_min and max_group_size were plain ints with nothing behind them,
// and the browser's only guard was isNaN(parseFloat(v)) — which '-40' passes.
const TRAINER = GUARDIAN_A;
const svcSetup =
  "insert into public.trainer_profiles(id, status, display_name) values ('"
  + TRAINER + "','draft','Synthetic Trainer A') on conflict (id) do nothing;";
const svc = (cols) =>
  "insert into public.services(trainer_id, title, price_cents, duration_min, max_group_size) values ('"
  + TRAINER + "','Synthetic session'," + cols + ");";
const svcCount = "select count(*)::text from public.services where trainer_id='" + TRAINER + "';";

add('M01', 'service-values', 'a well-formed service is still accepted',
  { setup: svcSetup, sql: svc('4000, 60, 1') + svcCount, expect: 'ok', expectOut: '1' });
add('M02', 'service-values', 'THE CASE: a negative price is refused by the database',
  { setup: svcSetup, sql: svc('-4000, 60, 1'),
    expect: 'error', expectError: /services_price_cents_not_negative/ });
add('M03', 'service-values', 'a free session is allowed — zero is a real price',
  { setup: svcSetup, sql: svc('0, 60, 1') + svcCount, expect: 'ok', expectOut: '1' });
add('M04', 'service-values', 'a zero-minute session is refused',
  { setup: svcSetup, sql: svc('4000, 0, 1'),
    expect: 'error', expectError: /services_duration_min_positive/ });
add('M05', 'service-values', 'a negative duration is refused',
  { setup: svcSetup, sql: svc('4000, -5, 1'),
    expect: 'error', expectError: /services_duration_min_positive/ });
add('M06', 'service-values', 'a group of zero athletes is refused',
  { setup: svcSetup, sql: svc('4000, 60, 0'),
    expect: 'error', expectError: /services_max_group_size_at_least_one/ });
add('M07', 'service-values', 'a negative group size is refused',
  { setup: svcSetup, sql: svc('4000, 60, -5'),
    expect: 'error', expectError: /services_max_group_size_at_least_one/ });
add('M08', 'service-values', 'an unspecified group size stays allowed — null is not zero',
  { setup: svcSetup, sql: svc('4000, 60, null') + svcCount, expect: 'ok', expectOut: '1' });
add('M09', 'service-values', 'an UPDATE cannot smuggle a negative price past the constraint either',
  { setup: svcSetup + svc('4000, 60, 1'),
    sql: "update public.services set price_cents = -4000 where trainer_id='" + TRAINER + "';",
    expect: 'error', expectError: /services_price_cents_not_negative/ });

// =========================================================== execute
const TAG = /^(BEGIN|COMMIT|ROLLBACK|SET|RESET|CREATE|DROP|ALTER|GRANT|REVOKE|DO|INSERT [0-9]+ [0-9]+|UPDATE [0-9]+|DELETE [0-9]+|SELECT [0-9]+)$/;
const observed = text => {
  const lines = text.split(String.fromCharCode(10)).map(l => l.trim()).filter(l => l && !TAG.test(l));
  return lines.length ? lines[lines.length - 1] : '';
};

const results = [];
for (const c of CASES) {
  const r = run(c);
  let pass;
  if (c.expect === 'error') {
    pass = r.errored && (!c.expectError || c.expectError.test(r.error || r.out));
  } else {
    pass = !r.errored && (c.expectOut === undefined || observed(r.out) === c.expectOut);
  }
  results.push({ ...c, expectError: c.expectError ? String(c.expectError) : undefined, actual: r.errored ? ('ERROR: ' + r.error) : observed(r.out), pass });
}

const byGroup = {};
for (const r of results) (byGroup[r.group] ||= []).push(r);
console.log('ISOLATED DATABASE SECURITY TESTS — public.company_composition_results');
console.log('cluster: ' + CONN.join(' ') + ' (disposable), every case rolled back\n');
for (const [group, rows] of Object.entries(byGroup)) {
  const failed = rows.filter(r => !r.pass).length;
  console.log(`[${group}] ${rows.length - failed}/${rows.length} pass`);
  for (const r of rows) {
    const mark = r.pass ? 'PASS' : 'FAIL';
    const tail = r.pass ? (r.note ? '  << ' + r.note : '') : `  expected=${r.expect}${r.expectOut !== undefined ? '/' + r.expectOut : ''} actual=${r.actual}`;
    console.log(`  ${mark} ${r.id} ${r.desc}${tail}`);
  }
  console.log('');
}
const failed = results.filter(r => !r.pass);
console.log(`TOTAL: ${results.length - failed.length}/${results.length} pass, ${failed.length} fail`);
fs.writeFileSync(path.join(process.env.PP_DB_OUT || __dirname, 'security-test-report.json'), JSON.stringify(results, null, 2));
process.exitCode = failed.length ? 1 : 0;
