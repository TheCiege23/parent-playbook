#!/usr/bin/env node
'use strict';

/**
 * Check a deployed SDK host against the package it was deployed from.
 *
 * tools/acceptance.cjs proves the package serves correctly on the machine it was extracted on. It
 * says nothing about a host somebody else deployed: whether the bytes that host serves are the bytes
 * the manifest describes, whether a platform's static fallback exposed the rest of the package, or
 * whether the origin is one a browser will let the capture flow use. This asks those questions of a
 * real URL.
 *
 *   node tools/sdk-host-smoke.cjs https://sdk.example.com/
 *   node tools/sdk-host-smoke.cjs https://sdk.example.com/ --manifest path/to/manifest.json
 *   node tools/sdk-host-smoke.cjs https://sdk.example.com/ --no-demo
 *
 * Served modules are compared with the manifest you supply, so the result is only as trustworthy as
 * that manifest. Verify its signature first with tools/sdk-sign.cjs, against a public key obtained
 * separately from the package: the signature proves the manifest is ours, and this proves the host
 * serves what the manifest describes.
 *
 * Read-only apart from one POST that must be refused. It sends no credentials and nothing from a
 * capture.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'PP_SDK_HOST_SMOKE_V1';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// Paths a correct host never serves: one of each kind the package carries, so a platform that falls
// back to serving the whole directory is caught whichever kind it exposes. A migration is added from
// the manifest itself.
const MUST_NOT_SERVE = Object.freeze(['/manifest.json', '/signature.json', '/HANDOVER.md', '/BODY-SDK.md',
  '/tools/sdk-files.cjs', '/tests/db/run.cjs', '/tests/db/10-fixtures.sql']);

function normalizeBase(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('Pass an absolute http(s) URL for the SDK host.'); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw Error('Pass an absolute http(s) URL without credentials, query text or a fragment.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/';
  return url;
}

function loadManifest(file) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw Error('Could not read the manifest at ' + file + ': ' + error.message); }
  if (manifest.schema !== 'PP_BODY_SDK_BUNDLE_V1' || !Array.isArray(manifest.files)) throw Error('Unsupported manifest: ' + file);
  return manifest;
}

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function get(fetchImpl, base, pathname, init = {}) {
  try {
    const response = await fetchImpl(new URL(pathname.replace(/^\//, ''), base), {
      redirect: 'manual', ...init, headers: { 'user-agent': 'ParentPlaybook-SDK-Host-Smoke/1.0' },
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, type: response.headers.get('content-type') || '', headers: response.headers, bytes };
  } catch (error) {
    return { status: null, type: '', headers: new Headers(), bytes: Buffer.alloc(0), error: error.message };
  }
}

async function run(baseValue, options = {}) {
  const base = normalizeBase(baseValue);
  const fetchImpl = options.fetch || fetch;
  const manifest = loadManifest(options.manifestPath || path.join(__dirname, '..', 'manifest.json'));
  const modules = manifest.files.filter(entry => /^js\/[^/]+\.m?js$/.test(entry.path));
  if (!modules.length) throw Error('The manifest lists no SDK modules under js/.');

  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok, detail });

  // Camera capture needs a secure context. Plain http is acceptable only on loopback, which is where
  // a workstation test runs and nowhere a buyer's users are.
  const loopback = LOOPBACK.has(base.hostname);
  add('secure_origin', base.protocol === 'https:' || loopback,
    base.protocol === 'https:' ? 'https'
      : loopback ? 'http on loopback, acceptable for a local test only'
        : 'plain http on a public host: browsers refuse camera access outside a secure context');

  const health = await get(fetchImpl, base, '/healthz');
  add('healthz', health.status === 200 && health.bytes.toString('utf8').trim() === 'ok', health.error || 'status ' + health.status);

  const unloadable = [];
  const mismatched = [];
  let nosniff = true;
  for (const entry of modules) {
    const res = await get(fetchImpl, base, '/' + entry.path);
    // A module served without a JavaScript type is refused by the browser with no useful error.
    if (res.status !== 200 || !/javascript/i.test(res.type)) {
      unloadable.push(entry.path + ' (' + (res.error || res.status + ' ' + (res.type || 'no content-type')) + ')');
      continue;
    }
    if (res.bytes.length !== entry.bytes || sha256(res.bytes) !== entry.sha256) mismatched.push(entry.path);
    if ((res.headers.get('x-content-type-options') || '').toLowerCase() !== 'nosniff') nosniff = false;
  }
  add('modules_load', unloadable.length === 0,
    unloadable.length ? unloadable : modules.length + ' modules served 200 with a JavaScript content type');
  add('modules_match_manifest', unloadable.length === 0 && mismatched.length === 0,
    mismatched.length ? mismatched
      : unloadable.length ? 'not fully compared: some modules did not load'
        : 'every served module matches its manifest size and SHA-256');
  add('nosniff_header', unloadable.length < modules.length && nosniff,
    nosniff ? 'modules carry X-Content-Type-Options: nosniff' : 'at least one module lacks X-Content-Type-Options: nosniff');

  if (options.expectDemo !== false) {
    const page = await get(fetchImpl, base, '/');
    add('demo_page', page.status === 200 && /text\/html/i.test(page.type) && /Provisional/i.test(page.bytes.toString('utf8')),
      page.error || 'status ' + page.status + ', ' + (page.type || 'no content-type'));
  }

  // Anything but a 4xx is a failure here. A 2xx serves the file; a 3xx may lead to it; a network
  // error proves nothing either way.
  const hidden = [...MUST_NOT_SERVE];
  const migration = manifest.files.find(entry => entry.path.startsWith('supabase/migrations/'));
  if (migration) hidden.push('/' + migration.path);
  const exposed = [];
  for (const pathname of hidden) {
    const res = await get(fetchImpl, base, pathname);
    if (!(res.status >= 400 && res.status < 500)) exposed.push(pathname + ' (' + (res.error || res.status) + ')');
  }
  add('package_not_exposed', exposed.length === 0, exposed.length ? exposed : hidden.length + ' package paths refused with 4xx');

  const write = await get(fetchImpl, base, '/' + modules[0].path, { method: 'POST', body: '{}' });
  add('writes_refused', write.status !== null && write.status >= 400, write.error || 'POST returned ' + write.status);

  return {
    schema: SCHEMA,
    base: base.href,
    manifest: { sdkVersion: manifest.sdkVersion, modules: modules.length },
    ok: checks.every(check => check.ok),
    checks,
    note: 'Served modules were compared with the manifest supplied. Verify that manifest\'s signature with tools/sdk-sign.cjs to establish it is the one that was published.',
  };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--manifest');
  const target = argv.find((value, i) => !value.startsWith('--') && i !== at + 1);
  if (!target) {
    console.error('Usage: node tools/sdk-host-smoke.cjs <https://your-sdk-host/> [--manifest manifest.json] [--no-demo]');
    process.exit(2);
  }
  run(target, { manifestPath: at === -1 ? undefined : argv[at + 1], expectDemo: !argv.includes('--no-demo') })
    .then(result => { console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1; })
    .catch(error => { console.error(JSON.stringify({ schema: SCHEMA, ok: false, error: error.message }, null, 2)); process.exitCode = 2; });
}

module.exports = { SCHEMA, MUST_NOT_SERVE, normalizeBase, run };
