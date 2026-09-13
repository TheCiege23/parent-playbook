// tools/acceptance.cjs runs tools/package-scan.cjs over an extracted package, and nothing in this suite
// did. So a contract test that declared its fake API key as `SECRET = '...'` passed every test here and
// then failed the exclusion check of the v34 acceptance run, after the archive had been built and signed.
// This builds a package the way a release is built and scans it the way acceptance does, so the same
// mistake fails here first.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildBundle } = require('../tools/sdk-bundle.cjs');
const { scan } = require('../tools/package-scan.cjs');

test('a freshly built package passes the exclusion scan that acceptance runs', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-scan-bundle-'));
  t.after(() => {
    assert.ok(path.resolve(parent).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(parent, { recursive: true, force: true });
  });
  const output = path.join(parent, 'release');
  assert.equal(buildBundle(output).ok, true);
  const result = scan(output);
  assert.ok(result.scanned > 200, 'the scan should have read the whole package, not ' + result.scanned + ' files');
  assert.deepEqual(result.findings, [],
    'this package would fail the exclusions check in tools/acceptance.cjs: ' + JSON.stringify(result.findings));
});
