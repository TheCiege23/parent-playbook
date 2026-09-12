#!/usr/bin/env node
'use strict';

/**
 * Fit the preregistered baselines on the training partition and report them on calibration.
 *
 *   node tools/nhanes/run-baselines.cjs --data <dir> [--out <dir>]
 *
 * The final holdout is never loaded by this command. There is no flag to make it. Reading it is a
 * separate, deliberate act at the release decision, and a baselines run that could touch it is how
 * "read once" stops being true.
 *
 * Fitting happens on rows from modelReadyExport, which physically lack race, identifiers and
 * survey design variables. Evaluation happens against participant records, which carry them. That
 * split is what makes the subgroup report possible without letting any of it reach a coefficient.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const LOCKFILE = path.join(HERE, 'sources.lock.json');
const args = process.argv.slice(2);
const valueFor = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };

if (args.includes('--help') || !args.includes('--data')) {
  console.error('Usage: node tools/nhanes/run-baselines.cjs --data <dir> [--out <dir>]');
  process.exit(args.includes('--help') ? 0 : 2);
}
const DATA = path.resolve(valueFor('--data'));
const OUT = path.resolve(valueFor('--out') || path.join(DATA, 'baselines'));

// Roles come from sources.json through tools/nhanes/roles.mjs, like every other NHANES tool.

const fixed = (value, places = 3) => (value == null ? '—' : Number(value).toFixed(places));

(async () => {
  const { readXport } = await import('../../tools/nhanes/xport.mjs');
  const { buildCohort, modelReadyExport } = await import('../../tools/nhanes/cohort.mjs');
  const B = await import('../../tools/nhanes/baselines.mjs');
  const { cohortRoleFor } = await import('../../tools/nhanes/roles.mjs');

  const lock = JSON.parse(fs.readFileSync(LOCKFILE, 'utf8'));
  const cycles = new Map();
  for (const entry of lock.files) {
    if (cohortRoleFor(entry.role, entry.cycle) !== 'development') continue;     // the holdout is not even read
    const at = path.join(DATA, entry.name + '.xpt');
    const buffer = fs.readFileSync(at);
    if (crypto.createHash('sha256').update(buffer).digest('hex') !== entry.sha256) {
      console.error('  CHANGED  ' + entry.name + ' no longer matches sources.lock.json.'); process.exit(1);
    }
    if (!cycles.has(entry.cycle)) cycles.set(entry.cycle, { cycle: entry.cycle, role: 'development', replicatePolicy: 'measured_only' });
    const parsed = readXport(buffer);
    const slot = { 'demographics': 'demo', 'body-measures': 'bmx', 'dxa-whole-body': 'dxa' }[entry.component];
    cycles.get(entry.cycle)[slot] = parsed.rows;
  }

  const cohort = buildCohort([...cycles.values()].sort((a, b) => a.cycle.localeCompare(b.cycle)));
  const train = cohort.participants.filter(p => p.split === 'train');
  const calibration = cohort.participants.filter(p => p.split === 'calibration');
  console.log('Development cohort ' + cohort.total + ' — train ' + train.length + ', calibration ' + calibration.length);
  console.log('The final holdout was not read.\n');

  // Fitted on rows that do not contain race, an identifier or a design variable.
  const trainFeatures = modelReadyExport(train);

  const models = [
    { name: '1. mean by age and sex band', model: B.fitMeanByBand(trainFeatures) },
    { name: '2. linear: age, sex, height, weight', model: B.fitLinear(trainFeatures, ['ageYears', 'sexMale', 'heightCm', 'weightKg'], 'bodyFatPercent', 'linear') },
    { name: '3. BMI regression: bmi, age, sex', model: B.fitLinear(trainFeatures, ['bmi', 'ageYears', 'sexMale'], 'bodyFatPercent', 'bmi_regression') },
    { name: '4. waist-enhanced: + waist', model: B.fitLinear(trainFeatures.filter(row => Number.isFinite(row.waistCm)), ['bmi', 'ageYears', 'sexMale', 'waistCm'], 'bodyFatPercent', 'waist_regression') },
  ];

  console.log('CALIBRATION SET — body fat percentage');
  console.log('  ' + 'model'.padEnd(38) + 'n'.padStart(6) + 'bias'.padStart(9) + 'MAE'.padStart(8) + 'RMSE'.padStart(8) + 'maxErr'.padStart(8) + 'slope'.padStart(8) + ' refused');
  const report = {};
  for (const { name, model } of models) {
    const metrics = B.evaluate(model, calibration);
    report[name] = { model: { kind: model.kind, features: model.features, intercept: model.intercept ?? null, coefficients: model.coefficients ?? null }, calibration: metrics };
    console.log('  ' + name.padEnd(38) + String(metrics.n).padStart(6) + fixed(metrics.bias, 3).padStart(9)
      + fixed(metrics.mae, 3).padStart(8) + fixed(metrics.rmse, 3).padStart(8)
      + fixed(metrics.maxAbsError, 2).padStart(8) + fixed(metrics.calibrationSlope, 3).padStart(8)
      + String(metrics.refused).padStart(8));
  }

  // Subgroups for the best baseline by calibration MAE, which is the one anything else has to beat.
  const best = models.reduce((a, b) => (B.evaluate(b.model, calibration).mae < B.evaluate(a.model, calibration).mae ? b : a));
  const overall = B.evaluate(best.model, calibration);
  console.log('\nBest baseline: ' + best.name + '  (MAE ' + fixed(overall.mae, 3) + ')');
  const breakdowns = {
    'age band': row => B.AGE_BAND_OF(row.ageYears),
    'sex': row => (row.sexMale === 1 ? 'male' : 'female'),
    'BMI band': row => B.BMI_BAND_OF(row.bmi),
    'race/ethnicity audit group': row => (row.raceEthnicity == null ? null : 'RIDRETH1=' + row.raceEthnicity),
  };
  for (const [label, keyOf] of Object.entries(breakdowns)) {
    console.log('\n  by ' + label + ':');
    const groups = B.subgroupMetrics(best.model, calibration, keyOf);
    report['subgroups:' + label] = groups;
    for (const [key, metrics] of Object.entries(groups)) {
      if (metrics.insufficient) { console.log('    ' + key.padEnd(28) + String(metrics.n).padStart(6) + '  insufficient to report'); continue; }
      const ratio = overall.mae ? metrics.mae / overall.mae : null;
      console.log('    ' + key.padEnd(28) + String(metrics.n).padStart(6)
        + '  MAE ' + fixed(metrics.mae, 3) + '  bias ' + fixed(metrics.bias, 3)
        + '  x overall ' + fixed(ratio, 2) + (ratio > 1.25 ? '   <-- over the 1.25 ceiling' : ''));
    }
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'baselines.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log('\nWrote ' + path.join(OUT, 'baselines.json'));
  console.log('These are baselines on the CALIBRATION set. They establish what a candidate model has');
  console.log('to beat; they are not a release result and the holdout remains unread.');
})();
