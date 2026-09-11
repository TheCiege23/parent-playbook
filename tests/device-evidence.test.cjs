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

const okBuild = () => ({ serviceWorkerCache: 'pp-v106', origin: 'https://playbookbp.com', buildSource: 'service-worker-cache' });
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

test('a record with no viewport does not establish a device', () => {
  // Found by driving the deployed demo from an automation browser, which reported 0x0. It
  // was touch-capable, so the class came out 'touch-wide' and the record verified clean —
  // a claim about hardware that nothing in the record supported. A session that cannot say
  // how big the screen was is not evidence about a device.
  const record = DE.buildDeviceEvidence(okInput({
    device: { ...okDevice(), viewportWidth: 0, viewportHeight: 0 },
  }));
  const result = DE.verifyDeviceEvidence(record, { expectedCache: 'pp-v106' });
  assert.equal(result.ok, false, 'a dimensionless session must not verify clean');
  assert.equal(result.deviceClass, 'unknown', 'and must not be classified as any kind of device');
  assert.ok(result.problems.some(p => /No viewport was observed \(0x0\)/.test(p)), result.problems.join('; '));
});

test('one missing dimension is enough to withhold the classification', () => {
  // A width with no height is not a screen. Checking only one of the two would let half a
  // measurement through.
  for (const [w, h] of [[1512, 0], [0, 945]]) {
    const record = DE.buildDeviceEvidence(okInput({
      device: { ...okDevice(), viewportWidth: w, viewportHeight: h },
    }));
    const result = DE.verifyDeviceEvidence(record, { expectedCache: 'pp-v106' });
    assert.equal(result.ok, false, w + 'x' + h + ' must not verify clean');
    assert.equal(result.deviceClass, 'unknown', w + 'x' + h + ' must not be classified');
  }
});

test('real devices still classify and still verify', () => {
  // The negative control for the two above: the guard must not have made every record fail.
  const cases = [
    [390, 844, 5, 'touch-handheld'],
    [1512, 945, 0, 'desktop'],
    [1024, 1366, 5, 'touch-wide'],
    [700, 900, 0, 'narrow-viewport'],
  ];
  for (const [w, h, touch, expected] of cases) {
    const record = DE.buildDeviceEvidence(okInput({
      device: { ...okDevice(), viewportWidth: w, viewportHeight: h, maxTouchPoints: touch },
    }));
    const result = DE.verifyDeviceEvidence(record, { expectedCache: 'pp-v106' });
    assert.equal(result.deviceClass, expected, w + 'x' + h + ' touch=' + touch);
    assert.equal(result.ok, true, w + 'x' + h + ' should still verify clean');
  }
});

test('a record from an older deployment is caught', () => {
  // The whole reason the build is read from the cache name rather than written down.
  const record = DE.buildDeviceEvidence(okInput({ build: { ...okBuild(), serviceWorkerCache: 'pp-v83' } }));
  const result = DE.verifyDeviceEvidence(record, { expectedCache: 'pp-v106' });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /pp-v83.*expected pp-v106/.test(p)), result.problems.join('; '));
});

test('an unestablished build is a problem, not a pass', () => {
  const record = DE.buildDeviceEvidence(okInput({ build: { ...okBuild(), serviceWorkerCache: 'unknown', buildSource: 'none' } }));
  const result = DE.verifyDeviceEvidence(record, {});
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /does not say which release ran/.test(p)), result.problems.join('; '));
  assert.equal(result.buildEvidence, 'not established');
});

test('an observed build and a reported one are not the same claim', () => {
  // A cache name proves the browser RAN that build. A version read from the origin's sw.js
  // proves only that the origin offers it now — which is genuinely weaker, and a reader
  // deciding how much a session is worth needs to be able to tell them apart.
  const observed = DE.buildDeviceEvidence(okInput());
  assert.equal(DE.verifyDeviceEvidence(observed, { expectedCache: 'pp-v106' }).buildEvidence,
    'observed in the browser cache');

  const reported = DE.buildDeviceEvidence(okInput({ build: { ...okBuild(), buildSource: 'served-sw.js' } }));
  const verdict = DE.verifyDeviceEvidence(reported, { expectedCache: 'pp-v106' });
  assert.equal(verdict.buildEvidence, 'read from the origin, not observed in this session');
  assert.equal(verdict.ok, true, 'weaker provenance is still a valid record, not a failure');
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
    assert.equal(c.buildSource, 'service-worker-cache', 'a cache hit is the strong source');
    assert.equal(c.origin, 'https://playbookbp.com');
    assert.equal(c.viewportWidth, 390);
    assert.equal(c.maxTouchPoints, 5);
    assert.equal(c.standalone, true, 'display-mode standalone should be detected');
  });
});

test('a page with no cache and no sw.js reports an unestablished build rather than guessing', () => {
  return DE.collectDeviceEvidence({ navigator: {}, location: { origin: 'https://x.test' }, innerWidth: 0, innerHeight: 0 })
    .then(c => {
      assert.equal(c.serviceWorkerCache, 'unknown');
      assert.equal(c.buildSource, 'none');
    });
});

test('a page with no service worker falls back to the version the origin serves', () => {
  // The company SDK demo has no worker of its own. Without this it recorded 'unknown' and
  // failed verification for a reason that had nothing to do with the session.
  const env = {
    caches: { keys: async () => [] },
    navigator: { userAgent: 'UA', maxTouchPoints: 0 },
    location: { origin: 'https://playbookbp.com' },
    innerWidth: 1512, innerHeight: 945, devicePixelRatio: 2,
    fetch: async (url) => {
      assert.equal(url, '/sw.js');
      return { ok: true, text: async () => "const CACHE = 'pp-v108';" };
    },
  };
  return DE.collectDeviceEvidence(env).then(c => {
    assert.equal(c.serviceWorkerCache, 'pp-v108');
    assert.equal(c.buildSource, 'served-sw.js', 'and it must say the source was weaker');
  });
});

test('a failing or nonsense sw.js leaves the build unestablished', () => {
  const base = {
    caches: { keys: async () => [] },
    navigator: {}, location: { origin: 'https://x.test' }, innerWidth: 0, innerHeight: 0,
  };
  const cases = [
    ['a 404', async () => ({ ok: false, text: async () => '' })],
    ['a file with no CACHE line', async () => ({ ok: true, text: async () => 'console.log(1)' })],
    ['a throwing fetch', async () => { throw new Error('offline'); }],
  ];
  return Promise.all(cases.map(([what, fetchImpl]) =>
    DE.collectDeviceEvidence({ ...base, fetch: fetchImpl }).then(c => {
      assert.equal(c.serviceWorkerCache, 'unknown', what + ' must not establish a build');
      assert.equal(c.buildSource, 'none', what);
    })));
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
