#!/usr/bin/env node
'use strict';

/**
 * Uncertainty intervals, leave one cycle out: attempt 3 under amendment 6, attempt 4 under
 * amendment 7.
 *
 *   node tools/nhanes/run-intervals.cjs --data <dir> --attempt 3|4 [--out <dir>]
 *
 * Development cycles only. The unread holdout is never loaded and there is no flag for it.
 *
 * Leave one cycle out. For each development cycle in turn, B+ and baseline 1 are fitted on the
 * training partition of the other four, the half-width is set on the other four's calibration
 * partition, and every participant of the left-out cycle gets an interval. Attempt 1 passed on
 * calibration and failed on a new cycle; pooled calibration is not the test, a new cycle is.
 *
 * --attempt is required and has no default. Attempt 4 extends this runner rather than replacing
 * it, and amendment 7 requires the extended runner to reproduce attempt 3 exactly before any
 * attempt-4 number is trusted. With a default it would be easy to run one while believing it was
 * the other.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const LOCKFILE = path.join(HERE, 'sources.lock.json');
const args = process.argv.slice(2);
const valueFor = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const ATTEMPT = valueFor('--attempt');
if (args.includes('--help') || !args.includes('--data') || !['3', '4'].includes(ATTEMPT)) {
  console.error('Usage: node tools/nhanes/run-intervals.cjs --data <dir> --attempt 3|4 [--out <dir>]');
  process.exit(args.includes('--help') ? 0 : 2);
}
const DATA = path.resolve(valueFor('--data'));
const OUT = path.resolve(valueFor('--out') || path.join(DATA, 'intervals'));

// B+ exactly as frozen in attempt 1. Amendments 6 and 7 name it and forbid retuning.
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

  const breakdowns = {
    ageBand: p => B.AGE_BAND_OF(p.ageYears),
    sex: p => (p.sexMale === 1 ? 'male' : 'female'),
    bmiBand: p => B.BMI_BAND_OF(p.bmi),
    raceEthnicityAudit: p => (p.raceEthnicity == null ? null : 'RIDRETH1=' + p.raceEthnicity),
  };
  // Within one sex, sex is constant, so it is not a subgroup there.
  const { sex: _sex, ...withinSex } = breakdowns;
  const SEX_NAME = { 0: 'female', 1: 'male' };

  // Each rule turns one fold's conformal residuals into a half-width for a person.
  const oneWidth = (halfWidth, binding) => ({
    widthFor: () => halfWidth,
    halfWidths: { all: halfWidth },
    binding: binding ? { all: binding.dimension + ' ' + binding.key } : {},
  });
  const widthPerSex = stratified => ({
    widthFor: person => I.halfWidthFor(stratified, person),
    halfWidths: Object.fromEntries(Object.entries(stratified.widths).map(([value, w]) => [SEX_NAME[value], w.halfWidth])),
    binding: Object.fromEntries(Object.entries(stratified.widths).filter(([, w]) => w.binding)
      .map(([value, w]) => [SEX_NAME[value], w.binding.dimension + ' ' + w.binding.key])),
  });
  const ATTEMPTS = {
    3: { amendment: 6, rules: {
      W1: { label: 'W1, race-blind', build: residuals => oneWidth(I.conformalHalfWidth(residuals.map(r => r.absoluteResidual)), null) },
      W2: { label: 'W2, group-covering', build: residuals => { const g = I.groupCoveringHalfWidth(residuals, breakdowns); return oneWidth(g.halfWidth, g.binding); } },
    } },
    4: { amendment: 7, rules: {
      S1: { label: 'S1, per sex, race-blind', build: residuals => widthPerSex(I.stratifiedHalfWidths(residuals, 'sexMale', { rule: 'pooled' })) },
      S2: { label: 'S2, per sex, group-covering', build: residuals => widthPerSex(I.stratifiedHalfWidths(residuals, 'sexMale', { rule: 'group-covering', breakdowns: withinSex })) },
    } },
  };
  const { amendment, rules } = ATTEMPTS[ATTEMPT];
  const RULES = Object.keys(rules);
  console.log('Attempt ' + ATTEMPT + ' under amendment ' + amendment + '. Development cohort ' + cohort.total
    + ' across ' + cycles.join(', ') + '. The holdout was not read.\n');

  const MODELS = ['B+', 'baseline 1'];
  const results = Object.fromEntries(MODELS.map(m => [m, Object.fromEntries(RULES.map(r => [r, { folds: [], records: [] }]))]));
  const showWidths = fold => Object.entries(fold.halfWidths).map(([s, w]) => (s === 'all' ? '' : s + ' ') + fixed(w)).join(', ')
    + (Object.keys(fold.binding).length
      ? ' (set by ' + Object.entries(fold.binding).map(([s, b]) => (s === 'all' ? '' : s + ': ') + b).join('; ') + ')' : '');

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

      for (const rule of RULES) {
        const width = rules[rule].build(residuals);
        const records = [];
        let refused = 0;
        for (const person of target) {
          const estimate = predict(model, person);
          const halfWidth = estimate == null ? null : width.widthFor(person);
          const interval = halfWidth == null ? null : I.intervalFor(estimate, halfWidth);
          if (!interval || !Number.isFinite(person.bodyFatPercent)) { refused++; continue; }
          records.push({ actual: person.bodyFatPercent, interval, person, heldOut });
        }
        results[name][rule].folds.push({
          heldOut, conformalN: residuals.length, halfWidths: width.halfWidths, binding: width.binding,
          intervals: records.length, refused,
        });
        results[name][rule].records.push(...records);
      }
    }
    console.log('  left out ' + heldOut + ':  ' + RULES.map(rule => 'B+ ' + rule + ' ' + showWidths(results['B+'][rule].folds.at(-1))).join(';  ')
      + ';  baseline 1 ' + RULES[0] + ' ' + showWidths(results['baseline 1'][RULES[0]].folds.at(-1)));
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
  for (const name of MODELS) evaluation[name] = Object.fromEntries(RULES.map(rule => [rule, evaluate(name, rule)]));

  // --- report --------------------------------------------------------------------------------------
  for (const rule of RULES) {
    const e = evaluation['B+'][rule];
    console.log('\nB+ with ' + rules[rule].label + ' — out-of-cycle coverage, nominal 90%');
    console.log('  overall  n ' + e.overall.n + '   coverage ' + pct(e.overall.coverage) + '   floor ' + pct(e.overall.floor)
      + '   ' + (e.overall.pass ? 'pass' : 'FAIL'));
    console.log('  half-width by fold: ' + e.folds.map(f => f.heldOut + ' ' + showWidths(f)).join('; '));
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
    // Per stratum: under amendment 7 each sex's width has to be narrower than baseline 1's for that sex.
    const narrower = e.folds.every((fold, i) => Object.entries(fold.halfWidths).every(([s, w]) => w < base.folds[i].halfWidths[s]));
    return [
      { id: 'overall_coverage', label: 'Overall out-of-cycle coverage ≥ 90% − 2·SE', pass: e.overall.pass,
        value: pct(e.overall.coverage) + ' vs ' + pct(e.overall.floor) },
      { id: 'pooled_subgroup_coverage', label: 'Each reported subgroup, pooled, ≥ 90% − 2·SE', pass: e.pooled.filter(g => !g.insufficient).every(g => g.pass),
        value: e.pooled.filter(g => !g.insufficient && !g.pass).map(g => g.dimension + ' ' + g.key + ' ' + pct(g.coverage)).join('; ') || 'all pass' },
      { id: 'per_cycle_subgroup_coverage', label: 'Each subgroup in each left-out cycle ≥ 90% − 3·SE', pass: e.perCycle.filter(c => !c.insufficient).every(c => c.pass),
        value: e.perCycle.filter(c => !c.insufficient && !c.pass).length + ' of ' + e.perCycle.filter(c => !c.insufficient).length + ' cells below' },
      { id: 'usefulness', label: 'Narrower than baseline 1 in every fold' + (ATTEMPT === '4' ? ', per sex' : ''), pass: narrower,
        value: e.folds.map((f, i) => Object.entries(f.halfWidths).map(([s, w]) => (s === 'all' ? '' : s + ' ') + fixed(w) + ' vs ' + fixed(base.folds[i].halfWidths[s])).join(' / ')).join(', ') },
    ];
  };
  const criteria = Object.fromEntries(RULES.map(rule => [rule, criteriaFor(rule)]));
  console.log('\nAMENDMENT ' + amendment + ' CRITERIA');
  for (const rule of RULES) {
    console.log('  ' + rules[rule].label);
    for (const c of criteria[rule]) console.log('    ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + c.label.padEnd(52) + c.value);
  }
  const [first, second] = RULES;
  const passes = rule => criteria[rule].every(c => c.pass);
  const decision = passes(first) ? first : passes(second) ? second : null;
  console.log('\n  DECISION: ' + (decision === first ? rules[first].label + ' meets every criterion.'
    : decision === second ? rules[first].label + ' fails; ' + rules[second].label + ' meets every criterion. The result depends on the audit variable helping set the width, which goes to the reviewer.'
      : 'Neither rule meets every criterion. Attempt ' + ATTEMPT + ' fails and the not-released result stands.'));
  if (decision) {
    const folds = evaluation['B+'][decision].folds;
    for (const stratum of Object.keys(folds[0].halfWidths)) {
      const width = folds.reduce((s, f) => s + f.halfWidths[stratum], 0) / folds.length;
      const shown = I.intervalFor(25, width);
      console.log('  What a person would see' + (stratum === 'all' ? '' : ' (' + stratum + ')') + ', at the mean half-width across folds: an estimate of 25% becomes '
        + fixed(shown.lower, 1) + '–' + fixed(shown.upper, 1) + '%.');
    }
  }
  if (ATTEMPT === '4') {
    console.log('  Amendment 7 was written after attempt 3\'s result, on these same cycles. 2015-2016 is the only test of');
    console.log('  it whose result has not already been seen.');
  }
  console.log('  Whether a range may be released when its centre fails amendment 4 is not decided by this');
  console.log('  tool. It is referred to the §8 reviewer. 2015-2016 remains unread.');

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'intervals-attempt-' + ATTEMPT + '.json');
  fs.writeFileSync(file, JSON.stringify({
    attempt: Number(ATTEMPT), amendment, nominalCoverage: I.NOMINAL_COVERAGE, hyperparameters: HYPERPARAMETERS, cycles,
    evaluation, criteria, decision,
  }, null, 2) + '\n', 'utf8');
  console.log('\nWrote ' + file + ' (aggregates only; no participant rows).');
})();
