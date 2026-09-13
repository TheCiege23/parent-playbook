// Measurement study statistics, checked against hand calculations and a published example.
//
// Every number below can be reproduced with a pencil. The point is that a formula error — a wrong
// divisor, n instead of n - 1, a transposed mean square — shows up as a wrong number here instead of
// as a plausible-looking agreement statistic in a study report.
const test = require('node:test');
const assert = require('node:assert/strict');

let A;
test.before(async () => { A = await import('../tools/study/analysis.mjs'); });

const close = (actual, expected, tolerance = 1e-4) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, 'expected ' + expected + ', got ' + actual);

test('Bland–Altman bias, limits of agreement and error match a hand calculation', () => {
  // Differences 1, 1, 0, 2: bias 1; sample SD sqrt(2/3) = 0.816497; limits 1 ± 1.96 × 0.816497.
  const result = A.blandAltman([
    { scan: 10, reference: 9 }, { scan: 12, reference: 11 }, { scan: 11, reference: 11 }, { scan: 13, reference: 11 },
  ]);
  assert.equal(result.n, 4);
  close(result.bias, 1);
  close(result.sdDifference, 0.816497);
  close(result.limitsOfAgreement[0], 1 - 1.96 * 0.816497);
  close(result.limitsOfAgreement[1], 1 + 1.96 * 0.816497);
  close(result.meanAbsoluteError, 1);
  close(result.biasPercentOfReference, 100 / 10.5);
  // Limit-of-agreement interval uses sqrt(3 s^2 / n).
  close(result.upperLimitCi[1] - result.limitsOfAgreement[1], 1.96 * Math.sqrt(3 * (2 / 3) / 4));
  assert.match(result.approximation, /understate uncertainty in small samples/);
});

test('a constant bias has no proportional bias, and a growing one does', () => {
  const constant = A.blandAltman([10, 20, 30, 40, 50].map((reference, i) => ({ reference, scan: reference + 2 + (i % 2 ? 0.1 : -0.1) })));
  assert.ok(Math.abs(constant.proportionalBias.slope) < 0.01);
  const growing = A.blandAltman([10, 20, 30, 40, 50].map(reference => ({ reference, scan: reference * 1.1 })));
  assert.ok(growing.proportionalBias.slope > 0.05, 'a 10% overestimate grows with size');
});

test('missing or non-finite pairs are refused, not silently dropped', () => {
  assert.throws(() => A.blandAltman([{ scan: 1, reference: 1 }, { scan: 2, reference: 2 }, { scan: NaN, reference: 3 }]), { code: 'NON_FINITE_PAIR' });
  assert.throws(() => A.blandAltman([{ scan: 1, reference: 1 }, { scan: 2, reference: 2 }]), { code: 'TOO_FEW_PAIRS' });
});

test('technical error of measurement and minimal detectable change match a hand calculation', () => {
  // Differences 1, 0, 1: TEM = sqrt(2 / (2 × 3)) = 0.57735; grand mean 20.
  const result = A.technicalError([[10, 11], [20, 20], [30, 29]]);
  close(result.tem, Math.sqrt(1 / 3));
  close(result.relativeTemPercent, 100 * Math.sqrt(1 / 3) / 20);
  close(result.minimalDetectableChange95, 1.96 * Math.SQRT2 * Math.sqrt(1 / 3));
  assert.throws(() => A.technicalError([[1, 2]]), { code: 'TOO_FEW_PAIRS' });
  assert.throws(() => A.technicalError([[1, 2], [3]]), { code: 'NON_FINITE_PAIR' });
});

test('ICC reproduces Shrout and Fleiss (1979), Table 2', () => {
  // Six targets rated by four judges. The paper reports ICC(1,1) = .17, ICC(2,1) = .29, ICC(3,1) = .71.
  const ratings = [
    [9, 2, 5, 8],
    [6, 1, 3, 2],
    [8, 4, 6, 8],
    [7, 1, 2, 6],
    [10, 5, 6, 9],
    [6, 2, 4, 7],
  ];
  const result = A.intraclassCorrelation(ratings);
  close(result.icc1_1, 0.17, 0.006);
  close(result.icc2_1, 0.29, 0.006);
  close(result.icc3_1, 0.71, 0.006);
});

test('ICC refuses a matrix with a missing cell instead of imputing one', () => {
  assert.throws(() => A.intraclassCorrelation([[1, 2], [3, NaN], [5, 6]]), { code: 'RAGGED_MATRIX' });
  assert.throws(() => A.intraclassCorrelation([[1, 2], [3]]), { code: 'RAGGED_MATRIX' });
});
