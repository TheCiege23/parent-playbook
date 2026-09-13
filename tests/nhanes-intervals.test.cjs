// Uncertainty intervals under amendment 6.
//
// Every number here is synthetic and small enough to check by hand. The rules being guarded are
// the ones that would make an interval look better than it is without anything erroring: an index
// off by one, a residual silently dropped, a subgroup too small to report setting the width, or
// misses that all fall on one side being counted as ordinary misses.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let I;
test.before(async () => { I = await import('../tools/nhanes/intervals.mjs'); });

const rejects = (fn, code) => {
  try { fn(); assert.fail('expected rejection ' + code); }
  catch (error) { assert.equal(error.code, code, 'message was: ' + error.message); return error; }
};
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

test('the half-width is the ceil((n+1) * coverage)-th smallest residual', () => {
  // n = 9: ceil(10 * 0.9) = 9, the largest.
  assert.equal(I.conformalHalfWidth(range(1, 9)), 9);
  // n = 19: ceil(20 * 0.9) = 18.
  assert.equal(I.conformalHalfWidth(range(1, 19).reverse()), 18);
  // Order of the input does not matter, and the input is not sorted in place.
  const input = [5, 1, 4, 2, 3, 9, 8, 7, 6];
  I.conformalHalfWidth(input);
  assert.deepEqual(input, [5, 1, 4, 2, 3, 9, 8, 7, 6]);
});

test('too few residuals give an unbounded half-width, not the largest one', () => {
  // n = 5: ceil(6 * 0.9) = 6 > 5. Returning 5 would claim 90% coverage from five observations.
  assert.equal(I.conformalHalfWidth(range(1, 5)), Infinity);
});

test('a missing, non-finite or signed residual is refused rather than dropped', () => {
  rejects(() => I.conformalHalfWidth([]), 'NO_RESIDUALS');
  rejects(() => I.conformalHalfWidth([1, 2, NaN]), 'NON_FINITE_RESIDUAL');
  rejects(() => I.conformalHalfWidth([1, 2, null]), 'NON_FINITE_RESIDUAL');
  rejects(() => I.conformalHalfWidth([1, -2, 3]), 'NEGATIVE_RESIDUAL');
  rejects(() => I.conformalHalfWidth([1, 2, 3], 1), 'BAD_COVERAGE');
});

test('on exchangeable data the conformal half-width delivers its coverage', () => {
  // A deterministic generator, so this is a fixed check rather than a flaky one.
  let seed = 20260912;
  const uniform = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const normal = () => Math.sqrt(-2 * Math.log(uniform() || 1e-12)) * Math.cos(2 * Math.PI * uniform());
  const errors = Array.from({ length: 6000 }, () => 3.3 * normal());
  const halfWidth = I.conformalHalfWidth(errors.slice(0, 3000).map(Math.abs));
  const held = errors.slice(3000).map(error => ({ actual: 25 + error, interval: I.intervalFor(25, halfWidth) }));
  const summary = I.summarizeCoverage(held);
  assert.ok(summary.pass, 'coverage ' + summary.coverage + ' below floor ' + summary.floor);
  assert.ok(Math.abs(halfWidth - 1.645 * 3.3) < 0.35, 'half-width ' + halfWidth + ' is not near the normal 90% value');
});

test('a group whose estimates all run high is covered less, and its misses fall on one side', () => {
  // The defect amendment 4 found, in miniature: the same spread, shifted by about a third of it.
  let seed = 7;
  const uniform = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const normal = () => Math.sqrt(-2 * Math.log(uniform() || 1e-12)) * Math.cos(2 * Math.PI * uniform());
  const halfWidth = 1.645 * 3.3;
  const shifted = Array.from({ length: 4000 }, () => ({ actual: 25 - 1.2 + 3.3 * normal(), interval: I.intervalFor(25, halfWidth) }));
  const summary = I.summarizeCoverage(shifted);
  assert.ok(summary.coverage < 0.895 && summary.coverage > 0.85, 'coverage ' + summary.coverage);
  assert.ok(!summary.pass, 'with n = 4000 the floor is about 89.1%, and this group sits below it');
  assert.ok(summary.estimateTooHigh > 3 * summary.estimateTooLow, 'the misses should be lopsided toward over-estimation');
});

test('the group-covering width is set by the worst reportable subgroup, never by a small one', () => {
  const person = group => ({ group });
  const records = [
    ...range(1, 200).map(i => ({ absoluteResidual: i / 40, person: person('a') })),   // up to 5.0
    ...range(1, 150).map(i => ({ absoluteResidual: i / 20, person: person('b') })),   // up to 7.5
    ...range(1, 20).map(() => ({ absoluteResidual: 50, person: person('tiny') })),    // huge, but n = 20
  ];
  const result = I.groupCoveringHalfWidth(records, { group: p => p.group });
  const b = I.conformalHalfWidth(range(1, 150).map(i => i / 20));
  assert.equal(result.halfWidth, b);
  assert.equal(result.binding.key, 'b');
  assert.ok(result.halfWidth >= result.pooled);
  const tiny = result.groups.find(g => g.key === 'tiny');
  assert.equal(tiny.insufficient, true);
  assert.equal(tiny.halfWidth, undefined, 'an insufficient subgroup is not summarized');
});

test('when the pooled width already covers every subgroup, nothing is reported as binding', () => {
  const records = range(1, 300).map(i => ({ absoluteResidual: (i % 30) / 10, person: { group: i % 2 ? 'odd' : 'even' } }));
  const result = I.groupCoveringHalfWidth(records, { group: p => p.group });
  assert.ok(result.halfWidth >= result.pooled);
  if (result.halfWidth === result.pooled) assert.equal(result.binding, null);
});

test('an interval contains its estimate, stays inside 1-75, and says when it was cut', () => {
  const middle = I.intervalFor(25, 5.4);
  assert.deepEqual([middle.lower, middle.upper, middle.truncated], [19.6, 30.4, false]);
  const low = I.intervalFor(3, 5.4);
  assert.deepEqual([low.lower, low.truncated], [1, true]);
  assert.ok(low.lower <= 3 && 3 <= low.upper);
  const unbounded = I.intervalFor(40, Infinity);
  assert.deepEqual([unbounded.lower, unbounded.upper], [1, 75]);
});

test('an estimate the predictor would refuse gets no interval', () => {
  assert.equal(I.intervalFor(0.5, 5), null);
  assert.equal(I.intervalFor(80, 5), null);
  assert.equal(I.intervalFor(NaN, 5), null);
  rejects(() => I.intervalFor(25, -1), 'BAD_HALF_WIDTH');
  rejects(() => I.intervalFor(25, NaN), 'BAD_HALF_WIDTH');
});

test('the interval depends on the estimate and the half-width, and on nothing about the person', () => {
  // Structural, because it is the property that keeps race out of any individual interval.
  assert.equal(I.intervalFor.length, 2, 'intervalFor takes an estimate and a half-width; the range has a default');
  assert.deepEqual(I.intervalFor(25, 5), I.intervalFor(25, 5, [1, 75]));
});

test('coverage counts misses by direction and the floor follows sampling error', () => {
  const interval = I.intervalFor(25, 5);
  const summary = I.summarizeCoverage([
    { actual: 25, interval }, { actual: 30, interval }, { actual: 20, interval },
    { actual: 19, interval }, { actual: 31, interval }, { actual: 18, interval },
  ]);
  assert.deepEqual([summary.covered, summary.estimateTooHigh, summary.estimateTooLow], [3, 2, 1]);
  assert.ok(Math.abs(I.coverageFloor(900) - 0.88) < 1e-12);
  assert.ok(Math.abs(I.coverageFloor(900, { z: 3 }) - 0.87) < 1e-12);
  rejects(() => I.summarizeCoverage([]), 'NO_OBSERVATIONS');
  rejects(() => I.summarizeCoverage([{ actual: 25, interval: null }]), 'INCOMPLETE_RECORD');
});

test('run-intervals fits only on model-ready rows, so race cannot reach a fit', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'nhanes', 'run-intervals.cjs'), 'utf8');
  const fits = source.match(/\.fit(BoostedTrees|MeanByBand|Linear|SplineRidge)\(/g) || [];
  assert.ok(fits.length >= 2, 'expected the runner to fit B+ and baseline 1');
  assert.ok(!/\.fit(BoostedTrees|MeanByBand|Linear|SplineRidge)\((?!modelReadyExport\()/.test(source),
    'every fit must receive modelReadyExport(...) directly');
});

test('run-intervals never loads the unread holdout', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'nhanes', 'run-intervals.cjs'), 'utf8');
  assert.match(source, /cohortRoleFor\(entry\.role, entry\.cycle\) !== 'development'\) continue;/);
  assert.ok(!/include-holdout|2015-2016'\s*:/.test(source));
});

// ----------------------------------------------------------------- amendment 7: a half-width per sex

const sexed = (sexMale, residuals, extra = {}) => residuals.map(absoluteResidual => ({ absoluteResidual, person: { sexMale, ...extra } }));

test('each sex gets the conformal half-width of its own residuals', () => {
  const records = [...sexed(0, range(1, 19).map(i => i / 2)), ...sexed(1, range(1, 19).map(i => i / 4))];
  const result = I.stratifiedHalfWidths(records, 'sexMale');
  assert.equal(result.widths[0].halfWidth, I.conformalHalfWidth(range(1, 19).map(i => i / 2)));
  assert.equal(result.widths[1].halfWidth, I.conformalHalfWidth(range(1, 19).map(i => i / 4)));
  assert.equal(I.halfWidthFor(result, { sexMale: 0 }), 9);
  assert.equal(I.halfWidthFor(result, { sexMale: 1 }), 4.5);
});

test('only sex may choose a half-width, and above all not the audit variable', () => {
  const records = sexed(0, range(1, 19));
  for (const stratum of ['raceEthnicity', 'RIDRETH1', 'ageYears', 'waistCm', 'cycle']) {
    rejects(() => I.stratifiedHalfWidths(records, stratum), 'FORBIDDEN_STRATUM');
  }
  assert.deepEqual([...I.PERMITTED_STRATA], ['sexMale']);
  assert.ok(Object.isFrozen(I.PERMITTED_STRATA), 'the list cannot be extended at runtime');
});

test('a residual with no sex is refused, and an unknown rule is refused', () => {
  rejects(() => I.stratifiedHalfWidths([...sexed(0, range(1, 19)), { absoluteResidual: 3, person: {} }], 'sexMale'), 'MISSING_STRATUM');
  rejects(() => I.stratifiedHalfWidths(sexed(0, range(1, 19)), 'sexMale', { rule: 'widest' }), 'UNKNOWN_RULE');
});

test('a stratum with no calibrated width gets no width, not a borrowed one', () => {
  const result = I.stratifiedHalfWidths(sexed(1, range(1, 19)), 'sexMale');
  assert.equal(I.halfWidthFor(result, { sexMale: 1 }), 18);
  assert.equal(I.halfWidthFor(result, { sexMale: 0 }), null, 'women were never calibrated here; no width');
  assert.equal(I.halfWidthFor(result, {}), null);
  assert.equal(I.halfWidthFor(result, { sexMale: 'toString' }), null, 'inherited names are not strata');
});

test('group-covering within a sex is set by a subgroup that is large enough inside that sex', () => {
  const records = [
    // Women: band b's residuals run wider than the pooled set's, so b sets their width.
    ...sexed(0, range(1, 200).map(i => i / 40), { band: 'a' }),
    ...sexed(0, range(1, 150).map(i => i / 20), { band: 'b' }),
    ...sexed(0, range(1, 20).map(() => 0.5), { band: 'c' }),
    // Men: band c's residuals are huge, but only 20 men are in it — under the minimum, and few
    // enough not to move the pooled quantile — so c must not set their width.
    ...sexed(1, range(1, 300).map(i => i / 60), { band: 'a' }),
    ...sexed(1, range(1, 20).map(() => 40), { band: 'c' }),
  ];
  const result = I.stratifiedHalfWidths(records, 'sexMale', { rule: 'group-covering', breakdowns: { band: p => p.band } });
  assert.equal(result.widths[0].binding.key, 'b');
  assert.equal(result.widths[0].halfWidth, I.conformalHalfWidth(range(1, 150).map(i => i / 20)));
  assert.ok(result.widths[0].halfWidth > result.widths[0].pooled);
  assert.equal(result.widths[1].binding, null, 'band c has 20 men, under the minimum, so it cannot set their width');
  assert.ok(result.widths[1].halfWidth < 40);
  assert.equal(result.widths[1].groups, undefined, 'the per-sex entry reports its width, not a second copy of every group');
});

test('run-intervals requires an attempt and has no default', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'nhanes', 'run-intervals.cjs'), 'utf8');
  assert.match(source, /!\['3', '4'\]\.includes\(ATTEMPT\)/);
  assert.ok(!/valueFor\('--attempt'\)\s*(\|\||\?\?)/.test(source), 'an attempt must not fall back to a default');
  // Attempt 4 stratifies by sex through the closed list and nothing else.
  const strata = source.match(/stratifiedHalfWidths\([^,]+,\s*'([^']+)'/g) || [];
  assert.ok(strata.length >= 2);
  assert.ok(strata.every(call => call.endsWith("'sexMale'")));
});
