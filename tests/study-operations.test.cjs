// Measurement study operations: codes, device order, readings, blinding, visits, withdrawal, lock
// and storage. Every participant here is synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let C, R, REF, V, B, S, STORE;
test.before(async () => {
  C = await import('../tools/study/codes.mjs');
  R = await import('../tools/study/randomize.mjs');
  REF = await import('../tools/study/reference.mjs');
  V = await import('../tools/study/visits.mjs');
  B = await import('../tools/study/blinding.mjs');
  S = await import('../tools/study/study.mjs');
  STORE = await import('../tools/study/store.mjs');
});

const SEED = 'synthetic-seed-for-tests-0123456789abcdef';
const config = (over = {}) => ({
  schema: 'PP_MEASUREMENT_STUDY_CONFIG_V1', studyId: 'synthetic-study',
  devices: [{ id: 'phone-a' }, { id: 'phone-b' }, { id: 'phone-c' }], phone1: 'phone-a',
  randomizationSeed: SEED, visit2WindowDays: [7, 14],
  reference: { combine: 'mean_of_two_median_of_three', tolerancesCm: { stature: 0.5, arm_span: 0.5 } },
  ...over,
});
// Deterministic "random" bytes so participant codes are reproducible.
const bytesFrom = seedByte => { let n = seedByte; return size => Buffer.from(Array.from({ length: size }, () => (n = (n * 37 + 11) % 256))); };
const fixedNow = () => '2026-09-13T12:00:00.000Z';
const adult = (over = {}) => ({ name: 'Synthetic Person', contact: 'synthetic@example.invalid', sex: 'female', ageYears: 30, enrolledOn: '2026-09-20',
  consents: { visit2: true, raceEthnicity: false, futureContact: false }, ...over });
const enrolled = (state, over, seedByte = 1) => S.enroll(state, 'coordinator', adult(over), { randomBytes: bytesFrom(seedByte), now: fixedNow });

// ----------------------------------------------------------------- codes

test('participant codes carry a check character that catches any single mistyped character', () => {
  const code = C.newParticipantCode(new Set(), bytesFrom(5));
  assert.ok(C.isValidParticipantCode(code), code);
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const body = code.slice(4, 10);
  for (let i = 0; i < 6; i++) {
    for (const ch of alphabet) {
      if (ch === body[i]) continue;
      const typo = 'PPS-' + body.slice(0, i) + ch + body.slice(i + 1) + code.slice(10);
      assert.ok(!C.isValidParticipantCode(typo), 'missed a substitution at position ' + i + ': ' + typo);
    }
  }
  assert.ok(C.isValidParticipantCode(code.toLowerCase().replace(/0/g, 'o')), 'lower case and O-for-zero are normalized');
});

test('export pseudonyms need a strong key and differ between keys', () => {
  const code = C.newParticipantCode(new Set(), bytesFrom(9));
  assert.throws(() => C.exportPseudonym(code, 'short'), { code: 'WEAK_EXPORT_KEY' });
  const a = C.exportPseudonym(code, 'k'.repeat(32)), b = C.exportPseudonym(code, 'j'.repeat(32));
  assert.match(a, /^S-[0-9A-Z]{8}$/);
  assert.notEqual(a, b, 'two exports under different keys cannot be joined');
});

// ----------------------------------------------------------------- device order

const balance = (orders, n) => {
  const position = Array.from({ length: n }, () => new Map());
  const follows = new Map();
  for (const order of orders) {
    order.forEach((device, i) => position[i].set(device, (position[i].get(device) || 0) + 1));
    for (let i = 1; i < order.length; i++) { const key = order[i - 1] + '>' + order[i]; follows.set(key, (follows.get(key) || 0) + 1); }
  }
  return { position, follows };
};

test('device order is balanced by position and by which device follows which (even count)', () => {
  const devices = ['a', 'b', 'c', 'd'];
  const orders = [0, 1, 2, 3].map(i => R.deviceOrder(i, devices, SEED));
  const { position, follows } = balance(orders, 4);
  for (const counts of position) for (const d of devices) assert.equal(counts.get(d), 1);
  assert.equal(follows.size, 12, 'every ordered pair of different devices appears');
  for (const count of follows.values()) assert.equal(count, 1);
});

test('device order is balanced for an odd count over twice as many participants', () => {
  const devices = ['a', 'b', 'c'];
  const orders = [0, 1, 2, 3, 4, 5].map(i => R.deviceOrder(i, devices, SEED));
  const { position, follows } = balance(orders, 3);
  for (const counts of position) for (const d of devices) assert.equal(counts.get(d), 2);
  for (const count of follows.values()) assert.equal(count, 2);
});

test('device order is reproducible from the seed and changes with it', () => {
  const devices = ['a', 'b', 'c', 'd'];
  const first = Array.from({ length: 8 }, (_, i) => R.deviceOrder(i, devices, SEED).join(''));
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => R.deviceOrder(i, devices, SEED).join('')), first);
  const other = Array.from({ length: 8 }, (_, i) => R.deviceOrder(i, devices, 'another-seed-for-tests-0123456789abcdef').join(''));
  assert.notDeepEqual(other, first);
  assert.throws(() => R.deviceOrder(0, devices, 'short'), { code: 'WEAK_SEED' });
});

// ----------------------------------------------------------------- reference readings

test('two readings within tolerance complete by their mean; outside it a third resolves by the median', () => {
  close2(REF.evaluateReadings([100.0, 100.4], 0.5, 'mean_of_two_median_of_three'), 'complete', 100.2);
  const needs = REF.evaluateReadings([100.0, 100.8], 0.5, 'mean_of_two_median_of_three');
  assert.equal(needs.status, 'needs_third');
  close2(REF.evaluateReadings([100.0, 100.8, 100.3], 0.5, 'mean_of_two_median_of_three'), 'complete', 100.3);
  assert.throws(() => REF.evaluateReadings([1, 2, 3, 4], 0.5, 'mean_of_two_median_of_three'), { code: 'TOO_MANY_READINGS' });
});
function close2(result, status, final) {
  assert.equal(result.status, status);
  assert.ok(Math.abs(result.final - final) < 1e-9, 'final ' + result.final);
}

test('there are no scientific defaults: tolerances and the combine rule must be configured', () => {
  assert.throws(() => S.emptyState(config({ reference: { tolerancesCm: {} } })), { code: 'NO_COMBINE_RULE' });
  assert.throws(() => S.emptyState(config({ reference: { combine: 'mean_of_two_median_of_three' } })), { code: 'NO_TOLERANCES' });
  const state = S.emptyState(config());
  const { state: withPerson, code } = enrolled(state);
  assert.throws(() => S.recordReading(withPerson, 'measurer', { code, visit: 1, measure: 'biacromial_breadth', measurer: 'A', value: 40, verifyValue: 40 }), { code: 'NO_TOLERANCE' });
});

test('the scan-to-reference mapping covers all 25 outputs and marks the ones with no counterpart', () => {
  assert.equal(Object.keys(REF.SCAN_TO_REFERENCE).length, 25);
  const descriptive = Object.entries(REF.SCAN_TO_REFERENCE).filter(([, v]) => v === null).map(([k]) => k).sort();
  assert.deepEqual(descriptive, ['ear_width', 'hip_width', 'left_ankle_heel_length', 'right_ankle_heel_length', 'torso_length']);
  assert.equal(REF.SCAN_TO_REFERENCE.shoulder_width.caveat, true, 'shoulder width is not a palpated biacromial breadth');
  const derived = REF.referenceForScanOutput('left_arm_path_length', { acromiale_radiale_left: 33, radiale_stylion_left: 26 });
  assert.equal(derived.value, 59);
  assert.equal(REF.referenceForScanOutput('ear_width', {}).reason, 'descriptive_only');
});

// ----------------------------------------------------------------- enrollment, double entry, blinding

test('enrollment is adults only, and race/ethnicity needs its own consent', () => {
  const state = S.emptyState(config());
  assert.throws(() => enrolled(state, { ageYears: 17 }), { code: 'ADULTS_ONLY' });
  assert.throws(() => enrolled(state, { raceEthnicity: 'recorded without consent' }), { code: 'NO_CONSENT' });
  const { state: next, code, deviceOrder } = enrolled(state);
  assert.ok(C.isValidParticipantCode(code));
  assert.equal(deviceOrder[0], 'phone-a', 'phone 1 always comes first');
  assert.deepEqual([...deviceOrder].sort(), ['phone-a', 'phone-b', 'phone-c']);
  assert.equal(next.linkKey.length, 1);
  assert.equal(next.participants[0].name, undefined, 'the name lives only in the link key');
});

test('double data entry refuses a mismatch and stores nothing', () => {
  const { state, code } = enrolled(S.emptyState(config()));
  assert.throws(() => S.recordReading(state, 'measurer', { code, visit: 1, measure: 'arm_span', measurer: 'A', value: 181.2, verifyValue: 182.1 }), { code: 'ENTRY_MISMATCH' });
  const ok = S.recordReading(state, 'measurer', { code, visit: 1, measure: 'arm_span', measurer: 'A', value: 181.2, verifyValue: 181.2 });
  assert.equal(ok.evaluation.status, 'needs_second');
  assert.equal(state.reference.length, 0, 'the input state is never mutated');
  assert.equal(ok.state.reference.length, 1);
});

test('roles are enforced, and each measurer sees only their own readings', () => {
  let { state, code } = enrolled(S.emptyState(config()));
  assert.throws(() => S.recordReading(state, 'scan_operator', { code, visit: 1, measure: 'arm_span', measurer: 'A', value: 180, verifyValue: 180 }), { code: 'NOT_PERMITTED' });
  assert.throws(() => S.enroll(state, 'measurer', adult()), { code: 'NOT_PERMITTED' });
  state = S.recordReading(state, 'measurer', { code, visit: 1, measure: 'arm_span', measurer: 'A', value: 180, verifyValue: 180 }).state;
  state = S.recordReading(state, 'measurer', { code, visit: 1, measure: 'arm_span', measurer: 'B', value: 181, verifyValue: 181 }).state;
  const viewB = B.viewFor(state, 'measurer', { measurer: 'B' });
  assert.deepEqual(viewB.reference.map(r => r.measurer), ['B']);
  assert.equal(viewB.scans, undefined);
  assert.equal(B.viewFor(state, 'scan_operator').reference, undefined);
  assert.ok(!JSON.stringify(B.viewFor(state, 'coordinator')).includes('"value"'), 'the coordinator sees completeness, never values');
  assert.throws(() => B.viewFor(state, 'analyst'), { code: 'NO_RAW_VIEW' });
  assert.throws(() => B.viewFor(state, 'measurer'), { code: 'MEASURER_REQUIRED' });
});

// ----------------------------------------------------------------- visits, withdrawal, lock

test('completing visit 1 schedules visit 2 inside the configured window, and status follows the calendar', () => {
  let { state, code } = enrolled(S.emptyState(config()));
  state = S.completeVisit(state, 'coordinator', { code, visit: 1, on: '2026-09-20' }, { now: fixedNow }).state;
  const visit2 = state.visits.find(v => v.visit === 2);
  assert.deepEqual([visit2.from, visit2.to], ['2026-09-27', '2026-10-04']);
  assert.equal(V.visitStatus(visit2, '2026-09-26'), 'not_yet_due');
  assert.equal(V.visitStatus(visit2, '2026-09-30'), 'due');
  assert.equal(V.visitStatus(visit2, '2026-10-05'), 'overdue');
  assert.throws(() => V.visit2Window('2026-02-30', [7, 14]), { code: 'BAD_DATE' });
});

test('withdrawal deletes the participant\'s data and link key immediately, even after the lock', () => {
  let { state, code } = enrolled(S.emptyState(config()));
  state = S.recordReading(state, 'measurer', { code, visit: 1, measure: 'stature', measurer: 'A', value: 170, verifyValue: 170 }).state;
  state = S.lockData(state, 'coordinator', { now: fixedNow }).state;
  assert.throws(() => S.recordReading(state, 'measurer', { code, visit: 1, measure: 'stature', measurer: 'A', value: 170.2, verifyValue: 170.2 }), { code: 'DATA_LOCKED' });
  const result = S.withdraw(state, 'coordinator', { code, on: '2026-09-21' }, { now: fixedNow });
  assert.deepEqual(result.removed, { readings: 1, scans: 0, visits: 1 });
  assert.equal(result.state.reference.length, 0);
  assert.equal(result.state.linkKey.length, 0);
  assert.deepEqual(Object.keys(result.state.participants[0]).sort(), ['code', 'enrollmentIndex', 'status', 'withdrawnOn']);
  const audit = result.state.audit.at(-1);
  assert.equal(audit.event, 'withdrawn');
  assert.equal(audit.afterLock, true);
  assert.ok(!JSON.stringify(audit).includes('170'), 'the audit records counts, never values');
});

// ----------------------------------------------------------------- storage

test('study files refuse to live inside the repository, keep the link key separate, and round-trip', () => {
  const repo = path.resolve(__dirname, '..');
  assert.throws(() => STORE.initStudy(path.join(repo, 'study-data'), config()), { code: 'INSIDE_REPOSITORY' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-study-test-'));
  try {
    STORE.initStudy(dir, config());
    assert.throws(() => STORE.initStudy(dir, config()), { code: 'ALREADY_INITIALIZED' });
    let state = STORE.loadStudy(dir);
    state = enrolled(state).state;
    STORE.saveStudy(dir, state);
    const back = STORE.loadStudy(dir);
    assert.equal(back.participants.length, 1);
    assert.equal(back.linkKey[0].name, 'Synthetic Person');
    assert.ok(!fs.readFileSync(path.join(dir, 'participants.json'), 'utf8').includes('Synthetic Person'), 'names are only in link-key.json');
    assert.equal(back.audit.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
