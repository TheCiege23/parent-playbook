/* Producing an estimate from a frozen model artifact.
 *
 * This is the whole runtime: hand it the artifact and a person's four measurements, get back an
 * estimate or a refusal. It does not fit anything, does not read the cohort, and does not need the
 * survey data — which is what makes the artifact portable, and what a buyer would run.
 *
 * IT REFUSES MORE OFTEN THAN IT ESTIMATES, ON PURPOSE
 *
 * Every refusal below is a rule from research/NHANES-PREREGISTRATION.md, and each one exists
 * because the alternative is a number that looks like a measurement of somebody:
 *
 *   outside 18-59            no cycle after 2004 scanned anyone older, so nothing validates it
 *   no waist measurement     every model that does not need waist fails the fairness criterion,
 *                            so there is no fallback to quietly drop to
 *   an input out of range    an implausible input produces a confident implausible output
 *   an implausible output    refused rather than clamped; a clamped value looks measured
 *   a candidate artifact     asked for a released estimate, when no holdout has been read
 */

const REFUSAL = (code, message) => Object.freeze({ ok: false, code, message });

export function estimateBodyComposition(artifact, person = {}, { allowCandidate = false } = {}) {
  if (artifact?.schema !== 'PP_BODY_COMPOSITION_MODEL_V1') {
    return REFUSAL('UNKNOWN_ARTIFACT', 'That is not a Parent Playbook body composition model artifact.');
  }
  if (!artifact.model?.ensemble?.length) {
    return REFUSAL('EMPTY_ARTIFACT', 'That artifact carries no model. It cannot estimate anything, whatever else it says about itself.');
  }

  // The candidate gate. An artifact that has not been through a holdout is not a released model,
  // and a caller has to say out loud that it is using one anyway.
  if (artifact.status !== 'released' && !allowCandidate) {
    return REFUSAL('NOT_RELEASED',
      'This artifact is a ' + artifact.status + ' and no holdout has been read against it, so it has no '
      + 'validated performance. It must not be shown to anyone as an estimate. Pass allowCandidate to use it '
      + 'for research.');
  }

  const population = artifact.supportedPopulation?.ageYears;
  if (population && (!(person.ageYears >= population.min) || person.ageYears > population.max)) {
    return REFUSAL('OUTSIDE_SUPPORTED_POPULATION',
      'This model supports ages ' + population.min + ' to ' + population.max + '. '
      + (Number.isFinite(person.ageYears) ? 'Age ' + person.ageYears + ' is outside it' : 'No age was given')
      + ', and an estimate outside the population it was validated on is not an estimate.');
  }

  for (const input of artifact.inputs) {
    const value = person[input.key];
    if (input.required && !Number.isFinite(value)) {
      return REFUSAL('MISSING_INPUT',
        input.key + ' is required and was not given.'
        + (input.key === 'waistCm' ? ' There is no version of this model that works without a waist measurement: '
          + 'every model that does not need one fails the subgroup fairness criterion, so there is nothing to fall back to.' : ''));
    }
    if (Number.isFinite(value) && input.range && (value < input.range[0] || value > input.range[1])) {
      return REFUSAL('INPUT_OUT_OF_RANGE',
        input.key + ' of ' + value + ' ' + input.unit + ' is outside the range this model accepts ('
        + input.range[0] + '-' + input.range[1] + '). An implausible input produces a confident implausible output.');
    }
    if (input.values && !input.values.includes(value)) {
      return REFUSAL('INVALID_INPUT', input.key + ' must be one of ' + input.values.join(' or ') + '.');
    }
  }

  const predicted = scoreEnsemble(artifact.model, person);
  if (!Number.isFinite(predicted)) {
    return REFUSAL('PREDICTION_FAILED', 'The model did not produce a finite value for these inputs.');
  }
  if (predicted < 1 || predicted > 75) {
    return REFUSAL('IMPLAUSIBLE_PREDICTION',
      'The predicted body fat of ' + predicted.toFixed(1) + '% is outside the range this model supports. '
      + 'No estimate is produced: a clamped value would look measured and would not be.');
  }

  const totalMassKg = person.weightKg;
  const fatMassKg = totalMassKg * predicted / 100;
  const leanMassKg = totalMassKg - fatMassKg;
  if (fatMassKg < 0 || fatMassKg > totalMassKg) {
    return REFUSAL('INCONSISTENT_COMPOSITION', 'The derived masses do not reconcile with total body mass.');
  }

  return Object.freeze({
    ok: true,
    modelId: artifact.id,
    modelVersion: artifact.version,
    modelStatus: artifact.status,
    bodyFatPercent: Math.round(predicted * 10) / 10,
    fatMassKg: Math.round(fatMassKg * 10) / 10,
    leanMassKg: Math.round(leanMassKg * 10) / 10,
    // Travels with the number so a screen cannot relabel it on the way to a person.
    leanMassDefinition: artifact.notSkeletalMuscle,
    origin: 'model_estimate',
    isParentPlaybookEstimate: true,
    limitations: artifact.limitations,
    // Repeated in the result rather than left in the artifact, because the caller that displays
    // this is not necessarily the caller that loaded it.
    validated: artifact.holdoutRead ? 'Validated against a held-out survey cycle.' : 'NOT VALIDATED. No holdout has been read against this model.',
  });
}

function scoreEnsemble(model, row) {
  let value = model.base;
  for (const tree of model.ensemble) value += model.learningRate * leafValue(tree, row);
  return value;
}
const leafValue = (node, row) => (node.leaf ? node.value
  : leafValue(row[node.feature] <= node.threshold ? node.left : node.right, row));

/* What an artifact says about itself, for a reader deciding whether to trust it. */
export function describeArtifact(artifact) {
  return Object.freeze({
    id: artifact.id, version: artifact.version, status: artifact.status,
    holdoutRead: !!artifact.holdoutRead,
    releasable: artifact.status === 'released' && !!artifact.holdoutRead,
    supportedAges: artifact.supportedPopulation?.ageYears ?? null,
    requiredInputs: Object.freeze(artifact.inputs.filter(i => i.required).map(i => i.key)),
    refusalConditions: Object.freeze([...(artifact.refusalConditions ?? [])]),
    trainedOn: artifact.training?.fittedOn ?? null,
    calibrationMae: artifact.calibrationReport?.mae ?? null,
    holdoutReport: artifact.holdoutReport ?? null,
  });
}
