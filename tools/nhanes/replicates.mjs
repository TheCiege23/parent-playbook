/* Replicate rows in the NHANES DXA files, and the refusal to guess what to do about them.
 *
 * The 1999-2004 whole-body DXA files carry exactly five rows per participant: a variable named
 * `_MULT_`, labelled "Imputation Version", counting 1 to 5. The 2011-2018 files carry one row per
 * participant and no such variable. Measured counts are in research/NHANES-DATA-STRUCTURE.md.
 *
 * Joining the early files on the participant identifier without accounting for this multiplies the
 * cohort by five. It does not error and does not look wrong — one person becomes five people who
 * happen to agree, every standard error shrinks, and any model fitted on the result looks better
 * than it is. That is the entire reason this file exists.
 *
 * THERE IS NO DEFAULT POLICY, DELIBERATELY
 *
 * Three handlings are defensible and they answer different questions. A default would be chosen
 * once, by whoever wrote this line, and then never thought about again by anyone — so naming one
 * is required and the choice is recorded in the report that comes back.
 */

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'NhanesReplicateError', code }); };

export const REPLICATE_POLICIES = Object.freeze({
  /* Keep only participants whose DXA was actually measured, and collapse their identical
   * replicates to one row.
   *
   * The right choice for training a model whose purpose is to approximate a DXA measurement:
   * training partly on somebody else's imputation of a DXA measurement is a different exercise,
   * and one whose error is not the error being reported.
   */
  measured_only: {
    label: 'Measured only',
    keeps: 'participants flagged as not imputed, collapsed to one row',
    cost: 'Drops roughly a fifth of the early-cycle participants.',
  },
  /* Take the first imputation for everyone.
   *
   * Keeps the participant count up and silently discards the imputation uncertainty, which then
   * reappears later as confidence the study has not earned.
   */
  single_imputation: {
    label: 'First imputation',
    keeps: 'one row per participant, imputed or not',
    cost: 'Discards imputation uncertainty entirely; imputed values become indistinguishable from measured ones downstream unless carried separately.',
  },
  /* Keep all five, flagged, for combination by Rubin's rules.
   *
   * Correct when done properly. Wrong, and invisibly so, if the five are then pooled as
   * independent observations — which is the failure this module exists to prevent, so the rows
   * come back marked and the report says plainly that they are not observations.
   */
  all_imputations: {
    label: 'All imputations',
    keeps: 'every replicate, marked with its version',
    cost: "Must be combined by Rubin's rules. Pooling these as independent rows is the exact error this module exists to prevent.",
  },
});

/* What shape is this file?
 *
 * Answered by counting, not by which cycle the filename suggests. A file that gains or loses its
 * imputation apparatus between releases should change the answer here rather than surprise
 * something downstream.
 */
export function detectReplicates(rows, { idKey = 'SEQN', versionKey = '_MULT_' } = {}) {
  if (!Array.isArray(rows) || !rows.length) fail('NO_ROWS', 'There are no rows to inspect.');
  const perParticipant = new Map();
  const versions = new Set();
  for (const row of rows) {
    const id = row?.[idKey];
    if (id == null) fail('MISSING_PARTICIPANT_ID', 'A row has no ' + idKey + '. Rows without a participant identifier cannot be counted, deduplicated or excluded, so this is refused rather than skipped.');
    perParticipant.set(id, (perParticipant.get(id) || 0) + 1);
    if (row[versionKey] != null) versions.add(row[versionKey]);
  }
  const counts = [...perParticipant.values()];
  const min = Math.min(...counts), max = Math.max(...counts);
  return Object.freeze({
    rows: rows.length,
    participants: perParticipant.size,
    rowsPerParticipant: rows.length / perParticipant.size,
    minRowsPerParticipant: min,
    maxRowsPerParticipant: max,
    uniform: min === max,
    hasVersionVariable: versions.size > 0,
    versions: Object.freeze([...versions].sort((a, b) => a - b)),
    replicated: max > 1,
  });
}

/* Reduce a replicated file to one row per participant, under a named policy.
 *
 * A file that is not replicated passes through and says so. A file that is replicated without a
 * policy is refused, with the counts in the message so the person choosing knows what they are
 * choosing between.
 */
export function collapseReplicates(rows, {
  policy = null, idKey = 'SEQN', versionKey = '_MULT_', imputationFlagKey = 'DXITOT', valueKey = 'DXDTOPF',
} = {}) {
  const shape = detectReplicates(rows, { idKey, versionKey });

  if (!shape.replicated) {
    return Object.freeze({
      rows, policy: 'not_replicated', droppedParticipants: Object.freeze([]),
      report: Object.freeze({ ...shape, kept: rows.length, dropped: 0,
        note: 'One row per participant; no replicate handling was needed or applied.' }),
    });
  }

  if (!policy) {
    fail('REPLICATE_POLICY_REQUIRED',
      'This file has ' + shape.rowsPerParticipant.toFixed(2) + ' rows per participant ('
      + shape.rows + ' rows, ' + shape.participants + ' participants'
      + (shape.hasVersionVariable ? ', ' + versionKey + ' values ' + shape.versions.join('/') : '')
      + '). These are imputation replicates, not observations: joining them as they are would count '
      + 'one person as ' + shape.maxRowsPerParticipant + ' people. Choose a policy explicitly — '
      + Object.keys(REPLICATE_POLICIES).join(', ') + ' — and record why. There is no default, '
      + 'because a default would be chosen once and never reconsidered.');
  }
  if (!REPLICATE_POLICIES[policy]) {
    fail('UNKNOWN_REPLICATE_POLICY', policy + ' is not a replicate policy. Supported: ' + Object.keys(REPLICATE_POLICIES).join(', ') + '.');
  }
  if (!shape.uniform) {
    fail('UNEVEN_REPLICATES',
      'Participants have between ' + shape.minRowsPerParticipant + ' and ' + shape.maxRowsPerParticipant
      + ' rows. A file where the replicate count varies is not the structure this handles, and '
      + 'collapsing it would silently treat two different situations the same way. Find out why '
      + 'before continuing.');
  }

  const byParticipant = new Map();
  for (const row of rows) {
    const id = row[idKey];
    if (!byParticipant.has(id)) byParticipant.set(id, []);
    byParticipant.get(id).push(row);
  }

  const kept = [];
  // Who measured_only removed, and whether any replicate carried a value. Returned rather than only
  // counted: these participants leave the file here, before any exclusion runs, and a cohort flow
  // that cannot see them counts them as having no DXA record at all.
  const dropped = [];
  let droppedImputed = 0, keptImputed = 0, keptMeasured = 0;

  for (const [, group] of byParticipant) {
    // The flag is on every replicate of a participant; the first is representative.
    const imputed = group[0]?.[imputationFlagKey] !== 0;
    if (policy === 'measured_only') {
      if (imputed) {
        droppedImputed++;
        dropped.push(Object.freeze({ id: group[0][idKey], hasValue: group.some(row => row[valueKey] != null) }));
        continue;
      }
      kept.push(pickVersion(group, versionKey, 1));
      keptMeasured++;
    } else if (policy === 'single_imputation') {
      kept.push(pickVersion(group, versionKey, 1));
      if (imputed) keptImputed++; else keptMeasured++;
    } else {
      for (const row of group) kept.push(row);
      if (imputed) keptImputed++; else keptMeasured++;
    }
  }

  return Object.freeze({
    rows: kept,
    policy,
    droppedParticipants: Object.freeze(dropped),
    report: Object.freeze({
      ...shape,
      policy,
      policyLabel: REPLICATE_POLICIES[policy].label,
      policyCost: REPLICATE_POLICIES[policy].cost,
      kept: kept.length,
      dropped: rows.length - kept.length,
      participantsKept: policy === 'measured_only' ? keptMeasured : byParticipant.size,
      participantsDropped: policy === 'measured_only' ? droppedImputed : 0,
      droppedWithImputedValue: dropped.filter(d => d.hasValue).length,
      droppedWithoutValue: dropped.filter(d => !d.hasValue).length,
      measuredParticipants: keptMeasured,
      imputedParticipants: policy === 'measured_only' ? 0 : keptImputed,
      // Said out loud in the report rather than left to the reader to remember.
      warning: policy === 'all_imputations'
        ? 'These rows are NOT independent observations. Combine them by Rubin’s rules; pooling them as ordinary rows will understate every standard error.'
        : null,
    }),
  });
}

function pickVersion(group, versionKey, wanted) {
  const exact = group.find(row => row[versionKey] === wanted);
  return exact || group[0];
}

/* Are a participant's replicates actually identical?
 *
 * Where the imputation flag says nothing was imputed, the five rows are exact duplicates and the
 * machinery is carrying no information. Where it says something was, they differ. Checking rather
 * than assuming means a cycle that breaks the pattern is a finding instead of a silent change of
 * meaning.
 */
export function replicatesAgree(rows, key, { idKey = 'SEQN' } = {}) {
  const byParticipant = new Map();
  for (const row of rows) {
    const id = row[idKey];
    if (!byParticipant.has(id)) byParticipant.set(id, []);
    byParticipant.get(id).push(row);
  }
  let identical = 0, varying = 0;
  for (const [, group] of byParticipant) {
    if (new Set(group.map(row => row[key])).size === 1) identical++; else varying++;
  }
  return Object.freeze({ key, participants: byParticipant.size, identical, varying });
}
