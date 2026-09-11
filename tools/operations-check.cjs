#!/usr/bin/env node
'use strict';

/**
 * Assert a production posture snapshot.
 *
 * FM12 asks for operating evidence. This is the half a machine can hold: `tests/db/posture.sql`
 * asks production a fixed set of read-only questions, and this asserts every answer. It exits
 * non-zero when production is not in the state the repository believes it is in.
 *
 *   node tools/operations-check.cjs --verify tools/ops-evidence/posture-<date>.json
 *   node tools/operations-check.cjs --verify <file> --allow composition_gate_closed
 *
 * The snapshot is captured separately by running tests/db/posture.sql against the live project;
 * this script never connects to a database and never sees row content.
 *
 * `--allow <check>` records a deliberate, temporary exception. It still prints the failure and
 * says it was waived, so a waiver cannot quietly become the normal state.
 */

const fs = require('node:fs');

// Every check posture.sql emits must be listed here. A snapshot missing one, or carrying one this
// script does not know about, is itself a failure: it means the two files drifted apart.
const EXPECTED_CHECKS = [
  'rls_enabled_on_every_public_table',
  'no_excess_tenant_grants',
  'definer_functions_pin_search_path',
  'tenant_roles_cannot_create_schema_objects',
  'auto_rls_guardrail_intact',
  'retention_jobs_registered_and_healthy',
  'nothing_retained_past_its_retention_date',
  'composition_gate_closed',
];

const WHY = {
  rls_enabled_on_every_public_table:
    'A public table without row-level security is readable by any signed-in user.',
  no_excess_tenant_grants:
    'TRUNCATE is not subject to row-level security. A tenant role holding it can empty the table regardless of policy.',
  definer_functions_pin_search_path:
    'A SECURITY DEFINER function with an UNSET search_path lets the caller control name resolution inside code running as the owner.',
  tenant_roles_cannot_create_schema_objects:
    'Four definer functions pin search_path=public rather than empty. That is safe only while no tenant role can create an object in public to shadow a name.',
  auto_rls_guardrail_intact:
    'ensure_rls enables RLS on every new public table. Without it the next table created is silently unprotected.',
  retention_jobs_registered_and_healthy:
    'Retention is a data-protection commitment. A disabled or failing sweep means data outlives its consent.',
  nothing_retained_past_its_retention_date:
    'This is the outcome, not the schedule. A sweep can run and succeed over zero rows while still not deleting what it should.',
  composition_gate_closed:
    'No licensed composition model exists. A registered provider or a stored result would mean the gate opened without one.',
};

const args = process.argv.slice(2);
const mode = args[0];
const file = args[1];
const allowed = new Set();
for (let i = 2; i < args.length; i++) if (args[i] === '--allow' && args[i + 1]) allowed.add(args[++i]);

if (mode !== '--verify' || !file) {
  console.error('Usage: node tools/operations-check.cjs --verify <posture.json> [--allow <check>]');
  process.exit(2);
}
if (!fs.existsSync(file)) { console.error('No such snapshot: ' + file); process.exit(2); }

let snapshot;
try { snapshot = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (error) { console.error('Could not parse the snapshot: ' + error.message); process.exit(2); }
const posture = snapshot.posture || snapshot;
const checks = posture.checks;
if (!checks || typeof checks !== 'object') { console.error('Snapshot has no checks object.'); process.exit(2); }

console.log('PRODUCTION POSTURE');
console.log('  captured at    : ' + (posture.captured_at || '(not recorded)'));
console.log('  server version : ' + (posture.server_version || '(not recorded)'));
console.log('  snapshot       : ' + file);
console.log('');

const missing = EXPECTED_CHECKS.filter(name => !(name in checks));
const unknown = Object.keys(checks).filter(name => !EXPECTED_CHECKS.includes(name));
let failures = 0;
let waived = 0;

for (const name of EXPECTED_CHECKS) {
  const check = checks[name];
  if (!check) continue;
  const pass = check.pass === true;
  const isWaived = !pass && allowed.has(name);
  if (pass) {
    console.log('  PASS   ' + name);
  } else if (isWaived) {
    waived++;
    console.log('  WAIVED ' + name + '   (--allow was passed; this is still a failure)');
    console.log('         why it matters: ' + WHY[name]);
    console.log('         detail: ' + JSON.stringify(check.detail));
  } else {
    failures++;
    console.log('  FAIL   ' + name);
    console.log('         why it matters: ' + WHY[name]);
    console.log('         detail: ' + JSON.stringify(check.detail));
  }
}

if (missing.length) {
  failures += missing.length;
  console.log('\n  MISSING from the snapshot (posture.sql and this script have drifted):');
  for (const name of missing) console.log('    ' + name);
}
if (unknown.length) {
  failures += unknown.length;
  console.log('\n  UNKNOWN in the snapshot (posture.sql emits a check this script does not assert):');
  for (const name of unknown) console.log('    ' + name);
}

console.log('');
console.log('  checks: ' + EXPECTED_CHECKS.length + '   failures: ' + failures + '   waived: ' + waived);
if (failures === 0 && waived === 0) console.log('\nProduction matches the posture this repository expects.');
else if (failures === 0) console.log('\nNo unwaived failures, but ' + waived + ' waived. A waiver is a debt, not a pass.');
else console.log('\nProduction does NOT match the expected posture.');
process.exitCode = failures === 0 ? 0 : 1;
