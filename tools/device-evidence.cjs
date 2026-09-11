#!/usr/bin/env node
/* Verify a device-session evidence file against this checkout.
 *
 *   node tools/device-evidence.cjs --verify <file.json> [--cache pp-vNNN] [--origin https://…]
 *
 * The point is that the claim "this ran on a phone at build X" stops being something written
 * from memory afterwards. The record names the service-worker cache the page was actually
 * served by, and this compares it against the sw.js in this checkout, so a record from an
 * older deployment is visible as one.
 *
 * It prints findings rather than a single verdict word, because a session can be genuine and
 * still be incomplete, and the reader needs to know which half is missing.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { verifyDeviceEvidence, EXPECTED_OUTPUTS } = require(path.join(root, 'js', 'device-evidence.js'));

function currentCache() {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const m = sw.match(/const CACHE\s*=\s*'([^']+)'/);
  if (!m) throw Error('sw.js has no CACHE constant; this tool cannot say which build is current.');
  return m[1];
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--verify') args.file = argv[++i];
    else if (argv[i] === '--cache') args.cache = argv[++i];
    else if (argv[i] === '--origin') args.origin = argv[++i];
    else if (argv[i] === '--expected-outputs') args.expectedOutputs = Number(argv[++i]);
    else return usage('Unrecognised argument: ' + argv[i]);
  }
  if (!args.file) return usage('A --verify <file> is required.');

  let record;
  try { record = JSON.parse(fs.readFileSync(args.file, 'utf8')); }
  catch (e) { console.error('Could not read ' + args.file + ': ' + e.message); return 1; }

  const expectedCache = args.cache || currentCache();
  const result = verifyDeviceEvidence(record, {
    expectedCache,
    expectedOrigin: args.origin,
    expectedOutputs: Number.isInteger(args.expectedOutputs) ? args.expectedOutputs : EXPECTED_OUTPUTS,
  });

  console.log('Device-session evidence — ' + path.basename(args.file));
  console.log('');
  console.log('  recorded at   ' + (record && record.recordedAt));
  console.log('  build         ' + result.build + (expectedCache ? '   (this checkout: ' + expectedCache + ')' : ''));
  console.log('  device class  ' + result.deviceClass);
  console.log('  user agent    ' + String((record && record.device && record.device.userAgent) || '').slice(0, 110));
  console.log('  viewport      ' + (record && record.device && record.device.viewportWidth) + 'x'
    + (record && record.device && record.device.viewportHeight)
    + ' @ ' + (record && record.device && record.device.pixelRatio) + 'x'
    + ((record && record.device && record.device.standalone) ? ', installed' : ''));
  console.log('  outputs       ' + result.outputs);
  console.log('  processing    ' + (record && record.run && (record.run.processingMs / 1000).toFixed(1)) + ' s');
  console.log('');

  if (result.ok) {
    console.log('  OK — every check passed.');
  } else {
    console.log('  NOT CLEAN:');
    for (const p of result.problems) console.log('    - ' + p);
  }
  console.log('');
  console.log('What this does NOT establish:');
  console.log('  - Measurement accuracy. No physical measurement appears in this record.');
  console.log('  - That the person captured was measured correctly, or measured at all.');
  console.log('  - Anything the record does not contain: it holds counts, timings and build');
  console.log('    identity, deliberately and by allowlist, not results.');
  console.log('  - Authenticity. Nothing here is signed. It detects a stale build or an');
  console.log('    incomplete run; it cannot detect a determined forgery.');
  return result.ok ? 0 : 1;
}

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: node tools/device-evidence.cjs --verify <file.json> [--cache pp-vNNN] [--origin URL]');
  return 2;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { currentCache, main };
