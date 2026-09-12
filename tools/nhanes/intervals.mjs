/* Uncertainty intervals for the body-fat estimate, under amendment 6 of
 * research/NHANES-PREREGISTRATION.md.
 *
 * Split-conformal, symmetric, one half-width for everyone. The half-width is read off residuals the
 * model was not fitted on, so the stated coverage is a property of held-out data rather than of the
 * model's opinion of itself. Nothing here fits a model or reads the survey; it takes residuals and
 * produces widths, intervals and coverage, which keeps every rule testable on numbers small enough
 * to check by hand.
 *
 * WHAT A HALF-WIDTH MAY DEPEND ON
 *
 * Nothing about the person. intervalFor takes an estimate and a half-width and nothing else, so no
 * input — and in particular no race or ethnicity — can widen or narrow one person's interval
 * relative to another's. The group-covering rule looks at subgroups to choose that single number,
 * and amendment 6 records that as a use of the audit variable the preregistration did not
 * contemplate. It is still one number.
 */

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'NhanesIntervalError', code }); };

export const NOMINAL_COVERAGE = 0.9;
export const ACCEPTED_RANGE = Object.freeze([1, 75]);
export const MINIMUM_SUBGROUP = 100;

/* The conformal half-width: the ceil((n+1) * coverage)-th smallest absolute residual.
 *
 * The n+1 is the finite-sample correction that makes the coverage guarantee hold rather than hold
 * approximately. When the set is too small for that index to exist the honest half-width is
 * unbounded, and Infinity is returned instead of the largest residual, which would understate it.
 */
export function conformalHalfWidth(absoluteResiduals, coverage = NOMINAL_COVERAGE) {
  if (!(coverage > 0 && coverage < 1)) fail('BAD_COVERAGE', 'Coverage must be strictly between 0 and 1; got ' + coverage + '.');
  if (!Array.isArray(absoluteResiduals) || !absoluteResiduals.length) fail('NO_RESIDUALS', 'A half-width needs at least one residual.');
  // Checked rather than filtered. A residual quietly dropped shrinks n, and a smaller n moves the
  // index — the interval would get narrower because data went missing.
  for (const value of absoluteResiduals) {
    if (!Number.isFinite(value)) fail('NON_FINITE_RESIDUAL', 'Every residual must be a finite number; got ' + value + '.');
    if (value < 0) fail('NEGATIVE_RESIDUAL', 'Residuals must be absolute values, |actual - estimate|; got ' + value + '.');
  }
  const k = Math.ceil((absoluteResiduals.length + 1) * coverage);
  if (k > absoluteResiduals.length) return Infinity;
  return [...absoluteResiduals].sort((a, b) => a - b)[k - 1];
}

/* W2: the smallest single half-width that gives the pooled set and every subgroup large enough to
 * report its own conformal coverage.
 *
 * records: [{ absoluteResidual, person }]. breakdowns: { dimension: person => key or null }.
 * Subgroups under the minimum are listed as insufficient and do not set the width, matching how
 * §8 treats a subgroup too small to summarize.
 */
export function groupCoveringHalfWidth(records, breakdowns, { coverage = NOMINAL_COVERAGE, minimum = MINIMUM_SUBGROUP } = {}) {
  const pooled = conformalHalfWidth(records.map(record => record.absoluteResidual), coverage);
  const groups = [];
  for (const [dimension, keyOf] of Object.entries(breakdowns)) {
    const byKey = new Map();
    for (const record of records) {
      const key = keyOf(record.person);
      if (key == null) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(record.absoluteResidual);
    }
    for (const [key, values] of [...byKey].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
      groups.push(values.length < minimum
        ? Object.freeze({ dimension, key, n: values.length, insufficient: true })
        : Object.freeze({ dimension, key, n: values.length, insufficient: false, halfWidth: conformalHalfWidth(values, coverage) }));
    }
  }
  const reported = groups.filter(group => !group.insufficient);
  let binding = null;
  for (const group of reported) if (group.halfWidth > pooled && (binding == null || group.halfWidth > binding.halfWidth)) binding = group;
  return Object.freeze({
    halfWidth: binding ? binding.halfWidth : pooled,
    pooled,
    // The subgroup that set the width, or null when the pooled width already covers every subgroup.
    binding,
    groups: Object.freeze(groups),
  });
}

/* One person's interval: the estimate plus and minus the half-width, inside the accepted range.
 *
 * §4: the interval contains the estimate and stays inside the accepted range. An estimate outside
 * that range returns null — it is already refused by the predictor, and an interval around a
 * refused number would be a way of showing it anyway.
 */
export function intervalFor(estimate, halfWidth, [low, high] = ACCEPTED_RANGE) {
  if (!Number.isFinite(estimate) || estimate < low || estimate > high) return null;
  if (!(halfWidth >= 0)) fail('BAD_HALF_WIDTH', 'A half-width must be zero or more; got ' + halfWidth + '.');
  const lower = Math.max(low, estimate - halfWidth);
  const upper = Math.min(high, estimate + halfWidth);
  return Object.freeze({
    estimate, lower, upper,
    truncated: lower !== estimate - halfWidth || upper !== estimate + halfWidth,
  });
}

/* The lowest coverage that sampling error alone explains: nominal - z * SE(n). */
export function coverageFloor(n, { nominal = NOMINAL_COVERAGE, z = 2 } = {}) {
  if (!(n > 0)) fail('NO_OBSERVATIONS', 'A coverage floor needs at least one observation.');
  return nominal - z * Math.sqrt(nominal * (1 - nominal) / n);
}

/* Coverage over [{ actual, interval }], with the misses split by direction.
 *
 * "Estimate too high" is the actual value falling below the interval. The direction is reported
 * because a symmetric interval can reach its nominal coverage while every miss falls on one side,
 * and one-sided misses are what a group-level bias looks like.
 */
export function summarizeCoverage(records, { nominal = NOMINAL_COVERAGE, z = 2 } = {}) {
  if (!records.length) fail('NO_OBSERVATIONS', 'Coverage needs at least one interval.');
  let covered = 0, estimateTooHigh = 0, estimateTooLow = 0;
  for (const { actual, interval } of records) {
    if (!Number.isFinite(actual) || !interval) fail('INCOMPLETE_RECORD', 'Every record needs an actual value and an interval.');
    if (actual < interval.lower) estimateTooHigh++;
    else if (actual > interval.upper) estimateTooLow++;
    else covered++;
  }
  const n = records.length;
  const coverage = covered / n;
  const floor = coverageFloor(n, { nominal, z });
  return Object.freeze({ n, covered, coverage, estimateTooHigh, estimateTooLow, floor, z, pass: coverage >= floor });
}
