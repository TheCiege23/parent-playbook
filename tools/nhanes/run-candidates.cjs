#!/usr/bin/env node
'use strict';

/**
 * Fit the candidate models on the training partition and compare them with the baselines on
 * calibration.
 *
 *   node tools/nhanes/run-candidates.cjs --data <dir> [--out <dir>]
 *
 * The final holdout is never loaded. There is no flag for it.
 *
 * Calibration is the tuning partition, so every number this prints is optimistic by construction —
 * the candidates were chosen partly by looking at it. That is what calibration is for, and it is
 * why the release decision reads the holdout instead. Nothing here is a release result.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const LOCKFILE = path.join(HERE, 'sources.lock.json');
const args = process.argv.slice(2);
const valueFor = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
if (args.includes('--help') || !args.includes('--data')) {
  console.error('Usage: node tools/nhanes/run-candidates.cjs --data <dir> [--out <dir>]');
  process.exit(args.includes('--help') ? 0 : 2);
}
const DATA = path.resolve(valueFor('--data'));
const OUT = path.resolve(valueFor('--out') || path.join(DATA, 'candidates'));

const ROLES = {
  '1999-2000': 'development', '2001-2002': 'development', '2003-2004': 'development',
  '2011-2012': 'development', '2013-2014': 'development', '2017-2018': 'holdout',
};
const fixed = (value, places = 3) => (value == null ? '—' : Number(value).toFixed(places));

(async () => {
  const { readXport } = await import('../../tools/nhanes/xport.mjs');
  const { buildCohort, modelReadyExport } = await import('../../tools/nhanes/cohort.mjs');
  const B = await import('../../tools/nhanes/baselines.mjs');
  const M = await import('../../tools/nhanes/models.mjs');

  const lock = JSON.parse(fs.readFileSync(LOCKFILE, 'utf8'));
  const cycles = new Map();
  for (const entry of lock.files) {
    if (ROLES[entry.cycle] !== 'development') continue;
    const buffer = fs.readFileSync(path.join(DATA, entry.name + '.xpt'));
    if (crypto.createHash('sha256').update(buffer).digest('hex') !== entry.sha256) {
      console.error('  CHANGED  ' + entry.name); process.exit(1);
    }
    if (!cycles.has(entry.cycle)) cycles.set(entry.cycle, { cycle: entry.cycle, role: 'development', replicatePolicy: 'measured_only' });
    const slot = { 'demographics': 'demo', 'body-measures': 'bmx', 'dxa-whole-body': 'dxa' }[entry.component];
    cycles.get(entry.cycle)[slot] = readXport(buffer).rows;
  }

  const cohort = buildCohort([...cycles.values()].sort((a, b) => a.cycle.localeCompare(b.cycle)));
  const train = cohort.participants.filter(p => p.split === 'train');
  const calibration = cohort.participants.filter(p => p.split === 'calibration');
  const trainFeatures = modelReadyExport(train);
  const withWaist = trainFeatures.filter(row => Number.isFinite(row.waistCm));
  console.log('train ' + train.length + ', calibration ' + calibration.length + '. The holdout was not read.\n');

  const entries = [
    { name: 'baseline 2: linear', predict: B.predict, model: B.fitLinear(trainFeatures, ['ageYears', 'sexMale', 'heightCm', 'weightKg'], 'bodyFatPercent') },
    { name: 'baseline 4: + waist', predict: B.predict, model: B.fitLinear(withWaist, ['bmi', 'ageYears', 'sexMale', 'waistCm'], 'bodyFatPercent') },
    { name: 'candidate A: spline ridge', predict: M.predictCandidate, model: M.fitSplineRidge(trainFeatures, { lambda: 1 }) },
    { name: 'candidate A+: spline + waist', predict: M.predictCandidate, model: M.fitSplineRidge(withWaist, { continuous: ['ageYears', 'heightCm', 'weightKg', 'waistCm'], lambda: 1 }) },
    { name: 'candidate B: boosted trees', predict: M.predictCandidate, model: M.fitBoostedTrees(trainFeatures, { trees: 300, learningRate: 0.05, depth: 3 }) },
    { name: 'candidate B+: boosted + waist', predict: M.predictCandidate, model: M.fitBoostedTrees(withWaist, { features: ['ageYears', 'sexMale', 'heightCm', 'weightKg', 'waistCm'], trees: 300, learningRate: 0.05, depth: 3 }) },
  ];

  // One evaluator for every model, so a candidate is never scored by a different ruler.
  const score = entry => {
    const pairs = [];
    let refused = 0;
    for (const row of calibration) {
      const predicted = entry.predict(entry.model, row);
      if (predicted == null || !Number.isFinite(row.bodyFatPercent)) { refused++; continue; }
      pairs.push({ predicted, actual: row.bodyFatPercent, row });
    }
    const errors = pairs.map(p => p.predicted - p.actual);
    const meanOf = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
    const mp = meanOf(pairs.map(p => p.predicted)), ma = meanOf(pairs.map(p => p.actual));
    let cov = 0, varr = 0;
    for (const p of pairs) { cov += (p.predicted - mp) * (p.actual - ma); varr += (p.predicted - mp) ** 2; }
    return { n: pairs.length, refused, bias: meanOf(errors), mae: meanOf(errors.map(Math.abs)),
      rmse: Math.sqrt(meanOf(errors.map(e => e ** 2))), slope: varr ? cov / varr : null, pairs };
  };

  console.log('CALIBRATION — body fat percentage (optimistic: this is the tuning partition)');
  console.log('  ' + 'model'.padEnd(30) + 'n'.padStart(6) + 'bias'.padStart(9) + 'MAE'.padStart(8) + 'RMSE'.padStart(8) + 'slope'.padStart(8) + ' refused');
  const report = {};
  for (const entry of entries) {
    const s = score(entry);
    entry.score = s;
    report[entry.name] = { kind: entry.model.kind, features: entry.model.features, n: s.n, refused: s.refused, bias: s.bias, mae: s.mae, rmse: s.rmse, calibrationSlope: s.slope };
    console.log('  ' + entry.name.padEnd(30) + String(s.n).padStart(6) + fixed(s.bias).padStart(9)
      + fixed(s.mae).padStart(8) + fixed(s.rmse).padStart(8) + fixed(s.slope).padStart(8) + String(s.refused).padStart(8));
  }

  // The question Sprint 3 exists to answer: does a stronger model fix the subgroup bias?
  console.log('\nSIGNED BIAS BY RACE/ETHNICITY AUDIT GROUP  (limit ±1.0, amendment 4)');
  const groups = [...new Set(calibration.map(p => p.raceEthnicity).filter(g => g != null))].sort();
  console.log('  ' + 'model'.padEnd(30) + groups.map(g => ('RIDRETH1=' + g).padStart(12)).join('') + '   worst');
  const biasReport = {};
  for (const entry of entries) {
    const byGroup = groups.map(group => {
      const rows = entry.score.pairs.filter(p => p.row.raceEthnicity === group);
      if (!rows.length) return null;
      return rows.reduce((sum, p) => sum + (p.predicted - p.actual), 0) / rows.length;
    });
    const worst = Math.max(...byGroup.filter(v => v != null).map(Math.abs));
    biasReport[entry.name] = Object.fromEntries(groups.map((g, i) => ['RIDRETH1=' + g, byGroup[i]]));
    biasReport[entry.name].worstAbsolute = worst;
    biasReport[entry.name].passesAmendment4 = worst <= 1.0;
    console.log('  ' + entry.name.padEnd(30) + byGroup.map(v => fixed(v, 3).padStart(12)).join('')
      + fixed(worst, 3).padStart(8) + (worst <= 1.0 ? '  passes' : '  FAILS'));
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'candidates.json'), JSON.stringify({ accuracy: report, subgroupBias: biasReport }, null, 2) + '\n', 'utf8');
  console.log('\nWrote ' + path.join(OUT, 'candidates.json'));
  console.log('Calibration numbers are optimistic by construction. The holdout remains unread.');
})();
