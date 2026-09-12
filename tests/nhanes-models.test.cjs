// The candidate models, and the derivation that turns a prediction into a composition.
//
// Every fit is checked against synthetic data built from a known relationship, so it has a right
// answer rather than a plausible one. A regression only ever checked against real data can be
// wrong in a way that looks like the data being noisy, and that is the failure that would carry
// all the way to a release report.
const test = require('node:test');
const assert = require('node:assert/strict');

let M, B, C;
test.before(async () => {
  M = await import('../tools/nhanes/models.mjs');
  B = await import('../tools/nhanes/baselines.mjs');
  C = await import('../tools/nhanes/cohort.mjs');
});

function generator(seed = 99) {
  let state = seed;
  return () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state / 4294967296; };
}

// A deliberately CURVED relationship, which a straight line cannot represent and a spline can.
//   bodyFat = 8 + 0.8 * weight - 0.004 * weight^2 + 0.1 * age - 10 * sexMale
function curved(n, { noise = 0.3, seed = 5 } = {}) {
  const random = generator(seed);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const sexMale = random() < 0.5 ? 1 : 0;
    const ageYears = 18 + Math.floor(random() * 42);
    const heightCm = (sexMale ? 176 : 163) + (random() - 0.5) * 16;
    const weightKg = 50 + random() * 70;
    const bodyFatPercent = 8 + 0.8 * weightKg - 0.004 * weightKg ** 2 + 0.1 * ageYears - 10 * sexMale + (random() - 0.5) * noise;
    rows.push({ ageYears, sexMale, heightCm, weightKg, bodyFatPercent,
      totalMassKg: weightKg, raceEthnicity: 1 + (i % 4) });
  }
  return rows;
}

const rejects = (fn, code) => {
  try { fn(); assert.fail('expected rejection ' + code); }
  catch (error) { assert.equal(error.code, code, 'message was: ' + error.message); return error; }
};
const maeOf = (model, rows, predict) => {
  const errors = rows.map(row => Math.abs(predict(model, row) - row.bodyFatPercent)).filter(Number.isFinite);
  return errors.reduce((a, b) => a + b, 0) / errors.length;
};

// ----------------------------------------------------------------- the spline basis itself
test('a restricted cubic spline is linear beyond its outer knots', () => {
  // This is what "restricted" buys, and it matters for the heaviest and lightest people in the
  // cohort: an unrestricted cubic bends sharply where there is least data and produces a
  // confident wrong number exactly where an estimate is least safe.
  const knots = [10, 20, 30, 40];
  const slopeBetween = (a, b) => M.splineBasis(b, knots).map((v, i) => (v - M.splineBasis(a, knots)[i]) / (b - a));
  const farRight = slopeBetween(60, 70), furtherRight = slopeBetween(80, 90);
  for (let i = 0; i < farRight.length; i++) {
    assert.ok(Math.abs(farRight[i] - furtherRight[i]) < 1e-9,
      'basis term ' + i + ' is still bending beyond the outer knot');
  }
});

test('knots are placed by quantile and refuse a variable with no spread', () => {
  const values = Array.from({ length: 200 }, (_, i) => i);
  const knots = M.splineKnots(values, 4);
  assert.equal(knots.length, 4);
  assert.ok(knots[0] < knots[1] && knots[1] < knots[2] && knots[2] < knots[3]);
  rejects(() => M.splineKnots(new Array(200).fill(7), 4), 'DEGENERATE_KNOTS');
  rejects(() => M.splineKnots([1, 2, 3], 4), 'TOO_FEW_VALUES');
});

// ----------------------------------------------------------------- the spline beats a line
test('the spline recovers a curve that a linear model cannot', () => {
  const rows = curved(3000, { noise: 0.05 });
  const linear = B.fitLinear(rows, ['ageYears', 'sexMale', 'heightCm', 'weightKg'], 'bodyFatPercent');
  const spline = M.fitSplineRidge(rows, { lambda: 0.1 });
  const linearMae = maeOf(linear, rows, B.predict);
  const splineMae = maeOf(spline, rows, M.predictCandidate);
  assert.ok(splineMae < linearMae / 2,
    'spline ' + splineMae.toFixed(3) + ' should be far better than linear ' + linearMae.toFixed(3) + ' on a curved truth');
  assert.ok(splineMae < 0.2, 'spline should nearly recover the curve; got ' + splineMae.toFixed(3));
});

test('ridge standardizes, so the penalty does not depend on the unit somebody recorded', () => {
  // An unstandardized ridge penalizes a coefficient on centimetres far more than the same
  // relationship in metres. The fitted predictions must not move when a unit changes.
  const rows = curved(1500, { noise: 0.2 });
  const inMetres = rows.map(row => ({ ...row, heightCm: row.heightCm / 100 }));
  const a = M.fitSplineRidge(rows, { lambda: 1 });
  const b = M.fitSplineRidge(inMetres, { lambda: 1 });
  const pa = rows.slice(0, 100).map(row => M.predictCandidate(a, row));
  const pb = inMetres.slice(0, 100).map(row => M.predictCandidate(b, row));
  for (let i = 0; i < pa.length; i++) {
    assert.ok(Math.abs(pa[i] - pb[i]) < 0.05, 'prediction moved by ' + Math.abs(pa[i] - pb[i]).toFixed(4) + ' when height changed unit');
  }
});

test('more penalty shrinks the fit toward the mean, which is what a penalty is', () => {
  const rows = curved(1500, { noise: 0.2 });
  const light = M.fitSplineRidge(rows, { lambda: 0.01 });
  const heavy = M.fitSplineRidge(rows, { lambda: 10000 });
  const spread = model => {
    const values = rows.slice(0, 300).map(row => M.predictCandidate(model, row));
    const m = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length);
  };
  assert.ok(spread(heavy) < spread(light) / 2,
    'heavy penalty spread ' + spread(heavy).toFixed(2) + ' vs light ' + spread(light).toFixed(2));
});

// ----------------------------------------------------------------- boosted trees
test('boosted trees recover a curve too, by a different route', () => {
  const rows = curved(2000, { noise: 0.05 });
  const trees = M.fitBoostedTrees(rows, { trees: 150, learningRate: 0.1, depth: 3 });
  assert.ok(maeOf(trees, rows, M.predictCandidate) < 1.0,
    'boosted MAE was ' + maeOf(trees, rows, M.predictCandidate).toFixed(3));
});

test('boosting reduces training error as trees are added, and each tree is shrunk', () => {
  const rows = curved(800, { noise: 0.2 });
  const few = M.fitBoostedTrees(rows, { trees: 5, learningRate: 0.1, depth: 2 });
  const many = M.fitBoostedTrees(rows, { trees: 200, learningRate: 0.1, depth: 2 });
  assert.ok(maeOf(many, rows, M.predictCandidate) < maeOf(few, rows, M.predictCandidate));
  assert.equal(many.trees, 200);
  assert.equal(many.learningRate, 0.1);
});

test('a leaf keeps a minimum number of participants, so no split is fitted to a handful', () => {
  const rows = curved(600, { noise: 0.5 });
  const model = M.fitBoostedTrees(rows, { trees: 10, depth: 6, minLeaf: 50 });
  const leafCounts = [];
  const walk = (node, count) => { if (node.leaf) leafCounts.push(count); else { walk(node.left, count); walk(node.right, count); } };
  // Depth 6 with minLeaf 50 on 600 rows cannot produce 64 leaves.
  walk(model.ensemble[0], 0);
  assert.ok(leafCounts.length <= 12, 'minLeaf should stop the tree splitting into fragments; got ' + leafCounts.length + ' leaves');
});

test('too few rows to boost is refused', () => {
  rejects(() => M.fitBoostedTrees(curved(10), { minLeaf: 20 }), 'TOO_FEW_ROWS');
});

// ----------------------------------------------------------------- the rules that carry over
test('every candidate refuses a missing input rather than substituting', () => {
  const rows = curved(500);
  for (const model of [M.fitSplineRidge(rows), M.fitBoostedTrees(rows, { trees: 20 })]) {
    assert.equal(M.predictCandidate(model, { ageYears: 40, sexMale: 1, heightCm: 175, weightKg: null }), null);
    assert.equal(M.predictCandidate(model, { ageYears: 40, sexMale: 1, heightCm: 175 }), null);
    assert.ok(Number.isFinite(M.predictCandidate(model, { ageYears: 40, sexMale: 1, heightCm: 175, weightKg: 80 })));
  }
});

test('a candidate fitted on the model-ready export never receives race', () => {
  const participants = curved(400).map((row, i) => ({ ...row, seqn: i, cycle: '2013-2014', split: 'train',
    waistCm: 90, bmi: 25, fatMassKg: 20, leanMassKg: 60 }));
  const modelReady = C.modelReadyExport(participants);
  assert.ok(!('raceEthnicity' in modelReady[0]));
  const spline = M.fitSplineRidge(modelReady);
  const trees = M.fitBoostedTrees(modelReady, { trees: 20 });
  for (const model of [spline, trees]) {
    assert.ok(!model.features.some(f => /race|seqn|sdmv|wtmec/i.test(f)));
  }
});

test('an unknown model kind is refused rather than guessed at', () => {
  rejects(() => M.predictCandidate({ kind: 'neural_something', features: [] }, {}), 'UNKNOWN_MODEL_KIND');
});

// ----------------------------------------------------------------- the derivation
test('a composition reconciles with total mass', () => {
  const out = M.deriveComposition(25, 80);
  assert.equal(out.ok, true);
  assert.equal(out.fatMassKg, 20);
  assert.equal(out.leanMassKg, 60);
  assert.ok(Math.abs((out.fatMassKg + out.leanMassKg) - 80) < 0.05);
});

test('an implausible prediction produces no estimate, not a clamped one', () => {
  // Clamping would produce a value that looks measured and is not, and nothing downstream could
  // tell the difference.
  for (const bad of [0.5, 80, -3]) {
    const out = M.deriveComposition(bad, 80);
    assert.equal(out.ok, false);
    assert.match(out.reason, /outside the range|positive/);
  }
  assert.match(M.deriveComposition(90, 80).reason, /would look measured and would not be/);
});

test('a missing input to the derivation produces no estimate', () => {
  assert.equal(M.deriveComposition(null, 80).ok, false);
  assert.equal(M.deriveComposition(25, null).ok, false);
  assert.equal(M.deriveComposition(25, 0).ok, false);
});

test('lean mass is named as what it is, and explicitly not as skeletal muscle', () => {
  // DXA does not resolve skeletal muscle from lean soft tissue. A conversion factor does not
  // create the measurement, and the definition travels with the number so a screen cannot relabel it.
  const out = M.deriveComposition(25, 80);
  assert.match(out.definition, /including bone mineral/);
  assert.match(out.definition, /not skeletal muscle mass/);
});

// ----------------------------------------------------------------- the record
test('the candidate results are recorded, including the correction to the baselines', () => {
  const fs = require('node:fs'), path = require('node:path');
  // Blockquote markers are stripped as well as whitespace: the correction notice is a blockquote,
  // so a hard-wrapped sentence inside it reads "... so > the sequence ..." once only spaces collapse.
  const read = n => fs.readFileSync(path.join(__dirname, '..', 'research', n), 'utf8')
    .replace(/^\s*>\s?/gm, '').replace(/\s+/g, ' ');
  const candidates = read('NHANES-CANDIDATES.md'), baselines = read('NHANES-BASELINES.md');

  // The finding: a better input, not a better model class.
  assert.match(candidates, /0\.865/);
  assert.match(candidates, /1\.718/);
  assert.match(candidates, /the fix came from \*\*a better input, not a better model\.\*\*/);
  // The correction is stated in the candidates doc AND pointed at from the page it corrects,
  // so a reader who stops at the earlier one is not left with the wrong conclusion.
  assert.match(candidates, /A correction to what I wrote in the baselines/);
  assert.match(baselines, /Later correction/);
  assert.match(baselines, /too pessimistic/);
  assert.match(baselines, /left as it was written so the sequence stays legible/);
});

test('the candidate record keeps the three reasons it is not a result', () => {
  const fs = require('node:fs'), path = require('node:path');
  const doc = fs.readFileSync(path.join(__dirname, '..', 'research', 'NHANES-CANDIDATES.md'), 'utf8').replace(/\s+/g, ' ');
  // Optimism, because calibration is the tuning partition.
  assert.match(doc, /optimistic by construction/);
  // The waist constraint, which is a product consequence and not a footnote.
  assert.match(doc, /would have to refuse anyone without a waist measurement/);
  assert.match(doc, /it is about what someone chooses to supply, not about who they are/);
  // And that the margin is thinner than the accuracy margin.
  assert.match(doc, /accuracy has margin, fairness has 0\.135/);
});
