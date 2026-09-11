// The evidence control on the scan result screen, driven rather than described.
//
// js/device-evidence.js is covered on its own. What is covered here is the wiring: that the
// control only appears when it has been asked for, that the handler assembles the record
// from the real result and record objects the scan flow produces, that what lands in the
// downloaded file contains no measurement and no height, and that a failure does not leave
// the button dead.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

// A phone, as the collector would see one.
const PHONE = {
  caches: { keys: async () => ['pp-v108'] },
  navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', maxTouchPoints: 5 },
  location: { origin: 'https://playbookbp.com' },
  innerWidth: 390, innerHeight: 844, devicePixelRatio: 3,
  matchMedia: () => ({ matches: true }),
};
const DE = require(path.join(root, 'js', 'device-evidence.js'));

// The 25 defined outputs, loaded from the real dictionary so the test cannot drift from it.
function bodyOutputs() {
  const ctx = vm.createContext({ Object, Number, Math, String, Array, JSON });
  const src = fs.readFileSync(path.join(root, 'js', 'body-outputs.js'), 'utf8');
  return vm.runInContext(src + '\n;({ BODY_OUTPUTS, BODY_OUTPUT_VERSION })', ctx);
}

// A scan result and record of the shape bsResult() is handed.
const RESULT = () => ({
  heightIn: 74,
  confidence: 0.82,
  metrics: Object.fromEntries(Object.keys(bodyOutputs().BODY_OUTPUTS).map(k => [k, 12.3])),
  detail: {},
});
const RECORD = () => ({
  meta: {
    engine: { id: 'pp-length-v2', version: '0.13.0', model: 'pose-landmarker-full' },
    processing: { protocol: 'provider-wall-time-v1', duration_ms: 14400 },
    athlete_id: 'athlete-uuid-that-must-not-appear',
  },
  rows: [{ created_by: 'user-1' }],
});

// Load js/body-scan.js far enough to reach the two functions under test. The file is
// definitions only — ARCHITECTURE.md's rule against load-time code in feature modules is
// what makes this possible at all.
function loadScanModule(search) {
  const downloads = [];
  const toasts = [];
  const reported = [];
  const anchor = { click() { downloads.push({ href: this.href, download: this.download }); }, remove() {} };
  const ctx = vm.createContext({
    console, Promise, Object, Number, Math, String, Array, JSON, Date, Error, Set, Map,
    isNaN, parseInt, parseFloat, setTimeout, clearInterval, setInterval,
    URLSearchParams,
    location: { search },
    // collectDeviceEvidence() reads the page's globals. In the browser that is the real
    // page; here it is a phone-shaped stand-in, so the collector's own logic — including
    // reading the build out of caches.keys() — is exercised rather than bypassed.
    DeviceEvidence: Object.assign({}, DE, { collectDeviceEvidence: () => DE.collectDeviceEvidence(PHONE) }),
    BODY_OUTPUTS: bodyOutputs().BODY_OUTPUTS,
    toast: m => toasts.push(m),
    reportError: (e, where) => reported.push(where + ': ' + (e && e.message)),
    Blob: class { constructor(parts) { this.parts = parts; } },
    URL: { createObjectURL: b => 'blob:' + b.parts[0], revokeObjectURL() {} },
    document: { createElement: () => anchor, body: { appendChild() {} } },
  });
  const src = fs.readFileSync(path.join(root, 'js', 'body-scan.js'), 'utf8');
  // Only the two functions this test drives are needed; the file defines many more, and
  // evaluating their declarations is harmless because none of them run at load time.
  vm.runInContext(src, ctx, { filename: 'body-scan.js' });
  const api = vm.runInContext('({ bsEvidenceEnabled, bsSaveEvidence })', ctx);
  return { ...api, downloads, toasts, reported };
}

test('the control is off unless it is asked for', () => {
  assert.equal(loadScanModule('').bsEvidenceEnabled(), false, 'a parent must not meet this control');
  assert.equal(loadScanModule('?evidence=0').bsEvidenceEnabled(), false);
  assert.equal(loadScanModule('?other=1').bsEvidenceEnabled(), false);
  assert.equal(loadScanModule('?evidence=1').bsEvidenceEnabled(), true);
  assert.equal(loadScanModule('?foo=a&evidence=1').bsEvidenceEnabled(), true);
});

test('the result sheet only renders the control when it is enabled', () => {
  // Read the source rather than the DOM for this one: the button is inside a template that
  // needs the whole sheet to build, and the condition is the thing that matters.
  const src = fs.readFileSync(path.join(root, 'js', 'body-scan.js'), 'utf8');
  assert.match(src, /\$\{bsEvidenceEnabled\(\)\?'<button class="btn ghost sm" id="bsEvidence"/,
    'the control must be behind the flag, not always rendered');
  assert.match(src, /No measurement, height or name is included\./,
    'the sheet should say what the file does not contain');
  assert.match(src, /if\(ev\) ev\.onclick=\(\)=>bsSaveEvidence\(result,record,ev\)/,
    'and it must be bound when present');
});

test('driving the button produces a verifiable record', async () => {
  const m = loadScanModule('?evidence=1');
  const btn = { disabled: false, textContent: 'Save session evidence' };
  await m.bsSaveEvidence(RESULT(), RECORD(), btn);

  assert.equal(m.toasts.at(-1), 'Session evidence saved');
  assert.equal(m.downloads.length, 1, 'exactly one file should be produced');
  assert.equal(btn.disabled, false, 'the button must be usable again afterwards');
  assert.equal(btn.textContent, 'Save session evidence', 'and must get its label back');

  const written = JSON.parse(m.downloads[0].href.replace(/^blob:/, ''));
  assert.equal(written.schema, 'PP_DEVICE_EVIDENCE_V1');
  assert.equal(written.run.outputCount, 25);
  assert.equal(written.run.expectedOutputs, 25, 'the expected count comes from BODY_OUTPUTS');
  assert.deepEqual(written.run.missingOutputKeys, []);
  assert.equal(written.run.heightSupplied, true);
  assert.equal(written.run.engineId, 'pp-length-v2');
  assert.equal(written.run.processingMs, 14400);
  assert.match(written.run.workflowVersion, /ondevice/, 'the app supplies its own policy version');

  // It has to pass the verifier it was built for.
  const verdict = DE.verifyDeviceEvidence(written, { expectedCache: written.build.serviceWorkerCache });
  assert.deepEqual(verdict.problems, []);
  assert.equal(verdict.ok, true);
});

test('nothing measured, and no identifier, reaches the file', async () => {
  const m = loadScanModule('?evidence=1');
  await m.bsSaveEvidence(RESULT(), RECORD(), { disabled: false, textContent: 'x' });
  const written = JSON.parse(m.downloads[0].href.replace(/^blob:/, ''));

  // Walk the parsed record rather than substring-matching the JSON text. Searching the text
  // for "74" looked equivalent and is not: recordedAt is an ISO instant, and about one
  // instant in fifty contains those two digits in its milliseconds. That assertion would
  // have failed roughly 2% of runs for a reason having nothing to do with the height.
  const values = [], keys = [];
  (function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) { keys.push(k); walk(v); }
      return;
    }
    values.push(node);
  })(written);

  assert.ok(!values.includes(74), 'the recorded height must not appear as a value');
  assert.ok(!values.includes(12.3), 'a measured value must not appear');
  assert.ok(!values.includes('athlete-uuid-that-must-not-appear'), 'no athlete identifier may appear');
  for (const forbidden of ['metrics', 'measurements', 'height', 'heightIn', 'athlete_id', 'consent_id']) {
    assert.ok(!keys.includes(forbidden), 'no ' + forbidden + ' key may appear');
  }
  // The record is not empty of everything — it should still carry the counts it exists for.
  assert.ok(values.includes(25), 'the output count is the point and must survive');
});

test('a partial scan is recorded as partial rather than rounded up', async () => {
  const result = RESULT();
  const keys = Object.keys(result.metrics);
  delete result.metrics[keys[0]];
  delete result.metrics[keys[1]];

  const m = loadScanModule('?evidence=1');
  await m.bsSaveEvidence(result, RECORD(), { disabled: false, textContent: 'x' });
  const written = JSON.parse(m.downloads[0].href.replace(/^blob:/, ''));
  assert.equal(written.run.outputCount, 23);
  assert.equal(written.run.expectedOutputs, 25);
  assert.deepEqual(written.run.missingOutputKeys.sort(), [keys[0], keys[1]].sort());

  const verdict = DE.verifyDeviceEvidence(written, { expectedCache: written.build.serviceWorkerCache });
  assert.equal(verdict.ok, false, 'a 23-of-25 run must not verify clean');
  assert.ok(verdict.problems.some(p => /Returned 23 of 25/.test(p)), verdict.problems.join('; '));
});

test('a scan with no height is recorded as unscaled', async () => {
  const result = RESULT();
  result.heightIn = 0;
  const m = loadScanModule('?evidence=1');
  await m.bsSaveEvidence(result, RECORD(), { disabled: false, textContent: 'x' });
  const written = JSON.parse(m.downloads[0].href.replace(/^blob:/, ''));
  assert.equal(written.run.heightSupplied, false);
  assert.ok(DE.verifyDeviceEvidence(written, { expectedCache: written.build.serviceWorkerCache })
    .problems.some(p => /No recorded height/.test(p)));
});

test('a failure restores the button instead of leaving it dead', async () => {
  const m = loadScanModule('?evidence=1');
  const btn = { disabled: false, textContent: 'Save session evidence' };
  // A record with no engine is the realistic failure: buildDeviceEvidence refuses it.
  await m.bsSaveEvidence(RESULT(), { meta: {}, rows: [{}] }, btn);
  assert.equal(m.downloads.length, 0, 'nothing should be written');
  assert.equal(btn.disabled, false, 'the button must come back');
  assert.equal(btn.textContent, 'Save session evidence');
  assert.equal(m.toasts.at(-1), 'Could not build session evidence');
  assert.ok(m.reported.some(r => /scan:deviceEvidence/.test(r)), 'and the failure should be reported');
});

test('the filename names the build and the instant, so two runs cannot collide', async () => {
  const m = loadScanModule('?evidence=1');
  await m.bsSaveEvidence(RESULT(), RECORD(), { disabled: false, textContent: 'x' });
  const name = m.downloads[0].download;
  assert.match(name, /^device-session-[a-z0-9-]+-\d{8}\d{6}\.json$/,
    'expected device-session-<build>-<YYYYMMDDHHMMSS>.json, got ' + name);
});
