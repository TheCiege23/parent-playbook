// The baselines, and the evaluation that judges everything after them.
//
// These exist to be beaten. The tests that matter here are the ones that would let a later model
// look better than it is: a fit that silently uses a feature it should not have, a prediction that
// substitutes a population mean for a missing input, and a metric that hides a systematic error.
//
// Fixtures are synthetic and generated from a known relationship, so the fit has a right answer to
// be checked against rather than a plausible one to be admired.
const test = require('node:test');
const assert = require('node:assert/strict');

let B, C;
test.before(async () => {
  B = await import('../tools/nhanes/baselines.mjs');
  C = await import('../tools/nhanes/cohort.mjs');
});

// A deterministic pseudo-random source: the same fixture on every machine and every run.
function generator(seed = 12345) {
  let state = seed;
  return () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state / 4294967296; };
}

// Body fat built from a known formula, so the fit can be checked against the truth.
//   bodyFat = 12 + 0.30 * bmi + 0.12 * age - 11 * sexMale + noise
function synthetic(n, { noise = 0.5, seed = 7 } = {}) {
  const random = generator(seed);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const sexMale = random() < 0.5 ? 1 : 0;
    const ageYears = 18 + Math.floor(random() * 42);
    const heightCm = (sexMale ? 176 : 163) + (random() - 0.5) * 16;
    const weightKg = (sexMale ? 84 : 71) + (random() - 0.5) * 30;
    const bmi = weightKg / (heightCm / 100) ** 2;
    const bodyFatPercent = 12 + 0.30 * bmi + 0.12 * ageYears - 11 * sexMale + (random() - 0.5) * noise;
    rows.push({ seqn: 1000 + i, ageYears, sexMale, heightCm, weightKg,
      waistCm: 70 + bmi * 1.1, bmi, bodyFatPercent,
      fatMassKg: weightKg * bodyFatPercent / 100, leanMassKg: weightKg * (1 - bodyFatPercent / 100),
      totalMassKg: weightKg, raceEthnicity: 1 + (i % 5), cycle: '2013-2014', split: 'train' });
  }
  return rows;
}

const rejects = (fn, code) => {
  try { fn(); assert.fail('expected rejection ' + code); }
  catch (error) { assert.equal(error.code, code, 'message was: ' + error.message); return error; }
};

// ----------------------------------------------------------------- the fit has a right answer
test('the linear fit recovers a known relationship', () => {
  // Not "the fit produced plausible coefficients" — the data was built from a formula and the fit
  // has to find it. A regression that is only ever checked against real data can be wrong in a way
  // that looks like the data being noisy.
  const rows = synthetic(3000, { noise: 0.01 });
  const model = B.fitLinear(rows, ['bmi', 'ageYears', 'sexMale'], 'bodyFatPercent', 'bmi_regression');
  assert.ok(Math.abs(model.coefficients.bmi - 0.30) < 0.01, 'bmi coefficient ' + model.coefficients.bmi);
  assert.ok(Math.abs(model.coefficients.ageYears - 0.12) < 0.01, 'age coefficient ' + model.coefficients.ageYears);
  assert.ok(Math.abs(model.coefficients.sexMale + 11) < 0.05, 'sex coefficient ' + model.coefficients.sexMale);
  assert.ok(Math.abs(model.intercept - 12) < 0.2, 'intercept ' + model.intercept);
});

test('centring matters: an uncentred fit on these scales would be the wrong kind of right', () => {
  // Height in centimetres and weight in kilograms sit far from zero. The fit still has to land on
  // the truth with all four features present.
  const rows = synthetic(3000, { noise: 0.01 });
  const model = B.fitLinear(rows, ['ageYears', 'sexMale', 'heightCm', 'weightKg'], 'bodyFatPercent', 'linear');
  const predictions = rows.slice(0, 200).map(row => B.predict(model, row) - row.bodyFatPercent);
  const maxError = Math.max(...predictions.map(Math.abs));
  assert.ok(maxError < 0.6, 'largest error on the fitted data was ' + maxError.toFixed(3));
});

test('a collinear feature is refused, not given a coefficient that depends on rounding', () => {
  const rows = synthetic(500).map(row => ({ ...row, weightKgAgain: row.weightKg }));
  const error = rejects(() => B.fitLinear(rows, ['weightKg', 'weightKgAgain'], 'bodyFatPercent'), 'SINGULAR_DESIGN');
  assert.match(error.message, /not identified/);
});

test('too few rows to identify the features is refused', () => {
  rejects(() => B.fitLinear(synthetic(3), ['ageYears', 'sexMale', 'heightCm'], 'bodyFatPercent'), 'TOO_FEW_ROWS');
});

// ----------------------------------------------------------------- the race rule, structurally
test('a model fitted on the model-ready export cannot use race, because it never receives it', () => {
  // The point is not that the fit ignores race. It is that the rows it is given do not contain it,
  // so there is nothing to ignore and nothing to accidentally include later.
  const participants = synthetic(500);
  const modelReady = C.modelReadyExport(participants);
  assert.ok(!('raceEthnicity' in modelReady[0]));
  assert.ok(!('seqn' in modelReady[0]));

  const model = B.fitLinear(modelReady, ['ageYears', 'sexMale', 'heightCm', 'weightKg'], 'bodyFatPercent');
  assert.deepEqual([...model.features], ['ageYears', 'sexMale', 'heightCm', 'weightKg']);
  assert.ok(!Object.keys(model.coefficients).some(key => /race|seqn|sdmv|wtmec/i.test(key)));

  // And the subgroup report is still possible, because the PARTICIPANTS carry what the model did not.
  const bySubgroup = B.subgroupMetrics(model, participants, row => row.raceEthnicity, { minimumForReporting: 1 });
  assert.equal(Object.keys(bySubgroup).length, 5);
});

// ----------------------------------------------------------------- refusal
test('a missing input produces no estimate, never a substitute', () => {
  // The alternative puts a number in front of someone whose measurements were never taken, and
  // nothing downstream can tell it from a real one.
  const model = B.fitLinear(synthetic(500), ['ageYears', 'sexMale', 'heightCm', 'weightKg'], 'bodyFatPercent');
  assert.equal(B.predict(model, { ageYears: 40, sexMale: 1, heightCm: 175, weightKg: null }), null);
  assert.equal(B.predict(model, { ageYears: 40, sexMale: 1, heightCm: 175 }), null);
  assert.ok(Number.isFinite(B.predict(model, { ageYears: 40, sexMale: 1, heightCm: 175, weightKg: 80 })));
});

test('the band baseline refuses an age it has no band for, rather than reaching for the nearest', () => {
  const model = B.fitMeanByBand(synthetic(500));
  assert.equal(B.predict(model, { ageYears: 65, sexMale: 1 }), null, '65 is outside the supported population');
  assert.equal(B.predict(model, { ageYears: 12, sexMale: 1 }), null);
  assert.ok(Number.isFinite(B.predict(model, { ageYears: 35, sexMale: 1 })));
});

test('refusals are counted and reported, not dropped', () => {
  const rows = synthetic(200);
  const model = B.fitLinear(rows, ['ageYears', 'sexMale', 'heightCm', 'weightKg'], 'bodyFatPercent');
  const withGaps = [...rows.slice(0, 100), ...rows.slice(100).map(row => ({ ...row, weightKg: null }))];
  const metrics = B.evaluate(model, withGaps);
  assert.equal(metrics.n, 100);
  assert.equal(metrics.refused, 100);
  assert.equal(metrics.refusalRate, 0.5);
});

// ----------------------------------------------------------------- the metrics
test('signed bias catches a systematic error that MAE alone would hide', () => {
  const rows = synthetic(500, { noise: 0.01 });
  const honest = B.fitLinear(rows, ['bmi', 'ageYears', 'sexMale'], 'bodyFatPercent');
  const shifted = { ...honest, intercept: honest.intercept + 3 };
  const a = B.evaluate(honest, rows), b = B.evaluate(shifted, rows);
  assert.ok(Math.abs(a.bias) < 0.05, 'the honest model has no systematic offset');
  assert.ok(Math.abs(b.bias - 3) < 0.05, 'the shifted one is three points high, every time');
  // And bias is what shows it: the shifted model is worse on MAE too, but bias says which direction.
  assert.ok(b.mae > a.mae);
});

test('calibration slope catches over-confidence that bias and MAE both miss', () => {
  // A model whose predictions are too spread out is wrong about who is extreme. Its mean error can
  // be zero and its MAE unremarkable while it systematically exaggerates at both ends.
  const rows = synthetic(2000, { noise: 0.01 });
  const model = B.fitLinear(rows, ['bmi', 'ageYears', 'sexMale'], 'bodyFatPercent');
  const centre = 12 + 0.30 * 26 + 0.12 * 39 - 11 * 0.5;
  const overconfident = rows.map(row => ({ ...row,
    bodyFatPercent: centre + (row.bodyFatPercent - centre) / 1.5 }));
  const metrics = B.evaluate(model, overconfident);
  assert.ok(Math.abs(metrics.bias) < 0.6, 'bias is small: ' + metrics.bias.toFixed(3));
  assert.ok(metrics.calibrationSlope < 0.8,
    'the slope should reveal the exaggeration; got ' + metrics.calibrationSlope.toFixed(3));
});

test('a perfect model reports a slope of one and no bias', () => {
  const rows = synthetic(500, { noise: 0 });
  const model = B.fitLinear(rows, ['bmi', 'ageYears', 'sexMale'], 'bodyFatPercent');
  const metrics = B.evaluate(model, rows);
  assert.ok(Math.abs(metrics.calibrationSlope - 1) < 0.01);
  assert.ok(Math.abs(metrics.bias) < 0.01);
  assert.ok(metrics.mae < 0.01);
});

// ----------------------------------------------------------------- subgroups
test('a subgroup below the reporting floor is reported as insufficient, not summarized', () => {
  // §8: a small subgroup gets a stated absence rather than a number nobody should read.
  const rows = synthetic(400);
  const model = B.fitLinear(rows, ['bmi', 'ageYears', 'sexMale'], 'bodyFatPercent');
  const tagged = rows.map((row, i) => ({ ...row, tinyGroup: i < 20 ? 'rare' : 'common' }));
  const groups = B.subgroupMetrics(model, tagged, row => row.tinyGroup, { minimumForReporting: 100 });
  assert.equal(groups.rare.insufficient, true);
  assert.equal(groups.rare.n, 20);
  assert.equal(groups.rare.mae, undefined, 'an insufficient subgroup must not carry a number to quote');
  assert.match(groups.rare.note, /insufficient rather than summarized/);
  assert.equal(groups.common.insufficient, false);
  assert.ok(Number.isFinite(groups.common.mae));
});

test('subgroups are keyed by the bands the preregistration names', () => {
  assert.equal(B.AGE_BAND_OF(18), '18-29');
  assert.equal(B.AGE_BAND_OF(59), '50-59');
  assert.equal(B.AGE_BAND_OF(60), null, 'outside the supported population');
  assert.equal(B.BMI_BAND_OF(17), 'under 18.5');
  assert.equal(B.BMI_BAND_OF(24.9), '18.5-24.9');
  assert.equal(B.BMI_BAND_OF(31), '30.0-34.9');
  assert.equal(B.BMI_BAND_OF(null), null);
});

// ----------------------------------------------------------------- the band baseline
test('the band baseline is a real baseline, not a constant', () => {
  const rows = synthetic(2000);
  const model = B.fitMeanByBand(rows);
  // Men and women in the same band differ by about the 11 points the fixture built in.
  const male = model.means['30-39|1'], female = model.means['30-39|0'];
  assert.ok(female - male > 8 && female - male < 14, 'band means should reflect the sex difference');
  assert.ok(Object.keys(model.groupCounts).length >= 6);
});

test('a linear model beats the band baseline on the same data, which is the point of having it', () => {
  const rows = synthetic(2000);
  const band = B.fitMeanByBand(rows);
  const linear = B.fitLinear(rows, ['bmi', 'ageYears', 'sexMale'], 'bodyFatPercent');
  const bandMae = B.evaluate(band, rows).mae, linearMae = B.evaluate(linear, rows).mae;
  assert.ok(linearMae < bandMae,
    'the linear model (' + linearMae.toFixed(2) + ') should beat the band mean (' + bandMae.toFixed(2) + ')');
});

// ----------------------------------------------------------------- the record
test('the baseline results are recorded, including the one that fails a criterion', () => {
  const fs = require('node:fs'), path = require('node:path');
  const doc = fs.readFileSync(path.join(__dirname, '..', 'research', 'NHANES-BASELINES.md'), 'utf8');
  const flat = doc.replace(/\s+/g, ' ');
  // The bar a candidate model has to clear is the best BASELINE, not the release threshold.
  assert.match(doc, /2\.987/);
  assert.match(flat, /has to beat \*\*2\.987\*\*, not 3\.5/);
  // The finding: precise for everyone, not equally right for everyone.
  assert.match(flat, /MAE is uniform and bias is not/);
  assert.match(doc, /−1\.211|-1\.211/);
  assert.match(doc, /1\.427/);
  // And that narrowing the population cannot be the remedy here.
  assert.match(flat, /Narrowing a supported population by race/);
});

test('the preregistration carries the subgroup bias criterion, and admits when it was added', () => {
  const fs = require('node:fs'), path = require('node:path');
  const prereg = fs.readFileSync(path.join(__dirname, '..', 'research', 'NHANES-PREREGISTRATION.md'), 'utf8');
  const flat = prereg.replace(/\s+/g, ' ');
  // In the criteria table, where a release decision reads it.
  assert.match(flat, /Signed bias, each reported subgroup \| within ±1\.0 percentage point/);
  // And disclosed as after-the-fact, with the argument for why that is defensible.
  assert.match(flat, /\*\*Results existed and were known\.\*\*/);
  assert.match(flat, /it makes release strictly harder/);
  assert.match(flat, /An after-the-fact criterion can only be defended when it tightens/);
  // The amendment must not quietly become permission to use race as a feature.
  assert.match(flat, /must not become "add race as a feature"/);
});

test('every amendment says what was known when it was made', () => {
  // The whole value of this document is that its changes are legible. An amendment that does not
  // say what was known at the time is indistinguishable from one written to fit a result.
  const fs = require('node:fs'), path = require('node:path');
  const prereg = fs.readFileSync(path.join(__dirname, '..', 'research', 'NHANES-PREREGISTRATION.md'), 'utf8');
  const amendments = prereg.split(/^### \d+ — /m).slice(1);
  assert.ok(amendments.length >= 4, 'expected at least four amendments, found ' + amendments.length);
  for (const [index, body] of amendments.entries()) {
    assert.match(body, /What was known when this was made/,
      'amendment ' + (index + 1) + ' does not say what was known when it was made');
  }
});
