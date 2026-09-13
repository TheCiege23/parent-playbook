// One command a buyer runs to find out what this package can prove about itself.
//
//   node tools/acceptance.cjs            everything available on this machine
//   node tools/acceptance.cjs --json     machine-readable result
//   node tools/acceptance.cjs --skip-db  skip the PostgreSQL replay
//
// Design rule, and the reason this file exists rather than a list of commands in a
// README: a check that cannot run must say so loudly and must never look like a
// pass. HANDOVER.md previously told buyers to run the JavaScript suite inside the
// package, where it matched no files, reported "tests 0" and exited 0 — green, and
// worth nothing. Every step below therefore reports PASS, FAIL or SKIP with a
// reason, a suite that runs zero tests is a FAIL, and the summary ends with what
// none of this establishes.
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const has = flag => args.includes(flag);

// A shipped bundle carries manifest.json; the development tree does not. The two are
// asked different questions and conflating them is what made these checks fail here:
// verifyBundle rejects every file it does not expect, so the repository — which holds
// far more than a bundle ships — can never satisfy it, manifest or no manifest. What
// the tree can answer is whether the files a bundle WOULD ship are complete and clean.
const isBundle = fs.existsSync(path.join(root, 'manifest.json'));
const bundleFiles = () => require(path.join(root, 'tools/sdk-files.cjs')).BUNDLE_FILES;

const results = [];
const record = (id, status, detail, extra) => {
  results.push({ id, status, detail, ...(extra || {}) });
  if (!JSON_OUT) {
    const mark = status === 'pass' ? 'PASS' : status === 'skip' ? 'SKIP' : 'FAIL';
    console.log('  ' + mark.padEnd(5) + id.padEnd(14) + detail);
  }
  return status;
};

// --- 1. runtime -----------------------------------------------------------
function checkRuntime() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) return record('runtime', 'fail', `Node ${process.versions.node}; this package needs 18 or newer`);
  return record('runtime', 'pass', `Node ${process.versions.node} on ${process.platform}`);
}

// --- 2. manifest ----------------------------------------------------------
function checkManifest() {
  let verify;
  try { verify = require(path.join(root, 'tools/sdk-verify.cjs')); }
  catch (e) { return record('manifest', 'fail', 'tools/sdk-verify.cjs did not load: ' + e.message); }
  if (!isBundle) {
    // No manifest exists until tools/sdk-bundle.cjs writes one, so there are no checksums
    // to verify. That is a SKIP, not a PASS — but the file list itself is still checkable,
    // and a list naming a file that does not exist would ship a short bundle, so that fails.
    let files;
    try { files = bundleFiles(); }
    catch (e) { return record('manifest', 'fail', 'tools/sdk-files.cjs did not load: ' + e.message); }
    const missing = files.filter(f => !fs.existsSync(path.join(root, f)));
    if (missing.length) return record('manifest', 'fail',
      `${missing.length} of ${files.length} files listed in tools/sdk-files.cjs are absent: `
      + missing.slice(0, 3).join(', '), { missing });
    return record('manifest', 'skip',
      `development tree: no manifest.json to verify, checksums are written at packaging time; `
      + `all ${files.length} files listed in tools/sdk-files.cjs are present`, { fileCount: files.length });
  }
  const check = verify.verifyBundle(root);
  if (!check.ok) return record('manifest', 'fail', check.errors.slice(0, 3).join('; '), { errors: check.errors });
  return record('manifest', 'pass',
    `${check.fileCount} files match the checksum manifest, no extras, no symlinks`, { fileCount: check.fileCount });
}

// --- 3. exclusions --------------------------------------------------------
function checkExclusions() {
  let scan;
  try { scan = require(path.join(root, 'tools/package-scan.cjs')); }
  catch (e) { return record('exclusions', 'fail', 'tools/package-scan.cjs did not load: ' + e.message); }
  let result;
  if (isBundle) result = scan.scan(root);
  else {
    // Scan what would ship, not the repository around it.
    try { result = scan.scan(root, { only: bundleFiles() }); }
    catch (e) { return record('exclusions', 'fail', 'tools/sdk-files.cjs did not load: ' + e.message); }
  }
  if (!result.ok) {
    const first = result.findings.slice(0, 3).map(f => `${f.file} [${f.rule}]`).join('; ');
    return record('exclusions', 'fail', `${result.findings.length} finding(s): ${first}`, { findings: result.findings });
  }
  // Report only the rules that actually ran. A shipped package has no identifier list
  // — see tools/package-scan.cjs — so claiming it was checked for live identifiers
  // would be the same kind of false green this tool exists to prevent.
  const rules = 'images, capture geometry and credentials'
    + (result.liveIdentifiersChecked ? ', and live record identifiers' : '');
  return record('exclusions', 'pass',
    `${result.scanned} ${isBundle ? 'files' : 'files this package would ship'} carry no ${rules}`
    + (result.liveIdentifiersChecked ? '' : ' (the live-identifier rule needs an operator-supplied list and did not run here)'),
    { liveIdentifiersChecked: result.liveIdentifiersChecked });
}

// --- 4. contracts ---------------------------------------------------------
function checkContracts() {
  const dir = path.join(root, 'tests');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.test.cjs')).map(f => path.join('tests', f))
    : [];
  // A suite with no files is the exact trap this tool exists to close. Node exits 0.
  if (!files.length) return record('contracts', 'fail', 'no contract tests are present in this package');

  // Enumerate the files rather than passing a glob: --test glob support varies by
  // Node version, and an unmatched glob is another way to report zero tests as success.
  const run = spawnSync(process.execPath, ['--test', ...files],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  const out = (run.stdout || '') + (run.stderr || '');
  const number = label => { const m = out.match(new RegExp('^# ?' + label + ' (\\d+)', 'm')) || out.match(new RegExp('\\b' + label + ' (\\d+)')); return m ? Number(m[1]) : null; };
  const total = number('tests'), pass = number('pass'), fail = number('fail');
  if (total === null) return record('contracts', 'fail', 'could not read the test summary', { output: out.slice(-2000) });
  if (total === 0) return record('contracts', 'fail', 'the contract suite ran zero tests; it is not verifying anything');
  if (fail) return record('contracts', 'fail', `${fail} of ${total} contract tests failed`, { total, pass, fail });
  return record('contracts', 'pass', `${pass} of ${total} contract tests pass against the shipped modules`, { total, pass });
}

// --- 5. database ----------------------------------------------------------
function postgresAvailable() {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const dirs = [process.env.PP_PG_BIN, null].filter(d => d !== undefined);
  for (const dir of dirs) {
    const initdb = dir ? path.join(dir, 'initdb' + exe) : 'initdb' + exe;
    const probe = spawnSync(initdb, ['--version'], { encoding: 'utf8', windowsHide: true });
    if (probe.status === 0) return (probe.stdout || '').trim();
  }
  return null;
}

function checkDatabase() {
  if (has('--skip-db')) return record('database', 'skip', 'skipped by --skip-db');
  const runner = path.join(root, 'tests/db/run.cjs');
  if (!fs.existsSync(runner)) return record('database', 'skip', 'tests/db/run.cjs is not in this package');
  const version = postgresAvailable();
  if (!version) return record('database', 'skip',
    'no PostgreSQL on PATH. Install it, or set PP_PG_BIN to its bin directory, then re-run. ' +
    'Until then the row-level-security evidence is UNVERIFIED on this machine.');
  // The harness is reliable; the platform underneath it is not always. On Windows a
  // stray console control event terminates a PostgreSQL backend (0xC000013A) and the
  // postmaster then drops every connection mid-run. run.cjs labels that CLUSTER_LOST.
  // It says nothing about the migrations, so retry once rather than reporting a
  // security failure that did not happen — but never silently, and never more than once.
  const attempt = () => {
    try {
      const out = execFileSync(process.execPath, [runner], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
      return { out };
    } catch (e) { return { out: (e.stdout || '') + (e.stderr || ''), error: e }; }
  };

  let run = attempt();
  let retried = false;
  if (run.error && /CLUSTER_LOST/.test(run.out)) {
    retried = true;
    if (!JSON_OUT) console.log('  ..... database      cluster died mid-run (environment fault); retrying once');
    run = attempt();
  }

  const suffix = retried ? ' after one retry past an environment fault' : '';
  if (run.error) {
    if (/CLUSTER_LOST/.test(run.out)) return record('database', 'fail',
      'the disposable cluster died mid-run twice. This is an environment fault, not a failed ' +
      'security case: a console control event terminated a PostgreSQL backend. Re-run, or run ' +
      'tests/db/run.cjs directly, before concluding anything about the policies.',
      { environmentFault: true, retried });
    const tail = run.out.trim().split('\n').slice(-4).join(' | ');
    return record('database', 'fail', 'the database suite did not complete: ' + tail.slice(0, 400), { retried });
  }
  // The run reports one TOTAL per suite — the security cases and the restore/deletion
  // rehearsal. Read every one of them: taking only the first silently drops a whole
  // suite from the result while still printing a pass.
  const totals = [...run.out.matchAll(/TOTAL: (\d+)\/(\d+) pass, (\d+) fail/g)]
    .map(m => ({ passed: Number(m[1]), total: Number(m[2]), failed: Number(m[3]) }));
  if (!totals.length) return record('database', 'fail', 'the database suite produced no total line', { retried });
  if (totals.length < 2) return record('database', 'fail',
    `only ${totals.length} database suite reported a total; the security cases and the restore/deletion rehearsal should both run`, { retried, totals });
  const failedCases = totals.reduce((n, t) => n + t.failed, 0);
  if (failedCases) return record('database', 'fail', `${failedCases} database cases failed`, { retried, totals });
  const passed = totals.reduce((n, t) => n + t.passed, 0);
  const total = totals.reduce((n, t) => n + t.total, 0);
  return record('database', 'pass',
    `${passed}/${total} cases pass on a disposable cluster built from this package's migrations — ` +
    totals.map(t => `${t.passed}/${t.total}`).join(' security, ') + ' rehearsal' + ` (${version})${suffix}`,
    { passed, total, totals, retried });
}

// --- 6. host --------------------------------------------------------------
function freePort() {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}
const get = (port, pathname) => new Promise(resolve => {
  const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 4000 }, res => {
    let body = ''; res.on('data', d => { body += d; });
    res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body }));
  });
  req.on('timeout', () => { req.destroy(); resolve({ status: 0, type: '', body: 'timeout' }); });
  req.on('error', e => resolve({ status: 0, type: '', body: e.message }));
});

// --- signature ------------------------------------------------------------
// The manifest detects accidental change. It cannot detect substitution: anyone who
// replaces a file can rewrite its hash to agree. A detached signature closes that, but only
// against a public key the reader obtained independently of this package — so this check
// needs one supplied, and SKIPs rather than passing when it has none. A SKIP here is the
// honest answer to "is this package authentic": unknown.
function checkSignature() {
  const signaturePath = path.join(root, 'signature.json');
  const keyPath = process.env.PP_SDK_PUBLIC_KEY;
  if (!fs.existsSync(signaturePath)) {
    return record('signature', 'skip',
      'this package carries no detached signature, so origin is unverified — checksums detect accidental change, not substitution');
  }
  if (!keyPath) {
    return record('signature', 'skip',
      'a signature is present but no public key was supplied; set PP_SDK_PUBLIC_KEY to a key obtained independently of this package');
  }
  let outcome;
  try { outcome = require(path.join(root, 'tools/sdk-sign.cjs')).verifySignature(root, keyPath); }
  catch (error) { return record('signature', 'fail', 'the signature could not be checked: ' + error.message); }
  if (!outcome.ok) return record('signature', 'fail', outcome.problems.join('; '));
  return record('signature', 'pass',
    'the manifest was signed by key ' + outcome.keyFingerprint + ' and has not been altered since'
    + (outcome.trustAnchorInsideBundle
      ? ' — WARNING: that key came from inside this package, which proves internal consistency only'
      : ''));
}

async function checkHost() {
  if (has('--skip-host')) return record('host', 'skip', 'skipped by --skip-host');
  const host = path.join(root, 'tools/sdk-host.cjs');
  if (!fs.existsSync(host)) return record('host', 'skip', 'tools/sdk-host.cjs is not in this package');
  const port = await freePort();
  const child = spawn(process.execPath, [host, '--port', String(port)], { cwd: root, stdio: 'ignore', windowsHide: true });
  try {
    // Poll rather than sleep a fixed amount: a slow machine should not fail this.
    let health = { status: 0 };
    for (let i = 0; i < 40 && health.status !== 200; i++) {
      await new Promise(r => setTimeout(r, 100));
      health = await get(port, '/healthz');
    }
    if (health.status !== 200) return record('host', 'fail', `/healthz did not answer on port ${port}`);
    // Serving a module with the right type is what a browser integration depends on.
    const mod = await get(port, '/js/body-sdk.mjs');
    if (mod.status !== 200) return record('host', 'fail', `/js/body-sdk.mjs returned ${mod.status}`);
    if (!/javascript/.test(mod.type)) return record('host', 'fail', `/js/body-sdk.mjs served as "${mod.type}", which a browser will refuse as a module`);
    // And a path outside the allowlist must not be reachable.
    const leak = await get(port, '/manifest.json');
    if (leak.status === 200) return record('host', 'fail', 'the host served /manifest.json, which is outside its allowlist');

    // In an extracted package, every served module is compared with the manifest by the same tool a
    // buyer points at their own deployment. The development tree has no manifest, so it skips this.
    let compared = '';
    const smokeTool = path.join(root, 'tools/sdk-host-smoke.cjs');
    if (isBundle && fs.existsSync(smokeTool)) {
      const smoke = await require(smokeTool).run('http://127.0.0.1:' + port + '/', { manifestPath: path.join(root, 'manifest.json') });
      const failed = smoke.checks.filter(check => !check.ok);
      if (failed.length) return record('host', 'fail', 'tools/sdk-host-smoke.cjs: ' + failed.map(check => check.id + ' ' + JSON.stringify(check.detail)).join('; '));
      compared = '; all ' + smoke.manifest.modules + ' served modules match the manifest';
    }

    // The page a buyer actually opens has to carry its own limits. Everything else in this
    // run checks files and contracts; nobody was checking that the one human-readable
    // surface still says what the outputs are and are not. A demo page that quietly lost
    // "no body composition" would pass every other check in this tool.
    const page = await get(port, '/');
    if (page.status !== 200) return record('host', 'fail', `the demo page returned ${page.status}`);
    const required = [
      [/Provisional/i, 'the provisional marking'],
      [/unvalidated|not established/i, 'the accuracy caveat'],
      [/No anatomical girths or body composition/i, 'the refusal to claim girths or composition'],
      [/I have permission to process/i, 'the permission gate'],
    ];
    const missing = required.filter(([re]) => !re.test(page.body || '')).map(([, what]) => what);
    if (missing.length) return record('host', 'fail', 'the demo page is missing ' + missing.join(', '));

    return record('host', 'pass', `serves /healthz and /js/body-sdk.mjs as ${mod.type.split(';')[0]}; off-allowlist paths refused; the demo page keeps its provisional, accuracy, girth/composition and permission disclosures${compared}`);
  } finally {
    child.kill();
  }
}

// --- report ---------------------------------------------------------------
// Stated as plainly as the passes. A buyer reading a screen of PASS lines should
// not have to infer what is missing from what is absent.
const NOT_ESTABLISHED = [
  'Measurement accuracy. Nothing here compares an output to a physical measurement.',
  'Anatomical validity. The surface perimeters are clothed-surface contours, not girths.',
  'Body composition. No model ships and no composition value is ever produced.',
  'FITMATCH equivalence, DEXA equivalence and clinical validity are not claimed or tested.',
  'Provider backup restore. A logical dump and restore is rehearsed here, including that row-level security and table privileges survive it. Restoring from the hosting provider\u2019s own backups, and point-in-time recovery, are not rehearsed.',
  'Buyer-host deployment and physical-device capture have not been performed.',
  'Package authenticity, unless the signature check above passed against a public key you obtained independently of this package. A checksum manifest on its own detects accidental change, not substitution.',
];

async function main() {
  if (!JSON_OUT) {
    console.log('Parent Playbook package acceptance');
    console.log(path.resolve(root));
    console.log('');
  }
  checkRuntime();
  checkManifest();
  checkExclusions();
  checkContracts();
  checkDatabase();
  checkSignature();
  await checkHost();

  const failed = results.filter(r => r.status === 'fail');
  const skipped = results.filter(r => r.status === 'skip');
  const ok = failed.length === 0;
  const summary = {
    schema: 'PP_PACKAGE_ACCEPTANCE_V1',
    ok, checkedAt: new Date().toISOString(),
    passed: results.filter(r => r.status === 'pass').length,
    failed: failed.length, skipped: skipped.length,
    results, notEstablished: NOT_ESTABLISHED,
  };
  if (JSON_OUT) { console.log(JSON.stringify(summary, null, 2)); }
  else {
    console.log('');
    console.log(ok
      ? `${summary.passed} checks passed` + (skipped.length ? `, ${skipped.length} could not run on this machine` : '')
      : `${failed.length} check(s) FAILED`);
    if (skipped.length) {
      console.log('');
      console.log('Not run here, so not evidence:');
      for (const s of skipped) console.log('  - ' + s.id + ': ' + s.detail);
    }
    console.log('');
    console.log('What a clean run does NOT establish:');
    for (const line of NOT_ESTABLISHED) console.log('  - ' + line);
  }
  if (!ok) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { NOT_ESTABLISHED };
