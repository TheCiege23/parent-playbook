// tools/adult-harness is how Your training gets clicked through in a real browser without a live project: the real app
// scripts, in index.html's order, over an in-memory stand-in for Supabase holding only synthetic rows. These keep it
// honest: it loads exactly what the site loads, it never reaches a real project or registers the service worker, and it
// is never deployed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const base = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8').replace(/\r\n/g, '\n');

test('the harness loads every app script the site loads, in the same order, and is regenerated from index.html', () => {
  const siteScripts = [...read('index.html').matchAll(/<script src="(\/js\/[a-z0-9-]+\.js)"><\/script>/g)].map(m => m[1]).filter(s => s !== '/js/landing.js');
  const harness = read('tools/adult-harness/index.html');
  const harnessScripts = [...harness.matchAll(/<script src="(\/js\/[a-z0-9-]+\.js)"><\/script>/g)].map(m => m[1]);
  assert.deepEqual(harnessScripts, siteScripts, 'rebuild with node tools/adult-harness/build.cjs after changing index.html');
  // Building again produces the committed page, line endings aside. The build goes to a temporary file, never over
  // the committed page: rewriting it left a Windows checkout (CRLF) showing it as modified after every run.
  const committed = path.join(base, 'tools/adult-harness/index.html');
  const committedBytes = fs.readFileSync(committed);
  const out = path.join(os.tmpdir(), 'pp-adult-harness-' + process.pid + '-' + Date.now() + '.html');
  try {
    execFileSync(process.execPath, [path.join(base, 'tools/adult-harness/build.cjs'), out], { cwd: base });
    assert.equal(fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n'), harness, 'rebuild with node tools/adult-harness/build.cjs');
  } finally {
    fs.rmSync(out, { force: true });
  }
  assert.ok(fs.readFileSync(committed).equals(committedBytes), 'the check does not write into the repository');
  assert.ok(!fs.existsSync(out), 'the temporary page is removed');
  // Run without an argument, the build still regenerates the committed page.
  assert.match(read('tools/adult-harness/build.cjs'), /const out = process\.argv\[2\] \? path\.resolve\(process\.argv\[2\]\) : path\.join\(__dirname, 'index\.html'\);/);
});

test('the fake client is loaded before core.js creates the client, and nothing real is reachable', () => {
  const harness = read('tools/adult-harness/index.html');
  assert.ok(harness.indexOf('/tools/adult-harness/fake-supabase.js') < harness.indexOf('/js/core.js'));
  assert.doesNotMatch(harness, /cdn\.jsdelivr\.net\/npm\/@supabase|sentry-cdn/);
  assert.match(harness, /registerServiceWorker = function\(\)\{\};/);
  assert.ok(harness.indexOf('registerServiceWorker = function') < harness.indexOf('/js/init.js'), 'disabled before init.js calls it');
  const fake = read('tools/adult-harness/fake-supabase.js');
  assert.doesNotMatch(fake, /supabase\.co|sb_publishable|fetch\(|XMLHttpRequest|WebSocket/);
  assert.match(fake, /synthetic-parent@example\.invalid/);
  assert.match(fake, /window\.supabase = \{ createClient:\(\) => client \};/);
});

test('it is never deployed and never packaged', () => {
  const docker = read('Dockerfile');
  assert.doesNotMatch(docker, /adult-harness/);
  assert.doesNotMatch(docker, /COPY tools\/ /, 'tools/ is copied file by file, never whole');
  const { BUNDLE_FILES } = require('../tools/sdk-files.cjs');
  assert.ok(!BUNDLE_FILES.some(f => /adult-harness/.test(f)));
});

test('the family scenario answers like production today: unapplied migrations are missing', async () => {
  const vm = require('node:vm');
  const ctx = vm.createContext({ console, crypto: require('node:crypto').webcrypto, Date, Math, JSON, Number, String, Array, Object, Set, URLSearchParams, location: { search: '?scenario=family' } });
  ctx.window = ctx;
  vm.runInContext(read('tools/adult-harness/fake-supabase.js'), ctx);
  const sb = ctx.window.supabase.createClient();
  const h = ctx.window.__harness;
  assert.equal(h.SCENARIO, 'family');
  // Every table a migration after the live head creates is missing, and nothing older is.
  const migrations = fs.readdirSync(path.join(base, 'supabase/migrations')).filter(f => f > '20260912123000' && f.endsWith('.sql'));
  const created = migrations.flatMap(f => [...read('supabase/migrations/' + f).matchAll(/create table if not exists public\.([a-z_]+) \(/g)].map(m => m[1]));
  const dropped = new Set(migrations.flatMap(f => [...read('supabase/migrations/' + f).matchAll(/drop table (?:if exists )?public\.([a-z_]+);/g)].map(m => m[1])));
  assert.deepEqual([...h.MISSING_TABLES].sort(), created.filter(t => !dropped.has(t)).sort());
  const missing = await sb.from('week_exceptions').select('*');
  assert.equal(missing.error.code, 'PGRST205');
  assert.equal((await sb.rpc('save_body_scan_assessment', {})).error.code, 'PGRST202');
  const athletes = await sb.from('athletes').select('*');
  assert.equal(athletes.data.length, 1);
  assert.equal(athletes.data[0].first_name, 'Sam');
});

test('the fake applies the cascades the screens rely on and the import dedupes like the database', async () => {
  const vm = require('node:vm');
  const ctx = vm.createContext({ console, crypto: require('node:crypto').webcrypto, Date, Math, JSON, Number, String, Array, Object, Set });
  ctx.window = ctx;
  vm.runInContext(read('tools/adult-harness/fake-supabase.js'), ctx);
  const sb = ctx.window.supabase.createClient();
  const { db, USER } = ctx.window.__harness;

  await sb.from('adult_schedule_items').insert({ id: 'w1', guardian_id: USER.id, weekday: 0, title: 'Synthetic', kind: 'strength' });
  await sb.from('adult_schedule_exercises').insert({ item_id: 'w1', guardian_id: USER.id, name: 'Synthetic squat' });
  await sb.from('adult_workout_logs').insert({ guardian_id: USER.id, schedule_item_id: 'w1', done_on: '2026-09-14' });
  await sb.from('adult_schedule_items').delete().eq('id', 'w1');
  assert.equal(db.adult_schedule_exercises.length, 0);
  assert.equal(db.adult_workout_logs[0].schedule_item_id, null, 'a ticked day stays, unlinked');

  const reading = { metric_key: 'weight', value: 180, unit: 'lb', measured_on: '2026-09-14', method: 'device_measured' };
  const first = await sb.rpc('save_adult_health_import', { p_batch: { id: 'b1', source_name: 'Scale', origin: 'device', rows_received: 1, rows_rejected: 0 }, p_records: [reading] });
  const again = await sb.rpc('save_adult_health_import', { p_batch: { id: 'b2', source_name: 'scale', origin: 'device', rows_received: 1, rows_rejected: 0 }, p_records: [{ ...reading, value: 180.0 }] });
  assert.equal(JSON.stringify([first.data.saved, again.data.saved, again.data.duplicates]), '[1,0,1]');
  await sb.from('adult_health_import_batches').delete().eq('id', 'b1');
  assert.equal(db.adult_health_records.length, 0, 'undoing an import removes its readings');
});
