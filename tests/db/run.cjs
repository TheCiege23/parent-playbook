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
  const cfg = spawnSync('pg_config' + EXE, ['--bindir'], { encoding: 'utf8', windowsHide: true });
  if (cfg.status === 0 && cfg.stdout.trim()) candidates.push(cfg.stdout.trim());
  candidates.push(null); // bare PATH lookup
  for (const dir of ['/usr/local/pgsql/bin', '/usr/lib/postgresql/18/bin', '/usr/lib/postgresql/17/bin',
    '/opt/homebrew/bin', 'C:/Program Files/PostgreSQL/18/bin', 'C:/Program Files/PostgreSQL/17/bin',
    'C:/Program Files/PostgreSQL/16/bin']) candidates.push(dir);
  for (const dir of candidates) {
    const initdb = dir ? path.join(dir, 'initdb' + EXE) : 'initdb' + EXE;
    const probe = spawnSync(initdb, ['--version'], { encoding: 'utf8', windowsHide: true });
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

// True when the cluster we started is no longer answering. Used only to explain a
// failure after the fact, never to decide whether a test passed.
let clusterPort = null;
function clusterGone() {
  if (!clusterPort) return false;
  const probe = spawnSync(bin('psql'), ['-h', '127.0.0.1', '-p', String(clusterPort), '-U', 'pptest',
    '-d', 'postgres', '-X', '-A', '-t', '-c', 'select 1'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  return !(probe.status === 0 && String(probe.stdout).trim() === '1');
}

function stopCluster() {
  if (!started || !dataDir) return;
  try {
    execFileSync(bin('pg_ctl'), ['-D', dataDir, '-m', 'fast', '-w', 'stop'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch { /* already down */ }
  started = false;
}
// Set once the run has failed, so cleanup keeps the postmaster log instead of deleting
// the only artifact that explains what went wrong. A harness that tidies away its own
// evidence on failure is worse than one that leaves temp files behind.
let failed = false;

function removeCluster() {
  if (logPath) {
    if (failed) { console.error('postmaster log kept for diagnosis: ' + logPath); logPath = null; }
    else { try { fs.rmSync(logPath, { force: true }); } catch {} logPath = null; }
  }
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
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  console.log('cluster created');

  step('start');
  // Start the postmaster DIRECTLY rather than through `pg_ctl start`, and hand it the log
  // file as its own stdout/stderr.
  //
  // Two reasons. `pg_ctl -w start` does not return under a Git Bash/Windows shell even
  // though the server comes up. More importantly, on Windows pg_ctl launches postgres in a
  // way that leaves it attached to the calling console, and every process on a console
  // receives that console's control events: a stray Ctrl+C anywhere in the session
  // terminates a backend — or an internal background worker — with STATUS_CONTROL_C_EXIT
  // (0xC000013A), after which the postmaster kills every other process and shuts down
  // mid-run. That produced failures that looked like migration errors and were not.
  //
  // Spawning the postmaster as our own detached child gives it DETACHED_PROCESS and
  // CREATE_NEW_PROCESS_GROUP, and it is the process group that provides the immunity: a
  // control event aimed at this console is not delivered to another group. `pg_ctl stop`
  // still works against it, because it finds the server through postmaster.pid rather than
  // through who started it.
  //
  // Detaching is also the whole reason a console window appears for the length of a run.
  // DETACHED_PROCESS is mutually exclusive with the CREATE_NO_WINDOW that windowsHide asks
  // for, so Windows honours the detach and discards the hide; measured, the detached spawn
  // costs exactly one visible window and the non-detached one costs none.
  //
  // That window is only worth paying for when a console exists to send the event. Run with
  // no terminal attached — from the desktop app, from tools/acceptance.cjs, from CI — there
  // is nothing that can deliver a Ctrl+C here, so detaching buys no protection and costs a
  // window on every run. So detach only when a terminal is attached, which is exactly the
  // situation the 0xC000013A cascade came from in the first place.
  const interactive = Boolean(process.stdout.isTTY || process.stdin.isTTY);
  const logFd = fs.openSync(logFile, 'a');
  // No Unix socket. Every connection this harness makes is TCP to 127.0.0.1, and distro Linux builds put the
  // socket lock in /var/run/postgresql, which an ordinary user cannot write: there the cluster failed to start
  // with 'could not create lock file ... Permission denied'. Found by CI's first run on Ubuntu.
  const launcher = spawn(bin('postgres'), ['-D', dataDir, '-p', String(port),
    '-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories=', '-c', 'fsync=off', '-c', 'full_page_writes=off'],
    { detached: interactive, stdio: ['ignore', logFd, logFd], windowsHide: true });
  launcher.unref();
  fs.closeSync(logFd);
  started = true;
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    const probe = spawnSync(bin('psql'), ['-h', '127.0.0.1', '-p', String(port), '-U', user,
      '-d', 'postgres', '-X', '-A', '-t', '-c', 'select 1'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (probe.status === 0 && String(probe.stdout).trim() === '1') { ready = true; break; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  }
  if (!ready) {
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').slice(-15).join('\n') : '(no log)';
    throw new Error('The disposable cluster did not become ready within 60s.\n' + log);
  }
  clusterPort = port; // from here on a failure can be attributed to the cluster dying
  console.log('server started and accepting connections');

  execFileSync(bin('createdb'), ['-h', '127.0.0.1', '-p', String(port), '-U', user, database],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  const conn = ['-h', '127.0.0.1', '-p', String(port), '-U', user, '-d', database];
  const env = { ...process.env, PP_DB_PSQL: bin('psql'), PP_DB_CONN: JSON.stringify(conn), PP_DB_OUT: os.tmpdir() };
  if (MIGRATIONS_FROM) env.PP_DB_MIGRATIONS = path.resolve(MIGRATIONS_FROM);
  const child = (script, label) => {
    const result = spawnSync(process.execPath, [path.join(HERE, script)], { env, encoding: 'utf8', stdio: 'inherit', windowsHide: true });
    if (result.status !== 0) throw new Error(label + ' failed (exit ' + result.status + ')');
  };

  step('replay the real migration history');
  child('replay.cjs', 'migration replay');

  if (INVENTORY_AT) {
    step('capture schema inventory');
    const out = execFileSync(env.PP_DB_PSQL, [...conn, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1',
      '-f', path.join(HERE, 'inventory.sql')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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
    '-f', path.join(HERE, '10-fixtures.sql')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  console.log('synthetic fixtures loaded');

  step('security tests');
  child('security-tests.cjs', 'security tests');

  // The rehearsals need pg_dump/pg_restore and the ability to create a second database
  // on this cluster, so they get the bin directory and connection parts rather than the
  // assembled psql argument list the security suite uses.
  env.PP_DB_BINDIR = found.dir || '';
  env.PP_DB_PORT = String(port);
  env.PP_DB_USER = user;
  env.PP_DB_NAME = database;

  step('restore and deletion rehearsal');
  child('restore-deletion.cjs', 'restore and deletion rehearsal');

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
  failed = true; // keeps the postmaster log; the exit handler cleans up the rest
  console.error('\n' + (error && error.message ? error.message : error));
  // A failure here means one of two very different things, and a reader must not have
  // to guess which. Either a security case genuinely failed, or the disposable cluster
  // died underneath the run — on Windows the backends are reachable by console control
  // events, and a stray one terminates a backend with 0xC000013A, after which the
  // postmaster shuts every connection. That is an environment fault: it says nothing
  // about the migrations or the policies. Probe the server and label it.
  if (started && clusterGone()) {
    const tail = logPath && fs.existsSync(logPath)
      ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(-6).join('\n  ') : '(no log)';
    console.error('\nCLUSTER_LOST: the disposable cluster stopped accepting connections during the run.');
    console.error('This is an environment fault, not a failed security case. Re-run before drawing');
    console.error('any conclusion about the migrations or the row-level-security policies.');
    console.error('  ' + tail);
  }
  process.exitCode = 1;
});
