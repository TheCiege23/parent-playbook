// tools/deployment-smoke.cjs is the check run against production after every release, and now on a
// schedule. Its run() had no test: only EXPECTED_CACHE was imported anywhere. So a required token that
// no longer exists in the source, a cache version bumped here but not in sw.js, or a new required page
// the Dockerfile never copies would all be discovered by a failing check against the live site.
//
// These tests serve the repository exactly as the Dockerfile ships it, with Caddy's clean-URL rule,
// and run the real smoke check against that. The same mistakes now fail here, before a deploy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { run, required, forbidden } = require('../tools/deployment-smoke.cjs');

const root = path.join(__dirname, '..');
const FAST = { settleAttempts: 1, settleDelayMs: 5 };

// The Dockerfile's COPY lines are an allowlist into /srv. Anything copied elsewhere (the Caddyfile) is
// not part of the web root.
function dockerAllowlist() {
  const files = new Map();
  const dirs = new Map();
  for (const line of fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8').split(/\r?\n/)) {
    if (!/^COPY\s/.test(line)) continue;
    const parts = line.trim().split(/\s+/).slice(1);
    const dest = parts.pop();
    if (!dest.startsWith('./')) continue;
    for (const src of parts) {
      if (src.endsWith('/')) dirs.set('/' + dest.slice(2).replace(/\/$/, ''), src.replace(/\/$/, ''));
      else if (dest === './') files.set('/' + path.posix.basename(src), src);
      else files.set('/' + dest.slice(2), src);
    }
  }
  return { files, dirs };
}

// Caddy: try_files {path} {path}.html {path}/index.html
function resolveServed(allow, pathname) {
  const direct = candidate => {
    if (allow.files.has(candidate)) return path.join(root, allow.files.get(candidate));
    for (const [prefix, dir] of allow.dirs) {
      if (!candidate.startsWith(prefix + '/')) continue;
      const base = path.join(root, dir);
      const file = path.join(base, candidate.slice(prefix.length + 1));
      if (file.startsWith(base + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    }
    return null;
  };
  return direct(pathname) || direct(pathname + '.html') || direct(pathname.replace(/\/$/, '') + '/index.html');
}

async function serve(t, override) {
  const allow = dockerAllowlist();
  assert.ok(allow.files.has('/sw.js') && allow.dirs.has('/js'), 'the Dockerfile allowlist was not parsed');
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (override && override(pathname, res)) return;
    const file = resolveServed(allow, pathname);
    if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200);
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return 'http://127.0.0.1:' + server.address().port + '/';
}

test('the site exactly as the Dockerfile ships it passes the deployment smoke', async t => {
  const result = await run(await serve(t), FAST);
  assert.deepEqual(result.checks.filter(check => !check.ok), [], JSON.stringify(result.checks.filter(check => !check.ok), null, 2));
  assert.equal(result.ok, true);
  assert.equal(result.settled, 0);
  assert.equal(result.checks.length, required.length + forbidden.length);
});

test('a private file that becomes public fails the smoke, and a check that recovers is reported as settled', async t => {
  let firstServiceWorker = true;
  const base = await serve(t, (pathname, res) => {
    if (pathname === '/BODY-SDK.md') { res.writeHead(200); res.end('# leaked'); return true; }
    // One failed response, as a request that reached a container mid-swap would get.
    if (pathname === '/sw.js' && firstServiceWorker) { firstServiceWorker = false; res.writeHead(503); res.end(); return true; }
    return false;
  });
  const result = await run(base, FAST);
  assert.equal(result.ok, false);

  const leak = result.checks.find(check => check.pathname === '/BODY-SDK.md');
  assert.deepEqual([leak.expectation, leak.status, leak.ok], ['not-public', 200, false]);

  const recovered = result.checks.find(check => check.pathname === '/sw.js');
  assert.equal(recovered.ok, true);
  assert.equal(recovered.settledAfterMs, FAST.settleDelayMs);
  assert.equal(result.settled, 1);
  assert.match(result.settleNote, /overlapped a rollout/);
});

test('the scheduled monitor runs this smoke against production and needs no secrets', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/production-monitor.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(workflow, /^\s+- cron: '[^']+'$/m, 'the monitor should run on a schedule');
  assert.match(workflow, /^\s+run: node tools\/deployment-smoke\.cjs https:\/\/playbookbp\.com\/$/m);
  assert.match(workflow, /^permissions:\n\s+contents: read$/m, 'the monitor should hold read-only repository permissions');
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./, 'the monitor must not need a secret');
});
