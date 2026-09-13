// Measurement study export and analysis, end to end on synthetic participants.
//
// The export is the only thing an analyst receives, so the tests check what it must NOT contain as
// carefully as what it must: no names, no participant codes, no calendar dates, no race/ethnicity
// without consent, and no withdrawn participant. The analysis test plants a known bias and checks
// the pipeline recovers it.
const test = require('node:test');
const assert = require('node:assert/strict');

let S, E, I;
test.before(async () => {
  S = await import('../tools/study/study.mjs');
  E = await import('../tools/study/export.mjs');
  I = await import('../tools/study/scan-import.mjs');
});

const SEED = 'synthetic-seed-for-tests-0123456789abcdef';
const KEY = 'synthetic-export-key-0123456789abcdef';
const IN = 2.54;
const config = () => ({
  schema: 'PP_MEASUREMENT_STUDY_CONFIG_V1', studyId: 'synthetic-study',
  devices: [{ id: 'phone-a' }, { id: 'phone-b' }], phone1: 'phone-a',
  randomizationSeed: SEED, visit2WindowDays: [7, 14],
  reference: { combine: 'mean_of_two_median_of_three', tolerancesCm: { arm_span: 0.5, stature: 0.5 } },
});
const now = () => '2026-09-20T12:00:00.000Z';
let byte = 3;
const randomBytes = size => Buffer.from(Array.from({ length: size }, () => (byte = (byte * 53 + 17) % 256)));

const scan = (code, device, captureIndex, wingspanCm, visit = 1) => ({
  code, device, visit, captureIndex, capturedAt: visit === 1 ? '2026-09-20T15:00:00.000Z' : '2026-09-29T15:00:00.000Z',
  sdkVersion: '0.13.0', engine: { id: 'ondevice-pose', version: '1.3.0', model: 'synthetic' }, heightIn: 70,
  outputs: { wingspan: wingspanCm / IN }, missingOutputs: [],
});

// Four synthetic adults. The scan reads arm span high by 1.0 cm on average (offsets 0.8, 1.2, 0.9, 1.1).
function buildStudy({ lock = true, withdrawLast = false } = {}) {
  let state = S.emptyState(config());
  const spans = [170, 180, 165, 190], offsets = [0.8, 1.2, 0.9, 1.1];
  const codes = [];
  spans.forEach((span, i) => {
    const raceConsent = i === 0;
    const result = S.enroll(state, 'coordinator', {
      name: 'Synthetic Person ' + i, contact: 'person' + i + '@example.invalid', sex: i % 2 ? 'male' : 'female', ageYears: 25 + i,
      enrolledOn: '2026-09-20', consents: { visit2: true, raceEthnicity: raceConsent, futureContact: false },
      raceEthnicity: raceConsent ? 'synthetic group' : null,
    }, { randomBytes, now });
    state = result.state;
    const code = result.code;
    codes.push(code);
    for (const measurer of ['A', 'B']) {
      for (const value of [span, span + 0.2]) state = S.recordReading(state, 'measurer', { code, visit: 1, measure: 'arm_span', measurer, value, verifyValue: value }, { now }).state;
    }
    state = S.completeVisit(state, 'coordinator', { code, visit: 1, on: '2026-09-20' }, { now }).state;
    const truth = span + 0.1;
    state = S.recordScan(state, 'scan_operator', scan(code, 'phone-a', 1, truth + offsets[i]), { now }).state;
    state = S.recordScan(state, 'scan_operator', scan(code, 'phone-a', 2, truth + offsets[i] + (i % 2 ? 0.2 : -0.2)), { now }).state;
    state = S.recordScan(state, 'scan_operator', scan(code, 'phone-b', 1, truth + offsets[i] + 0.5), { now }).state;
    state = S.recordScan(state, 'scan_operator', scan(code, 'phone-a', 1, truth + offsets[i] + 0.1, 2), { now }).state;
  });
  if (withdrawLast) state = S.withdraw(state, 'coordinator', { code: codes.at(-1), on: '2026-09-25' }, { now }).state;
  if (lock) state = S.lockData(state, 'coordinator', { now }).state;
  return { state, codes };
}

test('the export refuses before the lock unless it is labelled interim', () => {
  const { state } = buildStudy({ lock: false });
  assert.throws(() => E.deidentifiedExport(state, 'analyst', { exportKey: KEY }), { code: 'NOT_LOCKED' });
  assert.throws(() => E.deidentifiedExport(state, 'coordinator', { exportKey: KEY, interim: true }), { code: 'NOT_PERMITTED' });
  const interim = E.deidentifiedExport(state, 'analyst', { exportKey: KEY, interim: true });
  assert.equal(interim.interim, true);
});

test('the export carries no names, codes, contact details or calendar dates', () => {
  const { state, codes } = buildStudy();
  const text = JSON.stringify(E.deidentifiedExport(state, 'analyst', { exportKey: KEY }));
  for (const code of codes) assert.ok(!text.includes(code), 'participant code leaked: ' + code);
  assert.ok(!/Synthetic Person|example\.invalid/.test(text), 'a name or contact detail leaked');
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(text), 'a calendar date leaked');
  assert.ok(!text.includes(KEY), 'the export key leaked');
});

test('race/ethnicity appears only with consent and when the export asks for it, and withdrawn participants are absent', () => {
  const { state } = buildStudy({ withdrawLast: true });
  const without = E.deidentifiedExport(state, 'analyst', { exportKey: KEY });
  assert.ok(without.participants.every(p => !('raceEthnicity' in p)));
  const withRace = E.deidentifiedExport(state, 'analyst', { exportKey: KEY, includeRaceEthnicity: true });
  assert.equal(withRace.participants.filter(p => 'raceEthnicity' in p).length, 1, 'only the one participant who consented');
  assert.equal(withRace.counts.participants, 3);
  assert.equal(withRace.counts.withdrawnExcluded, 1);
});

test('the analysis recovers a planted +1.0 cm bias, and reports repeatability and inter-rater error', () => {
  const { state } = buildStudy();
  const analysis = E.analyzeExport(E.deidentifiedExport(state, 'analyst', { exportKey: KEY }));
  const phoneA = analysis.agreement.wingspan.byDevice['phone-a'];
  assert.equal(phoneA.n, 4);
  assert.ok(Math.abs(phoneA.bias - 1.0) < 1e-9, 'bias ' + phoneA.bias);
  assert.ok(Math.abs(analysis.agreement.wingspan.byDevice['phone-b'].bias - 1.5) < 1e-9);
  assert.equal(analysis.agreement.wingspan.reference, 'arm_span');
  assert.equal(analysis.agreement.ear_width.descriptiveOnly, true);
  assert.equal(analysis.repeatability.withinSession.wingspan.n, 4);
  assert.ok(Math.abs(analysis.repeatability.withinSession.wingspan.tem - 0.2 / Math.SQRT2) < 1e-9);
  assert.equal(analysis.repeatability.betweenDay.wingspan.n, 4);
  assert.ok(Math.abs(analysis.interRater.arm_span.tem) < 1e-9, 'measurers A and B read identically in this synthetic set');
  assert.equal(analysis.agreement.left_thigh_length.byDevice['phone-a'].insufficient, true, 'no pairs recorded, reported as insufficient');
  assert.match(analysis.note, /No pass\/fail threshold is applied/);
});

test('a scan file goes through the product validator and keeps only scalar outputs', () => {
  const record = () => ({ schema: 'PP_COMPANY_BODY_ASSESSMENT_V1', assessmentId: 'synthetic-assessment-001', subjectId: 'synthetic-subject', organizationId: 'synthetic-org',
    createdBy: 'synthetic-operator', consentReference: 'synthetic-consent', capturedAt: '2026-09-20T15:00:00.000Z', savedAt: '2026-09-20T15:01:00.000Z', retentionUntil: null,
    assessment: { schema: 'PP_BODY_SDK_SUMMARY_V1', sdkVersion: '0.13.0', createdAt: '2026-09-20T15:00:00.000Z', status: 'provisional', unit: 'in', height: 70, processingMs: 1000,
      engine: { id: 'ondevice-pose', version: '1.3.0', model: 'synthetic' }, surfaceStatus: 'not_requested', outputCount: 1,
      measurements: [{ key: 'wingspan', label: 'Wingspan', value: 70.5, unit: 'in', definition: 'Predicted shoulder width plus twice the averaged shoulder-to-wrist path and estimated hand length. Not a direct fingertip-to-fingertip measurement.' }],
      missingOutputs: [], pairs: [] }, surfaceProcessing: null, dataScope: 'scalars only', limitations: 'provisional' });
  const devices = ['phone-a', 'phone-b'];
  const imported = I.scanFromCompanyRecord(record(), { code: 'PPS-000000-0', device: 'phone-a', visit: 1, captureIndex: 1, devices });
  assert.deepEqual({ ...imported.outputs }, { wingspan: 70.5 });
  assert.equal(imported.missingOutputs.length, 24);
  assert.equal(imported.heightIn, 70);
  const withPhotos = record(); withPhotos.photos = ['not allowed'];
  assert.throws(() => I.scanFromCompanyRecord(withPhotos, { code: 'PPS-000000-0', device: 'phone-a', visit: 1, captureIndex: 1, devices }), { code: 'INVALID_REFERENCE_EXPORT' });
  assert.throws(() => I.scanFromCompanyRecord(record(), { code: 'PPS-000000-0', device: 'laptop', visit: 1, captureIndex: 1, devices }), { code: 'UNKNOWN_DEVICE' });
});
