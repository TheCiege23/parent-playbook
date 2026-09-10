#!/usr/bin/env node
'use strict';

/**
 * Executable database tests for the composition storage layer.
 *
 * This script ALWAYS creates its own throwaway PostgreSQL cluster, replays the real migration
 * history into it, runs the security suite as restricted roles, and destroys the cluster. There is
 * deliberately no connection-string option: the harness cannot be pointed at an existing server, so
 * it cannot be pointed at production. Every fixture is synthetic.
 *
 *   node tests/db/run.cjs            run everything, then dispose
 *   node tests/db/run.cjs --keep     leave the cluster running for manual psql inspection
 *   node tests/db/run.cjs --inventory <file>   write the schema inventory, skip the suite
 *   node tests/db/run.cjs --migrations-from <dir>   replay a different migration set
 *
 * Requires a local PostgreSQL installation (initdb, pg_ctl, psql, createdb) on PATH, or set
 * PP_PG_BIN to its bin directory. Tested against PostgreSQL 18.3.
 */

const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const KEEP = process.argv.includes('--keep');
// --inventory <file> builds the cluster from the migrations, writes the canonical schema
// inventory and disposes, skipping the security suite. tools/schema-parity.cjs uses this to
// prove the committed migrations reproduce production.
const INVENTORY_AT = (() => { const i = process.argv.indexOf('--inventory'); return i === -1 ? null : process.argv[i + 1]; })();
// --migrations-from <dir> replays a different migration set than the repository's. The buyer
// handover package uses it to prove that the package alone reproduces the production schema.
const MIGRATIONS_FROM = (() => { const i = process.argv.indexOf('--migrations-from'); return i === -1 ? null : process.argv[i + 1]; })();
if (process.argv.includes('--migrations-from') && !MIGRATIONS_FROM) { console.error('--migrations-from needs a directory'); process.exit(2); }
if (process.argv.includes('--inventory') && !INVENTORY_AT) { console.error('--inventory needs an output path'); process.exit(2); }
const EXE = process.platform === 'win32' ? '.exe' : '';

function findBin() {
  const candidates = [];
  if (process.env.PP_PG_BIN) candidates.push(process.env.PP_PG_BIN);
  const cfg = spawnSync('pg_config' + EXE, ['--bindir'], { encoding: 'utf8' });
  if (cfg.status === 0 && cfg.stdout.trim()) candidates.push(cfg.stdout.trim());
  candidates.push(null); // bare PATH lookup
  for (const dir of ['/usr/local/pgsql/bin', '/usr/lib/postgresql/18/bin', '/usr/lib/postgresql/17/bin',
    '/opt/homebrew/bin', 'C:/Program Files/PostgreSQL/18/bin', 'C:/Program Files/PostgreSQL/17/bin',
    'C:/Program Files/PostgreSQL/16/bin']) candidates.push(dir);
  for (const dir of candidates) {
    const initdb = dir ? path.join(dir, 'initdb' + EXE) : 'initdb' + EXE;
    const probe = spawnSync(initdb, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return { dir, version: probe.stdout.trim() };
  }
  return null;
}

const found = findBin();
if (!found) {
  console.error([
    'PostgreSQL command-line tools were not found.',
    '',
    'These tests execute the real migration against a throwaway cluster, so a local PostgreSQL',
    'installation is required. Install PostgreSQL, or point PP_PG_BIN at its bin directory:',
    '',
    '  PP_PG_BIN="C:/Program Files/PostgreSQL/18/bin" node tests/db/run.cjs',
    '',
    'The JavaScript suite (node --test "tests/*.test.cjs") does not need PostgreSQL and is unaffected.',
  ].join('\n'));
  process.exit(2);
}
const bin = name => (found.dir ? path.join(found.dir, name + EXE) : name + EXE);

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const step = message => console.log('\n=== ' + message + ' ===');
let dataDir = null;
let started = false;
let logPath = null;

function stopCluster() {
  if (!started || !dataDir) return;
  try {
    execFileSync(bin('pg_ctl'), ['-D', dataDir, '-m', 'fast', '-w', 'stop'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { /* already down */ }
  started = false;
}
function removeCluster() {
  if (logPath) { try { fs.rmSync(logPath, { force: true }); } catch {} logPath = null; }
  if (!dataDir) return;
  // Only ever remove a directory this process created under the OS temp root.
  const resolved = path.resolve(dataDir);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    console.error('Refusing to remove ' + resolved + ' (outside the temp root).');
    return;
  }
  // Windows keeps the data directory locked briefly after shutdown.
  for (let attempt = 0; attempt < 12; attempt++) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); return; }
    catch (error) {
      if (attempt === 11) { console.error('Could not delete ' + resolved + ': ' + error.code + '. Remove it by hand.'); return; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

async function main() {
  const port = await freePort();
  const user = 'pptest';
  const database = 'pp_composition_test';
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-db-harness-'));
  fs.rmSync(dataDir, { recursive: true, force: true }); // initdb wants to create it itself
  const logFile = path.join(os.tmpdir(), 'pp-db-harness-' + port + '.log');
  logPath = logFile;

  console.log('Parent Playbook — executable database tests');
  console.log('  ' + found.version);
  console.log('  disposable cluster : ' + dataDir);
  console.log('  listening on       : 127.0.0.1:' + port + ' (this process only)');
  console.log('  repository         : ' + REPO);

  step('initdb');
  execFileSync(bin('initdb'), ['-D', dataDir, '-U', user, '--auth=trust', '--encoding=UTF8', '--locale=C'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  console.log('cluster created');

  step('start');
  // `pg_ctl -w start` does not return under a Git Bash/Windows shell even though the server comes
  // up, so start it detached and poll for readiness ourselves.
  const launcher = spawn(bin('pg_ctl'), ['-D', dataDir, '-l', logFile, '-o',
    '-p ' + port + ' -c listen_addresses=127.0.0.1 -c fsync=off -c full_page_writes=off', 'start'],
    { detached: true, stdio: 'ignore', windowsHide: true });
  launcher.unref();
  started = true;
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    const probe = spawnSync(bin('psql'), ['-h', '127.0.0.1', '-p', String(port), '-U', user,
      '-d', 'postgres', '-X', '-A', '-t', '-c', 'select 1'], { encoding: 'utf8', timeout: 10000 });
    if (probe.status === 0 && String(probe.stdout).trim() === '1') { ready = true; break; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  }
  if (!ready) {
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').slice(-15).join('\n') : '(no log)';
    throw new Error('The disposable cluster did not become ready within 60s.\n' + log);
  }
  console.log('server started and accepting connections');

  execFileSync(bin('createdb'), ['-h', '127.0.0.1', '-p', String(port), '-U', user, database],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  const conn = ['-h', '127.0.0.1', '-p', String(port), '-U', user, '-d', database];
  const env = { ...process.env, PP_DB_PSQL: bin('psql'), PP_DB_CONN: JSON.stringify(conn), PP_DB_OUT: os.tmpdir() };
  if (MIGRATIONS_FROM) env.PP_DB_MIGRATIONS = path.resolve(MIGRATIONS_FROM);
  const child = (script, label) => {
    const result = spawnSync(process.execPath, [path.join(HERE, script)], { env, encoding: 'utf8', stdio: 'inherit' });
    if (result.status !== 0) throw new Error(label + ' failed (exit ' + result.status + ')');
  };

  step('replay the real migration history');
  child('replay.cjs', 'migration replay');

  if (INVENTORY_AT) {
    step('capture schema inventory');
    const out = execFileSync(env.PP_DB_PSQL, [...conn, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1',
      '-f', path.join(HERE, 'inventory.sql')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const inventory = JSON.parse(out.trim());
    fs.mkdirSync(path.dirname(path.resolve(INVENTORY_AT)), { recursive: true });
    fs.writeFileSync(INVENTORY_AT, JSON.stringify(inventory, null, 2) + String.fromCharCode(10), 'utf8');
    console.log('wrote ' + inventory.total + ' objects to ' + INVENTORY_AT);
    step('dispose');
    stopCluster(); removeCluster(); dataDir = null;
    console.log('cluster stopped and deleted');
    return;
  }

  step('load synthetic fixtures');
  execFileSync(env.PP_DB_PSQL, [...conn, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction',
    '-f', path.join(HERE, '10-fixtures.sql')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  console.log('synthetic fixtures loaded');

  step('security tests');
  child('security-tests.cjs', 'security tests');

  if (KEEP) {
    console.log('\n--keep: leaving the cluster up for inspection.');
    console.log('  ' + [env.PP_DB_PSQL, ...conn].map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '));
    console.log('  stop and delete it with: ' + bin('pg_ctl') + ' -D ' + dataDir + ' -m immediate stop && rm -rf ' + dataDir);
    started = false; // do not tear down in the exit handler
    dataDir = null;
    return;
  }

  step('dispose');
  stopCluster();
  removeCluster();
  dataDir = null;
  console.log('cluster stopped and deleted');
}

process.on('exit', () => { stopCluster(); removeCluster(); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { process.exit(130); });

main().then(() => {
  console.log('\nAll executable database tests passed.');
}).catch(error => {
  console.error('\n' + (error && error.message ? error.message : error));
  process.exitCode = 1;
});
