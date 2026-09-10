#!/usr/bin/env node
'use strict';

/**
 * A hostable static server for the browser SDK.
 *
 * `tools/sdk-demo.cjs` is deliberately loopback-only: it binds 127.0.0.1 and refuses any Host
 * header that is not localhost. That is the right shape for a demo and the wrong shape for a
 * host, which left the handover package with nothing an acquirer could actually deploy. This is
 * that missing piece — the smallest correct thing that serves the SDK on a real origin.
 *
 *   PORT=8080 node tools/sdk-host.cjs
 *   node tools/sdk-host.cjs --port 8080 --host 127.0.0.1
 *
 * It is a reference, not a product. It has no TLS, no rate limiting, no access logging and no
 * authentication, because it serves nothing that needs any of those: the SDK is public source
 * code. Put it behind whatever your platform gives you. Everything that matters for correctness
 * is here — the exact file allowlist, the MIME types the module loader needs, and the response
 * headers production sets.
 *
 * What it will NOT serve, on purpose: migrations, tests, checksum manifests and documentation.
 * They ship in the package for an operator to read, not for a browser to fetch.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const arg = name => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; };
const PORT = Number(arg('--port') || process.env.PORT || 8080);
// 0.0.0.0 so a platform proxy can reach it. Override for a local bind.
const HOST = arg('--host') || process.env.HOST || '0.0.0.0';

let SDK_FILES;
try { ({ SDK_FILES } = require(path.join(ROOT, 'tools/sdk-files.cjs'))); }
catch { console.error('Run this from inside the SDK package: tools/sdk-files.cjs is missing.'); process.exit(2); }

// An explicit allowlist, built from the same list the package is assembled from. A request for
// anything not in this map is a 404 before the filesystem is touched, so there is no traversal
// surface and no way to reach a migration or a test fixture through the web root.
const ROUTES = new Map();
for (const name of SDK_FILES) ROUTES.set('/js/' + name, path.join(ROOT, 'js', name));
ROUTES.set('/', path.join(ROOT, 'tools/sdk-demo.html'));
ROUTES.set('/index.html', path.join(ROOT, 'tools/sdk-demo.html'));

const TYPES = {
  // .mjs must be a JavaScript type or the browser refuses the module outright.
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  const send = (status, body, headers = {}) => {
    res.writeHead(status, {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      // Nothing here is fingerprinted, so a stale cache is a correctness bug, not a saving.
      'Cache-Control': 'public, max-age=0, must-revalidate',
      ...headers,
    });
    res.end(body);
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method Not Allowed');

  // Ignore query and fragment; compare only the path against the allowlist.
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { return send(400, 'Bad Request'); }

  // A liveness endpoint, so a platform health check never has to hit an SDK asset.
  if (pathname === '/healthz') return send(200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' });

  const file = ROUTES.get(pathname);
  if (!file) return send(404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });

  let body;
  try { body = fs.readFileSync(file); }
  catch { return send(404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' }); }

  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  if (req.method === 'HEAD') { res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length }); return res.end(); }
  send(200, body, { 'Content-Type': type });
});

server.listen(PORT, HOST, () => {
  console.log('SDK host listening on ' + HOST + ':' + PORT);
  console.log('  serving ' + ROUTES.size + ' allowlisted paths, plus /healthz');
  console.log('  the SDK must be same-origin with your application; see BODY-SDK.md');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
