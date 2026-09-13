/* Measurement study operations: enrollment, readings, scans, visits, withdrawal and data lock.
 *
 * Every function takes the current state and a role, checks the role is allowed to do this
 * (blinding.mjs), and returns a new state. Nothing here touches the filesystem; store.mjs reads and
 * writes. That keeps each rule testable on its own, and keeps a mistake in file handling from being
 * able to bypass a rule.
 *
 * WHAT THIS ENFORCES FROM THE PROTOCOL
 *
 *   Adults only in phase 1 (§3).
 *   Race/ethnicity is recorded only with its own consent tick (§3), and never by default.
 *   Device order is fixed at enrollment by the recorded seed (§5); phone 1 always comes first.
 *   Every written value is typed twice, and the two must match before it is stored.
 *   A third reading is required when the first two differ by more than the configured tolerance.
 *   Withdrawal deletes the participant's data and link-key entry immediately (§6), even after the
 *   data lock, because the consent promises it.
 *   After the data lock, nothing new can be recorded.
 */

import { newParticipantCode, isValidParticipantCode, normalizeParticipantCode } from './codes.mjs';
import { deviceOrder } from './randomize.mjs';
import { REFERENCE_MEASURES, assertReferenceConfig, toleranceFor, evaluateReadings } from './reference.mjs';
import { visit2Window, assertVisitWindow } from './visits.mjs';
import { assertAllowed } from './blinding.mjs';

export const STUDY_CONFIG_SCHEMA = 'PP_MEASUREMENT_STUDY_CONFIG_V1';

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'StudyOperationError', code }); };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clone = value => structuredClone(value);
const nowIso = () => new Date().toISOString();

export function assertStudyConfig(config) {
  if (!config || config.schema !== STUDY_CONFIG_SCHEMA) fail('BAD_CONFIG', 'Not a measurement study configuration (' + STUDY_CONFIG_SCHEMA + ').');
  if (typeof config.studyId !== 'string' || !config.studyId.trim()) fail('BAD_CONFIG', 'The configuration needs a studyId.');
  if (!Array.isArray(config.devices) || !config.devices.length) fail('BAD_CONFIG', 'The configuration must list the study devices (protocol §4). There is no default device set.');
  const ids = config.devices.map(d => d?.id);
  if (!ids.every(id => typeof id === 'string' && id.trim()) || new Set(ids).size !== ids.length) fail('BAD_CONFIG', 'Every device needs a distinct id.');
  if (!ids.includes(config.phone1)) fail('BAD_CONFIG', 'phone1 must be one of the configured devices; it is used for the repeat captures.');
  if (typeof config.randomizationSeed !== 'string' || config.randomizationSeed.length < 32) fail('BAD_CONFIG', 'The configuration needs a recorded randomizationSeed of at least 32 characters.');
  assertVisitWindow(config.visit2WindowDays);
  assertReferenceConfig(config.reference);
  return true;
}

export function emptyState(config) {
  assertStudyConfig(config);
  return { config: clone(config), participants: [], linkKey: [], reference: [], scans: [], visits: [], audit: [], lockedAt: null };
}

function participantFor(state, code, { active = true } = {}) {
  const normalized = normalizeParticipantCode(code);
  if (!isValidParticipantCode(normalized)) fail('INVALID_CODE', 'Not a valid participant code: ' + code);
  const participant = state.participants.find(p => p.code === normalized);
  if (!participant) fail('UNKNOWN_PARTICIPANT', 'No participant with code ' + normalized);
  if (active && participant.status !== 'active') fail('NOT_ACTIVE', 'Participant ' + normalized + ' has withdrawn; nothing more can be recorded for them.');
  return participant;
}

function refuseIfLocked(state, action) {
  if (state.lockedAt) fail('DATA_LOCKED', 'The study data was locked on ' + state.lockedAt + '; ' + action + ' is no longer possible.');
}

export function enroll(state, role, details, { randomBytes, now = nowIso } = {}) {
  assertAllowed(role, 'enroll');
  refuseIfLocked(state, 'enrollment');
  const { name, contact, sex, ageYears, enrolledOn, consents, raceEthnicity = null } = details ?? {};
  if (typeof name !== 'string' || !name.trim()) fail('BAD_ENROLLMENT', 'A name is needed for the link key.');
  if (sex !== 'female' && sex !== 'male') fail('BAD_ENROLLMENT', 'Sex must be recorded as female or male, as in the protocol.');
  if (!Number.isInteger(ageYears) || ageYears < 18) fail('ADULTS_ONLY', 'Phase 1 enrolls adults only (protocol §3). Age must be a whole number of years, 18 or over.');
  if (typeof enrolledOn !== 'string' || !DAY.test(enrolledOn)) fail('BAD_ENROLLMENT', 'enrolledOn must be a calendar day, YYYY-MM-DD.');
  if (!consents || typeof consents.visit2 !== 'boolean' || typeof consents.raceEthnicity !== 'boolean' || typeof consents.futureContact !== 'boolean') {
    fail('BAD_ENROLLMENT', 'Each optional consent (visit2, raceEthnicity, futureContact) must be recorded as true or false.');
  }
  if (raceEthnicity != null && !consents.raceEthnicity) fail('NO_CONSENT', 'Race/ethnicity cannot be recorded without its own consent tick.');
  if (consents.raceEthnicity && (typeof raceEthnicity !== 'string' || !raceEthnicity.trim())) fail('BAD_ENROLLMENT', 'Race/ethnicity was consented to but not recorded.');

  const next = clone(state);
  const code = newParticipantCode(new Set(next.participants.map(p => p.code)), randomBytes);
  const enrollmentIndex = next.participants.length;   // includes withdrawn, so assignments never shift
  const others = next.config.devices.map(d => d.id).filter(id => id !== next.config.phone1);
  const order = [next.config.phone1, ...(others.length ? deviceOrder(enrollmentIndex, others, next.config.randomizationSeed) : [])];
  next.participants.push({ code, enrollmentIndex, enrolledOn, sex, ageYears, consents: { ...consents }, raceEthnicity: consents.raceEthnicity ? raceEthnicity.trim() : null, deviceOrder: order, status: 'active' });
  next.linkKey.push({ code, name: name.trim(), contact: typeof contact === 'string' ? contact.trim() : '' });
  next.visits.push({ code, visit: 1, on: enrolledOn, status: 'scheduled' });
  next.audit.push({ at: now(), event: 'enrolled', code });
  return { state: next, code, deviceOrder: order };
}

export function recordReading(state, role, entry, { now = nowIso } = {}) {
  assertAllowed(role, 'record_reference');
  refuseIfLocked(state, 'recording a reading');
  const { code, visit, measure, measurer, value, verifyValue } = entry ?? {};
  const participant = participantFor(state, code);
  if (visit !== 1 && visit !== 2) fail('BAD_VISIT', 'Visit must be 1 or 2.');
  if (visit === 2 && !state.visits.some(v => v.code === participant.code && v.visit === 2)) fail('NO_VISIT_2', 'Visit 2 is not scheduled for ' + participant.code + '.');
  if (!REFERENCE_MEASURES[measure]) fail('UNKNOWN_MEASURE', 'Unknown reference measure: ' + measure);
  if (typeof measurer !== 'string' || !measurer.trim()) fail('BAD_MEASURER', 'Each reading must name its measurer.');
  if (!(Number.isFinite(value) && value > 0)) fail('BAD_VALUE', 'A reading must be a positive number of centimetres.');
  // Double data entry: the value is typed twice, and a mismatch is a typo caught before it is stored.
  if (!Number.isFinite(verifyValue) || Math.round(value * 10) !== Math.round(verifyValue * 10)) {
    fail('ENTRY_MISMATCH', 'The two entries for this reading do not match (' + value + ' and ' + verifyValue + '). Nothing was stored; check the sheet and enter it again.');
  }
  const tolerance = toleranceFor(state.config.reference, measure);
  const prior = state.reference.filter(r => r.code === participant.code && r.visit === visit && r.measure === measure && r.measurer === measurer.trim());
  const before = evaluateReadings(prior.map(r => r.value), tolerance, state.config.reference.combine);
  if (before.status === 'complete') fail('ALREADY_COMPLETE', measure + ' is already complete for this visit and measurer.');
  const evaluation = evaluateReadings([...prior.map(r => r.value), value], tolerance, state.config.reference.combine);
  const next = clone(state);
  next.reference.push({ code: participant.code, visit, measure, measurer: measurer.trim(), attempt: prior.length + 1, value, recordedAt: now() });
  return { state: next, evaluation };
}

export function recordScan(state, role, scan, { now = nowIso } = {}) {
  assertAllowed(role, 'record_scan');
  refuseIfLocked(state, 'recording a scan');
  const participant = participantFor(state, scan?.code);
  if (!participant.deviceOrder.includes(scan.device)) fail('UNKNOWN_DEVICE', 'Device ' + scan.device + ' is not assigned to ' + participant.code + '.');
  if (scan.visit === 2 && !state.visits.some(v => v.code === participant.code && v.visit === 2)) fail('NO_VISIT_2', 'Visit 2 is not scheduled for ' + participant.code + '.');
  if (state.scans.some(s => s.code === participant.code && s.visit === scan.visit && s.device === scan.device && s.captureIndex === scan.captureIndex)) {
    fail('DUPLICATE_SCAN', 'Capture ' + scan.captureIndex + ' on ' + scan.device + ' at visit ' + scan.visit + ' is already recorded for ' + participant.code + '.');
  }
  const next = clone(state);
  next.scans.push({ ...clone(scan), code: participant.code, recordedAt: now() });
  return { state: next };
}

export function completeVisit(state, role, { code, visit, on }, { now = nowIso } = {}) {
  assertAllowed(role, 'manage_visits');
  const participant = participantFor(state, code);
  if (typeof on !== 'string' || !DAY.test(on)) fail('BAD_DATE', 'on must be a calendar day, YYYY-MM-DD.');
  const next = clone(state);
  const record = next.visits.find(v => v.code === participant.code && v.visit === visit);
  if (!record) fail('NO_SUCH_VISIT', 'Visit ' + visit + ' is not scheduled for ' + participant.code + '.');
  if (record.status === 'completed') fail('ALREADY_COMPLETE', 'Visit ' + visit + ' is already complete.');
  Object.assign(record, { status: 'completed', on });
  if (visit === 1 && participant.consents.visit2) {
    next.visits.push({ code: participant.code, visit: 2, status: 'scheduled', ...visit2Window(on, next.config.visit2WindowDays) });
  }
  next.audit.push({ at: now(), event: 'visit_completed', code: participant.code, visit });
  return { state: next };
}

export function markVisitMissed(state, role, { code, visit }, { now = nowIso } = {}) {
  assertAllowed(role, 'manage_visits');
  const participant = participantFor(state, code);
  const next = clone(state);
  const record = next.visits.find(v => v.code === participant.code && v.visit === visit);
  if (!record) fail('NO_SUCH_VISIT', 'Visit ' + visit + ' is not scheduled for ' + participant.code + '.');
  record.status = 'missed';
  next.audit.push({ at: now(), event: 'visit_missed', code: participant.code, visit });
  return { state: next };
}

/* Withdrawal: the participant's data and link-key entry are deleted now.
 *
 * What remains is the code with its enrollment index — so later device assignments do not shift —
 * and an audit line with counts of what was deleted, never the values. The reason is not stored:
 * a participant owes no reason, and a free-text reason is a place for personal information to hide.
 * Anything already exported cannot be recalled, which the consent outline says in advance.
 */
export function withdraw(state, role, { code, on }, { now = nowIso } = {}) {
  assertAllowed(role, 'withdraw');
  const participant = participantFor(state, code);
  if (typeof on !== 'string' || !DAY.test(on)) fail('BAD_DATE', 'on must be a calendar day, YYYY-MM-DD.');
  const next = clone(state);
  const removed = {
    readings: next.reference.filter(r => r.code === participant.code).length,
    scans: next.scans.filter(s => s.code === participant.code).length,
    visits: next.visits.filter(v => v.code === participant.code).length,
  };
  next.reference = next.reference.filter(r => r.code !== participant.code);
  next.scans = next.scans.filter(s => s.code !== participant.code);
  next.visits = next.visits.filter(v => v.code !== participant.code);
  next.linkKey = next.linkKey.filter(k => k.code !== participant.code);
  const index = next.participants.findIndex(p => p.code === participant.code);
  next.participants[index] = { code: participant.code, enrollmentIndex: participant.enrollmentIndex, status: 'withdrawn', withdrawnOn: on };
  next.audit.push({ at: now(), event: 'withdrawn', code: participant.code, removed, afterLock: !!next.lockedAt });
  return { state: next, removed };
}

export function lockData(state, role, { now = nowIso } = {}) {
  assertAllowed(role, 'lock_data');
  refuseIfLocked(state, 'locking again');
  const next = clone(state);
  next.lockedAt = now();
  next.audit.push({ at: next.lockedAt, event: 'data_locked' });
  return { state: next };
}
