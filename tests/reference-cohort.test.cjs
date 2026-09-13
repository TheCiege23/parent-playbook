const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

// A cohort fixture. The distribution numbers are invented for arithmetic testing; the shape and
// the provenance requirements are the real subject. No published dataset is reproduced here.
const cohort = (overrides = {}) => ({
  schema: 'PP_REFERENCE_COHORT_V1',
  cohortId: 'synthetic-cohort-001',
  source: {
    name: 'Synthetic Reference Set', citation: 'Invented for tests. Not a real publication.',
    url: 'https://example.invalid/synthetic', version: '1.0', retrievedAt: '2026-09-10', license: 'n/a',
  },
  population: {
    description: 'Synthetic subjects invented for arithmetic testing.', country: 'n/a',
    yearsCollected: '2026', sex: 'both', ageRange: { minMonths: 24, maxMonths: 240 }, sampleSize: 1000,
  },
  method: 'tape',
  metrics: [{
    key: 'synthetic_length_in', unit: 'in', definition: 'Invented metric for testing.',
    // The default fixture is the honest default: not usable.
    equivalence: { status: 'not_established', note: 'Definitional equivalence has not been established.' },
    distribution: { type: 'mean_sd', mean: 60, sd: 5 },
  }],
  limitations: 'Synthetic fixture. Establishes arithmetic and refusal behaviour only.',
  ...overrides,
});

const established = (extra = {}) => ({
  status: 'established',
  comparedTo: 'Synthetic tape protocol A',
  evidence: 'Invented agreement study, n=40, for test purposes only.',
  ...extra,
});

test('a cohort requires full provenance before it can be validated', async () => {
  const { validateReferenceCohort } = await import('../js/reference-cohort.mjs');
  assert.equal(validateReferenceCohort(cohort()).cohortId, 'synthetic-cohort-001');
  // Every one of these is something a reviewer would need to audit the cohort later.
  for (const [field, mutate] of [
    ['source', c => { delete c.source; }],
    ['source.citation', c => { delete c.source.citation; }],
    ['source.url', c => { delete c.source.url; }],
    ['source.version', c => { delete c.source.version; }],
    ['source.license', c => { delete c.source.license; }],
    ['population.sampleSize', c => { delete c.population.sampleSize; }],
    ['population.ageRange', c => { delete c.population.ageRange; }],
    ['population.description', c => { delete c.population.description; }],
    ['method', c => { delete c.method; }],
    ['limitations', c => { delete c.limitations; }],
  ]) {
    const bad = cohort(); mutate(bad);
    assert.throws(() => validateReferenceCohort(bad), error => error.name === 'ReferenceCohortError', 'missing ' + field);
  }
  // And nothing undeclared may ride along.
  const extra = cohort(); extra.notes = 'x';
  assert.throws(() => validateReferenceCohort(extra), { code: 'UNKNOWN_COHORT_FIELD' });
  const badMethod = cohort({ method: 'eyeball' });
  assert.throws(() => validateReferenceCohort(badMethod), { code: 'INVALID_COHORT' });
  const badSex = cohort(); badSex.population.sex = 'any';
  assert.throws(() => validateReferenceCohort(badSex), { code: 'INVALID_COHORT' });
});

test('an equivalence claim without evidence is refused', async () => {
  const { validateReferenceCohort } = await import('../js/reference-cohort.mjs');
  // "established" on its own is an assertion. This gate exists to refuse assertions.
  for (const claim of [
    { status: 'established' },
    { status: 'established', comparedTo: 'something' },
    { status: 'established', evidence: 'a study' },
    { status: 'probably_fine' },
  ]) {
    const bad = cohort(); bad.metrics[0].equivalence = claim;
    assert.throws(() => validateReferenceCohort(bad), error => error.name === 'ReferenceCohortError', JSON.stringify(claim));
  }
  const good = cohort(); good.metrics[0].equivalence = established();
  assert.equal(validateReferenceCohort(good).metrics[0].equivalence.status, 'established');
});

test('a metric without established equivalence yields no percentile, only a refusal', async () => {
  const { validateReferenceCohort, referencePercentile, usableMetrics } = await import('../js/reference-cohort.mjs');
  const c = validateReferenceCohort(cohort());
  assert.deepEqual(usableMetrics(c), []);
  // This is the whole point of the module: a confident number is worse than no number.
  assert.throws(() => referencePercentile(c, { metricKey: 'synthetic_length_in', value: 65, unit: 'in' }),
    { code: 'EQUIVALENCE_NOT_ESTABLISHED' });

  const usable = cohort(); usable.metrics[0].equivalence = established();
  const ready = validateReferenceCohort(usable);
  assert.deepEqual(usableMetrics(ready), ['synthetic_length_in']);
  assert.equal(referencePercentile(ready, { metricKey: 'synthetic_length_in', value: 60, unit: 'in', ageMonths: 120 }).percentile.toFixed(4), '50.0000');
});

test('mean/SD z-scores match values computable by hand', async () => {
  const { validateReferenceCohort, referencePercentile } = await import('../js/reference-cohort.mjs');
  const c = cohort(); c.metrics[0].equivalence = established();
  const ready = validateReferenceCohort(c);
  const at = value => referencePercentile(ready, { metricKey: 'synthetic_length_in', value, unit: 'in', ageMonths: 120 });
  // mean 60, sd 5 — so these z-scores are arithmetic, not approximation.
  assert.equal(at(60).z, 0);
  assert.equal(at(65).z, 1);
  assert.equal(at(50).z, -2);
  assert.equal(at(72.5).z, 2.5);
});

test('the normal CDF matches published standard-normal values', async () => {
  const { _normalCdf } = await import('../js/reference-cohort.mjs');
  // Textbook values. If this approximation is ever swapped, these must still hold.
  const expected = [
    [0, 0.5], [1, 0.8413447], [-1, 0.1586553], [1.959964, 0.975], [-1.959964, 0.025],
    [2.5758293, 0.995], [1.8807936, 0.97], [-1.8807936, 0.03], [3, 0.9986501],
  ];
  for (const [z, p] of expected) {
    assert.ok(Math.abs(_normalCdf(z) - p) < 2e-6, 'z=' + z + ' gave ' + _normalCdf(z) + ', expected ' + p);
  }
});

test('the LMS z-score reproduces the CDC formula, including the L=0 limit', async () => {
  const { validateReferenceCohort, referencePercentile } = await import('../js/reference-cohort.mjs');
  const lmsCohort = (L) => {
    const c = cohort();
    c.metrics[0].equivalence = established();
    // Flat table so interpolation cannot mask an error in the formula itself.
    c.metrics[0].distribution = { type: 'lms', rows: [[24, L, 100, 0.05], [240, L, 100, 0.05]] };
    return validateReferenceCohort(c);
  };
  const z = (L, value) => referencePercentile(lmsCohort(L), { metricKey: 'synthetic_length_in', value, unit: 'in', ageMonths: 120 }).z;

  // L=1 reduces to (X/M - 1)/S, so X=105 with M=100, S=0.05 must give exactly 1.
  assert.ok(Math.abs(z(1, 105) - 1) < 1e-12, 'L=1 gave ' + z(1, 105));
  assert.ok(Math.abs(z(1, 95) + 1) < 1e-12);
  // L=0 is the log limit: ln(X/M)/S.
  assert.ok(Math.abs(z(0, 110) - Math.log(1.1) / 0.05) < 1e-12, 'L=0 gave ' + z(0, 110));
  // A general L, computed independently here from CDC's published formula.
  const L = -1.5, X = 108;
  assert.ok(Math.abs(z(L, X) - ((Math.pow(X / 100, L) - 1) / (L * 0.05))) < 1e-12);
  // The median is z=0 at every L.
  for (const each of [-2, -1, 0, 0.5, 1, 2]) assert.ok(Math.abs(z(each, 100)) < 1e-12, 'median at L=' + each);
});

test('this module agrees with the already-verified CDC stature implementation', async () => {
  const { validateReferenceCohort, referencePercentile } = await import('../js/reference-cohort.mjs');
  // cdc-stature.js was checked against CDC's own published P3/P50/P97 columns across all 436
  // rows. Reproducing one of its LMS rows here and getting the same z is a cross-check against
  // an independently verified implementation, not against itself.
  const source = fs.readFileSync(path.join(__dirname, '../js/cdc-stature.js'), 'utf8');
  const row = source.match(/\[(\d+\.\d+),(-?\d+\.\d+),(\d+\.\d+),(\d+\.\d+)\]/);
  assert.ok(row, 'could not read an LMS row from cdc-stature.js');
  const [, ageMonths, L, M, S] = row.map(Number);

  const c = cohort();
  c.metrics[0].equivalence = established();
  c.metrics[0].unit = 'cm';
  c.metrics[0].distribution = { type: 'lms', rows: [[ageMonths, L, M, S], [ageMonths + 120, L, M, S]] };
  c.population.ageRange = { minMonths: ageMonths, maxMonths: ageMonths + 120 };
  const ready = validateReferenceCohort(c);

  const heightCm = M * 1.05;
  const mine = referencePercentile(ready, { metricKey: 'synthetic_length_in', value: heightCm, unit: 'cm', ageMonths }).z;
  const cdc = (Math.pow(heightCm / M, L) - 1) / (L * S);   // CDC's formula, applied directly
  assert.ok(Math.abs(mine - cdc) < 1e-12, 'mine ' + mine + ' vs CDC ' + cdc);
  // And the median of that row is the 50th percentile.
  assert.equal(referencePercentile(ready, { metricKey: 'synthetic_length_in', value: M, unit: 'cm', ageMonths }).percentile.toFixed(4), '50.0000');
});

test('a subject the cohort does not represent gets a refusal, not an extrapolation', async () => {
  const { validateReferenceCohort, referencePercentile } = await import('../js/reference-cohort.mjs');
  const c = cohort();
  c.metrics[0].equivalence = established();
  c.metrics[0].distribution = { type: 'lms', rows: [[24, 1, 100, 0.05], [240, 1, 140, 0.05]] };
  const ready = validateReferenceCohort(c);
  const ask = extra => referencePercentile(ready, { metricKey: 'synthetic_length_in', value: 120, unit: 'in', ...extra });

  // Extrapolating past a reference's own range is how you say something confident and wrong.
  assert.throws(() => ask({ ageMonths: 12 }), { code: 'AGE_OUT_OF_RANGE' });
  assert.throws(() => ask({ ageMonths: 300 }), { code: 'AGE_OUT_OF_RANGE' });
  assert.throws(() => ask({}), { code: 'AGE_REQUIRED' });
  assert.throws(() => ask({ ageMonths: 120, unit: 'cm' }), { code: 'UNIT_MISMATCH' });
  assert.throws(() => referencePercentile(ready, { metricKey: 'nope', value: 1, unit: 'in', ageMonths: 120 }), { code: 'METRIC_NOT_IN_COHORT' });
  for (const bad of [0, -5, NaN, Infinity, '60']) {
    assert.throws(() => ask({ ageMonths: 120, value: bad }), { code: 'INVALID_MEASUREMENT' }, String(bad));
  }
  // An adult-only cohort must refuse a female subject rather than quietly answering.
  const maleOnly = cohort();
  maleOnly.metrics[0].equivalence = established();
  maleOnly.population.sex = 'male';
  const m = validateReferenceCohort(maleOnly);
  assert.throws(() => referencePercentile(m, { metricKey: 'synthetic_length_in', value: 60, unit: 'in', sex: 'female', ageMonths: 120 }), { code: 'SEX_NOT_COVERED' });
  assert.ok(referencePercentile(m, { metricKey: 'synthetic_length_in', value: 60, unit: 'in', sex: 'male', ageMonths: 120 }).percentile > 0);
});

test('a mean/SD cohort refuses a subject outside its age range, as an age-varying one does', async () => {
  const { validateReferenceCohort, referencePercentile } = await import('../js/reference-cohort.mjs');
  const adults = cohort();
  adults.metrics[0].equivalence = established();
  adults.population.ageRange = { minMonths: 240, maxMonths: 960 };
  const ready = validateReferenceCohort(adults);
  const ask = extra => referencePercentile(ready, { metricKey: 'synthetic_length_in', value: 60, unit: 'in', ...extra });

  // A mean/SD distribution used to skip the age check entirely, so an adult reference answered for a child.
  assert.throws(() => ask({ ageMonths: 120 }), { code: 'AGE_OUT_OF_RANGE' });
  assert.throws(() => ask({ ageMonths: 961 }), { code: 'AGE_OUT_OF_RANGE' });
  // And leaving the age out is not a way around it.
  assert.throws(() => ask({}), { code: 'AGE_REQUIRED' });
  assert.throws(() => ask({ ageMonths: NaN }), { code: 'AGE_REQUIRED' });
  assert.equal(ask({ ageMonths: 240 }).z, 0, 'the lower bound is inside the range');
  assert.equal(ask({ ageMonths: 960 }).z, 0, 'and so is the upper');
});

test('a percentile carries the provenance needed to judge it', async () => {
  const { validateReferenceCohort, referencePercentile } = await import('../js/reference-cohort.mjs');
  const c = cohort();
  c.metrics[0].equivalence = established({ maxAbsoluteBias: 0.4, unit: 'in' });
  const result = referencePercentile(validateReferenceCohort(c), { metricKey: 'synthetic_length_in', value: 65, unit: 'in', ageMonths: 120 });
  // A number without its cohort is unreadable six months later.
  assert.equal(result.cohortId, 'synthetic-cohort-001');
  assert.equal(result.source.citation, 'Invented for tests. Not a real publication.');
  assert.equal(result.population.sampleSize, 1000);
  assert.equal(result.method, 'tape');
  assert.equal(result.equivalence.maxAbsoluteBias, 0.4);
  assert.match(result.limitations, /Not a diagnosis, not a prediction/);
  assert.match(result.limitations, /only meaningful for a subject the cohort actually represents/);
});

test('no reference cohort ships, and the reason is written down', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../REFERENCE-COHORTS.md'), 'utf8');
  // The repository must not quietly acquire a cohort without the equivalence work.
  const cohortFiles = fs.readdirSync(path.join(__dirname, '..', 'js')).filter(n => /cohort.*\.json$/i.test(n));
  assert.deepEqual(cohortFiles, [], 'a cohort data file appeared without an equivalence study');
  assert.match(doc, /ANSUR II/);
  assert.match(doc, /definitional equivalence/i);
  assert.match(doc, /no cohort is loaded/i);
});

test('the loaded-cohort registry cannot acquire a percentile nobody earned', async () => {
  const { validateReferenceCohort } = await import('../js/reference-cohort.mjs');
  const source = fs.readFileSync(path.join(__dirname, '../js/reference-cohorts.js'), 'utf8');
  // Evaluate the registry the way the browser does: a classic script, no imports.
  const scope = {};
  new Function(source + ';this.REFERENCE_COHORTS=REFERENCE_COHORTS;this.summary=referenceCohortSummary;this.forMetric=referenceCohortForMetric;').call(scope);

  // The honest current state.
  assert.deepEqual(scope.REFERENCE_COHORTS, [], 'a cohort appeared in the registry');
  const summary = scope.summary();
  assert.equal(summary.loaded, 0);
  assert.deepEqual(summary.usableMetrics, []);
  assert.match(summary.reason, /have not been shown to measure the same thing/);
  assert.equal(scope.forMetric('wingspan'), null);

  // If a cohort is ever added, it must satisfy the contract, and only metrics whose equivalence
  // was actually established may surface. This is the guard that makes the registry safe to edit.
  for (const cohort of scope.REFERENCE_COHORTS) {
    const validated = validateReferenceCohort(cohort);
    for (const metric of validated.metrics) {
      if (metric.equivalence.status !== 'established') {
        assert.equal(scope.forMetric(metric.key), null, metric.key + ' surfaced without established equivalence');
      } else {
        assert.ok(metric.equivalence.evidence, metric.key + ' claims equivalence with no evidence');
        assert.ok(metric.equivalence.comparedTo, metric.key + ' claims equivalence against nothing');
      }
    }
  }
});

test('Body Insights shows the missing reference instead of hiding it', () => {
  const insights = fs.readFileSync(path.join(__dirname, '../js/body-insights.js'), 'utf8');
  // The page must read the registry rather than hard-coding a state that can go stale.
  assert.match(insights, /referenceCohortSummary/);
  assert.match(insights, /refSummary/);
  // Guarded like staturePercentile, so a missing registry script degrades instead of throwing.
  assert.match(insights, /typeof referenceCohortSummary==='function'/);
  // The explanation renders with the body measurements, and the card renders in growth context.
  assert.match(insights, /bi-no-reference/);
  assert.match(insights, /Population reference/);
  // It must never invent a number: the card shows a count of referenced metrics, or an em dash.
  assert.match(insights, /refSummary&&refSummary\.usableMetrics\.length\?refSummary\.usableMetrics\.length:'—'/);

  // The registry is loaded before the page that reads it, and cached for offline.
  assert.match(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'),
    /reference-cohorts\.js"><\/script>\s*<script src="\/js\/body-outputs\.js/);
  assert.match(fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8'), /'\/js\/reference-cohorts\.js'/);
});
