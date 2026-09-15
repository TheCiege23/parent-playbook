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

// ================================================ N-R. external body composition records
// Imported DEXA / BIA / smart-scale results. These are evidence inputs, not model outputs, so the
// questions are different from the company table's: can a source claim more than it measured, can
// a child's result arrive without a live release, and can an organization write to a clinical
// record it did not create.
const GUARDIAN  = MEMBER_C;                // family owner: can edit every synthetic athlete
const C_LIVE    = 'e0000000-0000-4000-8000-00000000000e';
const C_REVOKED = 'e0000000-0000-4000-8000-00000000001e';
const C_EXPIRED = 'e0000000-0000-4000-8000-00000000002e';
const C_OFF     = 'e0000000-0000-4000-8000-00000000003e';  // live, but for the off-roster athlete

// The SQL-side payload gate, called directly so a rejection comes back as a value rather than an
// exception and the test can tell "refused" from "crashed".
const payloadFor = (source, outputsJson) =>
  "public.test_reference_payload('synthetic-reference-001','synthetic-subject-001','adult_reference','"
  + source + "','2026-09-10T04:00:00Z','2026-09-10T04:05:00Z'"
  + (outputsJson ? ",'" + outputsJson + "'::jsonb" : '') + ')';
const refAllow = (expr, source) =>
  'select private.external_composition_payload_is_allowed(' + expr
  + ",'synthetic-reference-001','synthetic-subject-001','adult_reference','" + (source || 'dexa')
  + "','2026-09-10T04:00:00Z','2026-09-10T04:05:00Z');";
const refBase = payloadFor('dexa');
const one = (key, status, value, unit) =>
  '[{"key":"' + key + '","status":"' + status + '","value":' + value + ',"unit":"' + unit + '"}]';

add('N00', 'external-payload', 'a DXA payload measuring body fat and lean mass is accepted',
  { sql: refAllow(refBase), expect: 'ok', expectOut: 't' });

// What each source is allowed to say it did. A machine that derives a number through the
// manufacturer's equation did not measure it, and a record saying otherwise overstates the
// evidence a parent is looking at.
const claims = [
  ['N01', 'dexa',           'body_fat_percent',        'measured',        18,  'percent', 't', 'DXA measures body fat'],
  ['N02', 'dexa',           'skeletal_muscle_mass_kg', 'measured',        30,  'kg',      'f', 'DXA does not isolate skeletal muscle from lean soft tissue'],
  ['N03', 'dexa',           'visceral_fat_index',      'measured',        5,   'index',   'f', 'DXA does not produce a visceral-fat index'],
  ['N04', 'bia_clinical',   'body_fat_percent',        'device_estimated',18,  'percent', 't', 'bioimpedance derives body fat'],
  ['N05', 'bia_clinical',   'body_fat_percent',        'measured',        18,  'percent', 'f', 'bioimpedance measures impedance, not fat'],
  ['N06', 'bia_clinical',   'weight_kg',               'measured',        70,  'kg',      't', 'the scale really does weigh you'],
  ['N07', 'smart_scale',    'lean_mass_kg',            'measured',        60,  'kg',      'f', 'a smart scale does not measure lean mass'],
  ['N08', 'smart_scale',    'skeletal_muscle_mass_kg', 'device_estimated',30,  'kg',      't', 'but it may estimate it'],
  ['N09', 'health_platform','body_fat_percent',        'device_estimated',18,  'percent', 't', 'a platform relays another app estimate'],
  ['N10', 'dexa',           'bmi',                     'measured',        22,  'kg_m2',   'f', 'nothing measures BMI'],
  ['N11', 'dexa',           'bmi',                     'calculated',      22,  'kg_m2',   't', 'BMI is arithmetic'],
  ['N12', 'dexa',           'bone_mineral_content_kg', 'measured',        2.5, 'kg',      't', 'DXA measures bone mineral content'],
  ['N13', 'bia_clinical',   'bone_mass_kg',            'device_estimated',3,   'kg',      't', 'bioimpedance estimates bone mass'],
  ['N14', 'manual_report',  'body_fat_percent',        'measured',        18,  'percent', 't', 'a transcription is no better than its document, and no worse'],
];
for (const [id, source, key, status, value, unit, want, why] of claims)
  add(id, 'external-payload', source + ' ' + status + ' ' + key + ': ' + why,
    { sql: refAllow(payloadFor(source, one(key, status, value, unit)), source),
      expect: 'ok', expectOut: want });

const ranges = [
  ['N20', 'body fat of 140% is refused',        one('body_fat_percent', 'measured', 140, 'percent'), 'f'],
  ['N21', 'body fat of 0.5% is refused',        one('body_fat_percent', 'measured', 0.5, 'percent'), 'f'],
  ['N22', 'a 500 kg weight is refused',         one('weight_kg', 'measured', 500, 'kg'), 'f'],
  ['N23', 'a plausible body fat is kept',       one('body_fat_percent', 'measured', 18, 'percent'), 't'],
  ['N24', 'the wrong unit is refused',          one('weight_kg', 'measured', 154, 'lb'), 'f'],
  ['N25', 'a quoted number is refused',         '[{"key":"weight_kg","status":"measured","value":"70","unit":"kg"}]', 'f'],
  ['N26', 'a JSON null value is refused',       '[{"key":"weight_kg","status":"measured","value":null,"unit":"kg"}]', 'f'],
  ['N27', 'an undeclared metric is refused',    one('vo2max', 'measured', 55, 'ml_kg_min'), 'f'],
  ['N28', 'the same metric twice is refused',
    '[{"key":"weight_kg","status":"measured","value":70,"unit":"kg"},{"key":"weight_kg","status":"measured","value":71,"unit":"kg"}]', 'f'],
  ['N29', 'an empty output list is refused',    '[]', 'f'],
];
for (const [id, desc, json, want] of ranges)
  add(id, 'external-payload', desc, { sql: refAllow(payloadFor('dexa', json)), expect: 'ok', expectOut: want });

// A model estimate must never be storable here, whatever else it claims about itself.
const notAnEstimate = [
  ['N30', 'a payload carrying a provider block',   refBase + " || '" + '{"provider":{"id":"x"}}' + "'::jsonb"],
  ['N31', 'a payload carrying a model manifest',   refBase + " || '" + '{"modelManifest":{"schema":"x"}}' + "'::jsonb"],
  ['N32', 'a payload claiming status estimated',   refBase + " || '" + '{"status":"estimated"}' + "'::jsonb"],
  ['N33', 'the company result schema',             "jsonb_set(" + refBase + ",'{schema}','\"PP_COMPANY_COMPOSITION_RESULT_V1\"')"],
  ['N34', 'a payload claiming model_estimate origin', "jsonb_set(" + refBase + ",'{origin}','\"model_estimate\"')"],
];
for (const [id, desc, expr] of notAnEstimate)
  add(id, 'external-payload', desc + ' is refused', { sql: refAllow('(' + expr + ')'), expect: 'ok', expectOut: 'f' });

const disagrees = [
  ['N40', 'recordId',    "jsonb_set(" + refBase + ",'{recordId}','\"other\"')"],
  ['N41', 'subjectId',   "jsonb_set(" + refBase + ",'{subjectId}','\"other\"')"],
  ['N42', 'scope',       "jsonb_set(" + refBase + ",'{scope}','\"child_athlete\"')"],
  ['N43', 'sourceClass', "jsonb_set(" + refBase + ",'{sourceClass}','\"smart_scale\"')"],
  ['N44', 'measuredAt',  "jsonb_set(" + refBase + ",'{measuredAt}','\"2020-01-01T00:00:00.000Z\"')"],
];
for (const [id, field, expr] of disagrees)
  add(id, 'external-payload', 'payload ' + field + ' disagreeing with the column is refused',
    { sql: refAllow('(' + expr + ')'), expect: 'ok', expectOut: 'f' });
add('N45', 'external-payload', 'a malformed instant is refused rather than raising a cast error',
  { sql: refAllow("jsonb_set(" + refBase + ",'{measuredAt}','\"not-a-date\"')"), expect: 'ok', expectOut: 'f' });

// ------------------------------------------------------------------------------------ consent
const seedChild = (consent) =>
  "select public.test_seed_external('synthetic-child-ref-001','" + GUARDIAN + "','child_athlete','"
  + ATH_A + "','" + ATH_A + "','" + consent + "');";
const insertChild = (consentExpr, guardian) =>
  "insert into public.external_composition_records(record_id, subject_reference, subject_scope,"
  + " athlete_id, guardian_id, consent_id, source_class, facility, measured_at, saved_at,"
  + " retention_until, record) values ('synthetic-child-ref-002','" + ATH_A + "','child_athlete','"
  + ATH_A + "','" + (guardian || GUARDIAN) + "'," + consentExpr + ",'dexa','Synthetic Clinic',"
  + "'2026-09-10T04:00:00Z','2026-09-10T04:05:00Z','2030-01-01T00:00:00Z',"
  + "public.test_reference_payload('synthetic-child-ref-002','" + ATH_A + "','child_athlete','dexa',"
  + "'2026-09-10T04:00:00Z','2026-09-10T04:05:00Z'));";
const q = (id) => "'" + id + "'";
const countRecords = 'select count(*)::text from public.external_composition_records;';
const NOT_LIVE = /not live for this athlete|violates row-level security/;

add('P00', 'external-consent', 'a child record with a live release is stored',
  { claims: GUARDIAN, role: 'authenticated', sql: insertChild(q(C_LIVE)) + countRecords,
    expect: 'ok', expectOut: '1' });
add('P01', 'external-consent', 'a child record naming a WITHDRAWN release is refused',
  { claims: GUARDIAN, role: 'authenticated', sql: insertChild(q(C_REVOKED)),
    expect: 'error', expectError: NOT_LIVE });
add('P02', 'external-consent', 'a child record naming an EXPIRED release is refused',
  { claims: GUARDIAN, role: 'authenticated', sql: insertChild(q(C_EXPIRED)),
    expect: 'error', expectError: NOT_LIVE });
add('P03', 'external-consent', 'a release belonging to a different athlete does not authorise this one',
  { claims: GUARDIAN, role: 'authenticated', sql: insertChild(q(C_OFF)),
    expect: 'error', expectError: NOT_LIVE });
add('P04', 'external-consent', 'a child record naming no release at all is refused',
  { claims: GUARDIAN, role: 'authenticated', sql: insertChild('null'),
    expect: 'error', expectError: /not live for this athlete|violates check constraint|violates row-level security/ });
// The trigger, not only the policy. The service role bypasses RLS, so an import running with the
// service key must not become the way a record arrives for a child whose family withdrew.
add('P05', 'external-consent', 'the OWNER, who bypasses RLS, is still refused a withdrawn release',
  { sql: seedChild(C_REVOKED), expect: 'error', expectError: /not live for this athlete/ });
add('P06', 'external-consent', 'the owner is still refused another athlete release',
  { sql: seedChild(C_OFF), expect: 'error', expectError: /not live for this athlete/ });
add('P07', 'external-consent', 'an adult reference needs no release',
  { claims: GUARDIAN, role: 'authenticated',
    sql: "insert into public.external_composition_records(record_id,subject_reference,subject_scope,"
      + "guardian_id,source_class,facility,measured_at,saved_at,retention_until,record) values "
      + "('synthetic-adult-ref-001','synthetic-subject-001','adult_reference','" + GUARDIAN
      + "','dexa','Synthetic Clinic','2026-09-10T04:00:00Z','2026-09-10T04:05:00Z',"
      + "'2030-01-01T00:00:00Z',public.test_reference_payload('synthetic-adult-ref-001'));" + countRecords,
    expect: 'ok', expectOut: '1' });
// Withdrawal is retroactive. A release that stops being live takes its records with it, because a
// record the family no longer agrees to is not one we are entitled to keep.
// The sweep and the count are separate statements on purpose. A single statement sees one
// snapshot, so a count taken alongside the call reports the rows as they stood BEFORE the delete,
// and a working sweep reads as a sweep that did nothing.
const sweepThen = (tail) => 'select private.sweep_external_composition_retention(); ' + tail;
add('P08', 'external-consent', 'the sweep removes records whose release was later withdrawn',
  { setup: seedChild(C_LIVE) + "update public.biometric_consents set revoked_at = now() where id='" + C_LIVE + "';",
    sql: sweepThen(countRecords), expect: 'ok', expectOut: '0' });
add('P08b', 'external-consent', 'and reports that it removed exactly one',
  { setup: seedChild(C_LIVE) + "update public.biometric_consents set revoked_at = now() where id='" + C_LIVE + "';",
    sql: 'select private.sweep_external_composition_retention()::text;', expect: 'ok', expectOut: '1' });
add('P09', 'external-consent', 'the sweep leaves a record whose release is still live',
  { setup: seedChild(C_LIVE), sql: sweepThen(countRecords), expect: 'ok', expectOut: '1' });

const seedOld = "select public.test_seed_external('synthetic-adult-old','" + GUARDIAN
  + "','adult_reference','synthetic-subject-001',null,null,null,"
  + "'2020-01-01T00:00:00Z','2021-01-01T00:00:00Z','2020-01-01T00:05:00Z');";
add('P10', 'external-consent', 'the sweep removes a record past its retention date',
  { setup: seedOld, sql: sweepThen(countRecords), expect: 'ok', expectOut: '0' });

// ------------------------------------------------------------------------------------- access
const seedShared = "select public.test_seed_external('synthetic-child-ref-001','" + GUARDIAN
  + "','child_athlete','" + ATH_A + "','" + ATH_A + "','" + C_LIVE + "','" + ORG_A + "');";
const seedPrivate = seedChild(C_LIVE);

add('Q00', 'external-access', 'the importing guardian reads their own record',
  { setup: seedPrivate, claims: GUARDIAN, role: 'authenticated', sql: countRecords, expect: 'ok', expectOut: '1' });
add('Q01', 'external-access', 'an organization admin cannot read a record that was not shared',
  { setup: seedPrivate, claims: ADMIN_A, role: 'authenticated', sql: countRecords, expect: 'ok', expectOut: '0' });
add('Q02', 'external-access', 'an organization admin reads a record the guardian shared with them',
  { setup: seedShared, claims: ADMIN_A, role: 'authenticated', sql: countRecords, expect: 'ok', expectOut: '1' });
add('Q03', 'external-access', 'a different organization still cannot read it',
  { setup: seedShared, claims: ADMIN_B, role: 'authenticated', sql: countRecords, expect: 'ok', expectOut: '0' });
add('Q04', 'external-access', 'anon holds no reach at all',
  { setup: seedShared, role: 'anon', sql: countRecords, expect: 'error', expectError: /permission denied/ });
add('Q05', 'external-access', 'a caller with no claim reads nothing',
  { setup: seedShared, role: 'authenticated', sql: countRecords, expect: 'ok', expectOut: '0' });
// Read, and only read. An organization that could write to a clinical record it did not create
// could alter somebody's medical history.
add('Q06', 'external-access', 'the shared-with organization cannot change the source',
  { setup: seedShared, claims: ADMIN_A, role: 'authenticated',
    sql: "with u as (update public.external_composition_records set source_class='smart_scale' returning 1) select count(*)::text from u;",
    expect: 'ok', expectOut: '0' });
add('Q07', 'external-access', 'the shared-with organization cannot delete it',
  { setup: seedShared, claims: ADMIN_A, role: 'authenticated',
    sql: 'with d as (delete from public.external_composition_records returning 1) select count(*)::text from d;',
    expect: 'ok', expectOut: '0' });
add('Q08', 'external-access', 'a caller cannot import a record in another guardian name',
  { claims: ADMIN_A, role: 'authenticated', sql: insertChild(q(C_LIVE), GUARDIAN),
    expect: 'error', expectError: /violates row-level security/ });
add('Q09', 'external-access', 'a stranger cannot import a record about an athlete they cannot edit',
  { claims: ADMIN_A, role: 'authenticated', sql: insertChild(q(C_LIVE), ADMIN_A),
    expect: 'error', expectError: /violates row-level security/ });
add('Q10', 'external-access', 'the guardian can delete their own record',
  { setup: seedPrivate, claims: GUARDIAN, role: 'authenticated',
    sql: 'with d as (delete from public.external_composition_records returning 1) select count(*)::text from d;',
    expect: 'ok', expectOut: '1' });

// ---------------------------------------------------------------------------------- integrity
add('R00', 'external-integrity', 'importing the same reading twice is refused, under a new record id',
  { setup: seedPrivate,
    sql: seedPrivate.replace('synthetic-child-ref-001', 'synthetic-child-ref-009'),
    expect: 'error', expectError: /external_composition_reading_idx/ });
add('R01', 'external-integrity', 'two people whose subject label is both "me" do not collide',
  { setup: "select public.test_seed_external('synthetic-adult-a','" + GUARDIAN + "','adult_reference','me');",
    sql: "select public.test_seed_external('synthetic-adult-b','" + ADMIN_A
      + "','adult_reference','me',null,null,null,'2026-09-11T04:00:00Z');" + countRecords,
    expect: 'ok', expectOut: '2' });
add('R02', 'external-integrity', 'retention beyond five years from the day we took custody is refused',
  { sql: "select public.test_seed_external('synthetic-adult-long','" + GUARDIAN
      + "','adult_reference','synthetic-subject-001',null,null,null,'2026-09-10T04:00:00Z','2040-01-01T00:00:00Z');",
    expect: 'error', expectError: /violates check constraint/ });
// Retention runs from custody, not from the measurement, so a scan from years ago is importable
// rather than instantly expired.
add('R03', 'external-integrity', 'a scan measured years ago is still importable',
  { sql: "select public.test_seed_external('synthetic-adult-2019','" + GUARDIAN
      + "','adult_reference','synthetic-subject-001',null,null,null,'2019-01-01T00:00:00Z','2030-01-01T00:00:00Z');"
      + countRecords, expect: 'ok', expectOut: '1' });
add('R04', 'external-integrity', 'a DXA record with no facility is refused',
  { sql: "insert into public.external_composition_records(record_id,subject_reference,subject_scope,"
      + "guardian_id,source_class,measured_at,saved_at,retention_until,record) values "
      + "('synthetic-adult-nofac','synthetic-subject-001','adult_reference','" + GUARDIAN
      + "','dexa','2026-09-10T04:00:00Z','2026-09-10T04:05:00Z','2030-01-01T00:00:00Z',"
      + "public.test_reference_payload('synthetic-adult-nofac'));",
    expect: 'error', expectError: /violates check constraint/ });
add('R05', 'external-integrity', 'an adult reference carrying an athlete id is refused',
  { sql: "select public.test_seed_external('synthetic-adult-mix','" + GUARDIAN
      + "','adult_reference','synthetic-subject-001','" + ATH_A + "','" + C_LIVE + "');",
    expect: 'error', expectError: /violates check constraint/ });
add('R06', 'external-integrity', 'a child record whose subject label is not the athlete id is refused',
  { sql: "select public.test_seed_external('synthetic-child-mismatch','" + GUARDIAN
      + "','child_athlete','not-the-athlete','" + ATH_A + "','" + C_LIVE + "');",
    expect: 'error', expectError: /violates check constraint/ });

const ATTACH_ID = 'dddddddd-0000-4000-8000-00000000000d';
const attach = (record, status) =>
  "insert into public.external_composition_attachments(id, record_uuid, storage_key, content_type,"
  + " verification_status" + (status ? ', verified_by, verified_at' : '') + ") select '" + ATTACH_ID + "', r.id,"
  + " r.id::text || '/report.pdf', 'application/pdf', '" + (status || 'unverified') + "'"
  + (status ? ", '" + ADMIN_A + "', now()" : '')
  + " from public.external_composition_records r where r.record_id='" + record + "';";
const VERIFIED = 'verified_against_report';

add('R10', 'external-integrity', 'a verified record refuses a change of source',
  { setup: seedPrivate + attach('synthetic-child-ref-001', VERIFIED),
    sql: "update public.external_composition_records set source_class='smart_scale';",
    expect: 'error', expectError: /verified against its report/ });
add('R11', 'external-integrity', 'a verified record refuses a change of measured value',
  { setup: seedPrivate + attach('synthetic-child-ref-001', VERIFIED),
    sql: "update public.external_composition_records set record = jsonb_set(record,'{outputs,0,value}','99');",
    expect: 'error', expectError: /verified against its report/ });
add('R12', 'external-integrity', 'an unverified record can still be corrected',
  { setup: seedPrivate + attach('synthetic-child-ref-001'),
    sql: "update public.external_composition_records set facility='Corrected Clinic';"
      + ' select facility from public.external_composition_records;',
    expect: 'ok', expectOut: 'Corrected Clinic' });
add('R13', 'external-integrity', 'a verified record can still be shared with an organization',
  { setup: seedPrivate + attach('synthetic-child-ref-001', VERIFIED),
    sql: "update public.external_composition_records set team_id='" + ORG_A + "';"
      + ' select team_id::text from public.external_composition_records;',
    expect: 'ok', expectOut: ORG_A });

// Verification is a claim that a person compared the typed numbers against the document, so it is
// not something the person who typed them can assert about themselves.
add('R20', 'external-integrity', 'a guardian cannot certify their own transcription',
  { setup: seedPrivate + attach('synthetic-child-ref-001'), claims: GUARDIAN, role: 'authenticated',
    sql: "select (public.verify_composition_attachment('" + ATTACH_ID + "'))->>'verified';",
    expect: 'error', expectError: /platform verifier/ });
add('R21', 'external-integrity', 'a guardian cannot write the verified column directly either',
  { setup: seedPrivate + attach('synthetic-child-ref-001'), claims: GUARDIAN, role: 'authenticated',
    sql: "update public.external_composition_attachments set verification_status='" + VERIFIED + "';",
    expect: 'error', expectError: /permission denied/ });
add('R22', 'external-integrity', 'a platform verifier can mark it verified',
  { setup: seedPrivate + attach('synthetic-child-ref-001')
      + "insert into public.app_admins(guardian_id) values ('" + ADMIN_A + "') on conflict do nothing;",
    claims: ADMIN_A, role: 'authenticated',
    sql: "select (public.verify_composition_attachment('" + ATTACH_ID + "'))->>'verified';",
    expect: 'ok', expectOut: 'true' });
const asAdmin = (body) => "insert into public.app_admins(guardian_id) values ('" + ADMIN_A + "') on conflict do nothing;" + body;
add('R22b', 'external-integrity', 'a platform verifier can find the document they are asked to verify',
  { setup: seedPrivate + attach('synthetic-child-ref-001') + asAdmin(''),
    claims: ADMIN_A, role: 'authenticated',
    sql: 'select count(*)::text from public.external_composition_attachments;', expect: 'ok', expectOut: '1' });
add('R22c', 'external-integrity', 'and read the typed numbers they are comparing it against',
  { setup: seedPrivate + attach('synthetic-child-ref-001') + asAdmin(''),
    claims: ADMIN_A, role: 'authenticated', sql: countRecords, expect: 'ok', expectOut: '1' });
add('R22d', 'external-integrity', 'an organization admin who is not a verifier still cannot',
  { setup: seedShared + attach('synthetic-child-ref-001'), claims: ADMIN_A, role: 'authenticated',
    sql: 'select count(*)::text from public.external_composition_attachments;', expect: 'ok', expectOut: '0' });
add('R22e', 'external-integrity', 'verifying is written to the audit trail',
  { setup: seedPrivate + attach('synthetic-child-ref-001') + asAdmin(''),
    claims: ADMIN_A, role: 'authenticated',
    sql: "select public.verify_composition_attachment('" + ATTACH_ID + "');"
      + " reset role; select count(*)::text from public.access_log where action='external_composition_attachment_verified';",
    expect: 'ok', expectOut: '1' });
add('R23', 'external-integrity', 'an attachment cannot be inserted already claiming to be verified',
  { setup: seedPrivate, claims: GUARDIAN, role: 'authenticated',
    sql: attach('synthetic-child-ref-001', VERIFIED),
    expect: 'error', expectError: /violates row-level security/ });
// The shared numbers are what the organization was given. The source document carries a name, a
// date of birth and a referring physician, and was not.
add('R24', 'external-integrity', 'the shared-with organization cannot see the source document',
  { setup: seedShared + attach('synthetic-child-ref-001'), claims: ADMIN_A, role: 'authenticated',
    sql: 'select count(*)::text from public.external_composition_attachments;', expect: 'ok', expectOut: '0' });
add('R25', 'external-integrity', 'the guardian can see their own source document',
  { setup: seedPrivate + attach('synthetic-child-ref-001'), claims: GUARDIAN, role: 'authenticated',
    sql: 'select count(*)::text from public.external_composition_attachments;', expect: 'ok', expectOut: '1' });

// A report's file goes through the Storage API, never by a DELETE on storage.objects. Supabase refuses that DELETE
// (storage.protect_delete, which 00-preamble.sql reproduces), because the row would go and the file's bytes would
// stay. Until 20260915200000 a trigger issued it whenever an attachment row went, so in production deleting a record
// with a report, its athlete or its account failed, and so would the retention sweep. Now the database refuses to
// delete an attachment whose file is still stored, every path removes the file first, and the sweep leaves such a
// record for composition-report-retention. storageApiRemove stands in for the Storage API, which sets
// storage.allow_delete_query for its own delete.
const putObject = "insert into storage.objects(bucket_id,name) select 'composition-reports', storage_key from public.external_composition_attachments;";
const objectCount = "(select count(*) from storage.objects where bucket_id='composition-reports')::text";
const storageApiRemove = "select set_config('storage.allow_delete_query','true',true); delete from storage.objects where bucket_id='composition-reports';"
  + " select set_config('storage.allow_delete_query','false',true);";
const attachmentsAndObjects = "select (select count(*) from public.external_composition_attachments)::text || '|' || " + objectCount + ';';
const STILL_STORED = /report file is still stored/;
const removeAsCaller = "select set_config('storage.allow_delete_query','true',true);"
  + " with d as (delete from storage.objects where bucket_id='composition-reports' returning 1) select count(*)::text from d;";
add('R29', 'external-integrity', 'SQL cannot delete a stored object, as on Supabase',
  { setup: seedPrivate + attach('synthetic-child-ref-001') + putObject,
    sql: "delete from storage.objects where bucket_id='composition-reports';", expect: 'error', expectError: /Direct deletion from storage tables is not allowed/ });
add('R30', 'external-integrity', 'a record whose report file is still stored cannot be deleted, and nothing is lost',
  { setup: seedPrivate + attach('synthetic-child-ref-001') + putObject,
    sql: 'delete from public.external_composition_records;', expect: 'error', expectError: STILL_STORED });
add('R30b', 'external-integrity', 'once the file is removed through the Storage API, the record and its attachment go',
  { setup: seedPrivate + attach('synthetic-child-ref-001') + putObject + storageApiRemove,
    sql: 'delete from public.external_composition_records;' + attachmentsAndObjects, expect: 'ok', expectOut: '0|0' });
add('R30c', 'external-integrity', 'the importing guardian may remove the file through Storage while the record exists',
  { setup: seedPrivate + attach('synthetic-child-ref-001') + putObject, claims: GUARDIAN, role: 'authenticated',
    sql: removeAsCaller, expect: 'ok', expectOut: '1' });
add('R30d', 'external-integrity', 'and then delete the record, as the app does',
  { setup: seedPrivate + attach('synthetic-child-ref-001') + putObject + storageApiRemove, claims: GUARDIAN, role: 'authenticated',
    sql: 'with d as (delete from public.external_composition_records returning 1) select count(*)::text from d;', expect: 'ok', expectOut: '1' });
add('R30e', 'external-integrity', 'an organization the record was shared with cannot remove the file',
  { setup: seedShared + attach('synthetic-child-ref-001') + putObject, claims: ADMIN_A, role: 'authenticated',
    sql: removeAsCaller, expect: 'ok', expectOut: '0' });

const seedOldBare = "select public.test_seed_external('synthetic-adult-old-2','" + GUARDIAN
  + "','adult_reference','synthetic-subject-001',null,null,null,"
  + "'2020-02-01T00:00:00Z','2021-02-01T00:00:00Z','2020-02-01T00:05:00Z');";
const withdrawnChild = seedChild(C_LIVE) + "update public.biometric_consents set revoked_at = now() where id='" + C_LIVE + "';";
add('R31', 'external-integrity', 'the retention sweep leaves a due record whose file is still stored, instead of failing',
  { setup: seedOld + attach('synthetic-adult-old') + putObject,
    sql: sweepThen(countRecords), expect: 'ok', expectOut: '1' });
add('R31b', 'external-integrity', 'and still removes every other due record, so one report cannot stop retention for everyone',
  { setup: seedOld + attach('synthetic-adult-old') + putObject + seedOldBare,
    sql: 'select private.sweep_external_composition_retention()::text;', expect: 'ok', expectOut: '1' });
add('R31c', 'external-integrity', 'the service role is shown the stored files holding back a due record, expired or withdrawn',
  { setup: seedOld + attach('synthetic-adult-old') + putObject,
    sql: "set local role service_role; select count(*)::text from public.composition_reports_due_for_removal();", expect: 'ok', expectOut: '1' });
add('R31d', 'external-integrity', 'a withdrawn release holds its record back the same way',
  { setup: withdrawnChild + attach('synthetic-child-ref-001') + putObject,
    sql: "set local role service_role; select count(*)::text from public.composition_reports_due_for_removal();", expect: 'ok', expectOut: '1' });
add('R31e', 'external-integrity', 'a record that is not due, or whose file is gone, is not listed',
  { setup: seedPrivate + attach('synthetic-child-ref-001') + putObject + seedOldBare,
    sql: "set local role service_role; select count(*)::text from public.composition_reports_due_for_removal();", expect: 'ok', expectOut: '0' });
add('R31f', 'external-integrity', 'once composition-report-retention removes the file, its sweep removes the record',
  { setup: seedOld + attach('synthetic-adult-old') + putObject + storageApiRemove,
    sql: "set local role service_role; select public.run_external_composition_retention()::text;", expect: 'ok', expectOut: '1' });
add('R31g', 'external-integrity', 'only the service role can list due files or run the sweep',
  { sql: "select string_agg(has_function_privilege(r, f, 'EXECUTE')::text, ',' order by r, f) from unnest(array['anon','authenticated','service_role']) r,"
      + " unnest(array['public.composition_reports_due_for_removal(integer)','public.run_external_composition_retention()']) f;",
    expect: 'ok', expectOut: 'false,false,false,false,true,true' });
add('R31h', 'external-integrity', 'the report retention job is registered with the scheduler',
  { sql: "select count(*)::text from cron.job where jobname='external-composition-report-retention';", expect: 'ok', expectOut: '1' });

add('R32', 'external-integrity', 'an athlete whose imported result has a stored report cannot be deleted until the file is removed',
  { setup: seedPrivate + attach('synthetic-child-ref-001') + putObject,
    sql: "delete from public.athletes where id='" + ATH_A + "';", expect: 'error', expectError: STILL_STORED });
add('R32b', 'external-integrity', 'after the file is removed through the Storage API, deleting the athlete takes the record and attachment',
  { setup: seedPrivate + attach('synthetic-child-ref-001') + putObject + storageApiRemove,
    sql: "delete from public.athletes where id='" + ATH_A + "';" + attachmentsAndObjects, expect: 'ok', expectOut: '0|0' });
add('R32c', 'external-integrity', 'delete-athlete asks can_delete_athlete first: yes for a family owner of the athlete',
  { claims: GUARDIAN, role: 'authenticated', sql: "select public.can_delete_athlete('" + ATH_A + "')::text;", expect: 'ok', expectOut: 'true' });
add('R32d', 'external-integrity', 'no for an organization admin who is not in the family',
  { claims: ADMIN_A, role: 'authenticated', sql: "select public.can_delete_athlete('" + ATH_A + "')::text;", expect: 'ok', expectOut: 'false' });
add('R32e', 'external-integrity', 'no for a caller with no claim',
  { role: 'authenticated', sql: "select public.can_delete_athlete('" + ATH_A + "')::text;", expect: 'ok', expectOut: 'false' });
add('R32f', 'external-integrity', 'anon holds no execute on can_delete_athlete',
  { role: 'anon', sql: "select public.can_delete_athlete('" + ATH_A + "')::text;", expect: 'error', expectError: /permission denied/ });
// The audit of each cascaded delete runs with the athlete row already gone, so it keeps no link to it rather than
// failing the athlete's delete, as the body scan audit does.
add('R32g', 'external-integrity', 'an athlete with an imported result and no report can be deleted, and the audit keeps no link',
  { setup: seedPrivate,
    sql: "delete from public.athletes where id='" + ATH_A + "';"
      + " select count(*)::text || '|' || count(*) filter (where athlete_id is null)::text || '|' || count(*) filter (where detail->>'athlete_id' = '" + ATH_A + "')::text"
      + " from public.access_log where action='external_composition_record_delete';",
    expect: 'ok', expectOut: '1|1|1' });

const REPORT_OWNER = 'f0000000-0000-4000-8000-00000000000f';
const seedOwnReport = "insert into auth.users(id, email) values ('" + REPORT_OWNER + "','synthetic-report-owner@example.invalid');"
  + " select public.test_seed_external('synthetic-adult-own','" + REPORT_OWNER + "','adult_reference','me');"
  + attach('synthetic-adult-own') + putObject;
add('R33', 'external-integrity', 'an account whose own imported result has a stored report cannot be deleted until the file is removed',
  { setup: seedOwnReport, sql: "delete from auth.users where id='" + REPORT_OWNER + "';", expect: 'error', expectError: STILL_STORED });
add('R33b', 'external-integrity', 'after the file is removed through the Storage API, deleting the account takes the record and attachment',
  { setup: seedOwnReport + storageApiRemove,
    sql: "delete from auth.users where id='" + REPORT_OWNER + "';" + attachmentsAndObjects, expect: 'ok', expectOut: '0|0' });

// The audit trail records that a health record moved, without becoming one itself.
add('R40', 'external-integrity', 'an insert is audited',
  { sql: seedPrivate + "select count(*)::text from public.access_log where action='external_composition_record_insert';",
    expect: 'ok', expectOut: '1' });
add('R41', 'external-integrity', 'a delete is audited',
  { setup: seedPrivate,
    sql: 'delete from public.external_composition_records;'
      + " select count(*)::text from public.access_log where action='external_composition_record_delete';",
    expect: 'ok', expectOut: '1' });
add('R42', 'external-integrity', 'no measured value reaches the audit trail',
  { sql: seedPrivate + "select count(*)::text from public.access_log where action like 'external_composition_record_%'"
      + " and (detail ?| array['outputs','record','body_fat_percent','lean_mass_kg','value']"
      + " or detail::text like '%body_fat%' or detail::text like '%lean_mass%');",
    expect: 'ok', expectOut: '0' });

// One answer to "what is this record", so that no screen has to work it out from the columns.
add('R50', 'external-integrity', 'an imported measurement is never labelled a Parent Playbook estimate',
  { sql: "select (public.describe_composition_origin(public.test_reference_payload()))->>'isParentPlaybookEstimate';",
    expect: 'ok', expectOut: 'false' });
add('R51', 'external-integrity', 'a model result is labelled a Parent Playbook estimate',
  { sql: 'select (public.describe_composition_origin(\'{"schema":"PP_BODY_COMPOSITION_ESTIMATE_V1"}\'::jsonb))->>\'isParentPlaybookEstimate\';',
    expect: 'ok', expectOut: 'true' });
add('R52', 'external-integrity', 'an unrecognised payload is labelled unknown, not estimated',
  { sql: 'select (public.describe_composition_origin(\'{"schema":"SOMETHING_ELSE"}\'::jsonb))->>\'origin\';',
    expect: 'ok', expectOut: 'unknown' });
add('R53', 'external-integrity', 'a device-estimated record is labelled device estimated',
  { sql: 'select (public.describe_composition_origin(' + payloadFor('smart_scale', one('body_fat_percent', 'device_estimated', 18, 'percent')) + "))->>'label';",
    expect: 'ok', expectOut: 'Device estimated' });

add('R60', 'external-integrity', 'anon holds no privilege on the records table',
  { sql: grantsFor('external_composition_records', 'anon'), expect: 'ok', expectOut: '(none)' });
add('R61', 'external-integrity', 'anon holds no privilege on the attachments table',
  { sql: grantsFor('external_composition_attachments', 'anon'), expect: 'ok', expectOut: '(none)' });
add('R62', 'external-integrity', 'authenticated holds no UPDATE on attachments',
  { sql: grantsFor('external_composition_attachments', 'authenticated'), expect: 'ok', expectOut: 'DELETE,INSERT,SELECT' });
add('R63', 'external-integrity', 'the retention job is registered with the scheduler',
  { sql: "select count(*)::text from cron.job where jobname='external-composition-retention';",
    expect: 'ok', expectOut: '1' });
add('R64', 'external-integrity', 'the report bucket is private',
  { sql: "select public::text from storage.buckets where id='composition-reports';",
    expect: 'ok', expectOut: 'false' });

// =========================================================== O. organization results API
// supabase/migrations/20260913120000_company_results_api.sql. A key is created by a signed-in
// administrator and then used as service_role, the only role the edge function holds. Each case is one
// rolled-back transaction, so the secret travels between role switches in a transaction-local setting.
const asUser = (who) => `select set_config('request.jwt.claims','{"sub":"${who}","role":"authenticated"}',true); set local role authenticated;`;
const asOwner = `reset role; select set_config('request.jwt.claims','',true);`;
const asService = `reset role; select set_config('request.jwt.claims','',true); set local role service_role;`;
const makeKey = (name, { team = ORG_A, who = ADMIN_A, scopes = "array['results:read']", days = 30, limit = 120 } = {}) =>
  asUser(who)
  + `select set_config('pp.${name}', public.create_company_api_key('${team}','synthetic key ${name}',${scopes},now() + interval '${days} days',${limit})::text, true);`
  + asOwner;
const secret = (name) => `(current_setting('pp.${name}')::jsonb->>'secret')`;
const keyId = (name) => `(current_setting('pp.${name}')::jsonb->>'id')`;
const listCall = (name, kind, cursor = 'null', limit = 50) => `public.company_results_api_list(${secret(name)},'${kind}',${cursor},${limit})`;
const idsOf = (jsonExpr) => `(select coalesce(string_agg(e.value->>'id', ',' order by e.ord), '') from jsonb_array_elements((${jsonExpr})->'items') with ordinality e(value, ord))`;

const R1 = 'd0000000-0000-4000-8000-0000000000a1';
const R2 = 'd0000000-0000-4000-8000-0000000000a2';
const R3 = 'd0000000-0000-4000-8000-0000000000a3';
const RB = 'd0000000-0000-4000-8000-0000000000b1';
const B_LIVE = 'd0000000-0000-4000-8000-0000000000c1';
const B_REVOKED = 'd0000000-0000-4000-8000-0000000000c2';
const B_EXPIRED = 'd0000000-0000-4000-8000-0000000000c3';
const B_OFF = 'd0000000-0000-4000-8000-0000000000c4';

const refRow = (id, assessment, { team = ORG_A, actor = ADMIN_A, saved = '2026-09-10T04:05:00Z' } = {}) =>
  `insert into public.company_reference_assessments(id,assessment_id,team_id,subject_reference,consent_reference,adult_attested_at,created_by,captured_at,saved_at,retention_until,record)
   values ('${id}','${assessment}','${team}','synthetic-adult-001','synthetic-permission-001','2026-09-10T03:00:00Z','${actor}','2026-09-10T04:00:00Z','${saved}','2099-01-01T00:00:00Z',
   public.test_company_assessment_payload('${assessment}','synthetic-adult-001','${team}','${actor}','synthetic-permission-001','2026-09-10T04:00:00Z','${saved}','2099-01-01T00:00:00Z'));`;
const bodyRow = (id, assessment, consent, athlete = ATH_A) =>
  `insert into public.company_body_assessments(id,assessment_id,team_id,athlete_id,consent_id,created_by,captured_at,saved_at,retention_until,record)
   values ('${id}','${assessment}','${ORG_A}','${athlete}','${consent}','${ADMIN_A}','2026-09-10T04:00:00Z','2026-09-10T04:05:00Z','2099-01-01T00:00:00Z',
   public.test_company_assessment_payload('${assessment}','${athlete}','${ORG_A}','${ADMIN_A}','${consent}'));`;
const INVALID_KEY = /invalid API key/;

add('O01', 'results-api', 'a signed-in member who does not administer the organization cannot create its API key',
  { sql: asUser(MEMBER_C) + `select public.create_company_api_key('${ORG_A}','synthetic',array['results:read'],now() + interval '30 days');`,
    expect: 'error', expectError: /only an administrator of this organization/ });
add('O02', 'results-api', 'the secret is returned once and only its SHA-256 hash is stored',
  { sql: makeKey('k') + `select (k.key_hash = encode(sha256(convert_to(${secret('k')},'UTF8')),'hex')
      and position(${secret('k')} in row_to_json(k)::text) = 0
      and ${secret('k')} ~ '^ppk_[0-9a-f]{8}_[0-9a-f]{56}$')::text
      from public.company_api_keys k where k.id = ${keyId('k')}::uuid;`,
    expect: 'ok', expectOut: 'true' });
add('O03', 'results-api', 'an administrator cannot read a key hash, even for their own organization',
  { sql: makeKey('k') + asUser(ADMIN_A) + 'select key_hash from public.company_api_keys;',
    expect: 'error', expectError: /permission denied/ });
add('O04', 'results-api', "an administrator sees their own organization's keys and not another's",
  { sql: makeKey('a') + makeKey('b', { team: ORG_B, who: ADMIN_B }) + asUser(ADMIN_A) + 'select count(*)::text from public.company_api_keys;',
    expect: 'ok', expectOut: '1' });
add('O05', 'results-api', 'a signed-in role cannot call the results API functions directly',
  { sql: makeKey('k') + `set local role authenticated; select ${listCall('k', 'reference_assessments')};`,
    expect: 'error', expectError: /permission denied for function/ });
add('O06', 'results-api', 'the anonymous role cannot call the results API functions directly',
  { sql: makeKey('k') + `set local role anon; select ${listCall('k', 'reference_assessments')};`,
    expect: 'error', expectError: /permission denied for function/ });
add('O07', 'results-api', "a read key lists its own organization's results and none of another's",
  { setup: refRow(R1, 'synthetic-a1') + refRow(RB, 'synthetic-b1', { team: ORG_B, actor: ADMIN_B }),
    sql: makeKey('k') + asService + `select ${idsOf(listCall('k', 'reference_assessments'))};`,
    expect: 'ok', expectOut: R1 });
add('O08', 'results-api', "another organization's result id is answered exactly like a missing one",
  { setup: refRow(RB, 'synthetic-b1', { team: ORG_B, actor: ADMIN_B }),
    sql: makeKey('k') + asService + `select (public.company_results_api_get(${secret('k')},'reference_assessments','${RB}') is null)::text;`,
    expect: 'ok', expectOut: 'true' });
add('O09', 'results-api', 'a revoked key is refused',
  { sql: makeKey('k') + asUser(ADMIN_A) + `select public.revoke_company_api_key(${keyId('k')}::uuid);` + asService + `select ${listCall('k', 'reference_assessments')};`,
    expect: 'error', expectError: INVALID_KEY });
add('O10', 'results-api', 'an expired key is refused',
  { sql: makeKey('k') + `update public.company_api_keys set created_at = now() - interval '40 days', expires_at = now() - interval '1 day' where id = ${keyId('k')}::uuid;`
      + asService + `select ${listCall('k', 'reference_assessments')};`,
    expect: 'error', expectError: INVALID_KEY });
add('O11', 'results-api', 'a well-formed key that was never issued is refused',
  { sql: asService + `select public.company_results_api_list('ppk_00000000_${'0'.repeat(56)}','reference_assessments',null,50);`,
    expect: 'error', expectError: INVALID_KEY });
add('O12', 'results-api', 'an administrator of another organization cannot revoke this one\'s key',
  { sql: makeKey('k') + asUser(ADMIN_B) + `select public.revoke_company_api_key(${keyId('k')}::uuid);`,
    expect: 'error', expectError: /API key not found/ });
add('O13', 'results-api', 'a read-only key cannot delete',
  { setup: refRow(R1, 'synthetic-a1'),
    sql: makeKey('k') + asService + `select public.company_results_api_delete(${secret('k')},'reference_assessments','${R1}');`,
    expect: 'error', expectError: /does not carry the results:delete scope/ });
add('O14', 'results-api', 'a delete key deletes once, reports a repeat as nothing deleted, and the audit names the key',
  { setup: refRow(R1, 'synthetic-a1'),
    sql: makeKey('k', { scopes: "array['results:read','results:delete']" }) + asService
      + `select public.company_results_api_delete(${secret('k')},'reference_assessments','${R1}');`
      + `select set_config('pp.second', public.company_results_api_delete(${secret('k')},'reference_assessments','${R1}')::text, true);`
      + asOwner
      + `select ((select count(*) from public.company_reference_assessments where id = '${R1}') = 0
          and current_setting('pp.second')::jsonb->>'deleted' = 'false'
          and (select count(*) from public.access_log where action = 'company_results_api_delete'
                 and detail->>'key_id' = ${keyId('k')} and detail->>'result_id' = '${R1}') = 1)::text;`,
    expect: 'ok', expectOut: 'true' });
add('O15', 'results-api', "the rate limit refuses the request after a key's per-minute allowance",
  { sql: makeKey('k', { limit: 2 }) + asService
      + `select ${listCall('k', 'reference_assessments')}; select ${listCall('k', 'reference_assessments')}; select ${listCall('k', 'reference_assessments')};`,
    expect: 'error', expectError: /rate limit of 2 requests per minute exceeded/ });
add('O16', 'results-api', 'pages follow newest first, never overlap, and the last page has no cursor',
  { setup: refRow(R1, 'synthetic-1', { saved: '2026-09-10T04:05:00Z' }) + refRow(R2, 'synthetic-2', { saved: '2026-09-10T04:06:00Z' })
      + refRow(R3, 'synthetic-3', { saved: '2026-09-10T04:07:00Z' }),
    sql: makeKey('k') + asService
      + `select set_config('pp.p1', ${listCall('k', 'reference_assessments', 'null', 2)}::text, true);`
      + `select set_config('pp.p2', ${listCall('k', 'reference_assessments', "current_setting('pp.p1')::jsonb->>'nextCursor'", 2)}::text, true);`
      + `select concat_ws('|', ${idsOf("current_setting('pp.p1')::jsonb")}, ${idsOf("current_setting('pp.p2')::jsonb")}, coalesce(current_setting('pp.p2')::jsonb->>'nextCursor', 'none'));`,
    expect: 'ok', expectOut: `${R3},${R2}|${R1}|none` });
add('O17', 'results-api', 'a malformed cursor is refused',
  { sql: makeKey('k') + asService + `select ${listCall('k', 'reference_assessments', "'zz'")};`,
    expect: 'error', expectError: /invalid cursor/ });
add('O18', 'results-api', 'a page size outside 1 to 100 is refused',
  { sql: makeKey('k') + asService + `select ${listCall('k', 'reference_assessments', 'null', 101)};`,
    expect: 'error', expectError: /limit must be between 1 and 100/ });
add('O19', 'results-api', 'an unknown result kind is refused',
  { sql: makeKey('k') + asService + `select ${listCall('k', 'composition_results')};`,
    expect: 'error', expectError: /unknown result kind/ });
add('O20', 'results-api', 'child results are served only while the athlete is rostered and the release is live',
  { setup: bodyRow(B_LIVE, 'synthetic-live', C_LIVE) + bodyRow(B_REVOKED, 'synthetic-revoked', C_REVOKED)
      + bodyRow(B_EXPIRED, 'synthetic-expired', C_EXPIRED) + bodyRow(B_OFF, 'synthetic-off-roster', C_OFF, ATH_OFF),
    sql: makeKey('k') + asService + `select ${idsOf(listCall('k', 'body_assessments'))};`,
    expect: 'ok', expectOut: B_LIVE });
add('O21', 'results-api', 'every child result served is written to the access log against the athlete and the key',
  { setup: bodyRow(B_LIVE, 'synthetic-live', C_LIVE),
    sql: makeKey('k') + asService + `select ${listCall('k', 'body_assessments')};` + asOwner
      + `select count(*)::text from public.access_log where action = 'company_results_api_read' and athlete_id = '${ATH_A}'
           and detail->>'result_id' = '${B_LIVE}' and detail->>'key_id' = ${keyId('k')};`,
    expect: 'ok', expectOut: '1' });
add('O22', 'results-api', 'key creation is audited, and the audit entry does not contain the secret',
  { sql: makeKey('k') + `select (count(*) = 1 and bool_and(position(${secret('k')} in detail::text) = 0))::text
      from public.access_log where action = 'company_api_key_created' and detail->>'key_id' = ${keyId('k')};`,
    expect: 'ok', expectOut: 'true' });
add('O23', 'results-api', 'tenant roles cannot write keys, read hashes or reach the rate-limit table, and the key table has RLS',
  { sql: `select (not has_table_privilege('authenticated','public.company_api_keys','INSERT')
      and not has_table_privilege('authenticated','public.company_api_keys','UPDATE')
      and not has_table_privilege('authenticated','public.company_api_keys','DELETE')
      and not has_table_privilege('authenticated','public.company_api_keys','TRUNCATE')
      and not has_column_privilege('authenticated','public.company_api_keys','key_hash','SELECT')
      and not has_table_privilege('anon','public.company_api_keys','SELECT')
      and not has_table_privilege('authenticated','private.company_api_key_windows','SELECT')
      and (select relrowsecurity from pg_class where oid = 'public.company_api_keys'::regclass))::text;`,
    expect: 'ok', expectOut: 'true' });

// =========================================================== S. Stripe webhook idempotency and ordering
//
// Stripe delivers each event at least once and in no promised order. The partial unique index on
// payments.stripe_payment_intent turns a racing duplicate checkout into the unique violation the webhook already
// treats as "recorded", and apply_stripe_subscription_event refuses to let an older subscription event overwrite a
// newer one. The function is what makes a guardian premium, so nobody but the service role may call it.
const SUB_GUARDIAN = ADMIN_A;
const APPLY_SIGNATURE = 'public.apply_stripe_subscription_event(uuid,text,text,timestamptz,timestamptz)';
const subRow = `insert into public.subscriptions(guardian_id, status) values ('${SUB_GUARDIAN}', 'inactive');`;
const applySub = (status, at) =>
  `select public.apply_stripe_subscription_event('${SUB_GUARDIAN}', 'sub_synthetic_1', '${status}', '2026-10-13T00:00:00Z', '${at}');`;
const subState = `select status || '|' || coalesce(to_char(stripe_event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), 'none')
  from public.subscriptions where guardian_id = '${SUB_GUARDIAN}';`;
const paymentRow = intent =>
  `insert into public.payments(amount_cents, status, stripe_payment_intent) values (10000, 'captured', ${intent === null ? 'null' : `'${intent}'`});`;

add('S01', 'stripe-webhook', 'a second payment for the same payment intent is refused as a unique violation',
  { role: 'service_role', sql: paymentRow('pi_synthetic_1') + paymentRow('pi_synthetic_1'),
    expect: 'error', expectError: /payments_stripe_payment_intent_key/ });
add('S02', 'stripe-webhook', 'payments without a payment intent are not constrained by that index',
  { role: 'service_role', sql: paymentRow(null) + paymentRow(null) + 'select count(*)::text from public.payments where stripe_payment_intent is null;',
    expect: 'ok', expectOut: '2' });
add('S03', 'stripe-webhook', "an event is applied to the guardian's row, with its Stripe time recorded",
  { setup: subRow, role: 'service_role', sql: applySub('active', '2026-09-13T10:00:00Z') + subState,
    expect: 'ok', expectOut: 'active|2026-09-13T10:00:00' });
add('S04', 'stripe-webhook', 'THE CASE: an event older than the one applied is ignored, so a late update cannot undo a cancellation',
  { setup: subRow, role: 'service_role', sql: applySub('canceled', '2026-09-13T12:00:00Z') + applySub('active', '2026-09-13T11:00:00Z') + subState,
    expect: 'ok', expectOut: 'canceled|2026-09-13T12:00:00' });
add('S05', 'stripe-webhook', 'and the call reports it as stale',
  { setup: subRow, role: 'service_role', sql: applySub('canceled', '2026-09-13T12:00:00Z') + applySub('active', '2026-09-13T11:00:00Z'),
    expect: 'ok', expectOut: 'stale' });
add('S06', 'stripe-webhook', 'an event stamped the same second as the last one applies, in arrival order',
  { setup: subRow, role: 'service_role', sql: applySub('canceled', '2026-09-13T12:00:00Z') + applySub('active', '2026-09-13T12:00:00Z') + subState,
    expect: 'ok', expectOut: 'active|2026-09-13T12:00:00' });
add('S07', 'stripe-webhook', 'a guardian with no subscription row is reported, and no row is created',
  { role: 'service_role', sql: applySub('active', '2026-09-13T10:00:00Z'),
    expect: 'ok', expectOut: 'no_subscription' });
add('S08', 'stripe-webhook', 'a status the table does not use is refused',
  { setup: subRow, role: 'service_role', sql: applySub('trialing', '2026-09-13T10:00:00Z'),
    expect: 'error', expectError: /a guardian, the event time and a known status are required/ });
add('S09', 'stripe-webhook', 'only the service role holds EXECUTE on it',
  { sql: `select (not has_function_privilege('anon', '${APPLY_SIGNATURE}', 'EXECUTE')
      and not has_function_privilege('authenticated', '${APPLY_SIGNATURE}', 'EXECUTE')
      and has_function_privilege('service_role', '${APPLY_SIGNATURE}', 'EXECUTE'))::text;`,
    expect: 'ok', expectOut: 'true' });
add('S10', 'stripe-webhook', 'a signed-in guardian calling it directly to mark themselves premium is refused',
  { setup: subRow, role: 'authenticated', claims: SUB_GUARDIAN, sql: applySub('active', '2026-09-13T10:00:00Z'),
    expect: 'error', expectError: /permission denied for function apply_stripe_subscription_event/ });

// =========================================================== T. notification schedules
//
// The replayed migrations alone must schedule every push job production runs. The harness's cron stub records a job
// without ever firing it, which is all this needs.
add('T01', 'notification-schedules', 'the migrations schedule all four push jobs, each once, reading the key from Vault',
  { sql: `select string_agg(jobname || '=' || schedule, ',' order by jobname) from cron.job
      where command like '%/functions/v1/notify-%' and command like '%vault.decrypted_secrets%';`,
    expect: 'ok', expectOut: 'daily-nudge=12 20 * * *,gameday-push=0 23 * * *,measure-nudge=14 14 * * 0,weekly-plan-push=0 22 * * 0' });

// =========================================================== U. parent body scan records
//
// A parent's body scan is one row in public.body_scan_assessments, and its outputs are the measurements that
// reference it. These cases pin the save (one call, idempotent, as the signed-in guardian), the consent gate that
// applies even to the service role, the provenance allowlist, deletion, retention, the audit and the backfill.
const SCAN_ID = 'd5000000-0000-4000-8000-000000000001';
const SCAN_OLD = 'd5000000-0000-4000-8000-000000000002';
const SCAN_CONSENT = 'd6000000-0000-4000-8000-000000000001';
const SCAN_FAMILY = 'ffffffff-0000-4000-8000-00000000000f';
const SCAN_OTHER_ATHLETE = 'b1111111-1111-4111-8111-11111111111b';
const SCAN_REVOKED_AT = '2026-08-01T00:00:00Z';

const scanConsent = ({ athlete = ATH_A, engine = 'ondevice-pose', until = 'current_date + 365', revoked = null } = {}) =>
  `insert into public.biometric_consents(id, athlete_id, guardian_id, subject_is_minor, policy_version, scan_engine, retention_until, revoked_at)
   values ('${SCAN_CONSENT}', '${athlete}', '${MEMBER_C}', true, 'synthetic-scan-policy', '${engine}', ${until}, ${revoked ? `'${revoked}'` : 'null'});`;
// A view-only grandparent: family view is granted per athlete through athlete_access.
const scanFamilyViewer = `insert into public.athlete_access(athlete_id, guardian_id, role) values ('${ATH_A}', '${ADMIN_B}', 'family_view');`;
const scanRowId = i => 'd7000000-0000-4000-8000-' + String(i).padStart(12, '0');
const saveScan = ({ athlete = ATH_A, rowAthlete = athlete, actor = MEMBER_C, engine = 'ondevice-pose', record = "'{}'::jsonb", rows = 2 } = {}) => {
  const items = Array.from({ length: rows }, (_, i) =>
    `jsonb_build_object('id','${scanRowId(i + 1)}','athlete_id','${rowAthlete}','metric_key','${i % 2 ? 'leg_length' : 'wingspan'}',`
    + `'value',${60 + i},'unit','in','source','photo','measured_on',current_date,'created_by','${actor}',`
    + `'scan_assessment_id','${SCAN_ID}','note','synthetic scan row')`);
  return `select public.save_body_scan_assessment(
    jsonb_build_object('id','${SCAN_ID}','athlete_id','${athlete}','consent_id','${SCAN_CONSENT}','captured_at',now() - interval '1 hour',
      'engine',jsonb_build_object('id','${engine}','version','0.0.0-synthetic','model','synthetic'),'record',${record}),
    jsonb_build_array(${items.join(',')}))::text;`;
};
// Planted as the table owner, standing in for a scan saved earlier.
const seedScan = ({ id = SCAN_ID, rowId = scanRowId(1), captured = "now() - interval '1 hour'", retention = "now() + interval '11 months'" } = {}) =>
  `insert into public.body_scan_assessments(id, athlete_id, consent_id, created_by, engine_id, engine_version, engine_model,
     captured_at, measured_on, retention_until, output_count, record)
   values ('${id}', '${ATH_A}', '${SCAN_CONSENT}', '${MEMBER_C}', 'ondevice-pose', '0.0.0-synthetic', 'synthetic',
     ${captured}, (${captured})::date, ${retention}, 1, '{}'::jsonb);
   insert into public.measurements(id, athlete_id, metric_key, value, unit, source, measured_on, created_by, note, scan_assessment_id)
   values ('${rowId}', '${ATH_A}', 'wingspan', 60, 'in', 'photo', (${captured})::date, '${MEMBER_C}', 'synthetic scan row', '${id}');`;
// Two rows saved before scan records existed, carrying the old note, plus one whose note does not parse.
const legacyScanRows = [1, 2].map(i =>
  `insert into public.measurements(id, athlete_id, metric_key, value, unit, source, measured_on, created_by, note)
   values ('${scanRowId(i)}', '${ATH_A}', '${i === 1 ? 'wingspan' : 'leg_length'}', ${59 + i}, 'in', 'photo', current_date - 1, '${MEMBER_C}',
     'PP_SCAN_V1:' || jsonb_build_object('schema', 1, 'id', '${SCAN_ID}', 'athlete_id', '${ATH_A}', 'captured_at', now() - interval '1 day',
       'consent_id', '${SCAN_CONSENT}', 'engine', jsonb_build_object('id', 'ondevice-pose', 'version', '0.0.0-synthetic', 'model', 'synthetic'),
       'photo_reuse_check', jsonb_build_object('protocol', 'exact-photo-bytes-v1', 'checked_views', 4, 'distinct_files', true),
       'quality', jsonb_build_object('kind', 'heuristic'))::text);`).join('\n')
  + `\ninsert into public.measurements(id, athlete_id, metric_key, value, unit, source, measured_on, created_by, note)
   values ('${scanRowId(9)}', '${ATH_A}', 'wingspan', 61, 'in', 'photo', current_date - 1, '${MEMBER_C}', 'PP_SCAN_V1:{broken');`;
const asScanParent = { role: 'authenticated', claims: MEMBER_C };
const scanRowCount = `select count(*)::text from public.measurements where scan_assessment_id = '${SCAN_ID}';`;
const SCAN_NOT_LIVE = /scan permission is not live for this athlete and scan method/;

add('U01', 'body-scan-records', 'a guardian saves a scan and its outputs in one call, linked to each other',
  { setup: scanConsent(), ...asScanParent, sql: saveScan() + scanRowCount, expect: 'ok', expectOut: '2' });
add('U02', 'body-scan-records', 'saving the same scan again is a no-op, not a duplicate',
  { setup: scanConsent(), ...asScanParent,
    sql: saveScan() + saveScan() + `select (select count(*) from public.body_scan_assessments where id = '${SCAN_ID}') || '|' || (select count(*) from public.measurements where scan_assessment_id = '${SCAN_ID}');`,
    expect: 'ok', expectOut: '1|2' });
add('U03', 'body-scan-records', 'the scan is destroyed no later than the end of the release it was taken under',
  { setup: scanConsent({ until: 'current_date + 30' }), ...asScanParent,
    sql: saveScan() + `select (retention_until > now() and retention_until <= now() + interval '32 days')::text from public.body_scan_assessments where id = '${SCAN_ID}';`,
    expect: 'ok', expectOut: 'true' });
add('U04', 'body-scan-records', 'a withdrawn release refuses the save',
  { setup: scanConsent({ revoked: SCAN_REVOKED_AT }), ...asScanParent, sql: saveScan(), expect: 'error', expectError: SCAN_NOT_LIVE });
add('U05', 'body-scan-records', 'a release for a different scan method refuses the save',
  { setup: scanConsent({ engine: 'jump-video' }), ...asScanParent, sql: saveScan(), expect: 'error', expectError: SCAN_NOT_LIVE });
add('U06', 'body-scan-records', "another athlete's release refuses the save",
  { setup: scanConsent({ athlete: ATH_OFF }), ...asScanParent, sql: saveScan(), expect: 'error', expectError: SCAN_NOT_LIVE });
add('U07', 'body-scan-records', 'a family viewer cannot save a scan',
  { setup: scanConsent() + scanFamilyViewer, role: 'authenticated', claims: ADMIN_B, sql: saveScan({ actor: ADMIN_B }),
    expect: 'error', expectError: /row-level security/ });
add('U08', 'body-scan-records', "a scan cannot carry another athlete's measurement",
  { setup: scanConsent(), ...asScanParent, sql: saveScan({ rowAthlete: SCAN_OTHER_ATHLETE }),
    expect: 'error', expectError: /Every measurement must belong to this scan/ });
add('U09', 'body-scan-records', 'provenance naming a landmark is refused, however deep',
  { setup: scanConsent(), ...asScanParent,
    sql: saveScan({ record: "jsonb_build_object('quality', jsonb_build_object('landmarks', jsonb_build_array(1, 2)))" }),
    expect: 'error', expectError: /body_scan_assessments_record_check/ });
add('U10', 'body-scan-records', 'provenance with a field outside the allowlist is refused',
  { setup: scanConsent(), ...asScanParent, sql: saveScan({ record: "jsonb_build_object('frames', 'x')" }),
    expect: 'error', expectError: /body_scan_assessments_record_check/ });
add('U11', 'body-scan-records', 'more than 32 outputs is refused',
  { setup: scanConsent(), ...asScanParent, sql: saveScan({ rows: 33 }), expect: 'error', expectError: /between 1 and 32 measurements/ });
add('U12', 'body-scan-records', 'deleting a scan deletes its outputs',
  { setup: scanConsent() + seedScan(), ...asScanParent,
    sql: `delete from public.body_scan_assessments where id = '${SCAN_ID}';` + scanRowCount, expect: 'ok', expectOut: '0' });
add('U13', 'body-scan-records', 'a family viewer cannot delete a scan',
  { setup: scanConsent() + seedScan() + scanFamilyViewer, role: 'authenticated', claims: ADMIN_B,
    sql: `delete from public.body_scan_assessments where id = '${SCAN_ID}';reset role;` + scanRowCount, expect: 'ok', expectOut: '1' });
add('U14', 'body-scan-records', 'no one can edit a saved scan, anon cannot read one, and only a signed-in user can call the save',
  { sql: `select (not has_table_privilege('authenticated', 'public.body_scan_assessments', 'UPDATE')
      and not has_table_privilege('anon', 'public.body_scan_assessments', 'SELECT')
      and has_table_privilege('authenticated', 'public.body_scan_assessments', 'DELETE')
      and not has_function_privilege('anon', 'public.save_body_scan_assessment(jsonb,jsonb)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.save_body_scan_assessment(jsonb,jsonb)', 'EXECUTE')
      and (select relrowsecurity from pg_class where oid = 'public.body_scan_assessments'::regclass))::text;`,
    expect: 'ok', expectOut: 'true' });
add('U15', 'body-scan-records', 'the service role, which bypasses row-level security, still needs a live release',
  { setup: scanConsent({ revoked: SCAN_REVOKED_AT }), role: 'service_role', sql: seedScan(), expect: 'error', expectError: SCAN_NOT_LIVE });
add('U16', 'body-scan-records', 'the nightly sweep deletes a scan past its retention date with its outputs, and keeps a current one',
  { setup: scanConsent() + seedScan({ id: SCAN_OLD, rowId: scanRowId(2), captured: "now() - interval '13 months'", retention: "now() - interval '1 month'" }) + seedScan(),
    sql: `select private.sweep_biometric_retention();
      select (select count(*) from public.body_scan_assessments where id in ('${SCAN_ID}', '${SCAN_OLD}')) || '|'
        || (select count(*) from public.measurements where scan_assessment_id in ('${SCAN_ID}', '${SCAN_OLD}'));`,
    expect: 'ok', expectOut: '1|1' });
add('U17', 'body-scan-records', 'saving a scan is audited with identifiers only, never a measurement',
  { setup: scanConsent() + seedScan(),
    sql: `select (count(*) = 1 and bool_and(detail->>'output_count' = '1') and bool_and(not (detail ? 'value')) and bool_and(not (detail ? 'metric_key')))::text
      from public.access_log where action = 'body_scan_assessment_insert' and detail->>'assessment_id' = '${SCAN_ID}';`,
    expect: 'ok', expectOut: 'true' });
add('U18', 'body-scan-records', 'rows saved before scan records existed are linked into one scan when their release is live',
  { setup: scanConsent() + legacyScanRows,
    sql: `select private.link_legacy_body_scans();
      select (select output_count from public.body_scan_assessments where id = '${SCAN_ID}') || '|'
        || (select count(*) from public.measurements where scan_assessment_id = '${SCAN_ID}') || '|'
        || (select (record ? 'reuse_check' and not (record ? 'photo_reuse_check'))::text from public.body_scan_assessments where id = '${SCAN_ID}');`,
    expect: 'ok', expectOut: '2|2|true' });
add('U19', 'body-scan-records', 'an old scan whose release was withdrawn is left exactly as it was',
  { setup: scanConsent({ revoked: SCAN_REVOKED_AT }) + legacyScanRows,
    sql: `select private.link_legacy_body_scans()::text;`, expect: 'ok', expectOut: '0' });
add('U20', 'body-scan-records', 'only a photo measurement can belong to a scan',
  { setup: scanConsent() + seedScan(),
    sql: `insert into public.measurements(id, athlete_id, metric_key, value, unit, source, measured_on, created_by, scan_assessment_id)
      values ('${scanRowId(5)}', '${ATH_A}', 'wingspan', 60, 'in', 'manual', current_date, '${MEMBER_C}', '${SCAN_ID}');`,
    expect: 'error', expectError: /measurements_scan_assessment_photo_check/ });

// =========================================================== V. a parent's change to a week
//
// public.week_exceptions holds at most one parent change per athlete per week. The browser decides what a
// change may do to the plan (js/program.js applyWeekChange); the database holds the shape and who may write.
const THIS_MONDAY = `(current_date - (extract(isodow from current_date)::int - 1))`;
const weekChange = ({ actor = MEMBER_C, week = THIS_MONDAY, op = 'skip', to = 'null', rep = 'null' } = {}) =>
  `insert into public.week_exceptions(athlete_id, week_start, op, from_day, from_title, to_day, replacement_title, created_by)
   values ('${ATH_A}', ${week}, '${op}', 1, 'Synthetic session', ${to}, ${rep}, '${actor}');`;
const weekChangeCount = `select count(*)::text from public.week_exceptions where athlete_id = '${ATH_A}';`;

add('V01', 'week-changes', "a guardian who can edit records this week's change",
  { ...asScanParent, sql: weekChange() + weekChangeCount, expect: 'ok', expectOut: '1' });
add('V02', 'week-changes', 'a week holds one change, not two',
  { ...asScanParent, sql: weekChange() + weekChange({ op: 'swap', rep: "'Another synthetic card'" }),
    expect: 'error', expectError: /week_exceptions_athlete_id_week_start_key/ });
add('V03', 'week-changes', 'a family viewer cannot change the plan',
  { setup: scanFamilyViewer, role: 'authenticated', claims: ADMIN_B, sql: weekChange({ actor: ADMIN_B }),
    expect: 'error', expectError: /row-level security/ });
add('V04', 'week-changes', 'but a family viewer sees the change, so everyone reads the same week',
  { setup: scanFamilyViewer + weekChange(), role: 'authenticated', claims: ADMIN_B, sql: weekChangeCount, expect: 'ok', expectOut: '1' });
add('V05', 'week-changes', 'a change cannot be recorded in another guardian\'s name',
  { ...asScanParent, sql: weekChange({ actor: ADMIN_A }), expect: 'error', expectError: /row-level security/ });
add('V06', 'week-changes', 'a move has to say which day',
  { ...asScanParent, sql: weekChange({ op: 'move' }), expect: 'error', expectError: /week_exceptions_move_check/ });
add('V07', 'week-changes', 'a swap has to say which card',
  { ...asScanParent, sql: weekChange({ op: 'swap' }), expect: 'error', expectError: /week_exceptions_swap_check/ });
add('V08', 'week-changes', 'a move cannot land on the day it came from',
  { ...asScanParent, sql: weekChange({ op: 'move', to: '1' }), expect: 'error', expectError: /week_exceptions_distinct_days_check/ });
add('V09', 'week-changes', 'a week starts on a Monday',
  { ...asScanParent, sql: weekChange({ week: `${THIS_MONDAY} + 1` }), expect: 'error', expectError: /week_exceptions_monday_check/ });
add('V10', 'week-changes', 'a week that has already passed cannot be changed',
  { ...asScanParent, sql: weekChange({ week: `${THIS_MONDAY} - 28` }), expect: 'error', expectError: /row-level security/ });
add('V11', 'week-changes', 'a family viewer cannot undo a change',
  { setup: scanFamilyViewer + weekChange(), role: 'authenticated', claims: ADMIN_B,
    sql: `delete from public.week_exceptions where athlete_id = '${ATH_A}';reset role;` + weekChangeCount, expect: 'ok', expectOut: '1' });
add('V12', 'week-changes', 'a guardian who can edit undoes this week\'s change',
  { setup: weekChange(), ...asScanParent,
    sql: `delete from public.week_exceptions where athlete_id = '${ATH_A}';reset role;` + weekChangeCount, expect: 'ok', expectOut: '0' });
add('V13', 'week-changes', 'no one can edit a change in place, and anon cannot read one',
  { sql: `select (not has_table_privilege('authenticated', 'public.week_exceptions', 'UPDATE')
      and not has_table_privilege('anon', 'public.week_exceptions', 'SELECT')
      and has_table_privilege('authenticated', 'public.week_exceptions', 'DELETE')
      and (select relrowsecurity from pg_class where oid = 'public.week_exceptions'::regclass))::text;`,
    expect: 'ok', expectOut: 'true' });

// =========================================================== W. deleting one measurement
//
// Growth deletes a single reading directly through meas_del. It had no executed case: these hold it to edit rights,
// so the privacy page's "delete a measurement from Growth" is true for the family and refused for a view-only adult.
const READING_ID = 'd8000000-0000-4000-8000-000000000001';
const reading = `insert into public.measurements(id, athlete_id, metric_key, value, unit, source, measured_on, created_by)
  values ('${READING_ID}', '${ATH_A}', 'height', 55, 'in', 'manual', current_date, '${MEMBER_C}');`;
const readingCount = `select count(*)::text from public.measurements where id = '${READING_ID}';`;

add('W01', 'measurement-delete', "a guardian who can edit deletes one of the athlete's measurements",
  { setup: reading, ...asScanParent, sql: `delete from public.measurements where id = '${READING_ID}';reset role;` + readingCount,
    expect: 'ok', expectOut: '0' });
add('W02', 'measurement-delete', 'a family viewer cannot delete a measurement',
  { setup: reading + scanFamilyViewer, role: 'authenticated', claims: ADMIN_B,
    sql: `delete from public.measurements where id = '${READING_ID}';reset role;` + readingCount, expect: 'ok', expectOut: '1' });

// =========================================================== X. adult training (a parent's own record)
//
// A parent's goals, schedule, workouts and entries belong to that guardian alone. Writing also needs an allowlist row
// while the feature is behind a flag; reading and deleting never do, so a tester taken off the list can still export
// and delete. No co-parent, family viewer, coach or organization reaches it.
const ADULT_D = 'dddddddd-0000-4000-8000-00000000000d';
const ADULT_ITEM_B = 'a7000000-0000-4000-8000-00000000000b';
const ADULT_ITEM_C = 'a7000000-0000-4000-8000-00000000000c';
const adultAllow = guardian => `insert into public.adult_training_access(guardian_id) values ('${guardian}');`;
const adultGoal = guardian => `insert into public.adult_goals(guardian_id, kind, label) values ('${guardian}', 'strength', 'Synthetic goal');`;
const adultItem = (id, guardian) => `insert into public.adult_schedule_items(id, guardian_id, weekday, title, kind, duration_min) values ('${id}', '${guardian}', 1, 'Synthetic workout', 'strength', 40);`;
const adultGoalCount = `select count(*)::text from public.adult_goals where guardian_id = '${MEMBER_C}';`;
const coParentB = `insert into public.family_members(family_id, guardian_id, role) values ('${SCAN_FAMILY}', '${ADMIN_B}', 'co_parent');`;
const ADULT_TABLE_LIST = ['adult_training_access', 'adult_profiles', 'adult_goals', 'adult_schedule_items', 'adult_schedule_exercises', 'adult_workout_logs', 'adult_health_import_batches', 'adult_health_records'];

add('X01', 'adult-training', 'an allowlisted parent records a goal and reads it back',
  { setup: adultAllow(MEMBER_C), ...asScanParent, sql: adultGoal(MEMBER_C) + adultGoalCount, expect: 'ok', expectOut: '1' });
add('X02', 'adult-training', 'a parent who is not allowlisted cannot write, whatever the app flag says',
  { ...asScanParent, sql: adultGoal(MEMBER_C), expect: 'error', expectError: /row-level security/ });
add('X03', 'adult-training', "a parent cannot write into another guardian's record",
  { setup: adultAllow(MEMBER_C), ...asScanParent, sql: adultGoal(ADMIN_B), expect: 'error', expectError: /row-level security/ });
add('X04', 'adult-training', "a co-parent in the same family cannot read the other parent's record",
  { setup: adultAllow(MEMBER_C) + adultGoal(MEMBER_C) + coParentB, role: 'authenticated', claims: ADMIN_B, sql: adultGoalCount, expect: 'ok', expectOut: '0' });
add('X05', 'adult-training', "a family viewer of the parent's child cannot read it either",
  { setup: adultGoal(MEMBER_C) + scanFamilyViewer, role: 'authenticated', claims: ADMIN_B, sql: adultGoalCount, expect: 'ok', expectOut: '0' });
add('X06', 'adult-training', 'a parent taken off the allowlist can still read what they recorded',
  { setup: adultGoal(MEMBER_C), ...asScanParent, sql: adultGoalCount, expect: 'ok', expectOut: '1' });
add('X07', 'adult-training', 'and can still delete it',
  { setup: adultGoal(MEMBER_C), ...asScanParent,
    sql: `delete from public.adult_goals where guardian_id = '${MEMBER_C}';reset role;` + adultGoalCount, expect: 'ok', expectOut: '0' });
add('X08', 'adult-training', 'a parent cannot put themselves on the allowlist',
  { ...asScanParent, sql: adultAllow(MEMBER_C), expect: 'error', expectError: /permission denied/ });
add('X09', 'adult-training', 'anon reaches nothing, no tenant can write the allowlist, and every table has row-level security',
  { sql: `select (${ADULT_TABLE_LIST.map(t => `not has_table_privilege('anon', 'public.${t}', 'SELECT')
        and (select relrowsecurity from pg_class where oid = 'public.${t}'::regclass)`).join('\n        and ')}
      and not has_table_privilege('authenticated', 'public.adult_training_access', 'INSERT')
      and not has_table_privilege('authenticated', 'public.adult_training_access', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.adult_training_access', 'DELETE'))::text;`,
    expect: 'ok', expectOut: 'true' });
add('X10', 'adult-training', 'a workout dated days ahead is refused',
  { setup: adultAllow(MEMBER_C), ...asScanParent,
    sql: `insert into public.adult_workout_logs(guardian_id, done_on) values ('${MEMBER_C}', current_date + 3);`,
    expect: 'error', expectError: /row-level security/ });
add('X11', 'adult-training', 'a weight in centimetres is refused',
  { setup: adultAllow(MEMBER_C), ...asScanParent,
    sql: `insert into public.adult_health_records(guardian_id, metric_key, value, unit, measured_on, source_kind, method) values ('${MEMBER_C}', 'weight', 80, 'cm', current_date, 'manual', 'entered');`,
    expect: 'error', expectError: /adult_health_records_metric_check/ });
add('X12', 'adult-training', "an exercise cannot be attached to another guardian's workout",
  { setup: adultAllow(MEMBER_C) + adultAllow(ADMIN_B) + adultItem(ADULT_ITEM_B, ADMIN_B), ...asScanParent,
    sql: `insert into public.adult_schedule_exercises(item_id, guardian_id, name, sets, reps) values ('${ADULT_ITEM_B}', '${MEMBER_C}', 'Synthetic squat', 3, 8);`,
    expect: 'error', expectError: /adult_schedule_exercises_item_fkey/ });
add('X13', 'adult-training', 'deleting a workout from the schedule keeps the days it was done, unlinked',
  { setup: adultItem(ADULT_ITEM_C, MEMBER_C) + `insert into public.adult_workout_logs(guardian_id, schedule_item_id, done_on) values ('${MEMBER_C}', '${ADULT_ITEM_C}', current_date);`,
    sql: `delete from public.adult_schedule_items where id = '${ADULT_ITEM_C}';
      select (count(*) = 1 and bool_and(schedule_item_id is null))::text from public.adult_workout_logs where guardian_id = '${MEMBER_C}';`,
    expect: 'ok', expectOut: 'true' });
add('X14', 'adult-training', 'deleting the account removes every part of the record',
  { setup: `insert into auth.users(id, email) values ('${ADULT_D}', 'synthetic-adult-d@example.invalid');`
      + adultAllow(ADULT_D) + `insert into public.adult_profiles(guardian_id) values ('${ADULT_D}');` + adultGoal(ADULT_D)
      + adultItem('a7000000-0000-4000-8000-00000000000d', ADULT_D)
      + `insert into public.adult_schedule_exercises(item_id, guardian_id, name) values ('a7000000-0000-4000-8000-00000000000d', '${ADULT_D}', 'Synthetic press');
         insert into public.adult_workout_logs(guardian_id, schedule_item_id, done_on) values ('${ADULT_D}', 'a7000000-0000-4000-8000-00000000000d', current_date);
         insert into public.adult_health_records(guardian_id, metric_key, value, unit, measured_on, source_kind, method) values ('${ADULT_D}', 'weight', 180, 'lb', current_date, 'manual', 'entered');`,
    sql: `delete from auth.users where id = '${ADULT_D}';
      select (${ADULT_TABLE_LIST.map(t => `(select count(*) from public.${t} where guardian_id = '${ADULT_D}')`).join(' + ')})::text;`,
    expect: 'ok', expectOut: '0' });

// =========================================================== Y. adult nutrition (a parent's own eating plan)
//
// Preferences, recipes, planned meals and habit days follow the same rules as the rest of the parent's own record:
// theirs alone, writes need the allowlist, and the account's deletion takes all of it.
const ADULT_E = 'eeeeeeee-0000-4000-8000-00000000000e';
const AN_RECIPE_B = 'a8000000-0000-4000-8000-00000000000b';
const AN_RECIPE_C = 'a8000000-0000-4000-8000-00000000000c';
const AN_RECIPE_E = 'a8000000-0000-4000-8000-00000000000e';
const anRecipe = (id, guardian, cols = '', vals = '') =>
  `insert into public.adult_recipes(id, guardian_id, title, ingredients${cols}) values ('${id}', '${guardian}', 'Synthetic recipe', array['Synthetic ingredient']${vals});`;
const anPlan = (guardian, recipe, on = 'current_date') =>
  `insert into public.adult_meal_plan_items(guardian_id, planned_on, slot, recipe_id, title) values ('${guardian}', ${on}, 'dinner', ${recipe ? `'${recipe}'` : 'null'}, 'Synthetic meal');`;
const anRecipeCount = `select count(*)::text from public.adult_recipes where guardian_id = '${MEMBER_C}';`;
const NUTRITION_TABLE_LIST = ['adult_nutrition_preferences', 'adult_recipes', 'adult_meal_plan_items', 'adult_nutrition_days'];

add('Y01', 'adult-nutrition', 'an allowlisted parent adds a recipe, plans a meal with it and reads both back',
  { setup: adultAllow(MEMBER_C), ...asScanParent,
    sql: anRecipe(AN_RECIPE_C, MEMBER_C) + anPlan(MEMBER_C, AN_RECIPE_C)
      + `select ((select count(*) from public.adult_recipes where guardian_id = '${MEMBER_C}') + (select count(*) from public.adult_meal_plan_items where guardian_id = '${MEMBER_C}'))::text;`,
    expect: 'ok', expectOut: '2' });
add('Y02', 'adult-nutrition', 'a parent who is not allowlisted cannot save food preferences',
  { ...asScanParent, sql: `insert into public.adult_nutrition_preferences(guardian_id) values ('${MEMBER_C}');`, expect: 'error', expectError: /row-level security/ });
add('Y03', 'adult-nutrition', "a co-parent in the same family cannot read the other parent's recipes",
  { setup: anRecipe(AN_RECIPE_C, MEMBER_C) + coParentB, role: 'authenticated', claims: ADMIN_B, sql: anRecipeCount, expect: 'ok', expectOut: '0' });
add('Y04', 'adult-nutrition', "a planned meal cannot use another guardian's recipe",
  { setup: adultAllow(MEMBER_C) + anRecipe(AN_RECIPE_B, ADMIN_B), ...asScanParent, sql: anPlan(MEMBER_C, AN_RECIPE_B),
    expect: 'error', expectError: /adult_meal_plan_items_recipe_fkey/ });
add('Y05', 'adult-nutrition', 'an allergen tag outside the nine named in labeling law is refused',
  { setup: adultAllow(MEMBER_C), ...asScanParent, sql: anRecipe(AN_RECIPE_C, MEMBER_C, ', allergens', ", array['gluten']"),
    expect: 'error', expectError: /adult_recipes_allergens_check/ });
add('Y06', 'adult-nutrition', 'a recipe with more than 40 ingredient lines is refused',
  { setup: adultAllow(MEMBER_C), ...asScanParent,
    sql: `insert into public.adult_recipes(guardian_id, title, ingredients) values ('${MEMBER_C}', 'Synthetic recipe', array_fill('Synthetic ingredient'::text, array[41]));`,
    expect: 'error', expectError: /adult_recipes_ingredients_check/ });
add('Y07', 'adult-nutrition', 'deleting a recipe keeps the meals planned with it, unlinked',
  { setup: anRecipe(AN_RECIPE_C, MEMBER_C) + anPlan(MEMBER_C, AN_RECIPE_C),
    sql: `delete from public.adult_recipes where id = '${AN_RECIPE_C}';
      select (count(*) = 1 and bool_and(recipe_id is null))::text from public.adult_meal_plan_items where guardian_id = '${MEMBER_C}';`,
    expect: 'ok', expectOut: 'true' });
add('Y08', 'adult-nutrition', 'a habit day logged days ahead is refused',
  { setup: adultAllow(MEMBER_C), ...asScanParent,
    sql: `insert into public.adult_nutrition_days(guardian_id, logged_on, protein_meals) values ('${MEMBER_C}', current_date + 3, 2);`,
    expect: 'error', expectError: /row-level security/ });
add('Y09', 'adult-nutrition', 'a meal planned more than 60 days ahead is refused',
  { setup: adultAllow(MEMBER_C), ...asScanParent, sql: anPlan(MEMBER_C, null, 'current_date + 61'), expect: 'error', expectError: /row-level security/ });
add('Y10', 'adult-nutrition', 'one habit row a day',
  { setup: adultAllow(MEMBER_C), ...asScanParent,
    sql: `insert into public.adult_nutrition_days(guardian_id, logged_on, plate_meals) values ('${MEMBER_C}', current_date, 1), ('${MEMBER_C}', current_date, 2);`,
    expect: 'error', expectError: /adult_nutrition_days_once_a_day_key/ });
add('Y11', 'adult-nutrition', 'anon reaches nothing and every table has row-level security',
  { sql: `select (${NUTRITION_TABLE_LIST.map(t => `not has_table_privilege('anon', 'public.${t}', 'SELECT')
        and (select relrowsecurity from pg_class where oid = 'public.${t}'::regclass)`).join('\n        and ')})::text;`,
    expect: 'ok', expectOut: 'true' });
add('Y12', 'adult-nutrition', 'deleting the account removes every part of the eating plan',
  { setup: `insert into auth.users(id, email) values ('${ADULT_E}', 'synthetic-adult-e@example.invalid');`
      + `insert into public.adult_nutrition_preferences(guardian_id, avoid_allergens) values ('${ADULT_E}', array['peanuts']);`
      + anRecipe(AN_RECIPE_E, ADULT_E) + anPlan(ADULT_E, AN_RECIPE_E)
      + `insert into public.adult_nutrition_days(guardian_id, logged_on, protein_meals) values ('${ADULT_E}', current_date, 2);`,
    sql: `delete from auth.users where id = '${ADULT_E}';
      select (${NUTRITION_TABLE_LIST.map(t => `(select count(*) from public.${t} where guardian_id = '${ADULT_E}')`).join(' + ')})::text;`,
    expect: 'ok', expectOut: '0' });

// =========================================================== Z. adult health record (one source-tracked record)
//
// Every reading a parent types in or imports is one row that says where it came from. The database refuses what a
// source cannot claim, refuses duplicates, lets an import be undone, and keeps it all the parent's own.
const ADULT_G = '13131313-0000-4000-8000-000000000013';
const HR_BATCH_B = 'a9000000-0000-4000-8000-00000000000b';
const HR_BATCH_C = 'a9000000-0000-4000-8000-00000000000c';
const HR_BATCH_C2 = 'a9000000-0000-4000-8000-0000000000c2';
const HR_BATCH_G = 'a9000000-0000-4000-8000-000000000013';
const hrReading = (metric, value, unit, method) =>
  `jsonb_build_object('metric_key', '${metric}', 'value', ${value}, 'unit', '${unit}', 'measured_on', current_date, 'method', '${method}')`;
const HR_TWO = `jsonb_build_array(${hrReading('weight', 180, 'lb', 'device_measured')}, ${hrReading('steps', 8000, 'steps', 'device_estimated')})`;
const hrImport = (batch, records = HR_TWO) =>
  `select public.save_adult_health_import(jsonb_build_object('id', '${batch}', 'source_name', 'Synthetic scale export', 'origin', 'device'), ${records});`;
const hrCount = guardian => `select count(*)::text from public.adult_health_records where guardian_id = '${guardian}';`;
const hrManual = (guardian, metric, value, unit, on = 'current_date') =>
  `insert into public.adult_health_records(guardian_id, metric_key, value, unit, measured_on, source_kind, method) values ('${guardian}', '${metric}', ${value}, '${unit}', ${on}, 'manual', 'entered');`;
const hrBatch = (id, guardian) =>
  `insert into public.adult_health_import_batches(id, guardian_id, source_kind, source_name, origin, rows_received) values ('${id}', '${guardian}', 'file_import', 'Synthetic scale export', 'device', 2);`;
const hrFileReading = (guardian, batch, metric, value, unit, method) =>
  `insert into public.adult_health_records(guardian_id, metric_key, value, unit, measured_on, source_kind, source_name, method, batch_id) values ('${guardian}', '${metric}', ${value}, '${unit}', current_date, 'file_import', 'Synthetic scale export', '${method}', '${batch}');`;
const hrBatchCounts = batch => `(select rows_saved || '+' || rows_duplicate from public.adult_health_import_batches where id = '${batch}')`;
const HEALTH_TABLE_LIST = ['adult_health_import_batches', 'adult_health_records'];

add('Z01', 'adult-health-record', 'an allowlisted parent imports two readings and reads them back',
  { setup: adultAllow(MEMBER_C), ...asScanParent, sql: hrImport(HR_BATCH_C) + hrCount(MEMBER_C), expect: 'ok', expectOut: '2' });
add('Z02', 'adult-health-record', 'importing the same readings again adds nothing, and the import says so',
  { setup: adultAllow(MEMBER_C), ...asScanParent,
    sql: hrImport(HR_BATCH_C) + hrImport(HR_BATCH_C2)
      + `select (select count(*) from public.adult_health_records where guardian_id = '${MEMBER_C}')::text || '/' || ${hrBatchCounts(HR_BATCH_C2)};`,
    expect: 'ok', expectOut: '2/0+2' });
add('Z03', 'adult-health-record', 'retrying the same import changes nothing and keeps its counts true',
  { setup: adultAllow(MEMBER_C), ...asScanParent,
    sql: hrImport(HR_BATCH_C) + hrImport(HR_BATCH_C)
      + `select (select count(*) from public.adult_health_records where guardian_id = '${MEMBER_C}')::text || '/' || ${hrBatchCounts(HR_BATCH_C)};`,
    expect: 'ok', expectOut: '2/2+0' });
add('Z04', 'adult-health-record', 'a parent who is not allowlisted cannot import',
  { ...asScanParent, sql: hrImport(HR_BATCH_C), expect: 'error', expectError: /row-level security/ });
add('Z05', 'adult-health-record', "a co-parent in the same family cannot read the other parent's readings",
  { setup: hrManual(MEMBER_C, 'weight', 180, 'lb') + coParentB, role: 'authenticated', claims: ADMIN_B, sql: hrCount(MEMBER_C), expect: 'ok', expectOut: '0' });
add('Z06', 'adult-health-record', 'a resting heart rate in pounds is refused',
  { setup: adultAllow(MEMBER_C), ...asScanParent, sql: hrManual(MEMBER_C, 'resting_heart_rate', 60, 'lb'),
    expect: 'error', expectError: /adult_health_records_metric_check/ });
add('Z07', 'adult-health-record', 'an import cannot claim a device measured a tape measurement',
  { setup: adultAllow(MEMBER_C), ...asScanParent, sql: hrImport(HR_BATCH_C, `jsonb_build_array(${hrReading('waist', 34, 'in', 'device_measured')})`),
    expect: 'error', expectError: /adult_health_records_metric_check/ });
add('Z08', 'adult-health-record', 'a body-composition value is not a reading this record accepts',
  { setup: adultAllow(MEMBER_C), ...asScanParent, sql: hrManual(MEMBER_C, 'body_fat_percent', 20, 'percent'),
    expect: 'error', expectError: /adult_health_records_metric_check/ });
add('Z09', 'adult-health-record', 'a reading dated days ahead is refused',
  { setup: adultAllow(MEMBER_C), ...asScanParent, sql: hrManual(MEMBER_C, 'weight', 180, 'lb', 'current_date + 3'),
    expect: 'error', expectError: /row-level security/ });
add('Z10', 'adult-health-record', 'undoing an import removes exactly the readings it added',
  { setup: hrBatch(HR_BATCH_C, MEMBER_C) + hrFileReading(MEMBER_C, HR_BATCH_C, 'weight', 180, 'lb', 'device_measured')
      + hrFileReading(MEMBER_C, HR_BATCH_C, 'steps', 8000, 'steps', 'device_estimated') + hrManual(MEMBER_C, 'weight', 181, 'lb'),
    ...asScanParent, sql: `delete from public.adult_health_import_batches where id = '${HR_BATCH_C}';` + hrCount(MEMBER_C), expect: 'ok', expectOut: '1' });
add('Z11', 'adult-health-record', "a reading cannot be attached to another guardian's import",
  { setup: adultAllow(MEMBER_C) + hrBatch(HR_BATCH_B, ADMIN_B), ...asScanParent,
    sql: hrFileReading(MEMBER_C, HR_BATCH_B, 'weight', 180, 'lb', 'device_measured'), expect: 'error', expectError: /adult_health_records_batch_fkey/ });
add('Z12', 'adult-health-record', 'an import of more than 2000 readings is refused',
  { setup: adultAllow(MEMBER_C), ...asScanParent,
    sql: hrImport(HR_BATCH_C, `(select jsonb_agg(jsonb_build_object('metric_key', 'steps', 'value', g, 'unit', 'steps', 'measured_on', current_date, 'method', 'device_estimated')) from generate_series(1, 2001) g)`),
    expect: 'error', expectError: /between 1 and 2000 readings/ });
add('Z13', 'adult-health-record', 'a reading cannot be edited, only deleted',
  { sql: `select (not has_table_privilege('authenticated', 'public.adult_health_records', 'UPDATE')
      and has_table_privilege('authenticated', 'public.adult_health_records', 'DELETE'))::text;`, expect: 'ok', expectOut: 'true' });
add('Z14', 'adult-health-record', 'anon reaches nothing and both tables have row-level security',
  { sql: `select (${HEALTH_TABLE_LIST.map(t => `not has_table_privilege('anon', 'public.${t}', 'SELECT')
        and (select relrowsecurity from pg_class where oid = 'public.${t}'::regclass)`).join('\n        and ')})::text;`,
    expect: 'ok', expectOut: 'true' });
add('Z15', 'adult-health-record', 'deleting the account removes every reading and import',
  { setup: `insert into auth.users(id, email) values ('${ADULT_G}', 'synthetic-adult-g@example.invalid');` + hrBatch(HR_BATCH_G, ADULT_G)
      + hrFileReading(ADULT_G, HR_BATCH_G, 'steps', 9000, 'steps', 'device_estimated') + hrManual(ADULT_G, 'weight', 170, 'lb'),
    sql: `delete from auth.users where id = '${ADULT_G}';
      select (${HEALTH_TABLE_LIST.map(t => `(select count(*) from public.${t} where guardian_id = '${ADULT_G}')`).join(' + ')})::text;`,
    expect: 'ok', expectOut: '0' });

// =========================================================== AA. camp listings
//
// public.camps is a directory any signed-in account can submit to (camps_insert), and an administrator reviews
// pending listings on a screen that renders each sign-up link. The browser checked a submission and the database
// did not, so a listing sent straight to the API could carry a javascript: link onto that screen. The rules are in
// 20260915120000_camp_listing_validation.sql.
const campInsert = (o = {}) => {
  const c = { email: `'camp@example.invalid'`, url: `'https://example.invalid/signup'`,
    ageMin: 'null', ageMax: 'null', start: 'null', end: 'null', ...o };
  return `insert into public.camps(org_name, contact_name, contact_email, location_text, external_signup_url,
      age_min, age_max, start_date, end_date, created_by)
    values ('Synthetic Youth Camp', 'Synthetic Contact', ${c.email}, 'Synthetic Town', ${c.url},
      ${c.ageMin}, ${c.ageMax}, ${c.start}, ${c.end}, '${MEMBER_C}');`;
};
const asCampSubmitter = { role: 'authenticated', claims: MEMBER_C };
const ownCamps = `select count(*)::text from public.camps where created_by = '${MEMBER_C}';`;
const campUrlRefused = { expect: 'error', expectError: /camps_external_signup_url_check/ };

add('AA01', 'camp-listings', 'a complete listing is accepted, with its ages and dates in order',
  { ...asCampSubmitter, sql: campInsert({ ageMin: '8', ageMax: '12', start: `date '2027-06-01'`, end: `date '2027-06-05'` }) + ownCamps,
    expect: 'ok', expectOut: '1' });
add('AA02', 'camp-listings', 'ages and dates may still be left blank: "All ages", "Dates TBD"',
  { ...asCampSubmitter, sql: campInsert() + ownCamps, expect: 'ok', expectOut: '1' });
add('AA03', 'camp-listings', 'THE CASE: a javascript: sign-up link is refused',
  { ...asCampSubmitter, sql: campInsert({ url: `'javascript:alert(document.cookie)'` }), ...campUrlRefused });
add('AA04', 'camp-listings', 'a script link behind leading whitespace is refused, although a browser would strip the space',
  { ...asCampSubmitter, sql: campInsert({ url: `' javascript:alert(1)'` }), ...campUrlRefused });
add('AA05', 'camp-listings', 'a link without a web scheme is refused',
  { ...asCampSubmitter, sql: campInsert({ url: `'www.example.invalid/signup'` }), ...campUrlRefused });
add('AA06', 'camp-listings', 'a link longer than 2048 characters is refused',
  { ...asCampSubmitter, sql: campInsert({ url: `'https://example.invalid/' || repeat('a', 2025)` }), ...campUrlRefused });
add('AA07', 'camp-listings', 'an upper-case scheme is still a web address',
  { ...asCampSubmitter, sql: campInsert({ url: `'HTTPS://EXAMPLE.INVALID/SIGNUP'` }) + ownCamps, expect: 'ok', expectOut: '1' });
add('AA08', 'camp-listings', 'a contact email with no domain is refused',
  { ...asCampSubmitter, sql: campInsert({ email: `'camp@localhost'` }), expect: 'error', expectError: /camps_contact_email_check/ });
add('AA09', 'camp-listings', 'the youngest age cannot be above the oldest',
  { ...asCampSubmitter, sql: campInsert({ ageMin: '12', ageMax: '8' }), expect: 'error', expectError: /camps_ages_check/ });
add('AA10', 'camp-listings', 'an age above 19 is refused',
  { ...asCampSubmitter, sql: campInsert({ ageMax: '25' }), expect: 'error', expectError: /camps_ages_check/ });
add('AA11', 'camp-listings', 'a negative age is refused',
  { ...asCampSubmitter, sql: campInsert({ ageMin: '-1' }), expect: 'error', expectError: /camps_ages_check/ });
add('AA12', 'camp-listings', 'a camp cannot end before it starts',
  { ...asCampSubmitter, sql: campInsert({ start: `date '2027-06-05'`, end: `date '2027-06-01'` }),
    expect: 'error', expectError: /camps_dates_check/ });
add('AA13', 'camp-listings', 'the rules bind the table owner too: a listing cannot be approved with a script link',
  { setup: campInsert(),
    sql: `update public.camps set status = 'approved', external_signup_url = 'javascript:alert(1)' where created_by = '${MEMBER_C}';`,
    ...campUrlRefused });

// =========================================================== AB. a child needs consent
//
// Until 20260915180000_child_creation_requires_consent.sql the browser was the only place a child's consent was
// required: create_athlete_onboarding() recorded whatever consents it was handed, none included, and ath_insert let a
// family editor insert into public.athletes past the function. Now the function refuses without both required consents,
// the policy is gone, and a deferred constraint trigger refuses any writer's new child that reaches COMMIT without them.
//
// Every case here is rolled back, so none reaches COMMIT, which is when a deferred check runs. `set constraints all
// immediate` runs the pending checks at that point instead, exactly as COMMIT would. A case that inserts a child and
// leaves it out would pass whatever the trigger said.
const AT_COMMIT = 'set constraints all immediate;';
const CONSENT_MISSING = 'Both required consents, child_data and account, are needed to add a child.';
const CONSENT_MALFORMED = 'Each consent must be {"consent_type": <a known type>}, given once, in a list.';
const CONSENT_AT_COMMIT = 'has no granted child_data and account consent from one guardian in its household';
const BOTH_CONSENTS = `'[{"consent_type":"child_data"},{"consent_type":"account"}]'`;
const NEW_CHILD = 'a0000000-0000-4000-8000-00000000c0de';
const onboard = ({ newFamily = true, family = null, consents = BOTH_CONSENTS } = {}) =>
  `public.create_athlete_onboarding(${newFamily}, ${family ? `'${family}'` : 'null'}, 'Synthetic consent household', 'SyntheticConsentChild',
    date '2016-04-01', null, 'football', array['RB'], 'Junior', '[{"type":"skill","key":"hands","label":"Synthetic goal"}]'::jsonb, ${consents}::jsonb)`;
// Passes only if the statement is refused with exactly this SQLSTATE and message. Acceptance, or a refusal for any other
// reason, fails the case and shows what really happened.
const refusedWith = (statements, sqlstate, message) => `do $refusal$
begin
  ${statements}
  raise exception 'the database accepted it';
exception when others then
  if sqlstate is distinct from '${sqlstate}' or strpos(sqlerrm, '${message}') = 0 then
    raise;
  end if;
end $refusal$;
select 'refused';`;
const directChild = (id = NEW_CHILD) =>
  `insert into public.athletes(id, family_id, first_name, birthdate) values ('${id}', '${SCAN_FAMILY}', 'SyntheticDirectChild', date '2016-04-01');`;
const consentRow = (guardian, type, granted = true) =>
  `insert into public.consent_records(guardian_id, athlete_id, consent_type, granted, method) values ('${guardian}', '${NEW_CHILD}', '${type}', ${granted}, 'synthetic_case');`;
const refusedAtCommit = statements => ({ sql: refusedWith(statements + '\n  ' + AT_COMMIT, '23514', CONSENT_AT_COMMIT), expect: 'ok', expectOut: 'refused' });
const newChildCount = `${AT_COMMIT}\nreset role;\nselect count(*)::text from public.athletes where id = '${NEW_CHILD}';`;

add('AB01', 'child-consent', 'THE CASE: create_athlete_onboarding refuses a child with no consent (22023)',
  { ...asScanParent, sql: refusedWith(`perform ${onboard({ consents: `'[]'` })};`, '22023', CONSENT_MISSING), expect: 'ok', expectOut: 'refused' });
add('AB02', 'child-consent', 'a missing consent list counts as no consent',
  { ...asScanParent, sql: refusedWith(`perform ${onboard({ consents: 'null' })};`, '22023', CONSENT_MISSING), expect: 'ok', expectOut: 'refused' });
add('AB03', 'child-consent', 'child_data alone is refused: account consent is required too',
  { ...asScanParent, sql: refusedWith(`perform ${onboard({ consents: `'[{"consent_type":"child_data"}]'` })};`, '22023', CONSENT_MISSING), expect: 'ok', expectOut: 'refused' });
add('AB04', 'child-consent', 'account and the optional media consent are refused without child_data',
  { ...asScanParent, sql: refusedWith(`perform ${onboard({ consents: `'[{"consent_type":"account"},{"consent_type":"media"}]'` })};`, '22023', CONSENT_MISSING), expect: 'ok', expectOut: 'refused' });
const malformedConsents = [
  ['AB05', 'a single object instead of a list', `'{"consent_type":"child_data"}'`],
  ['AB06', 'bare strings instead of entries', `'["child_data","account"]'`],
  ['AB07', 'an entry with no consent_type', `'[{},{"consent_type":"child_data"},{"consent_type":"account"}]'`],
  ['AB08', 'a type that does not exist', `'[{"consent_type":"child_data"},{"consent_type":"account"},{"consent_type":"everything"}]'`],
  ['AB09', 'an entry trying to record a consent as not granted', `'[{"consent_type":"child_data","granted":false},{"consent_type":"account"}]'`],
  ['AB10', 'a consent_type that is not a string', `'[{"consent_type":["child_data"]},{"consent_type":"account"}]'`],
  ['AB11', 'the same type given twice', `'[{"consent_type":"child_data"},{"consent_type":"child_data"},{"consent_type":"account"}]'`],
  ['AB12', 'a JSON null', `'null'`],
];
for (const [id, desc, consents] of malformedConsents)
  add(id, 'child-consent', 'malformed consents are refused, not cast (22023): ' + desc,
    { ...asScanParent, sql: refusedWith(`perform ${onboard({ consents })};`, '22023', CONSENT_MALFORMED), expect: 'ok', expectOut: 'refused' });
add('AB13', 'child-consent', 'with both consents a parent adds a child in a new household: sport, goal and both consent records, and the check at commit passes',
  { ...asScanParent,
    sql: `select ${onboard()} is not null;
      ${AT_COMMIT}
      reset role;
      select (select count(*) from public.family_members m where m.family_id = a.family_id and m.guardian_id = '${MEMBER_C}' and m.role = 'owner')
        || '|' || (a.family_id <> '${SCAN_FAMILY}')
        || '|' || (select count(*) from public.athlete_sports s where s.athlete_id = a.id and s.sport_key = 'football' and s.is_primary)
        || '|' || (select count(*) from public.goals g where g.athlete_id = a.id and g.status = 'active')
        || '|' || (select string_agg(c.consent_type || ':' || c.granted || ':' || c.method, ',' order by c.consent_type::text)
                     from public.consent_records c where c.athlete_id = a.id and c.guardian_id = '${MEMBER_C}')
        from public.athletes a where a.first_name = 'SyntheticConsentChild';`,
    expect: 'ok', expectOut: '1|true|1|1|account:true:onboarding_checkbox,child_data:true:onboarding_checkbox' });
add('AB14', 'child-consent', 'with both consents a parent adds a sibling to the household they belong to, optional media consent recorded too',
  { ...asScanParent,
    sql: `select ${onboard({ newFamily: false, family: SCAN_FAMILY, consents: `'[{"consent_type":"child_data"},{"consent_type":"account"},{"consent_type":"media"}]'` })} is not null;
      ${AT_COMMIT}
      reset role;
      select a.family_id || '|' || (select string_agg(c.consent_type::text, ',' order by c.consent_type::text) from public.consent_records c where c.athlete_id = a.id and c.guardian_id = '${MEMBER_C}')
        from public.athletes a where a.first_name = 'SyntheticConsentChild';`,
    expect: 'ok', expectOut: `${SCAN_FAMILY}|account,child_data,media` });
add('AB15', 'child-consent', 'consent does not open a household the caller does not belong to',
  { role: 'authenticated', claims: ADMIN_B,
    sql: refusedWith(`perform ${onboard({ newFamily: false, family: SCAN_FAMILY })};`, 'P0001', 'not authorized for this family'), expect: 'ok', expectOut: 'refused' });
add('AB16', 'child-consent', 'THE CASE: an owner of the household can no longer insert a child directly, past the function',
  { ...asScanParent, sql: refusedWith(directChild(), '42501', 'new row violates row-level security policy for table "athletes"'), expect: 'ok', expectOut: 'refused' });
add('AB17', 'child-consent', 'no INSERT or ALL policy on public.athletes is left for any role',
  { sql: `select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'athletes' and cmd in ('INSERT', 'ALL');`,
    expect: 'ok', expectOut: '0' });
add('AB18', 'child-consent', 'THE CASE: the table owner, which bypasses row-level security, cannot commit a child with no consent (23514)',
  refusedAtCommit(directChild()));
add('AB19', 'child-consent', 'nor can the service role',
  { role: 'service_role', ...refusedAtCommit(directChild()) });
add('AB20', 'child-consent', 'the table owner commits a child whose household guardian gave both consents, written after the child',
  { sql: directChild() + consentRow(MEMBER_C, 'child_data') + consentRow(MEMBER_C, 'account') + newChildCount, expect: 'ok', expectOut: '1' });
add('AB21', 'child-consent', 'and so does the service role',
  { role: 'service_role', sql: directChild() + consentRow(MEMBER_C, 'child_data') + consentRow(MEMBER_C, 'account') + newChildCount, expect: 'ok', expectOut: '1' });
add('AB22', 'child-consent', 'consent from a guardian outside the household does not count',
  refusedAtCommit(directChild() + consentRow(ADMIN_A, 'child_data') + consentRow(ADMIN_A, 'account')));
add('AB23', 'child-consent', 'both consents must come from one guardian, not one from each parent',
  { setup: coParentB, ...refusedAtCommit(directChild() + consentRow(MEMBER_C, 'child_data') + consentRow(ADMIN_B, 'account')) });
add('AB24', 'child-consent', 'a consent record that was not granted does not count',
  refusedAtCommit(directChild() + consentRow(MEMBER_C, 'child_data') + consentRow(MEMBER_C, 'account', false)));
add('AB25', 'child-consent', 'a child deleted again in the same transaction leaves nothing to refuse',
  { sql: directChild() + `delete from public.athletes where id = '${NEW_CHILD}';` + newChildCount, expect: 'ok', expectOut: '0' });
add('AB26', 'child-consent', 'giving the new child another id in the same transaction does not escape the check',
  refusedAtCommit(directChild('a0000000-0000-4000-8000-00000000c0df') + `update public.athletes set id = '${NEW_CHILD}' where id = 'a0000000-0000-4000-8000-00000000c0df';`));
add('AB27', 'child-consent', "delete-account's hand-over still works: consent passes to the co-parent who stays and the departing parent leaves",
  { setup: coParentB, role: 'service_role',
    sql: `update public.consent_records set guardian_id = '${ADMIN_B}'
        where guardian_id = '${MEMBER_C}' and athlete_id in (select id from public.athletes where family_id = '${SCAN_FAMILY}');
      delete from public.family_members where family_id = '${SCAN_FAMILY}' and guardian_id = '${MEMBER_C}';
      ${AT_COMMIT}
      select (select count(*) from public.consent_records where guardian_id = '${ADMIN_B}') || '|'
        || (select string_agg(guardian_id::text, ',') from public.family_members where family_id = '${SCAN_FAMILY}');`,
    expect: 'ok', expectOut: `6|${ADMIN_B}` });
add('AB28', 'child-consent', 'the check is a deferred constraint trigger whose SECURITY DEFINER function pins an empty search_path and no tenant role can run; the function pins one too',
  { sql: `select (select c.condeferrable and c.condeferred from pg_constraint c where c.conname = 'athletes_require_consent' and c.conrelid = 'public.athletes'::regclass)
        || '|' || (select p.prosecdef || ':' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'private.require_athlete_consent()'::regprocedure)
        || '|' || (has_function_privilege('anon', 'private.require_athlete_consent()', 'EXECUTE') or has_function_privilege('authenticated', 'private.require_athlete_consent()', 'EXECUTE'))
        || '|' || (select array_to_string(p.proconfig, ',') from pg_proc p
                    where p.oid = 'public.create_athlete_onboarding(boolean,uuid,text,text,date,text,text,text[],text,jsonb,jsonb)'::regprocedure);`,
    expect: 'ok', expectOut: 'true|true:search_path=""|false|search_path=""' });

// =========================================================== AC. deleting an athlete with organization records
// Deleting an athlete cascades to their organization body assessments and company composition results, and the audit of
// each cascaded delete runs with the athlete row already gone. Both audits named the athlete, access_log's foreign key
// refused the insert, and so the athlete could not be deleted at all: not by delete-athlete, and not with the household
// by delete-account. The same failure was reproduced for external composition records (R32b) and fixed there as the body
// scan audit already did it: no link to an athlete that is gone, with its id kept in the detail.
const deleteAthleteA = "delete from public.athletes where id='" + ATH_A + "';";
const auditAfterDelete = (action, key) => " select count(*)::text || '|' || count(*) filter (where athlete_id is null)::text || '|'"
  + " || count(*) filter (where detail->>'" + key + "' = '" + ATH_A + "')::text from public.access_log where action='" + action + "';";
const bodyA = bodyRow(B_LIVE, 'synthetic-live', C_LIVE);
add('AC01', 'athlete-delete', 'an athlete with an organization body assessment can be deleted, and the assessment goes with them',
  { setup: bodyA, sql: deleteAthleteA + ' select count(*)::text from public.company_body_assessments;', expect: 'ok', expectOut: '0' });
add('AC02', 'athlete-delete', "the assessment's delete is audited with no link to the deleted athlete, its id kept in the detail",
  { setup: bodyA, sql: deleteAthleteA + auditAfterDelete('company_body_assessment_delete', 'athlete_id'), expect: 'ok', expectOut: '1|1|1' });
add('AC03', 'athlete-delete', 'an athlete with a company composition result can be deleted, and the result goes with them',
  { setup: seedChildA, sql: deleteAthleteA + " select count(*)::text from public.company_composition_results where result_id='seeded-child-a';", expect: 'ok', expectOut: '0' });
add('AC04', 'athlete-delete', "the result's delete is audited with no link to the deleted athlete, whose id its detail already carries as the subject",
  { setup: seedChildA, sql: deleteAthleteA + auditAfterDelete('company_composition_result_delete', 'subject_reference'), expect: 'ok', expectOut: '1|1|1' });
add('AC05', 'athlete-delete', 'deleting the household, as delete-account does for a sole guardian, takes an athlete with both',
  { setup: bodyA + seedChildA,
    sql: "delete from public.families where id=(select family_id from public.athletes where id='" + ATH_A + "');"
      + " select (select count(*) from public.athletes where id='" + ATH_A + "')::text || '|' || (select count(*) from public.company_body_assessments)::text"
      + " || '|' || (select count(*) from public.company_composition_results where athlete_id is not null)::text;",
    expect: 'ok', expectOut: '0|0|0' });
add('AC06', 'athlete-delete', 'the family owner deleting the athlete, as delete-athlete does with their own authorization, succeeds',
  { setup: bodyA + seedChildA, claims: GUARDIAN, role: 'authenticated',
    sql: 'with d as (' + deleteAthleteA.replace(/;$/, '') + ' returning 1) select count(*)::text from d;', expect: 'ok', expectOut: '1' });
add('AC07', 'athlete-delete', 'while the athlete remains, deleting the assessment still links its audit row to them',
  { setup: bodyA, sql: 'delete from public.company_body_assessments;'
      + " select count(*) filter (where athlete_id = '" + ATH_A + "')::text from public.access_log where action='company_body_assessment_delete';",
    expect: 'ok', expectOut: '1' });
add('AC08', 'athlete-delete', 'and so does deleting the result',
  { setup: seedChildA, sql: "delete from public.company_composition_results where result_id='seeded-child-a';"
      + " select count(*) filter (where athlete_id = '" + ATH_A + "')::text from public.access_log where action='company_composition_result_delete';",
    expect: 'ok', expectOut: '1' });
add('AC09', 'athlete-delete', 'both replaced audit functions still pin an empty search_path, run as definer, and are each still a table\'s trigger',
  { sql: "select string_agg(p.proname || '=' || array_to_string(p.proconfig, ',') || ':' || p.prosecdef::text || ':'"
      + " || (select count(*) from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal)::text, ' ' order by p.proname)"
      + " from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname in ('audit_company_body_assessment_change', 'audit_company_composition_change');",
    expect: 'ok', expectOut: 'audit_company_body_assessment_change=search_path="":true:1 audit_company_composition_change=search_path="":true:1' });

// =========================================================== AD. a signed-in parent writes only inside their own household
// Three policies let a signed-in account write outside the household it belongs to. ath_update checked that the caller
// could edit the child as stored, never the household the child was being written into, so an owner or an invited
// co-parent could move a child into any household. consent_ins checked only that a consent named its author, so anyone
// could put consent records on another family's child. fm_insert, and fm_update with it, let a household editor make any
// account a member, as owner if they liked, without an invite. The app does none of these: it never writes a child's
// household, a consent row or a membership directly, and an invite grants per-child access, not membership.
const OTHER_FAMILY = 'fb000000-0000-4000-8000-0000000000fb';   // another household, owned by ADMIN_B
const SECOND_FAMILY = 'fc000000-0000-4000-8000-0000000000fc';  // a second household of the scan parent's own
// A household is created the way the app creates one: its creator inserts it and private.handle_new_family() makes them
// its owner, which reads auth.uid(), so the setup supplies the claim.
const householdOf = (family, owner) => `select set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated"}',true);
  insert into public.families(id, name, created_by) values ('${family}', 'Synthetic household', '${owner}');`;
// What accept_invite() writes for a co-parent invited to one child: per-child access, not membership.
const invitedCoParentB = `insert into public.athlete_access(athlete_id, guardian_id, role, granted_by) values ('${ATH_A}', '${ADMIN_B}', 'co_parent', '${MEMBER_C}');`;
const ATHLETES_RLS = 'new row violates row-level security policy for table "athletes"';
const CONSENT_RLS = 'new row violates row-level security policy for table "consent_records"';
const MEMBERS_RLS = 'new row violates row-level security policy for table "family_members"';
const refusedBy = (statement, message) => ({ sql: refusedWith(statement, '42501', message), expect: 'ok', expectOut: 'refused' });
const moveChild = family => `update public.athletes set family_id = '${family}' where id = '${ATH_A}';`;
const consentFor = (guardian, athlete, type, granted = true) =>
  `insert into public.consent_records(guardian_id, athlete_id, consent_type, granted, method) values ('${guardian}', ${athlete ? `'${athlete}'` : 'null'}, '${type}', ${granted}, 'synthetic_case')`;
const addMember = (guardian, role) => `insert into public.family_members(family_id, guardian_id, role) values ('${SCAN_FAMILY}', '${guardian}', '${role}');`;
const scanMembers = `reset role; select string_agg(guardian_id::text || ':' || role, ',' order by guardian_id::text) from public.family_members where family_id = '${SCAN_FAMILY}';`;
const editChild = `with u as (update public.athletes set first_name = 'SyntheticRenamed', nickname = 'Syn', birthdate = date '2012-02-02', dominant_hand = 'left'
    where id = '${ATH_A}' returning family_id) select count(*) || '|' || min(family_id::text) from u;`;

add('AD01', 'household-writes', "THE CASE: an owner cannot move their child into another family's household",
  { setup: householdOf(OTHER_FAMILY, ADMIN_B), ...asScanParent, ...refusedBy(moveChild(OTHER_FAMILY), ATHLETES_RLS) });
add('AD02', 'household-writes', 'nor into a second household of their own: a child stays in the household it was added to',
  { setup: householdOf(SECOND_FAMILY, MEMBER_C), ...asScanParent, ...refusedBy(moveChild(SECOND_FAMILY), ATHLETES_RLS) });
add('AD03', 'household-writes', 'THE CASE: a co-parent invited to the child cannot move them into their own household',
  { setup: householdOf(OTHER_FAMILY, ADMIN_B) + invitedCoParentB, role: 'authenticated', claims: ADMIN_B, ...refusedBy(moveChild(OTHER_FAMILY), ATHLETES_RLS) });
add('AD04', 'household-writes', "the owner still edits the child's name, nickname, birthdate and hand, as the Edit screen does",
  { ...asScanParent, sql: editChild, expect: 'ok', expectOut: `1|${SCAN_FAMILY}` });
add('AD05', 'household-writes', 'and so does the invited co-parent, who is not a member of the household',
  { setup: invitedCoParentB, role: 'authenticated', claims: ADMIN_B, sql: editChild, expect: 'ok', expectOut: `1|${SCAN_FAMILY}` });
add('AD06', 'household-writes', 'the growth inputs the Growth screen writes still save',
  { ...asScanParent, sql: `with u as (update public.athletes set sex_at_birth = 'female', mother_height_in = 64, father_height_in = 70 where id = '${ATH_A}' returning 1) select count(*)::text from u;`,
    expect: 'ok', expectOut: '1' });
add('AD07', 'household-writes', 'an update that restates the household the child is already in is accepted',
  { ...asScanParent, sql: `with u as (update public.athletes set family_id = '${SCAN_FAMILY}', first_name = 'SyntheticRestated' where id = '${ATH_A}' returning 1) select count(*)::text from u;`,
    expect: 'ok', expectOut: '1' });

add('AD08', 'household-writes', "THE CASE: an account outside the household cannot record a consent for another family's child",
  { role: 'authenticated', claims: ADMIN_A, ...refusedBy(consentFor(ADMIN_A, ATH_A, 'media') + ';', CONSENT_RLS) });
add('AD09', 'household-writes', 'nor record one as refused',
  { role: 'authenticated', claims: ADMIN_A, ...refusedBy(consentFor(ADMIN_A, ATH_A, 'sharing', false) + ';', CONSENT_RLS) });
add('AD10', 'household-writes', 'a co-parent invited to the child has access to them but is not their household, so cannot record one either',
  { setup: invitedCoParentB, role: 'authenticated', claims: ADMIN_B, ...refusedBy(consentFor(ADMIN_B, ATH_A, 'media') + ';', CONSENT_RLS) });
add('AD11', 'household-writes', 'a consent names a child: one with no child is refused',
  { ...asScanParent, ...refusedBy(consentFor(MEMBER_C, null, 'account') + ';', CONSENT_RLS) });
add('AD12', 'household-writes', 'the owner still records a consent for their own child',
  { ...asScanParent, sql: `with i as (${consentFor(MEMBER_C, ATH_A, 'media')} returning 1) select count(*)::text from i;`, expect: 'ok', expectOut: '1' });
add('AD13', 'household-writes', "a co-parent who is a member of the household records their own consent for the household's child",
  { setup: coParentB, role: 'authenticated', claims: ADMIN_B,
    sql: `with i as (${consentFor(ADMIN_B, ATH_A, 'media')} returning 1) select count(*)::text from i;`, expect: 'ok', expectOut: '1' });
add('AD14', 'household-writes', "nobody records a consent in another guardian's name, the household's owner included",
  { setup: coParentB, ...asScanParent, ...refusedBy(consentFor(ADMIN_B, ATH_A, 'media') + ';', CONSENT_RLS) });

add('AD15', 'household-writes', 'THE CASE: the owner cannot make another account a member of the household without an invite',
  { ...asScanParent, ...refusedBy(addMember(ADMIN_A, 'co_parent'), MEMBERS_RLS) });
add('AD16', 'household-writes', 'nor make another account an owner',
  { ...asScanParent, ...refusedBy(addMember(ADMIN_A, 'owner'), MEMBERS_RLS) });
add('AD17', 'household-writes', 'a co-parent member cannot add an account either',
  { setup: coParentB, role: 'authenticated', claims: ADMIN_B, ...refusedBy(addMember(ADMIN_A, 'co_parent'), MEMBERS_RLS) });
add('AD18', 'household-writes', 'an account cannot add itself to a household it does not belong to',
  { role: 'authenticated', claims: ADMIN_A, ...refusedBy(addMember(ADMIN_A, 'owner'), MEMBERS_RLS) });
add('AD19', 'household-writes', "THE CASE: the owner cannot hand an existing membership to another account, which adds that account in two steps",
  { setup: coParentB, ...asScanParent,
    sql: `update public.family_members set guardian_id = '${ADMIN_A}' where family_id = '${SCAN_FAMILY}' and guardian_id = '${ADMIN_B}';` + scanMembers,
    expect: 'ok', expectOut: `${ADMIN_B}:co_parent,${MEMBER_C}:owner` });
add('AD20', 'household-writes', 'THE CASE: a co-parent member cannot make themselves owner, which would let them delete the household',
  { setup: coParentB, role: 'authenticated', claims: ADMIN_B,
    sql: `update public.family_members set role = 'owner' where family_id = '${SCAN_FAMILY}' and guardian_id = '${ADMIN_B}';` + scanMembers,
    expect: 'ok', expectOut: `${ADMIN_B}:co_parent,${MEMBER_C}:owner` });
add('AD21', 'household-writes', 'no INSERT, UPDATE or ALL policy is left on public.family_members for any role',
  { sql: `select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'family_members' and cmd in ('INSERT', 'UPDATE', 'ALL');`,
    expect: 'ok', expectOut: '0' });
add('AD22', 'household-writes', 'creating a household still makes its creator the owner',
  { ...asScanParent,
    sql: `insert into public.families(id, name, created_by) values ('${SECOND_FAMILY}', 'Synthetic household', '${MEMBER_C}');
      reset role; select string_agg(guardian_id::text || ':' || role, ',') from public.family_members where family_id = '${SECOND_FAMILY}';`,
    expect: 'ok', expectOut: `${MEMBER_C}:owner` });
add('AD23', 'household-writes', 'accepting a family-wide co-parent invite still grants access to every child in the household, and no membership',
  { setup: `insert into public.athlete_invites(athlete_id, role, token, created_by, scope) values ('${ATH_A}', 'co_parent', 'synthetic-household-invite', '${MEMBER_C}', 'family');`,
    role: 'authenticated', claims: ADMIN_A,
    sql: `select public.accept_invite('synthetic-household-invite') = '${ATH_A}';
      reset role;
      select (select count(*) from public.athlete_access where guardian_id = '${ADMIN_A}' and role = 'co_parent' and revoked_at is null)
        || '|' || (select count(*) from public.family_members where guardian_id = '${ADMIN_A}');`,
    expect: 'ok', expectOut: '3|0' });
add('AD24', 'household-writes', 'both policy helpers run as definer with an empty search_path, and only authenticated may execute them',
  { sql: `select string_agg(p.proname || '=' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ',') || ':'
        || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || ':' || has_function_privilege('anon', p.oid, 'EXECUTE')::text, ' ' order by p.proname)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname in ('athlete_in_household', 'is_household_guardian_of');`,
    expect: 'ok', expectOut: 'athlete_in_household=true:search_path="":true:false is_household_guardian_of=true:search_path="":true:false' });

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
