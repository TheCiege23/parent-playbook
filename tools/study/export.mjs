/* De-identified export and analysis for the measurement study.
 *
 * The analyst never sees the study state. They receive an export in which:
 *
 *   participant codes are replaced by keyed pseudonyms (codes.mjs), under a key the export omits;
 *   calendar dates are replaced by whole days since the participant's first visit;
 *   names, contact details and the link key are absent;
 *   race/ethnicity appears only when the participant ticked its box AND the export asks for it;
 *   withdrawn participants are absent entirely;
 *   scan outputs are converted to centimetres, the unit of the reference measurements.
 *
 * The export refuses until the coordinator has locked the data. An interim export is possible, and it
 * says "interim" in its own metadata so nobody mistakes it for the final dataset.
 *
 * The analysis reads only the export. It reports what protocol §7 lists and makes no pass/fail
 * judgement: §9 leaves the thresholds to the statistician.
 */

import { exportPseudonym } from './codes.mjs';
import { REFERENCE_MEASURES, SCAN_TO_REFERENCE, toleranceFor, evaluateReadings, referenceForScanOutput } from './reference.mjs';
import { daysBetween } from './visits.mjs';
import { assertAllowed } from './blinding.mjs';
import { blandAltman, technicalError, intraclassCorrelation } from './analysis.mjs';

export const EXPORT_SCHEMA = 'PP_MEASUREMENT_STUDY_EXPORT_V1';
export const ANALYSIS_SCHEMA = 'PP_MEASUREMENT_STUDY_ANALYSIS_V1';
const IN_TO_CM = 2.54;
const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'StudyExportError', code }); };

export function deidentifiedExport(state, role, { exportKey, includeRaceEthnicity = false, interim = false } = {}) {
  assertAllowed(role, 'export_deidentified');
  if (!state.lockedAt && !interim) {
    fail('NOT_LOCKED', 'The data is not locked. Lock it before the final export, or ask for an interim export, which is labelled as interim.');
  }
  const config = state.config;
  const active = state.participants.filter(p => p.status === 'active');
  const pseudonymOf = new Map(active.map(p => [p.code, exportPseudonym(p.code, exportKey)]));
  const firstDayOf = new Map(active.map(p => [p.code, state.visits.find(v => v.code === p.code && v.visit === 1)?.on ?? p.enrolledOn]));

  const participants = active.map(p => Object.freeze({
    pseudonym: pseudonymOf.get(p.code), sex: p.sex, ageYears: p.ageYears,
    ...(includeRaceEthnicity && p.consents.raceEthnicity ? { raceEthnicity: p.raceEthnicity } : {}),
  }));

  // One final value per participant, visit, measurer and measure, from complete readings only.
  const groups = new Map();
  for (const r of state.reference) {
    if (!pseudonymOf.has(r.code)) continue;
    const key = [r.code, r.visit, r.measurer, r.measure].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const reference = [];
  let incompleteReadings = 0;
  for (const readings of groups.values()) {
    const { code, visit, measurer, measure } = readings[0];
    const ordered = [...readings].sort((a, b) => a.attempt - b.attempt);
    const evaluation = evaluateReadings(ordered.map(r => r.value), toleranceFor(config.reference, measure), config.reference.combine);
    if (evaluation.status !== 'complete') { incompleteReadings++; continue; }
    reference.push(Object.freeze({ pseudonym: pseudonymOf.get(code), visit, measurer, measure, valueCm: evaluation.final, method: evaluation.method, readings: ordered.length }));
  }

  const scans = state.scans.filter(s => pseudonymOf.has(s.code)).map(s => Object.freeze({
    pseudonym: pseudonymOf.get(s.code), visit: s.visit, dayOffset: daysBetween(firstDayOf.get(s.code), s.capturedAt.slice(0, 10)),
    device: s.device, captureIndex: s.captureIndex, sdkVersion: s.sdkVersion, engineVersion: s.engine?.version ?? null,
    heightCm: Number.isFinite(s.heightIn) ? s.heightIn * IN_TO_CM : null,
    outputsCm: Object.freeze(Object.fromEntries(Object.entries(s.outputs).map(([k, v]) => [k, v * IN_TO_CM]))),
  }));

  return Object.freeze({
    schema: EXPORT_SCHEMA,
    studyId: config.studyId,
    interim: !state.lockedAt,
    phone1: config.phone1,
    devices: config.devices.map(d => d.id),
    counts: Object.freeze({ participants: participants.length, withdrawnExcluded: state.participants.length - active.length, incompleteReadingsExcluded: incompleteReadings }),
    participants: Object.freeze(participants),
    reference: Object.freeze(reference),
    scans: Object.freeze(scans),
  });
}

const tryStat = (fn, input) => {
  try { return fn(input); } catch (error) { return Object.freeze({ insufficient: true, reason: error.message }); }
};

/* Everything protocol §7 lists that can be computed from the export, with no thresholds applied. */
export function analyzeExport(exported, { primaryMeasurer = 'A', secondMeasurer = 'B' } = {}) {
  if (exported?.schema !== EXPORT_SCHEMA) fail('BAD_EXPORT', 'Not a measurement study export.');
  const finals = new Map();   // pseudonym|visit|measurer -> {measure: value}
  for (const r of exported.reference) {
    const key = [r.pseudonym, r.visit, r.measurer].join('|');
    if (!finals.has(key)) finals.set(key, {});
    finals.get(key)[r.measure] = r.valueCm;
  }
  const finalsFor = (pseudonym, visit, measurer) => finals.get([pseudonym, visit, measurer].join('|')) ?? {};
  const scanAt = (pseudonym, visit, device, captureIndex) =>
    exported.scans.find(s => s.pseudonym === pseudonym && s.visit === visit && s.device === device && s.captureIndex === captureIndex);

  const agreement = {}, withinSession = {}, betweenDay = {}, deviceIcc = {}, missing = {};
  for (const key of Object.keys(SCAN_TO_REFERENCE)) {
    const mapping = SCAN_TO_REFERENCE[key];
    missing[key] = Object.fromEntries(exported.devices.map(device => [device,
      exported.scans.filter(s => s.device === device && !Number.isFinite(s.outputsCm[key])).length]));

    // Repeatability applies to every output, descriptive-only ones included.
    const within = exported.participants.map(p => [scanAt(p.pseudonym, 1, exported.phone1, 1)?.outputsCm[key], scanAt(p.pseudonym, 1, exported.phone1, 2)?.outputsCm[key]])
      .filter(pair => pair.every(Number.isFinite));
    withinSession[key] = tryStat(technicalError, within);
    const across = exported.participants.map(p => [scanAt(p.pseudonym, 1, exported.phone1, 1)?.outputsCm[key], scanAt(p.pseudonym, 2, exported.phone1, 1)?.outputsCm[key]])
      .filter(pair => pair.every(Number.isFinite));
    betweenDay[key] = tryStat(technicalError, across);
    const matrix = exported.participants.map(p => exported.devices.map(device => scanAt(p.pseudonym, 1, device, 1)?.outputsCm[key]))
      .filter(row => row.every(Number.isFinite));
    deviceIcc[key] = exported.devices.length > 1 ? tryStat(intraclassCorrelation, matrix) : Object.freeze({ insufficient: true, reason: 'Only one device is configured.' });

    if (!mapping) { agreement[key] = Object.freeze({ descriptiveOnly: true }); continue; }
    const byDevice = {};
    for (const device of exported.devices) {
      const pairs = [];
      for (const p of exported.participants) {
        const scan = scanAt(p.pseudonym, 1, device, 1);
        const ref = referenceForScanOutput(key, finalsFor(p.pseudonym, 1, primaryMeasurer));
        if (scan && Number.isFinite(scan.outputsCm[key]) && Number.isFinite(ref.value)) pairs.push({ scan: scan.outputsCm[key], reference: ref.value });
      }
      byDevice[device] = tryStat(blandAltman, pairs);
    }
    agreement[key] = Object.freeze({ reference: mapping.reference, caveat: mapping.caveat, byDevice: Object.freeze(byDevice) });
  }

  // Reference quality: measurer A against measurer B on the inter-rater subset.
  const interRater = {};
  for (const measure of Object.keys(REFERENCE_MEASURES)) {
    const pairs = exported.participants.map(p => [finalsFor(p.pseudonym, 1, primaryMeasurer)[measure], finalsFor(p.pseudonym, 1, secondMeasurer)[measure]])
      .filter(pair => pair.every(Number.isFinite));
    interRater[measure] = tryStat(technicalError, pairs);
  }

  return Object.freeze({
    schema: ANALYSIS_SCHEMA,
    interim: exported.interim,
    counts: exported.counts,
    agreement: Object.freeze(agreement),
    repeatability: Object.freeze({ withinSession: Object.freeze(withinSession), betweenDay: Object.freeze(betweenDay) }),
    deviceIcc: Object.freeze(deviceIcc),
    interRater: Object.freeze(interRater),
    missingOutputs: Object.freeze(missing),
    note: 'Descriptive statistics only. No pass/fail threshold is applied; protocol §9 leaves those to the qualified statistician. '
      + 'Outputs marked caveat are compared with the nearest standard measurement, which is not the same quantity.',
  });
}
