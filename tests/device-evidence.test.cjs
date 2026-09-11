// A device session only counts as evidence if something about it can be checked afterwards.
//
// Every capability at stage 0.75 today rests on a sentence of the form "in the user's
// signed-in Windows Chrome session, X happened". The assessment payload records no user
// agent, no viewport and no indication of which deployed build produced it, so nothing
// written afterwards can be verified against anything — the record and the claim are the
// same sentence.
//
// js/device-evidence.js emits a separate record that can be: which build served the page
// (read from the service-worker cache name, not typed in from memory), what device ran it,
// how long it took, and how many defined outputs came back.
//
// It is a SIDE CHANNEL on purpose. It never touches the assessment payload, so the
// scalar-only allowlist and the database CHECK constraint that enforces it are unaffected.
// These tests hold it to that: no measurement value, no height, no identifier and no capture
// field can get into it, by allowlist and again by a recursive refusal.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const DE = require(path.join(root, 'js', 'device-evidence.js'));

const okBuild = () => ({ serviceWorkerCache: 'pp-v106', origin: 'https://playbookbp.com' });
const okDevice = () => ({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
  viewportWidth: 390, viewportHeight: 844, pixelRatio: 3, standalone: true, maxTouchPoints: 5,
});
const okRun = () => ({
  workflowVersion: '0.13.0', engineId: 'synthetic-engine', engineVersion: '1.0.0', engineModel: 'synthetic-model',
  processingMs: 14400, outputCount: 25, expectedOutputs: 25, missingOutputKeys: [], heightSupplied: true,
});
const okInput = (over = {}) => ({
  recordedAt: '2026-09-11T16:40:00.000Z', build: okBuild(), device: okDevice(), run: okRun(), ...over,
});

test('a complete phone session builds and verifies clean', () => {
  const record = DE.buildDeviceEvidence(okInput());
  assert.equal(record.schema, 'PP_DEVICE_EVIDENCE_V1');
  assert.match(record.excludes, /No photographs, landmarks, contours, meshes, measurement values/);
  const result = DE.verifyDeviceEvidence(record, { expectedCache: 'pp-v106', expectedOrigin: 'https://playbookbp.com' });
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.equal(result.deviceClass, 'touch-handheld', 'a 390px touch viewport is the phone case');
  assert.equal(result.outputs, '25/25');
});

test('a desktop session is recorded as one rather than refused', () => {
  // The rubric distinguishes intended-desktop from intended-phone evidence. Both are worth
  // recording; what matters is that the reader can tell which one they are holding.
  const record = DE.buildDeviceEvidence(okInput({
    device: { ...okDevice(), userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140', viewportWidth: 1512, viewportHeight: 945, pixelRatio: 2, standalone: false, maxTouchPoints: 0 },
  }));
  const result = DE.verifyDeviceEvidence(record, { expectedCache: 'pp-v106' });
  assert.equal(result.ok, true, 'a desktop session is still a valid record');
  assert.equal(result.deviceClass, 'desktop');
});

test('a record from an older deployment is caught', () => {
  // The whole reason the build is read from the cache name rather than written down.
  const record = DE.buildDeviceEvidence(okInput({ build: { ...okBuild(), serviceWorkerCache: 'pp-v83' } }));
  const result = DE.verifyDeviceEvidence(record, { expectedCache: 'pp-v106' });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /pp-v83.*expected pp-v106/.test(p)), result.problems.join('; '));
});

test('an unobserved build is a problem, not a pass', () => {
  const record = DE.buildDeviceEvidence(okInput({ build: { ...okBuild(), serviceWorkerCache: 'unknown' } }));
  const result = DE.verifyDeviceEvidence(record, {});
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /build is unverified/.test(p)), result.problems.join('; '));
});

test('a partial run cannot read as a complete one', () => {
  const record = DE.buildDeviceEvidence(okInput({
    run: { ...okRun(), outputCount: 23, missingOutputKeys: ['left_tibia_length', 'right_tibia_length'] },
  }));
  const result = DE.verifyDeviceEvidence(record, { expectedCache: 'pp-v106' });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /Returned 23 of 25/.test(p)));
  assert.ok(result.problems.some(p => /Missing outputs: left_tibia_length/.test(p)));
});

test('an unscaled run is reported, because the outputs mean nothing without a height', () => {
  const record = DE.buildDeviceEvidence(okInput({ run: { ...okRun(), heightSupplied: false } }));
  const result = DE.verifyDeviceEvidence(record, { expectedCache: 'pp-v106' });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /No recorded height/.test(p)));
});

test('measurement values, heights and identities cannot get in', () => {
  // The allowlist refuses unknown fields outright; the recursive check is the second line.
  const forbidden = [
    ['a measurement value', { run: { ...okRun(), value: 42 } }],
    ['a list of measurements', { run: { ...okRun(), measurements: [1, 2, 3] } }],
    ['the recorded height', { run: { ...okRun(), height_in: 74 } }],
    ['an athlete id', { device: { ...okDevice(), athlete: 'abc' } }],
    ['an email', { device: { ...okDevice(), email: 'x@y.z' } }],
    ['a photograph', { build: { ...okBuild(), photo: 'data:...' } }],
    ['landmarks', { build: { ...okBuild(), landmarks: [[1, 2]] } }],
    ['a mesh', { run: { ...okRun(), mesh: {} } }],
  ];
  for (const [what, over] of forbidden) {
    assert.throws(() => DE.buildDeviceEvidence(okInput(over)), /DEVICE_EVIDENCE_INVALID|unsupported field|cannot contain/i,
      'should have refused ' + what);
  }
});

test('an unknown field is refused rather than quietly dropped', () => {
  // Dropping it would let a caller believe something was recorded that was not.
  assert.throws(() => DE.buildDeviceEvidence(okInput({ build: { ...okBuild(), extra: 'x' } })),
    /unsupported field: extra/);
  assert.throws(() => DE.buildDeviceEvidence({ ...okInput(), somethingElse: 1 }),
    /Unsupported top-level field: somethingElse/);
});

test('missing sections and malformed instants fail closed', () => {
  assert.throws(() => DE.buildDeviceEvidence({ recordedAt: '2026-09-11T16:40:00.000Z', build: okBuild(), device: okDevice() }), /Section run is required/);
  assert.throws(() => DE.buildDeviceEvidence(okInput({ recordedAt: 'yesterday' })), /recordedAt must be an ISO instant/);
  assert.throws(() => DE.buildDeviceEvidence(okInput({ build: { serviceWorkerCache: 'pp-v106' } })), /missing origin/);
  assert.throws(() => DE.buildDeviceEvidence(okInput({ run: { ...okRun(), outputCount: -1 } })), /not a valid integer/);
  assert.throws(() => DE.buildDeviceEvidence(okInput({ run: { ...okRun(), missingOutputKeys: ['Not A Key!'] } })), /not a valid string\[\]/);
});

test('the collector reads the build from the cache name, not from a caller', () => {
  // caches.keys() is what makes the build claim checkable — it cannot be supplied from memory
  // after the fact.
  const env = {
    caches: { keys: async () => ['pp-v106', 'some-other-cache'] },
    navigator: { userAgent: 'UA', maxTouchPoints: 5, standalone: false },
    location: { origin: 'https://playbookbp.com' },
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 3,
    matchMedia: () => ({ matches: true }),
  };
  return DE.collectDeviceEvidence(env).then(c => {
    assert.equal(c.serviceWorkerCache, 'pp-v106');
    assert.equal(c.origin, 'https://playbookbp.com');
    assert.equal(c.viewportWidth, 390);
    assert.equal(c.maxTouchPoints, 5);
    assert.equal(c.standalone, true, 'display-mode standalone should be detected');
  });
});

test('a page with no cache API reports an unknown build instead of guessing', () => {
  return DE.collectDeviceEvidence({ navigator: {}, location: { origin: 'https://x.test' }, innerWidth: 0, innerHeight: 0 })
    .then(c => assert.equal(c.serviceWorkerCache, 'unknown'));
});

test('a result summary reduces to counts, and the summary itself is not retained', () => {
  const summary = {
    workflowVersion: '0.13.0', engine: { id: 'e', version: '1', model: 'm' },
    processingMs: 14400, outputCount: 25, missingOutputs: [], height: 74,
    measurements: [{ key: 'stature', value: 74, unit: 'in' }],   // must not survive
    pairs: [{ label: 'Femur', left: 1, right: 2 }],
  };
  const run = DE.runFromSummary(summary);
  assert.equal(run.outputCount, 25);
  assert.equal(run.heightSupplied, true, 'that a height was supplied is recorded');
  assert.ok(!('height' in run) && !('heightIn' in run), 'the height VALUE must not be');
  assert.ok(!('measurements' in run) && !('pairs' in run), 'no measurement data may survive');
  // And the whole record still builds, which proves the reduction is allowlist-clean.
  const record = DE.buildDeviceEvidence(okInput({ run }));
  assert.equal(JSON.stringify(record).includes('74'), false, 'no measured value should appear anywhere in the record');
});

test('the verifier tool reads the current build out of sw.js', () => {
  const tool = require(path.join(root, 'tools', 'device-evidence.cjs'));
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const expected = sw.match(/const CACHE\s*=\s*'([^']+)'/)[1];
  assert.equal(tool.currentCache(), expected,
    'the tool must compare against this checkout rather than a number written into it');
  assert.match(expected, /^pp-v\d+$/);
});

test('the module ships to the browser and survives offline', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.includes('/js/device-evidence.js'), 'index.html must load js/device-evidence.js');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(sw.includes('/js/device-evidence.js'), 'the service worker must cache js/device-evidence.js');
});
