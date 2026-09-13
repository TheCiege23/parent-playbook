// ===================================================================
//  REFERENCE COHORTS — comparing a measurement to a population
// ===================================================================
// A measurement with nothing to compare it against is data, not insight. That is
// the same reasoning behind cdc-stature.js, and this generalises it: any metric,
// any published cohort, the same statistics.
//
// The hard part is not the statistics. It is that a percentile is only meaningful
// when the cohort measured THE SAME QUANTITY THE SAME WAY. Our 25 outputs are
// pose-landmark distances scaled by a supplied height. Published anthropometric
// cohorts are tape and caliper measurements taken to ISO definitions by trained
// operators. Those are not interchangeable, and nothing about running one through
// the other's distribution makes them so — it just produces a confident number.
//
// So definitional equivalence is a precondition here, not a footnote:
// referencePercentile() refuses a metric whose cohort has not declared an
// established equivalence with the evidence that established it. A cohort can be
// loaded, inspected and audited without being usable, which is the honest state
// for every cohort we currently know of. See REFERENCE-COHORTS.md.

export const REFERENCE_COHORT_SCHEMA = 'PP_REFERENCE_COHORT_V1';
export const REFERENCE_METHODS = Object.freeze(['stadiometer', 'tape', 'caliper', 'dxa', '3d_scan', 'photo_estimate']);
export const REFERENCE_SEXES = Object.freeze(['male', 'female', 'both']);

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'ReferenceCohortError', code }); };
const text = (value, label, max = 300) => {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail('INVALID_COHORT', label + ' is required.');
  return value;
};
const finite = (value, label) => { if (!Number.isFinite(value)) fail('INVALID_COHORT', label + ' must be a finite number.'); return value; };
const onlyKeys = (value, label, allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_COHORT', label + ' must be an object.');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('UNKNOWN_COHORT_FIELD', 'Unsupported field ' + label + '.' + key + '.');
  return value;
};

// Abramowitz & Stegun 7.1.26, accurate to ~1.5e-7 — the same approximation
// cdc-stature.js uses, so a stature percentile computed here matches the one the
// parent app already shows rather than differing in the last displayed digit.
function normalCdf(z) {
  const s = z < 0 ? -1 : 1, x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}

function validateDistribution(input, label) {
  onlyKeys(input, label, ['type', 'rows', 'mean', 'sd']);
  if (input.type === 'lms') {
    // [ageMonths, L, M, S], ascending by age. M is in the metric's own unit.
    if (!Array.isArray(input.rows) || input.rows.length < 2 || input.rows.length > 2000) fail('INVALID_COHORT', label + '.rows must be an LMS table.');
    let previous = -Infinity;
    const rows = input.rows.map(row => {
      if (!Array.isArray(row) || row.length !== 4) fail('INVALID_COHORT', label + ' rows must be [ageMonths, L, M, S].');
      const [ageMonths, L, M, S] = row.map((v, i) => finite(v, label + '.rows[' + i + ']'));
      if (ageMonths <= previous) fail('INVALID_COHORT', label + '.rows must ascend by age.');
      if (M <= 0 || S <= 0) fail('INVALID_COHORT', label + ' M and S must be positive.');
      previous = ageMonths;
      return Object.freeze([ageMonths, L, M, S]);
    });
    return Object.freeze({ type: 'lms', rows: Object.freeze(rows) });
  }
  if (input.type === 'mean_sd') {
    const mean = finite(input.mean, label + '.mean'), sd = finite(input.sd, label + '.sd');
    if (sd <= 0) fail('INVALID_COHORT', label + '.sd must be positive.');
    return Object.freeze({ type: 'mean_sd', mean, sd });
  }
  return fail('INVALID_COHORT', label + '.type must be lms or mean_sd.');
}

// An equivalence claim is only accepted when it says what it was compared against
// and what established it. "established" with no evidence is an assertion, and an
// assertion is exactly what this gate exists to refuse.
function validateEquivalence(input, label) {
  onlyKeys(input, label, ['status', 'comparedTo', 'evidence', 'maxAbsoluteBias', 'unit', 'note']);
  if (input.status === 'not_established') {
    return Object.freeze({ status: 'not_established', note: input.note == null ? null : text(input.note, label + '.note', 1000) });
  }
  if (input.status !== 'established') fail('INVALID_COHORT', label + '.status must be established or not_established.');
  const bias = input.maxAbsoluteBias;
  if (bias != null && (!Number.isFinite(bias) || bias < 0)) fail('INVALID_COHORT', label + '.maxAbsoluteBias must be a non-negative number.');
  return Object.freeze({
    status: 'established',
    comparedTo: text(input.comparedTo, label + '.comparedTo', 300),
    evidence: text(input.evidence, label + '.evidence', 1000),
    maxAbsoluteBias: bias == null ? null : bias,
    unit: bias == null ? null : text(input.unit, label + '.unit', 40),
    note: input.note == null ? null : text(input.note, label + '.note', 1000),
  });
}

/** Validate a published reference cohort. Provenance is mandatory: a cohort whose source, population and method are not stated cannot be audited later. */
export function validateReferenceCohort(input) {
  onlyKeys(input, 'cohort', ['schema', 'cohortId', 'source', 'population', 'method', 'metrics', 'limitations']);
  if (input.schema !== REFERENCE_COHORT_SCHEMA) fail('INVALID_COHORT', 'Unsupported reference cohort schema.');
  if (!REFERENCE_METHODS.includes(input.method)) fail('INVALID_COHORT', 'method must be one of: ' + REFERENCE_METHODS.join(', ') + '.');

  const source = onlyKeys(input.source, 'source', ['name', 'citation', 'url', 'version', 'retrievedAt', 'license']);
  const population = onlyKeys(input.population, 'population', ['description', 'country', 'yearsCollected', 'sex', 'ageRange', 'sampleSize']);
  if (!REFERENCE_SEXES.includes(population.sex)) fail('INVALID_COHORT', 'population.sex must be male, female or both.');
  const ageRange = onlyKeys(population.ageRange, 'population.ageRange', ['minMonths', 'maxMonths']);
  const minMonths = finite(ageRange.minMonths, 'ageRange.minMonths'), maxMonths = finite(ageRange.maxMonths, 'ageRange.maxMonths');
  if (minMonths < 0 || maxMonths <= minMonths) fail('INVALID_COHORT', 'population.ageRange must be an increasing, non-negative month range.');
  if (!Number.isInteger(population.sampleSize) || population.sampleSize < 1) fail('INVALID_COHORT', 'population.sampleSize must be a positive integer.');

  if (!Array.isArray(input.metrics) || !input.metrics.length || input.metrics.length > 200) fail('INVALID_COHORT', 'A cohort must declare between 1 and 200 metrics.');
  const seen = new Set();
  const metrics = input.metrics.map(metric => {
    onlyKeys(metric, 'metrics[]', ['key', 'unit', 'definition', 'equivalence', 'distribution']);
    const key = text(metric.key, 'metric key', 100);
    if (seen.has(key)) fail('INVALID_COHORT', 'Duplicate metric ' + key + '.');
    seen.add(key);
    return Object.freeze({
      key,
      unit: text(metric.unit, 'metric unit', 40),
      definition: text(metric.definition, 'metric definition', 2000),
      equivalence: validateEquivalence(metric.equivalence, 'metrics[' + key + '].equivalence'),
      distribution: validateDistribution(metric.distribution, 'metrics[' + key + '].distribution'),
    });
  });

  return Object.freeze({
    schema: REFERENCE_COHORT_SCHEMA,
    cohortId: text(input.cohortId, 'cohortId', 180),
    source: Object.freeze({
      name: text(source.name, 'source.name'),
      citation: text(source.citation, 'source.citation', 1000),
      url: text(source.url, 'source.url', 500),
      version: text(source.version, 'source.version', 100),
      retrievedAt: text(source.retrievedAt, 'source.retrievedAt', 40),
      license: text(source.license, 'source.license', 200),
    }),
    population: Object.freeze({
      description: text(population.description, 'population.description', 1000),
      country: text(population.country, 'population.country', 100),
      yearsCollected: text(population.yearsCollected, 'population.yearsCollected', 100),
      sex: population.sex,
      ageRange: Object.freeze({ minMonths, maxMonths }),
      sampleSize: population.sampleSize,
    }),
    method: input.method,
    metrics: Object.freeze(metrics),
    limitations: text(input.limitations, 'limitations', 2000),
  });
}

/** The metrics this cohort may actually be used for. A cohort with none is still valid — it is simply not usable yet, which is the honest state of every cohort we know of. */
export function usableMetrics(cohort) {
  return Object.freeze(cohort.metrics.filter(m => m.equivalence.status === 'established').map(m => m.key));
}

function lmsAt(rows, ageMonths) {
  // Extrapolating a growth reference past its own range is how you tell someone
  // something confident and wrong, so out-of-range is a refusal, not a guess.
  if (ageMonths < rows[0][0] || ageMonths > rows[rows.length - 1][0]) return null;
  let lo = rows[0], hi = rows[rows.length - 1];
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i][0] <= ageMonths && ageMonths <= rows[i + 1][0]) { lo = rows[i]; hi = rows[i + 1]; break; }
  }
  if (hi[0] === lo[0]) return { L: lo[1], M: lo[2], S: lo[3] };
  const f = (ageMonths - lo[0]) / (hi[0] - lo[0]);
  return { L: lo[1] + f * (hi[1] - lo[1]), M: lo[2] + f * (hi[2] - lo[2]), S: lo[3] + f * (hi[3] - lo[3]) };
}

/**
 * Percentile for one measurement against one cohort.
 *
 * Refuses, rather than guessing, when: the metric is undeclared, its definitional
 * equivalence is not established, the unit differs, the subject's age is outside
 * the cohort's range, or the cohort does not cover the subject's sex.
 */
export function referencePercentile(cohort, { metricKey, value, unit, ageMonths = null, sex = null } = {}) {
  if (cohort?.schema !== REFERENCE_COHORT_SCHEMA) fail('INVALID_COHORT', 'Choose a validated reference cohort.');
  const metric = cohort.metrics.find(m => m.key === metricKey);
  if (!metric) fail('METRIC_NOT_IN_COHORT', 'This cohort does not describe ' + String(metricKey) + '.');

  if (metric.equivalence.status !== 'established') {
    fail('EQUIVALENCE_NOT_ESTABLISHED',
      'No percentile for ' + metric.key + ': this cohort has not established that its measurement definition matches ours. ' +
      'Comparing a pose-derived estimate against a differently-defined reference produces a confident number, not a valid one.');
  }
  if (unit !== metric.unit) fail('UNIT_MISMATCH', 'This cohort reports ' + metric.key + ' in ' + metric.unit + ', not ' + String(unit) + '.');
  if (!Number.isFinite(value) || value <= 0) fail('INVALID_MEASUREMENT', 'A positive finite measurement is required.');

  if (sex != null && cohort.population.sex !== 'both' && cohort.population.sex !== sex) {
    fail('SEX_NOT_COVERED', 'This cohort covers ' + cohort.population.sex + ' subjects only.');
  }

  // Every cohort states the ages it represents, so every distribution is refused outside them. A mean/SD
  // distribution used to skip this, which meant an adult reference would have answered for a ten-year-old.
  if (!Number.isFinite(ageMonths)) fail('AGE_REQUIRED', 'An age in months is required: every cohort represents a stated age range.');
  if (ageMonths < cohort.population.ageRange.minMonths || ageMonths > cohort.population.ageRange.maxMonths) {
    fail('AGE_OUT_OF_RANGE', 'This cohort covers ' + cohort.population.ageRange.minMonths + '-' + cohort.population.ageRange.maxMonths + ' months.');
  }

  let z;
  if (metric.distribution.type === 'mean_sd') {
    z = (value - metric.distribution.mean) / metric.distribution.sd;
  } else {
    const p = lmsAt(metric.distribution.rows, ageMonths);
    if (!p) fail('AGE_OUT_OF_RANGE', 'The cohort table does not cover this age.');
    // CDC's own formula: Z = ((X/M)^L - 1) / (L*S), and the L=0 limit is log(X/M)/S.
    z = p.L === 0 ? Math.log(value / p.M) / p.S : (Math.pow(value / p.M, p.L) - 1) / (p.L * p.S);
  }
  if (!Number.isFinite(z)) fail('INVALID_MEASUREMENT', 'The measurement produced no usable z-score.');

  return Object.freeze({
    schema: 'PP_REFERENCE_PERCENTILE_V1',
    metricKey: metric.key,
    value, unit: metric.unit,
    z, percentile: normalCdf(z) * 100,
    cohortId: cohort.cohortId,
    source: cohort.source,
    population: cohort.population,
    method: cohort.method,
    equivalence: metric.equivalence,
    limitations: 'Descriptive position within one published cohort. Not a diagnosis, not a prediction, and not evidence of athletic potential. ' +
      'It is only meaningful for a subject the cohort actually represents.',
  });
}

export { normalCdf as _normalCdf };
