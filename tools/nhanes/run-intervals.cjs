#!/usr/bin/env node
'use strict';

/**
 * Attempt 3, under amendment 6: does one uncertainty interval keep its stated coverage for every
 * subgroup, in a survey cycle the model never saw?
 *
 *   node tools/nhanes/run-intervals.cjs --data <dir> [--out <dir>]
 *
 * Development cycles only. The unread holdout is never loaded and there is no flag for it.
 *
 * Leave one cycle out. For each development cycle in turn, B+ and baseline 1 are fitted on the
 * training partition of the other four, the half-width is set on the other four's calibration
 * partition, and every participant of the left-out cycle gets an interval. Attempt 1 passed on
 * calibration and failed on a new cycle; pooled calibration is not the test, a new cycle is.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const LOCKFILE = path.join(HERE, 'sources.lock.json');
const args = process.argv.slice(2);
const valueFor = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
if (args.includes('--help') || !args.includes('--data')) {
  console.error('Usage: node tools/nhanes/run-intervals.cjs --data <dir> [--out <dir>]');
  process.exit(args.includes('--help') ? 0 : 2);
}
const DATA = path.resolve(valueFor('--data'));
const OUT = path.resolve(valueFor('--out') || path.join(DATA, 'intervals'));

// B+ exactly as frozen in attempt 1. Amendment 6 names it and forbids retuning.
const HYPERPARAMETERS = Object.freeze({
  features: ['ageYears', 'sexMale', 'heightCm', 'weightKg', 'waistCm'],
  trees: 300, learningRate: 0.05, depth: 3, minLeaf: 20,
});
const fixed = (value, places = 2) => (value == null ? '—' : Number(value).toFixed(places));
const pct = value => (100 * value).toFixed(1) + '%';

(async () => {
  const { readXport } = await import('../../tools/nhanes/xport.mjs');
  const { buildCohort, modelReadyExport } = await import('../../tools/nhanes/cohort.mjs');
  const B = await import('../../tools/nhanes/baselines.mjs');
  const M = await import('../../tools/nhanes/models.mjs');
  const { cohortRoleFor } = await import('../../tools/nhanes/roles.mjs');
  const I = await import('../../tools/nhanes/intervals.mjs');

  const lock = JSON.parse(fs.readFileSync(LOCKFILE, 'utf8'));
  const loaded = new Map();
  for (const entry of lock.files) {
    if (cohortRoleFor(entry.role, entry.cycle) !== 'development') continue;
    const buffer = fs.readFileSync(path.join(DATA, entry.name + '.xpt'));
    if (crypto.createHash('sha256').update(buffer).digest('hex') !== entry.sha256) {
      console.error('  CHANGED  ' + entry.name); process.exit(1);
    }
    if (!loaded.has(entry.cycle)) loaded.set(entry.cycle, { cycle: entry.cycle, role: 'development', replicatePolicy: 'measured_only' });
    const slot = { 'demographics': 'demo', 'body-measures': 'bmx', 'dxa-whole-body': 'dxa' }[entry.component];
    loaded.get(entry.cycle)[slot] = readXport(buffer).rows;
  }
  const cohort = buildCohort([...loaded.values()].sort((a, b) => a.cycle.localeCompare(b.cycle)));
  const cycles = [...new Set(cohort.participants.map(p => p.cycle))].sort();
  console.log('Development cohort ' + cohort.total + ' across ' + cycles.join(', ') + '. The holdout was not read.\n');

  const breakdowns = {
    ageBand: p => B.AGE_BAND_OF(p.ageYears),
    sex: p => (p.sexMale === 1 ? 'male' : 'female'),
    bmiBand: p => B.BMI_BAND_OF(p.bmi),
    raceEthnicityAudit: p => (p.raceEthnicity == null ? null : 'RIDRETH1=' + p.raceEthnicity),
  };
  const MODELS = ['B+', 'baseline 1'];
  const RULES = ['W1', 'W2'];
  const results = Object.fromEntries(MODELS.map(m => [m, Object.fromEntries(RULES.map(r => [r, { folds: [], records: [] }]))]));

  // --- leave one cycle out ----------------------------------------------------------------------
  for (const heldOut of cycles) {
    const others = cohort.participants.filter(p => p.cycle !== heldOut);
    const train = others.filter(p => p.split === 'train');
    const conformal = others.filter(p => p.split === 'calibration');
    const target = cohort.participants.filter(p => p.cycle === heldOut);

    const fitted = {
      'B+': { predict: M.predictCandidate, model: M.fitBoostedTrees(modelReadyExport(train).filter(row => Number.isFinite(row.waistCm)), HYPERPARAMETERS) },
      'baseline 1': { predict: B.predict, model: B.fitMeanByBand(modelReadyExport(train)) },
    };

    for (const name of MODELS) {
      const { predict, model } = fitted[name];
      const residuals = [];
      for (const person of conformal) {
        const estimate = predict(model, person);
        if (estimate == null || !Number.isFinite(person.bodyFatPercent)) continue;
        residuals.push({ absoluteResidual: Math.abs(person.bodyFatPercent - estimate), person });
      }
      const w1 = I.conformalHalfWidth(residuals.map(r => r.absoluteResidual));
      const w2 = I.groupCoveringHalfWidth(residuals, breakdowns);
      const widths = { W1: { halfWidth: w1, binding: null }, W2: { halfWidth: w2.halfWidth, binding: w2.binding } };

      for (const rule of RULES) {
        const { halfWidth, binding } = widths[rule];
        const records = [];
        let refused = 0;
        for (const person of target) {
          const estimate = predict(model, person);
          const interval = estimate == null ? null : I.intervalFor(estimate, halfWidth);
          if (!interval || !Number.isFinite(person.bodyFatPercent)) { refused++; continue; }
          records.push({ actual: person.bodyFatPercent, interval, person, heldOut });
        }
        results[name][rule].folds.push({
          heldOut, trainedOn: model.fittedOn ?? train.length, conformalN: residuals.length, halfWidth,
          binding: binding ? binding.dimension + ' ' + binding.key : null,
          intervals: records.length, refused,
        });
        results[name][rule].records.push(...records);
      }
    }
    console.log('  left out ' + heldOut + ': B+ half-width W1 ' + fixed(results['B+'].W1.folds.at(-1).halfWidth)
      + ', W2 ' + fixed(results['B+'].W2.folds.at(-1).halfWidth)
      + (results['B+'].W2.folds.at(-1).binding ? ' (set by ' + results['B+'].W2.folds.at(-1).binding + ')' : '')
      + ';  baseline 1 W1 ' + fixed(results['baseline 1'].W1.folds.at(-1).halfWidth));
  }

  // --- coverage ------------------------------------------------------------------------------------
  const groupBy = (records, keyOf) => {
    const groups = new Map();
    for (const record of records) {
      const key = keyOf(record.person);
      if (key == null) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }
    return [...groups].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  };
  const strip = summary => ({ n: summary.n, coverage: summary.coverage, floor: summary.floor, pass: summary.pass,
    estimateTooHigh: summary.estimateTooHigh, estimateTooLow: summary.estimateTooLow });

  function evaluate(name, rule) {
    const { folds, records } = results[name][rule];
    const overall = I.summarizeCoverage(records, { z: 2 });
    const pooled = [], perCycle = [];
    for (const [dimension, keyOf] of Object.entries(breakdowns)) {
      for (const [key, rows] of groupBy(records, keyOf)) {
        pooled.push(rows.length < I.MINIMUM_SUBGROUP
          ? { dimension, key, n: rows.length, insufficient: true }
          : { dimension, key, insufficient: false, ...strip(I.summarizeCoverage(rows, { z: 2 })) });
      }
      for (const cycle of cycles) {
        for (const [key, rows] of groupBy(records.filter(r => r.heldOut === cycle), keyOf)) {
          perCycle.push(rows.length < I.MINIMUM_SUBGROUP
            ? { cycle, dimension, key, n: rows.length, insufficient: true }
            : { cycle, dimension, key, insufficient: false, ...strip(I.summarizeCoverage(rows, { z: 3 })) });
        }
      }
    }
    return { folds, overall: strip(overall), pooled, perCycle };
  }

  const evaluation = {};
  for (const name of MODELS) evaluation[name] = { W1: evaluate(name, 'W1'), W2: evaluate(name, 'W2') };

  // --- report --------------------------------------------------------------------------------------
  for (const rule of RULES) {
    const e = evaluation['B+'][rule];
    console.log('\nB+ with ' + (rule === 'W1' ? 'W1, race-blind' : 'W2, group-covering') + ' — out-of-cycle coverage, nominal 90%');
    console.log('  overall  n ' + e.overall.n + '   coverage ' + pct(e.overall.coverage) + '   floor ' + pct(e.overall.floor)
      + '   ' + (e.overall.pass ? 'pass' : 'FAIL'));
    console.log('  half-width by fold: ' + e.folds.map(f => f.heldOut + ' ' + fixed(f.halfWidth)).join(', '));
    console.log('  pooled subgroups (misses: estimate too high / too low):');
    for (const g of e.pooled) {
      console.log('    ' + (g.dimension + ' ' + g.key).padEnd(34) + String(g.n).padStart(6)
        + (g.insufficient ? '   insufficient to report'
          : '   ' + pct(g.coverage).padStart(6) + '   floor ' + pct(g.floor) + '   high ' + String(g.estimateTooHigh).padStart(4)
            + ' / low ' + String(g.estimateTooLow).padStart(4) + (g.pass ? '' : '   FAIL')));
    }
    const cells = e.perCycle.filter(c => !c.insufficient);
    const failed = cells.filter(c => !c.pass);
    console.log('  per-cycle subgroup cells: ' + cells.length + ' reported, ' + failed.length + ' below the 3·SE floor'
      + (failed.length ? ':' : ''));
    for (const c of failed) {
      console.log('    ' + c.cycle + '  ' + (c.dimension + ' ' + c.key).padEnd(30) + ' n ' + String(c.n).padStart(4)
        + '   ' + pct(c.coverage) + ' vs floor ' + pct(c.floor) + '   high ' + c.estimateTooHigh + ' / low ' + c.estimateTooLow);
    }
  }

  // --- the criteria, checked rather than judged ------------------------------------------------------
  const criteriaFor = rule => {
    const e = evaluation['B+'][rule];
    const base = evaluation['baseline 1'][rule];
    const narrower = e.folds.every((fold, i) => fold.halfWidth < base.folds[i].halfWidth);
    return [
      { id: 'overall_coverage', label: 'Overall out-of-cycle coverage ≥ 90% − 2·SE', pass: e.overall.pass,
        value: pct(e.overall.coverage) + ' vs ' + pct(e.overall.floor) },
      { id: 'pooled_subgroup_coverage', label: 'Each reported subgroup, pooled, ≥ 90% − 2·SE', pass: e.pooled.filter(g => !g.insufficient).every(g => g.pass),
        value: e.pooled.filter(g => !g.insufficient && !g.pass).map(g => g.dimension + ' ' + g.key + ' ' + pct(g.coverage)).join('; ') || 'all pass' },
      { id: 'per_cycle_subgroup_coverage', label: 'Each subgroup in each left-out cycle ≥ 90% − 3·SE', pass: e.perCycle.filter(c => !c.insufficient).every(c => c.pass),
        value: e.perCycle.filter(c => !c.insufficient && !c.pass).length + ' of ' + e.perCycle.filter(c => !c.insufficient).length + ' cells below' },
      { id: 'usefulness', label: 'Narrower than baseline 1 in every fold', pass: narrower,
        value: e.folds.map((f, i) => fixed(f.halfWidth) + ' vs ' + fixed(base.folds[i].halfWidth)).join(', ') },
    ];
  };
  const criteria = { W1: criteriaFor('W1'), W2: criteriaFor('W2') };
  console.log('\nAMENDMENT 6 CRITERIA');
  for (const rule of RULES) {
    console.log('  ' + (rule === 'W1' ? 'W1, race-blind' : 'W2, group-covering'));
    for (const c of criteria[rule]) console.log('    ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + c.label.padEnd(52) + c.value);
  }
  const passes = rule => criteria[rule].every(c => c.pass);
  const decision = passes('W1') ? 'W1' : passes('W2') ? 'W2' : null;
  console.log('\n  DECISION: ' + (decision === 'W1' ? 'W1 meets every criterion. The race-blind interval is the attempt-3 result.'
    : decision === 'W2' ? 'W1 fails; W2 meets every criterion. The result depends on the audit variable setting the width, which goes to the reviewer.'
      : 'Neither rule meets every criterion. Attempt 3 fails and the not-released result stands.'));
  if (decision) {
    const width = evaluation['B+'][decision].folds.reduce((s, f) => s + f.halfWidth, 0) / cycles.length;
    const shown = I.intervalFor(25, width);
    console.log('  What a person would see, at the mean half-width across folds: an estimate of 25% becomes '
      + fixed(shown.lower, 1) + '–' + fixed(shown.upper, 1) + '%.');
  }
  console.log('  Whether a range may be released when its centre fails amendment 4 is not decided by this');
  console.log('  tool or by amendment 6. It is referred to the §8 reviewer. 2015-2016 remains unread.');

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'intervals.json'), JSON.stringify({
    nominalCoverage: I.NOMINAL_COVERAGE, hyperparameters: HYPERPARAMETERS, cycles,
    evaluation, criteria, decision,
  }, null, 2) + '\n', 'utf8');
  console.log('\nWrote ' + path.join(OUT, 'intervals.json') + ' (aggregates only; no participant rows).');
})();
