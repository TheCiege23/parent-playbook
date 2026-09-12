#!/usr/bin/env node
'use strict';

/**
 * Build the analysis cohort from the downloaded files and write the reports.
 *
 *   node tools/nhanes/build-cohort.cjs --data <dir> [--out <dir>]
 *
 * Reads the files named in sources.lock.json, verifies their hashes first, applies the exclusions
 * from research/NHANES-PREREGISTRATION.md in order, and writes the cohort flow, the model-ready
 * export and the evaluation export.
 *
 * The hash check is not ceremony. A study that cannot say which bytes it read is not reproducible,
 * and a cohort built from a file that changed under it is a different cohort wearing the same
 * counts.
 *
 * THE HOLDOUT IS NOT BUILT UNLESS ASKED. Pass --include-holdout to build it. The preregistration
 * says the final holdout is read once, at the release decision, and a command that produces it
 * every time someone iterates on the pipeline is how "read once" quietly becomes "read forty
 * times". Development alone is the default.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const LOCKFILE = path.join(HERE, 'sources.lock.json');

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const valueFor = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };

if (flag('--help') || !flag('--data')) {
  console.error('Usage: node tools/nhanes/build-cohort.cjs --data <dir> [--out <dir>] [--include-holdout]');
  process.exit(flag('--help') ? 0 : 2);
}

const DATA = path.resolve(valueFor('--data'));
const OUT = path.resolve(valueFor('--out') || path.join(DATA, 'cohort'));
const INCLUDE_HOLDOUT = flag('--include-holdout');

// Which cycle plays which part. The holdout is the most recent, per the preregistration.
const ROLES = {
  '1999-2000': 'development', '2001-2002': 'development', '2003-2004': 'development',
  '2011-2012': 'development', '2013-2014': 'development', '2017-2018': 'holdout',
};
// Only the early cycles impute; the policy is inert elsewhere but is stated for every cycle so the
// report says what was applied rather than leaving it to be inferred.
const REPLICATE_POLICY = 'measured_only';

(async () => {
  const { readXport } = await import('../../tools/nhanes/xport.mjs');
  const { buildCohort, modelReadyExport, evaluationExport, formatCohortFlow } = await import('../../tools/nhanes/cohort.mjs');

  if (!fs.existsSync(LOCKFILE)) { console.error('No sources.lock.json. Run acquire.cjs --download first.'); process.exit(2); }
  const lock = JSON.parse(fs.readFileSync(LOCKFILE, 'utf8'));

  // Verify before reading. A file that changed since it was locked makes every count below a
  // description of something other than what the study says it read.
  const files = new Map();
  let bad = 0;
  for (const entry of lock.files) {
    const at = path.join(DATA, entry.name + '.xpt');
    if (!fs.existsSync(at)) { console.error('  MISSING  ' + entry.name); bad++; continue; }
    const buffer = fs.readFileSync(at);
    const digest = crypto.createHash('sha256').update(buffer).digest('hex');
    if (digest !== entry.sha256) { console.error('  CHANGED  ' + entry.name + '  locked ' + entry.sha256.slice(0, 16) + '  found ' + digest.slice(0, 16)); bad++; continue; }
    files.set(entry.name, { entry, buffer });
  }
  if (bad) { console.error('\n' + bad + ' file(s) missing or changed. Re-download, or record why this study now reads different bytes.'); process.exit(1); }
  console.log('All ' + lock.files.length + ' source files match sources.lock.json.\n');

  const byCycle = new Map();
  for (const [, { entry, buffer }] of files) {
    if (!byCycle.has(entry.cycle)) byCycle.set(entry.cycle, {});
    byCycle.get(entry.cycle)[entry.component] = readXport(buffer);
  }

  const cycles = [];
  for (const [cycle, components] of byCycle) {
    const role = ROLES[cycle];
    if (!role) { console.error('Cycle ' + cycle + ' has no declared role; add it to ROLES deliberately.'); process.exit(2); }
    if (role === 'holdout' && !INCLUDE_HOLDOUT) {
      console.log('Skipping ' + cycle + ' (final holdout). Pass --include-holdout only at the release decision.');
      continue;
    }
    cycles.push({
      cycle, role,
      demo: components['demographics'].rows,
      bmx: components['body-measures'].rows,
      dxa: components['dxa-whole-body'].rows,
      replicatePolicy: REPLICATE_POLICY,
    });
  }
  cycles.sort((a, b) => a.cycle.localeCompare(b.cycle));

  const result = buildCohort(cycles);
  console.log(formatCohortFlow(result));

  fs.mkdirSync(OUT, { recursive: true });
  const asCsv = rows => {
    if (!rows.length) return '';
    const keys = Object.keys(rows[0]);
    const cell = v => (v == null ? '' : String(v));
    return [keys.join(','), ...rows.map(r => keys.map(k => cell(r[k])).join(','))].join('\n') + '\n';
  };
  fs.writeFileSync(path.join(OUT, 'cohort-flow.txt'), formatCohortFlow(result) + '\n', 'utf8');
  fs.writeFileSync(path.join(OUT, 'cohort-flow.json'), JSON.stringify(result.flow, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(OUT, 'model-ready.csv'), asCsv(modelReadyExport(result.participants)), 'utf8');
  fs.writeFileSync(path.join(OUT, 'evaluation.csv'), asCsv(evaluationExport(result.participants)), 'utf8');

  console.log('\nWrote to ' + OUT);
  console.log('  cohort-flow.txt / .json   every exclusion, in order, per cycle');
  console.log('  model-ready.csv           features and targets only; no identifier, no race, no design variable');
  console.log('  evaluation.csv            the audit and design variables the model may not see');
  console.log('\nThese outputs are participant-level survey data. They stay where the sources are,');
  console.log('outside the repository, and are not committed.');
})();
