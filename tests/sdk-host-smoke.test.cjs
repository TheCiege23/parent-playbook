// tools/sdk-host-smoke.cjs is what a buyer points at the host they deployed. These tests run it
// against a real tools/sdk-host.cjs serving a freshly built package, and then against the ways a
// deployment actually goes wrong: a file edited after the manifest was written, a platform that
// serves the whole package directory, and a public origin without TLS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { buildBundle } = require('../tools/sdk-bundle.cjs');
const { SDK_FILES } = require('../tools/sdk-files.cjs');
const { run, normalizeBase } = require('../tools/sdk-host-smoke.cjs');

function bundle(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-host-smoke-'));
  t.after(() => {
    assert.ok(path.resolve(parent).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(parent, { recursive: true, force: true });
  });
  const output = path.join(parent, 'release');
  assert.equal(buildBundle(output).ok, true);
  return output;
}

async function startHost(output) {
  const reserve = net.createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const child = spawn(process.execPath, [path.join(output, 'tools/sdk-host.cjs'), '--port', String(port), '--host', '127.0.0.1'],
    { cwd: output, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const stop = () => child.exitCode === null ? new Promise(resolve => { child.once('exit', resolve); child.kill(); }) : Promise.resolve();
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('host did not start')), 8000);
      child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error('host exited ' + code)); });
    });
  } catch (error) { await stop(); throw error; }
  return { base: 'http://127.0.0.1:' + port + '/', stop };
}

const byId = result => Object.fromEntries(result.checks.map(check => [check.id, check]));

test('a correctly deployed host passes, with every served module matching the manifest', async t => {
  const output = bundle(t);
  const host = await startHost(output);
  try {
    const result = await run(host.base, { manifestPath: path.join(output, 'manifest.json') });
    assert.equal(result.schema, 'PP_SDK_HOST_SMOKE_V1');
    assert.deepEqual(result.checks.filter(check => !check.ok), [], JSON.stringify(result.checks, null, 2));
    assert.equal(result.ok, true);
    assert.equal(result.manifest.modules, SDK_FILES.length, 'every SDK module should have been compared');
  } finally { await host.stop(); }
});

test('a module edited after the manifest was written is named, even though it still loads', async t => {
  const output = bundle(t);
  const host = await startHost(output);
  try {
    // The host reads from disk on every request, so this is exactly what a hand-edited deployment serves.
    fs.appendFileSync(path.join(output, 'js/body-sdk.mjs'), '\n// edited on the server');
    const checks = byId(await run(host.base, { manifestPath: path.join(output, 'manifest.json') }));
    assert.equal(checks.modules_load.ok, true, 'the edited module still loads, which is why loading is not enough');
    assert.equal(checks.modules_match_manifest.ok, false);
    assert.deepEqual(checks.modules_match_manifest.detail, ['js/body-sdk.mjs']);
    assert.equal(checks.healthz.ok, true);
  } finally { await host.stop(); }
});

test('a host that serves the whole package directory is caught, and so is a public origin without TLS', async t => {
  const output = bundle(t);
  // A naive static server: any file under the package, any method. Its SDK modules are correct,
  // which is the point. A host can serve the right SDK and still expose everything beside it.
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    const file = path.join(output, pathname === '/' ? 'tools/sdk-demo.html' : pathname);
    if (!file.startsWith(output + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = /\.m?js$/.test(file) ? 'text/javascript' : /\.html$/.test(file) ? 'text/html' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff' });
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const local = 'http://127.0.0.1:' + server.address().port;
  try {
    const leaky = byId(await run(local + '/', { manifestPath: path.join(output, 'manifest.json') }));
    assert.equal(leaky.modules_match_manifest.ok, true);
    assert.equal(leaky.package_not_exposed.ok, false);
    assert.ok(leaky.package_not_exposed.detail.some(entry => entry.startsWith('/manifest.json ')), JSON.stringify(leaky.package_not_exposed.detail));
    assert.ok(leaky.package_not_exposed.detail.some(entry => entry.startsWith('/supabase/migrations/')), 'a migration should be probed too');
    assert.equal(leaky.writes_refused.ok, false);

    // The same server addressed as a public http origin. Nothing else about it changes, so the
    // origin check is the only one that can move.
    const publicHttp = byId(await run('http://sdk.example.com/', {
      manifestPath: path.join(output, 'manifest.json'),
      fetch: (url, init) => fetch(String(url).replace('http://sdk.example.com', local), init),
    }));
    assert.equal(publicHttp.secure_origin.ok, false);
    assert.equal(leaky.secure_origin.ok, true, 'loopback http is acceptable for a local test');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('the smoke check refuses URLs carrying credentials or query text', () => {
  assert.throws(() => normalizeBase('https://user:secret@sdk.example.com/'), /without credentials/);
  assert.throws(() => normalizeBase('https://sdk.example.com/?token=abc'), /without credentials/);
  assert.throws(() => normalizeBase('ftp://sdk.example.com/'), /without credentials/);
  assert.equal(normalizeBase('https://sdk.example.com/sdk').pathname, '/sdk/');
});
