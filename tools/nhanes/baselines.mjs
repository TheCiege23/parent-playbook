/* The baselines from research/NHANES-PREREGISTRATION.md §6, and the evaluation from §7.
 *
 * These exist to be beaten. A candidate model that cannot beat a BMI regression has not earned its
 * complexity, and the only way to know that is to build the simple thing first and keep reporting
 * it afterwards — including in the release report, including if it wins.
 *
 * TWO STRUCTURAL POINTS
 *
 * A model is fitted on rows produced by modelReadyExport, which physically lack race, identifiers
 * and survey design variables. It is then evaluated against participant records that carry them.
 * That is not a convention: the fitting function never receives a row containing race, so it
 * cannot use race, and the subgroup report can still be produced. The preregistration's rule is
 * enforced by the shape of the data rather than by anyone remembering it.
 *
 * A missing input produces no estimate. Not a population mean, not a zero, not the last value that
 * worked — null, which the caller has to handle. §4 requires it, and the alternative is a number
 * that looks like a measurement of someone whose measurements were never taken.
 */

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'NhanesBaselineError', code }); };

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

/* Ordinary least squares by Gaussian elimination on the normal equations, with the columns
 * centred first.
 *
 * Centring is not cosmetic here. Height in centimetres and weight in kilograms are both far from
 * zero, so the uncentred cross-product matrix is badly conditioned and the solution picks up error
 * that looks like a real coefficient. With five features it would still "work" and return
 * plausible numbers, which is the problem.
 */
function leastSquares(rows, features, target) {
  const n = rows.length, p = features.length;
  if (n <= p + 1) fail('TOO_FEW_ROWS', 'Fitting ' + p + ' features needs more than ' + (p + 1) + ' rows; got ' + n + '.');

  const centres = {}, targetMean = mean(rows.map(row => row[target]));
  for (const feature of features) centres[feature] = mean(rows.map(row => row[feature]));

  // Normal equations on centred columns: (X'X) b = X'y
  const xtx = Array.from({ length: p }, () => new Array(p).fill(0));
  const xty = new Array(p).fill(0);
  for (const row of rows) {
    const centred = features.map(feature => row[feature] - centres[feature]);
    const dy = row[target] - targetMean;
    for (let i = 0; i < p; i++) {
      xty[i] += centred[i] * dy;
      for (let j = 0; j < p; j++) xtx[i][j] += centred[i] * centred[j];
    }
  }

  // Gaussian elimination with partial pivoting.
  const a = xtx.map((r, i) => [...r, xty[i]]);
  for (let col = 0; col < p; col++) {
    let pivot = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-10) {
      fail('SINGULAR_DESIGN', 'Feature ' + features[col] + ' is collinear with the others, so its coefficient '
        + 'is not identified. Fitting anyway would return a number that depends on rounding.');
    }
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const factor = a[r][col] / a[col][col];
      for (let c = col; c <= p; c++) a[r][c] -= factor * a[col][c];
    }
  }
  const coefficients = {};
  features.forEach((feature, i) => { coefficients[feature] = a[i][p] / a[i][i]; });
  // Undo the centring so the model applies to raw inputs.
  let intercept = targetMean;
  for (const feature of features) intercept -= coefficients[feature] * centres[feature];
  return { intercept, coefficients };
}

const AGE_BANDS = Object.freeze([[18, 29], [30, 39], [40, 49], [50, 59]]);
const bandOf = age => {
  const band = AGE_BANDS.find(([low, high]) => age >= low && age <= high);
  return band ? band[0] + '-' + band[1] : null;
};

/* Baseline 1: the population mean for an age band and sex.
 *
 * The weakest thing that is not a constant. Any model that cannot beat it is learning nothing from
 * the inputs at all.
 */
export function fitMeanByBand(rows, target = 'bodyFatPercent') {
  const groups = new Map();
  for (const row of rows) {
    const band = bandOf(row.ageYears);
    if (band == null || row[target] == null) continue;
    const key = band + '|' + row.sexMale;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row[target]);
  }
  const means = {};
  for (const [key, values] of groups) means[key] = mean(values);
  return Object.freeze({
    kind: 'mean_by_age_sex_band', target,
    features: Object.freeze(['ageYears', 'sexMale']),
    means: Object.freeze(means),
    groupCounts: Object.freeze(Object.fromEntries([...groups].map(([k, v]) => [k, v.length]))),
  });
}

/* Baselines 2-4: linear models on the declared features. */
export function fitLinear(rows, features, target = 'bodyFatPercent', kind = 'linear') {
  const usable = rows.filter(row => features.every(feature => Number.isFinite(row[feature])) && Number.isFinite(row[target]));
  if (!usable.length) fail('NO_USABLE_ROWS', 'No row has every one of ' + features.join(', ') + ' and ' + target + '.');
  const { intercept, coefficients } = leastSquares(usable, features, target);
  return Object.freeze({
    kind, target,
    features: Object.freeze([...features]),
    intercept,
    coefficients: Object.freeze(coefficients),
    fittedOn: usable.length,
    // Recorded so a report can say what the fit actually saw, rather than what was passed in.
    droppedForMissingInputs: rows.length - usable.length,
  });
}

/* A prediction, or nothing.
 *
 * §4: unsupported or missing inputs return no estimate. Returning a band mean or a zero here would
 * put a number in front of someone whose measurements were never taken, and nothing downstream
 * could tell it apart from a real one.
 */
export function predict(model, row) {
  if (model.kind === 'mean_by_age_sex_band') {
    const band = bandOf(row.ageYears);
    if (band == null || (row.sexMale !== 0 && row.sexMale !== 1)) return null;
    const value = model.means[band + '|' + row.sexMale];
    return value == null ? null : value;
  }
  for (const feature of model.features) if (!Number.isFinite(row[feature])) return null;
  let value = model.intercept;
  for (const feature of model.features) value += model.coefficients[feature] * row[feature];
  return value;
}

/* The metrics §7 requires, and no others.
 *
 * The calibration slope regresses the ACTUAL value on the PREDICTED one. A slope below 1 means the
 * model's spread is too wide — it is over-confident about who is extreme — and a slope above 1
 * means it is too timid. MAE alone cannot show either, and a model can have a good MAE while being
 * systematically wrong at both ends.
 */
export function evaluate(model, rows) {
  const pairs = [];
  let refused = 0;
  for (const row of rows) {
    const predicted = predict(model, row);
    if (predicted == null || !Number.isFinite(row[model.target])) { refused++; continue; }
    pairs.push({ predicted, actual: row[model.target], row });
  }
  if (!pairs.length) {
    return Object.freeze({ n: 0, refused, bias: null, mae: null, rmse: null, maxAbsError: null,
      calibrationSlope: null, calibrationIntercept: null });
  }
  const errors = pairs.map(pair => pair.predicted - pair.actual);
  const meanPredicted = mean(pairs.map(p => p.predicted)), meanActual = mean(pairs.map(p => p.actual));
  let covariance = 0, variance = 0;
  for (const pair of pairs) {
    covariance += (pair.predicted - meanPredicted) * (pair.actual - meanActual);
    variance += (pair.predicted - meanPredicted) ** 2;
  }
  const slope = variance === 0 ? null : covariance / variance;
  return Object.freeze({
    n: pairs.length,
    refused,
    refusalRate: refused / (pairs.length + refused),
    bias: mean(errors),
    mae: mean(errors.map(Math.abs)),
    rmse: Math.sqrt(mean(errors.map(error => error ** 2))),
    maxAbsError: Math.max(...errors.map(Math.abs)),
    calibrationSlope: slope,
    calibrationIntercept: slope == null ? null : meanActual - slope * meanPredicted,
  });
}

/* The same metrics, per subgroup.
 *
 * §8 requires the worst subgroup to be within 1.25x the overall MAE, and a subgroup below 100
 * participants to be reported as insufficient rather than summarized. Both are computed here so
 * the release decision reads a number rather than making a judgement.
 */
export function subgroupMetrics(model, rows, keyOf, { minimumForReporting = 100 } = {}) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (key == null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const out = {};
  for (const [key, groupRows] of [...groups].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    const metrics = evaluate(model, groupRows);
    out[key] = metrics.n < minimumForReporting
      ? Object.freeze({ n: metrics.n, insufficient: true,
          note: 'Fewer than ' + minimumForReporting + ' participants. Reported as insufficient rather than summarized, per §8.' })
      : Object.freeze({ ...metrics, insufficient: false });
  }
  return Object.freeze(out);
}

export const AGE_BAND_OF = bandOf;
export const BMI_BAND_OF = bmi => {
  if (!Number.isFinite(bmi)) return null;
  if (bmi < 18.5) return 'under 18.5';
  if (bmi < 25) return '18.5-24.9';
  if (bmi < 30) return '25.0-29.9';
  if (bmi < 35) return '30.0-34.9';
  return '35 and over';
};
