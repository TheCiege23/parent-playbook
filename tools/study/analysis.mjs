/* Agreement and repeatability statistics for the measurement study.
 *
 * research/MEASUREMENT-STUDY-PROTOCOL.md §7 names what is reported; this file computes it and nothing
 * else. It takes plain numbers, so every formula can be checked against a hand calculation or a
 * published example, and it makes no pass/fail judgement. §9 leaves the thresholds to the qualified
 * statistician, and a tool that compared results against a number nobody approved would be making
 * that decision for them.
 *
 * TWO APPROXIMATIONS, STATED RATHER THAN HIDDEN
 *
 *   Confidence intervals use 1.96, not the t distribution. For the protocol's planned samples of
 *   around 100 the difference is small; for a subgroup of 20 it understates the interval, and the
 *   report says so beside every interval.
 *
 *   The interval on a limit of agreement uses Bland and Altman's large-sample standard error,
 *   sqrt(3 s^2 / n) — the same approximation the protocol's sample-size table in §8 uses.
 */

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'StudyAnalysisError', code }); };
const Z = 1.96;

const mean = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const sampleSd = xs => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1));
};

function checkedPairs(pairs, minimum) {
  if (!Array.isArray(pairs)) fail('NOT_PAIRS', 'Expected an array of pairs.');
  // Refused rather than filtered: a pair silently dropped changes n, and n moves every interval.
  for (const pair of pairs) {
    if (!pair || !Number.isFinite(pair.scan) || !Number.isFinite(pair.reference)) {
      fail('NON_FINITE_PAIR', 'Every pair needs a finite scan and reference value. Remove missing pairs before analysis and report them as missing.');
    }
  }
  if (pairs.length < minimum) fail('TOO_FEW_PAIRS', 'This statistic needs at least ' + minimum + ' pairs; got ' + pairs.length + '.');
  return pairs;
}

/* Bland–Altman agreement between scan and reference, in the units given.
 *
 * pairs: [{ scan, reference }]. Differences are scan minus reference, so a positive bias means the
 * scan reads high.
 */
export function blandAltman(pairs) {
  checkedPairs(pairs, 3);
  const n = pairs.length;
  const differences = pairs.map(p => p.scan - p.reference);
  const averages = pairs.map(p => (p.scan + p.reference) / 2);
  const bias = mean(differences);
  const sd = sampleSd(differences);
  const lower = bias - Z * sd, upper = bias + Z * sd;
  const limitSe = Math.sqrt(3 * sd * sd / n);
  const biasSe = sd / Math.sqrt(n);

  // Proportional bias: does the difference grow with the size of the measurement? Ordinary least
  // squares of difference on average; a slope near zero means the bias is roughly constant.
  const meanAverage = mean(averages);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (averages[i] - meanAverage) * (differences[i] - bias); sxx += (averages[i] - meanAverage) ** 2; }
  let proportional = null;
  if (sxx > 0 && n > 2) {
    const slope = sxy / sxx;
    const intercept = bias - slope * meanAverage;
    const residual = differences.reduce((sum, d, i) => sum + (d - (intercept + slope * averages[i])) ** 2, 0);
    const slopeSe = Math.sqrt(residual / (n - 2) / sxx);
    proportional = { slope, intercept, slopeCi: [slope - Z * slopeSe, slope + Z * slopeSe] };
  }

  const referenceMean = mean(pairs.map(p => p.reference));
  const mae = mean(differences.map(Math.abs));
  return Object.freeze({
    n, bias, sdDifference: sd,
    biasCi: [bias - Z * biasSe, bias + Z * biasSe],
    limitsOfAgreement: [lower, upper],
    lowerLimitCi: [lower - Z * limitSe, lower + Z * limitSe],
    upperLimitCi: [upper - Z * limitSe, upper + Z * limitSe],
    meanAbsoluteError: mae,
    biasPercentOfReference: referenceMean ? 100 * bias / referenceMean : null,
    maePercentOfReference: referenceMean ? 100 * mae / referenceMean : null,
    proportionalBias: proportional,
    approximation: 'Intervals use 1.96 and the large-sample standard error of a limit of agreement; they understate uncertainty in small samples.',
  });
}

/* Technical error of measurement for paired repeat values: sqrt(sum(d^2) / 2n).
 *
 * The anthropometry convention for two trials. Relative TEM divides by the grand mean. The minimal
 * detectable change at 95% is 1.96 * sqrt(2) * TEM: the smallest change between two single
 * measurements that is unlikely to be measurement error alone.
 */
export function technicalError(repeats) {
  if (!Array.isArray(repeats) || repeats.length < 2) fail('TOO_FEW_PAIRS', 'Technical error needs at least 2 repeat pairs.');
  for (const r of repeats) {
    if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isFinite)) fail('NON_FINITE_PAIR', 'Every repeat must be a pair of two finite values.');
  }
  const n = repeats.length;
  const tem = Math.sqrt(repeats.reduce((sum, [a, b]) => sum + (a - b) ** 2, 0) / (2 * n));
  const grandMean = mean(repeats.flat());
  return Object.freeze({
    n, tem,
    relativeTemPercent: grandMean ? 100 * tem / grandMean : null,
    minimalDetectableChange95: Z * Math.SQRT2 * tem,
  });
}

/* Intraclass correlation from a subjects-by-occasions matrix (Shrout & Fleiss 1979).
 *
 * rows: subjects; columns: raters, trials or devices. No missing cells: a matrix with a hole would
 * need a different model, and filling it in would invent a measurement.
 *
 *   ICC(1,1) one-way random, single measure
 *   ICC(2,1) two-way random, absolute agreement, single measure  — occasions are a sample
 *   ICC(3,1) two-way mixed, consistency, single measure          — occasions are fixed
 */
export function intraclassCorrelation(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 2) fail('TOO_FEW_SUBJECTS', 'ICC needs at least 2 subjects.');
  const k = matrix[0]?.length;
  if (!(k >= 2)) fail('TOO_FEW_OCCASIONS', 'ICC needs at least 2 occasions per subject.');
  for (const row of matrix) {
    if (!Array.isArray(row) || row.length !== k || !row.every(Number.isFinite)) {
      fail('RAGGED_MATRIX', 'Every subject needs a finite value on every occasion. Missing cells are not imputed.');
    }
  }
  const n = matrix.length;
  const grand = mean(matrix.flat());
  const rowMeans = matrix.map(mean);
  const colMeans = Array.from({ length: k }, (_, j) => mean(matrix.map(row => row[j])));
  const ssRows = k * rowMeans.reduce((sum, m) => sum + (m - grand) ** 2, 0);
  const ssCols = n * colMeans.reduce((sum, m) => sum + (m - grand) ** 2, 0);
  const ssTotal = matrix.flat().reduce((sum, x) => sum + (x - grand) ** 2, 0);
  const ssError = ssTotal - ssRows - ssCols;
  const msRows = ssRows / (n - 1);
  const msCols = ssCols / (k - 1);
  const msError = ssError / ((n - 1) * (k - 1));
  const msWithin = (ssCols + ssError) / (n * (k - 1));
  return Object.freeze({
    subjects: n, occasions: k,
    icc1_1: (msRows - msWithin) / (msRows + (k - 1) * msWithin),
    icc2_1: (msRows - msError) / (msRows + (k - 1) * msError + k * (msCols - msError) / n),
    icc3_1: (msRows - msError) / (msRows + (k - 1) * msError),
    meanSquares: Object.freeze({ rows: msRows, columns: msCols, error: msError, within: msWithin }),
  });
}
