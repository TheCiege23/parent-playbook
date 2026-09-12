#!/usr/bin/env node
'use strict';

/**
 * Read the final holdout, once, against the frozen artifact.
 *
 *   node tools/nhanes/read-holdout.cjs --data <dir> --i-am-making-the-release-decision
 *
 * This is the single evaluation research/NHANES-PREREGISTRATION.md §5 reserves. It refits nothing,
 * tunes nothing and chooses nothing: it loads the frozen model, scores the 2017-2018 cycle, checks
 * every release criterion in §8 and writes the answer into the artifact — including if the answer
 * is no.
 *
 * IT REFUSES TO RUN TWICE. After a successful read the artifact carries holdoutRead: true, and
 * this tool exits rather than producing a second number. "Read once" is only a rule if something
 * enforces it, and the thing most likely to break it is someone re-running a command to see the
 * output again.
 *
 * The long flag is deliberate. There is no way to reach this by tab-completing a shorter one.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const LOCKFILE = path.join(HERE, 'sources.lock.json');
const MODEL_DIR = path.join(REPO, 'research', 'model');
const ARTIFACT = path.join(MODEL_DIR, 'bodyfat-candidate-v0.1.0.json');
const CHECKSUM = path.join(MODEL_DIR, 'bodyfat-candidate-v0.1.0.sha256');

const args = process.argv.slice(2);
const valueFor = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
if (!args.includes('--data') || !args.includes('--i-am-making-the-release-decision')) {
  console.error('Usage: node tools/nhanes/read-holdout.cjs --data <dir> --i-am-making-the-release-decision');
  console.error('\nThis reads the final holdout. It can only happen once, and it decides whether the');
  console.error('model is released. If you are iterating, you want run-candidates.cjs instead.');
  process.exit(2);
}
const DATA = path.resolve(valueFor('--data'));

const HOLDOUT_CYCLE = '2017-2018';
const fixed = (v, p = 3) => (v == null ? '—' : Number(v).toFixed(p));
const meanOf = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

(async () => {
  const { readXport } = await import('../../tools/nhanes/xport.mjs');
  const { buildCohort, modelReadyExport } = await import('../../tools/nhanes/cohort.mjs');
  const { estimateBodyComposition } = await import('../../tools/nhanes/frozen-predict.mjs');
  const B = await import('../../tools/nhanes/baselines.mjs');

  // --- the artifact, unchanged and unread ------------------------------------------------
  const raw = fs.readFileSync(ARTIFACT, 'utf8');
  const digest = crypto.createHash('sha256').update(raw.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
  const recorded = fs.readFileSync(CHECKSUM, 'utf8').split(/\s+/)[0];
  if (digest !== recorded) {
    console.error('The artifact does not match its recorded checksum. It is not the frozen model, and');
    console.error('reading the holdout against something else would spend the one read on nothing.');
    process.exit(1);
  }
  const artifact = JSON.parse(raw);
  if (artifact.holdoutRead) {
    console.error('This artifact has already had its holdout read, on ' + (artifact.holdoutReport?.readAt || 'an unrecorded date') + '.');
    console.error('There is no second read. The recorded result stands, whatever it says.');
    process.exit(1);
  }
  if (!artifact.model?.ensemble?.length) { console.error('The artifact carries no model.'); process.exit(1); }
  console.log('Frozen artifact verified: ' + artifact.id + ' ' + artifact.version);
  console.log('  sha-256 ' + digest);
  console.log('  frozen  ' + artifact.frozenAt + '\n');

  // --- the holdout cohort, built by exactly the same rules --------------------------------
  const lock = JSON.parse(fs.readFileSync(LOCKFILE, 'utf8'));
  const holdout = { cycle: HOLDOUT_CYCLE, role: 'holdout', replicatePolicy: 'measured_only' };
  const development = new Map();
  for (const entry of lock.files) {
    const buffer = fs.readFileSync(path.join(DATA, entry.name + '.xpt'));
    if (crypto.createHash('sha256').update(buffer).digest('hex') !== entry.sha256) {
      console.error('  CHANGED  ' + entry.name); process.exit(1);
    }
    const slot = { 'demographics': 'demo', 'body-measures': 'bmx', 'dxa-whole-body': 'dxa' }[entry.component];
    if (entry.cycle === HOLDOUT_CYCLE) holdout[slot] = readXport(buffer).rows;
    else {
      if (!development.has(entry.cycle)) development.set(entry.cycle, { cycle: entry.cycle, role: 'development', replicatePolicy: 'measured_only' });
      development.get(entry.cycle)[slot] = readXport(buffer).rows;
    }
  }
  const holdoutCohort = buildCohort([holdout]);
  console.log('Holdout cohort: ' + holdoutCohort.total + ' participants from ' + HOLDOUT_CYCLE + '\n');

  // Baselines are refitted on the development training partition — the same procedure that
  // produced them before — so "beats every baseline" is judged on the holdout for both sides.
  const devCohort = buildCohort([...development.values()].sort((a, b) => a.cycle.localeCompare(b.cycle)));
  const trainFeatures = modelReadyExport(devCohort.participants.filter(p => p.split === 'train'));
  const withWaist = trainFeatures.filter(row => Number.isFinite(row.waistCm));
  const baselines = [
    { name: 'mean by age and sex band', model: B.fitMeanByBand(trainFeatures) },
    { name: 'linear: age, sex, height, weight', model: B.fitLinear(trainFeatures, ['ageYears', 'sexMale', 'heightCm', 'weightKg'], 'bodyFatPercent') },
    { name: 'BMI regression', model: B.fitLinear(trainFeatures, ['bmi', 'ageYears', 'sexMale'], 'bodyFatPercent') },
    { name: 'waist-enhanced', model: B.fitLinear(withWaist, ['bmi', 'ageYears', 'sexMale', 'waistCm'], 'bodyFatPercent') },
  ];

  // --- score the frozen model -------------------------------------------------------------
  const pairs = [];
  let refused = 0;
  const refusalReasons = {};
  for (const person of holdoutCohort.participants) {
    const result = estimateBodyComposition(artifact, person, { allowCandidate: true });
    if (!result.ok) { refused++; refusalReasons[result.code] = (refusalReasons[result.code] || 0) + 1; continue; }
    pairs.push({ predicted: result.bodyFatPercent, actual: person.bodyFatPercent, person });
  }
  const metricsFor = rows => {
    if (!rows.length) return { n: 0 };
    const errors = rows.map(r => r.predicted - r.actual);
    const mp = meanOf(rows.map(r => r.predicted)), ma = meanOf(rows.map(r => r.actual));
    let cov = 0, varr = 0;
    for (const r of rows) { cov += (r.predicted - mp) * (r.actual - ma); varr += (r.predicted - mp) ** 2; }
    return { n: rows.length, bias: meanOf(errors), mae: meanOf(errors.map(Math.abs)),
      rmse: Math.sqrt(meanOf(errors.map(e => e ** 2))), maxAbsError: Math.max(...errors.map(Math.abs)),
      calibrationSlope: varr ? cov / varr : null, calibrationIntercept: varr ? ma - (cov / varr) * mp : null };
  };
  const overall = metricsFor(pairs);
  overall.refused = refused;
  overall.refusalRate = refused / holdoutCohort.total;

  console.log('HOLDOUT — ' + artifact.id + ' ' + artifact.version);
  console.log('  n                    ' + overall.n);
  console.log('  refused              ' + refused + '  (' + (100 * overall.refusalRate).toFixed(1) + '%)  ' + JSON.stringify(refusalReasons));
  console.log('  signed bias          ' + fixed(overall.bias));
  console.log('  MAE                  ' + fixed(overall.mae));
  console.log('  RMSE                 ' + fixed(overall.rmse));
  console.log('  max absolute error   ' + fixed(overall.maxAbsError, 2));
  console.log('  calibration slope    ' + fixed(overall.calibrationSlope));
  console.log('  calibration intercept ' + fixed(overall.calibrationIntercept));

  console.log('\n  baselines on the same holdout:');
  const baselineScores = {};
  for (const { name, model } of baselines) {
    const rows = [];
    for (const person of holdoutCohort.participants) {
      const predicted = B.predict(model, person);
      if (predicted == null || !Number.isFinite(person.bodyFatPercent)) continue;
      rows.push({ predicted, actual: person.bodyFatPercent });
    }
    const m = metricsFor(rows);
    baselineScores[name] = { n: m.n, mae: m.mae, bias: m.bias };
    console.log('    ' + name.padEnd(34) + 'n ' + String(m.n).padStart(5) + '   MAE ' + fixed(m.mae));
  }

  // --- subgroups ---------------------------------------------------------------------------
  const breakdowns = {
    ageBand: p => B.AGE_BAND_OF(p.ageYears),
    sex: p => (p.sexMale === 1 ? 'male' : 'female'),
    bmiBand: p => B.BMI_BAND_OF(p.bmi),
    raceEthnicityAudit: p => (p.raceEthnicity == null ? null : 'RIDRETH1=' + p.raceEthnicity),
  };
  const subgroups = {};
  console.log('\n  subgroups (MAE ceiling 1.25x overall; bias limit ±1.0):');
  for (const [label, keyOf] of Object.entries(breakdowns)) {
    subgroups[label] = {};
    console.log('    ' + label + ':');
    const groups = new Map();
    for (const pair of pairs) {
      const key = keyOf(pair.person);
      if (key == null) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(pair);
    }
    for (const [key, rows] of [...groups].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
      if (rows.length < 100) {
        subgroups[label][key] = { n: rows.length, insufficient: true };
        console.log('      ' + key.padEnd(26) + String(rows.length).padStart(5) + '   insufficient to report');
        continue;
      }
      const m = metricsFor(rows);
      const ratio = m.mae / overall.mae;
      subgroups[label][key] = { n: m.n, mae: m.mae, bias: m.bias, maeRatio: ratio, insufficient: false };
      console.log('      ' + key.padEnd(26) + String(m.n).padStart(5) + '   MAE ' + fixed(m.mae)
        + '   x' + fixed(ratio, 2) + '   bias ' + fixed(m.bias)
        + (ratio > 1.25 ? '  MAE OVER' : '') + (Math.abs(m.bias) > 1.0 ? '  BIAS OVER' : ''));
    }
  }

  // --- the criteria, checked rather than judged ---------------------------------------------
  const reported = Object.values(subgroups).flatMap(g => Object.entries(g)).filter(([, m]) => !m.insufficient);
  const worstMaeRatio = Math.max(...reported.map(([, m]) => m.maeRatio));
  const worstBias = Math.max(...reported.map(([, m]) => Math.abs(m.bias)));
  const bestBaselineMae = Math.min(...Object.values(baselineScores).map(b => b.mae));

  const criteria = [
    { id: 'mae', label: 'Holdout MAE ≤ 3.5', value: overall.mae, pass: overall.mae <= 3.5 },
    { id: 'bias', label: 'Holdout signed bias within ±1.0', value: overall.bias, pass: Math.abs(overall.bias) <= 1.0 },
    { id: 'slope', label: 'Calibration slope 0.85–1.15', value: overall.calibrationSlope, pass: overall.calibrationSlope >= 0.85 && overall.calibrationSlope <= 1.15 },
    { id: 'beats_baselines', label: 'Beats every baseline on holdout MAE', value: overall.mae + ' vs best baseline ' + fixed(bestBaselineMae), pass: overall.mae < bestBaselineMae },
    { id: 'subgroup_mae', label: 'Worst subgroup MAE ≤ 1.25× overall', value: worstMaeRatio, pass: worstMaeRatio <= 1.25 },
    { id: 'subgroup_bias', label: 'Each subgroup bias within ±1.0 (amendment 4)', value: worstBias, pass: worstBias <= 1.0 },
  ];

  console.log('\nRELEASE CRITERIA');
  for (const c of criteria) {
    console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + c.label.padEnd(46) + (typeof c.value === 'number' ? fixed(c.value) : c.value));
  }
  const allPass = criteria.every(c => c.pass);
  console.log('\n  ' + (allPass ? 'Every automated criterion passes.' : 'At least one criterion fails.'));
  console.log('  OUTSTANDING, and not satisfiable by this tool: §8 requires a statistician or qualified');
  console.log('  research reviewer to approve the thresholds and sample adequacy before release.');
  console.log('  Until that happens the decision below is "criteria met, review pending", never "released".');

  const decision = allPass ? 'criteria_met_review_pending' : 'not_released';
  console.log('\n  DECISION: ' + decision.toUpperCase().replace(/_/g, ' '));

  // --- write it into the artifact, whatever it says ------------------------------------------
  artifact.holdoutRead = true;
  artifact.holdoutReport = {
    readAt: new Date().toISOString(),
    cycle: HOLDOUT_CYCLE,
    cohort: holdoutCohort.total,
    overall, refusalReasons, subgroups, baselines: baselineScores,
    criteria: criteria.map(c => ({ id: c.id, label: c.label, value: c.value, pass: c.pass })),
    statisticianReview: { required: true, completed: false,
      note: 'Not satisfiable by this tool. §8 requires a qualified reviewer to approve thresholds and sample adequacy.' },
  };
  artifact.releaseDecision = decision;
  artifact.status = decision === 'not_released' ? 'not_released' : 'candidate';

  const canonicalize = value => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
      return out;
    }
    return value;
  };
  const canonical = JSON.stringify(canonicalize(artifact), null, 2) + '\n';
  const newDigest = crypto.createHash('sha256').update(canonical.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
  fs.writeFileSync(ARTIFACT, canonical, 'utf8');
  fs.writeFileSync(CHECKSUM, newDigest + '  bodyfat-candidate-v0.1.0.json\n', 'utf8');
  fs.writeFileSync(path.join(MODEL_DIR, 'holdout-report.json'), JSON.stringify(artifact.holdoutReport, null, 2) + '\n', 'utf8');

  console.log('\nRecorded in the artifact. holdoutRead is now true and this tool will not run again.');
  console.log('  new sha-256 ' + newDigest);
})();
