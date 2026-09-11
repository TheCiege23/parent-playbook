// ===================================================================
//  LOADED REFERENCE COHORTS — currently none, and that is the point
// ===================================================================
// The registry the app reads when deciding whether a measurement can be shown
// against a population. js/reference-cohort.mjs is the contract and the
// statistics; this is the list of cohorts that have actually cleared it.
//
// The list is EMPTY. Not because no data exists — ANSUR II is public domain and
// has 93 measurements on 6,068 subjects — but because definitional equivalence
// between our pose-derived estimates and any published anthropometric protocol
// has not been established. REFERENCE-COHORTS.md is the long version.
//
// Adding a cohort here is not a code change on its own. An entry must validate
// against validateReferenceCohort(), and only its metrics with an established
// equivalence — naming what they were compared against and what established it —
// ever reach a reader. tests/reference-cohort.test.cjs enforces both, so this
// file cannot quietly acquire a percentile that nobody earned.
//
// Height is the exception already shipping: CDC stature-for-age, in
// js/cdc-stature.js, measured by stadiometer to a definition that matches what a
// parent records. That is what an established reference looks like.

const REFERENCE_COHORTS = [];

// Why the list is empty, in the words a parent should see rather than a developer.
const REFERENCE_COHORT_REASON =
  'Body-length estimates have no population comparison yet. Published measurement sets are taken by tape and caliper to anatomical definitions; these are photo estimates scaled from a supplied height, and the two have not been shown to measure the same thing. Showing a percentile before that is established would look precise and mean nothing.';

/** The cohort that may be used for one metric, or null. Only an established equivalence qualifies. */
function referenceCohortForMetric(metricKey) {
  for (const cohort of REFERENCE_COHORTS) {
    const metric = (cohort.metrics || []).find(m => m.key === metricKey);
    if (metric && metric.equivalence && metric.equivalence.status === 'established') return cohort;
  }
  return null;
}

/** What the app can honestly say about population references right now. */
function referenceCohortSummary() {
  const usableMetrics = [];
  for (const cohort of REFERENCE_COHORTS) {
    for (const metric of cohort.metrics || []) {
      if (metric.equivalence && metric.equivalence.status === 'established' && !usableMetrics.includes(metric.key)) {
        usableMetrics.push(metric.key);
      }
    }
  }
  return {
    loaded: REFERENCE_COHORTS.length,
    usableMetrics,
    // Stature is referenced through cdc-stature.js, not through this registry.
    statureReference: 'CDC 2000 stature-for-age',
    reason: usableMetrics.length ? null : REFERENCE_COHORT_REASON,
  };
}
