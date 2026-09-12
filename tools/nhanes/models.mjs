/* Candidate models for the owned body-composition study, per research/NHANES-PREREGISTRATION.md §6.
 *
 * Two of them, deliberately different in kind:
 *
 *   a restricted cubic spline with ridge regularization — interpretable, and the standard shape in
 *   the published body-composition literature, where the relationship between body fat and weight
 *   is known to bend;
 *
 *   gradient-boosted regression trees — the stronger tabular model, which can represent
 *   interactions the spline cannot.
 *
 * Both take the same features, and both are fitted on rows from modelReadyExport, which physically
 * lack race, identifiers and survey design variables. Neither can use race because neither ever
 * receives it.
 *
 * WHY A STRONGER MODEL IS NOT EXPECTED TO FIX THE SUBGROUP BIAS
 *
 * The bias in research/NHANES-BASELINES.md is not a failure to fit. If two groups differ in body
 * fat at the same age, sex, height and weight, then no function of age, sex, height and weight can
 * separate them — the information is absent from the inputs, not underused by the model. A better
 * model gets closer to E[Y|X]; the group bias is E[E[Y|X] - Y | group], which stays whatever the
 * model does. That is a claim, and Sprint 3 exists partly to test it rather than assert it.
 */

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'NhanesModelError', code }); };

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

function quantile(sorted, p) {
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position), high = Math.ceil(position);
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/* Restricted cubic spline basis (Harrell).
 *
 * k knots produce k-2 nonlinear terms alongside the linear one. "Restricted" means the fit is
 * forced to be linear beyond the outer knots, which matters here: an unrestricted cubic can bend
 * sharply in the sparse tails and produce a confident, wrong number for the heaviest and lightest
 * people in the cohort — exactly the people an estimate is least safe for.
 */
export function splineKnots(values, count = 4) {
  if (count < 3) fail('TOO_FEW_KNOTS', 'A restricted cubic spline needs at least three knots.');
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length < count * 5) fail('TOO_FEW_VALUES', 'Placing ' + count + ' knots needs more data than ' + sorted.length + ' values.');
  // Conventional quantile placement; the outer knots sit inside the extremes so the tails are
  // linear rather than fitted to a handful of points.
  const fractions = count === 3 ? [0.10, 0.50, 0.90]
    : count === 4 ? [0.05, 0.35, 0.65, 0.95]
    : [0.05, 0.275, 0.50, 0.725, 0.95];
  const knots = fractions.slice(0, count).map(p => quantile(sorted, p));
  const unique = [...new Set(knots)];
  if (unique.length !== knots.length) fail('DEGENERATE_KNOTS', 'Two knots landed on the same value; this variable has too little spread for a spline.');
  return Object.freeze(knots);
}

export function splineBasis(x, knots) {
  const k = knots.length, last = knots[k - 1], penultimate = knots[k - 2];
  const denominator = (last - knots[0]) ** 2;
  const cube = value => (value > 0 ? value ** 3 : 0);
  const terms = [x];
  for (let j = 0; j < k - 2; j++) {
    const tj = knots[j];
    terms.push((cube(x - tj)
      - cube(x - penultimate) * (last - tj) / (last - penultimate)
      + cube(x - last) * (penultimate - tj) / (last - penultimate)) / denominator);
  }
  return terms;
}

/* Ridge regression on a design matrix, with columns standardized first.
 *
 * Standardizing is not optional when a penalty is involved: an unstandardized ridge penalizes a
 * coefficient on centimetres far more than the same relationship expressed in metres, so the
 * amount of regularization would depend on the unit somebody happened to record the data in.
 */
function ridgeSolve(design, targets, lambda) {
  const n = design.length, p = design[0].length;
  const centres = [], scales = [];
  for (let j = 0; j < p; j++) {
    const column = design.map(row => row[j]);
    const centre = mean(column);
    const spread = Math.sqrt(mean(column.map(v => (v - centre) ** 2))) || 1;
    centres.push(centre); scales.push(spread);
  }
  const z = design.map(row => row.map((v, j) => (v - centres[j]) / scales[j]));
  const targetMean = mean(targets);
  const y = targets.map(v => v - targetMean);

  const xtx = Array.from({ length: p }, () => new Array(p).fill(0));
  const xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      xty[a] += z[i][a] * y[i];
      for (let b = 0; b < p; b++) xtx[a][b] += z[i][a] * z[i][b];
    }
  }
  for (let a = 0; a < p; a++) xtx[a][a] += lambda;

  const m = xtx.map((row, i) => [...row, xty[i]]);
  for (let col = 0; col < p; col++) {
    let pivot = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) fail('SINGULAR_DESIGN', 'The penalized design is still singular at column ' + col + '.');
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const factor = m[r][col] / m[col][col];
      for (let c = col; c <= p; c++) m[r][c] -= factor * m[col][c];
    }
  }
  const standardized = [];
  for (let i = 0; i < p; i++) standardized.push(m[i][p] / m[i][i]);
  // Back to raw units so a prediction needs no knowledge of how the fit was scaled.
  const weights = standardized.map((w, j) => w / scales[j]);
  let intercept = targetMean;
  for (let j = 0; j < p; j++) intercept -= weights[j] * centres[j];
  return { weights, intercept };
}

/* Candidate 1: restricted cubic splines on the continuous inputs, ridge-penalized. */
export function fitSplineRidge(rows, {
  continuous = ['ageYears', 'heightCm', 'weightKg'], binary = ['sexMale'],
  target = 'bodyFatPercent', lambda = 1, knotCount = 4,
} = {}) {
  const features = [...continuous, ...binary];
  const usable = rows.filter(row => features.every(f => Number.isFinite(row[f])) && Number.isFinite(row[target]));
  if (!usable.length) fail('NO_USABLE_ROWS', 'No row carries every feature and the target.');

  const knots = {};
  for (const feature of continuous) knots[feature] = splineKnots(usable.map(row => row[feature]), knotCount);

  const design = usable.map(row => [
    ...continuous.flatMap(feature => splineBasis(row[feature], knots[feature])),
    ...binary.map(feature => row[feature]),
  ]);
  const { weights, intercept } = ridgeSolve(design, usable.map(row => row[target]), lambda);

  return Object.freeze({
    kind: 'spline_ridge', target, features: Object.freeze(features),
    continuous: Object.freeze([...continuous]), binary: Object.freeze([...binary]),
    knots: Object.freeze(knots), weights: Object.freeze(weights), intercept, lambda, knotCount,
    fittedOn: usable.length,
  });
}

/* Candidate 2: gradient-boosted regression trees.
 *
 * Depth-limited trees on squared loss, shrunk by a learning rate. Chosen over a random forest
 * because boosting is the stronger tabular method in this size of problem, and because a model
 * that cannot beat a spline here should not be kept merely for being fashionable.
 */
function bestSplit(rows, indices, features, residuals, minLeaf) {
  let best = null;
  for (const feature of features) {
    const ordered = [...indices].sort((a, b) => rows[a][feature] - rows[b][feature]);
    let leftSum = 0, leftCount = 0;
    const totalSum = ordered.reduce((sum, i) => sum + residuals[i], 0), totalCount = ordered.length;
    for (let i = 0; i < ordered.length - 1; i++) {
      leftSum += residuals[ordered[i]];
      leftCount++;
      const here = rows[ordered[i]][feature], next = rows[ordered[i + 1]][feature];
      if (here === next) continue;                       // cannot split between equal values
      if (leftCount < minLeaf || totalCount - leftCount < minLeaf) continue;
      // Squared-error reduction for a two-way split.
      const gain = (leftSum ** 2) / leftCount + ((totalSum - leftSum) ** 2) / (totalCount - leftCount) - (totalSum ** 2) / totalCount;
      if (!best || gain > best.gain) best = { feature, threshold: (here + next) / 2, gain };
    }
  }
  return best;
}

function growTree(rows, indices, features, residuals, depth, minLeaf) {
  const value = mean(indices.map(i => residuals[i]));
  if (depth === 0 || indices.length < minLeaf * 2) return { leaf: true, value };
  const split = bestSplit(rows, indices, features, residuals, minLeaf);
  if (!split || split.gain <= 0) return { leaf: true, value };
  const left = indices.filter(i => rows[i][split.feature] <= split.threshold);
  const right = indices.filter(i => rows[i][split.feature] > split.threshold);
  if (!left.length || !right.length) return { leaf: true, value };
  return {
    leaf: false, feature: split.feature, threshold: split.threshold,
    left: growTree(rows, left, features, residuals, depth - 1, minLeaf),
    right: growTree(rows, right, features, residuals, depth - 1, minLeaf),
  };
}

const treeValue = (node, row) => (node.leaf ? node.value
  : treeValue(row[node.feature] <= node.threshold ? node.left : node.right, row));

export function fitBoostedTrees(rows, {
  features = ['ageYears', 'sexMale', 'heightCm', 'weightKg'], target = 'bodyFatPercent',
  trees = 200, learningRate = 0.05, depth = 3, minLeaf = 20,
} = {}) {
  const usable = rows.filter(row => features.every(f => Number.isFinite(row[f])) && Number.isFinite(row[target]));
  if (usable.length < minLeaf * 4) fail('TOO_FEW_ROWS', 'Boosting needs more than ' + (minLeaf * 4) + ' rows; got ' + usable.length + '.');

  const base = mean(usable.map(row => row[target]));
  const predictions = new Array(usable.length).fill(base);
  const indices = usable.map((_, i) => i);
  const ensemble = [];
  for (let t = 0; t < trees; t++) {
    const residuals = usable.map((row, i) => row[target] - predictions[i]);
    const tree = growTree(usable, indices, features, residuals, depth, minLeaf);
    for (let i = 0; i < usable.length; i++) predictions[i] += learningRate * treeValue(tree, usable[i]);
    ensemble.push(tree);
  }
  return Object.freeze({
    kind: 'boosted_trees', target, features: Object.freeze([...features]),
    base, learningRate, depth, minLeaf, trees: ensemble.length,
    ensemble: Object.freeze(ensemble), fittedOn: usable.length,
  });
}

/* One prediction interface for every candidate, and the same refusal rule as the baselines:
 * a missing input returns null, never a substitute.
 */
export function predictCandidate(model, row) {
  for (const feature of model.features) if (!Number.isFinite(row[feature])) return null;
  if (model.kind === 'spline_ridge') {
    const design = [
      ...model.continuous.flatMap(feature => splineBasis(row[feature], model.knots[feature])),
      ...model.binary.map(feature => row[feature]),
    ];
    let value = model.intercept;
    for (let i = 0; i < design.length; i++) value += model.weights[i] * design[i];
    return value;
  }
  if (model.kind === 'boosted_trees') {
    let value = model.base;
    for (const tree of model.ensemble) value += model.learningRate * treeValue(tree, row);
    return value;
  }
  fail('UNKNOWN_MODEL_KIND', model.kind + ' is not a candidate model this predictor understands.');
}

/* §4: derive the other outputs from the prediction, and enforce consistency at the point of
 * production rather than checking afterwards.
 *
 * A body-fat percentage outside the plausible range, or a fat mass exceeding total mass, is not a
 * number to clamp quietly — clamping produces a value that looks measured and is not. It returns
 * no estimate, with the reason.
 */
export function deriveComposition(bodyFatPercent, totalMassKg) {
  if (!Number.isFinite(bodyFatPercent) || !Number.isFinite(totalMassKg)) {
    return { ok: false, reason: 'A composition needs both a predicted body-fat percentage and a total body mass.' };
  }
  if (bodyFatPercent < 1 || bodyFatPercent > 75) {
    return { ok: false, reason: 'The predicted body fat of ' + bodyFatPercent.toFixed(1) + '% is outside the range this model supports. No estimate is produced; a clamped value would look measured and would not be.' };
  }
  if (totalMassKg <= 0) return { ok: false, reason: 'Total body mass must be positive.' };
  const fatMassKg = totalMassKg * bodyFatPercent / 100;
  const leanMassKg = totalMassKg - fatMassKg;
  if (fatMassKg < 0 || fatMassKg > totalMassKg || leanMassKg < 0) {
    return { ok: false, reason: 'The derived masses do not reconcile with total body mass.' };
  }
  return Object.freeze({
    ok: true,
    bodyFatPercent: Math.round(bodyFatPercent * 10) / 10,
    fatMassKg: Math.round(fatMassKg * 10) / 10,
    // Lean here means everything that is not fat, including bone mineral -- the same definition
    // NHANES uses for DXDTOLI. It is NOT skeletal muscle mass and must never be presented as it.
    leanMassKg: Math.round(leanMassKg * 10) / 10,
    definition: 'Lean mass is total body mass minus fat mass, including bone mineral, matching the NHANES DXA definition this model was trained against. It is not skeletal muscle mass.',
  });
}
