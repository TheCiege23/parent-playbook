// Adult Training: one source-tracked record for a parent's own body and activity readings. These pin the pure logic
// and the promises the record rests on:
//
//   every reading says where it came from and how the number was obtained, and a source cannot claim more than it did;
//   the same reading is recognised as a duplicate by the browser and refused by the database, with the same key;
//   it is the parent's alone, behind the allowlist, undoable per import, exported and deleted with the account.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const base = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8');
const flat = text => text.replace(/\r\n/g, '\n');
const MIGRATION = 'supabase/migrations/20260914140000_adult_health_records.sql';

function context() {
  const ctx = vm.createContext({ console, Number, Math, String, Date, JSON, Set, Map, Array, Object });
  vm.runInContext(read('js/adult-health-record.js'), ctx);
  return ctx;
}
const plain = value => JSON.parse(JSON.stringify(value));
const MANUAL = { source_kind: 'manual', today: '2026-09-14' };

test('a typed-in reading is checked against the dictionary and saved as entered', () => {
  const ctx = context();
  const n = (input, c = MANUAL) => plain(ctx.adultHealthNormalize(input, c));
  assert.deepEqual(n({ metric_key: 'Weight', value: ' 182.456 ', unit: 'LBS', measured_on: '2026-09-14' }),
    { ok: true, record: { metric_key: 'weight', value: 182.46, unit: 'lb', measured_on: '2026-09-14', method: 'entered', external_id: null } });
  assert.equal(n({ metric_key: 'resting heart rate', value: '58', unit: 'bpm', measured_on: '2026-09-01' }).record.metric_key, 'resting_heart_rate');
  assert.equal(n({ metric_key: 'steps', value: '0', unit: 'steps', measured_on: '2026-09-14' }).ok, true, 'a day with no steps is still a reading');
  assert.equal(n({ metric_key: 'weight', value: '180', unit: 'lb', measured_on: '2026-09-14', external_id: 'x' }).record.external_id, null,
    'only an import carries a source id');
  for (const [input, reason] of [
    [{ metric_key: 'body_fat_percent', value: '20', unit: '%' }, 'metric'],
    [{ metric_key: 'lean mass', value: '60', unit: 'kg' }, 'metric'],
    [{ metric_key: 'constructor', value: '1', unit: 'lb' }, 'metric'],
    [{ metric_key: 'weight', value: '80', unit: 'cm' }, 'unit'],
    [{ metric_key: 'weight', value: '0', unit: 'lb' }, 'value'],
    [{ metric_key: 'weight', value: '2000', unit: 'lb' }, 'value'],
    [{ metric_key: 'weight', value: '', unit: 'lb' }, 'value'],
    [{ metric_key: 'steps', value: '100.5', unit: 'steps' }, 'value'],
    [{ metric_key: 'resting_heart_rate', value: '19', unit: 'bpm' }, 'value'],
    [{ metric_key: 'weight', value: '180', unit: 'lb', measured_on: '2026-02-30' }, 'date'],
    [{ metric_key: 'weight', value: '180', unit: 'lb', measured_on: '09/14/2026' }, 'date'],
    [{ metric_key: 'weight', value: '180', unit: 'lb', measured_on: '1899-12-31' }, 'date'],
    [{ metric_key: 'weight', value: '180', unit: 'lb', measured_on: '2026-09-15' }, 'future'],
  ]) assert.equal(n({ measured_on: '2026-09-14', ...input }).reason, reason, JSON.stringify(input));
});

test('an import records how each number was obtained, and a tape measurement never comes from a device', () => {
  const ctx = context();
  const device = { source_kind: 'file_import', source_name: 'Scale app', origin: 'device', today: '2026-09-14' };
  const own = { ...device, origin: 'own_records' };
  const n = (input, c) => plain(ctx.adultHealthNormalize({ measured_on: '2026-09-14', ...input }, c));
  assert.equal(n({ metric_key: 'weight', value: '180', unit: 'lb' }, device).record.method, 'device_measured');
  assert.equal(n({ metric_key: 'steps', value: '9000', unit: 'steps' }, device).record.method, 'device_estimated', 'a step count is an estimate');
  assert.equal(n({ metric_key: 'resting_heart_rate', value: '58', unit: 'bpm' }, device).record.method, 'device_measured');
  assert.equal(n({ metric_key: 'waist', value: '34', unit: 'in' }, device).reason, 'not_from_device');
  assert.equal(n({ metric_key: 'waist', value: '34', unit: 'in' }, own).record.method, 'entered');
  assert.equal(n({ metric_key: 'weight', value: '180', unit: 'lb', external_id: '  abc-1 ' }, device).record.external_id, 'abc-1');
});

test('the duplicate key is the one the database enforces', () => {
  const ctx = context();
  const scale = { source_kind: 'file_import', source_name: 'Scale App' };
  const reading = (extra = {}) => ({ metric_key: 'weight', value: 180, unit: 'lb', measured_on: '2026-09-14', external_id: null, ...extra });
  const key = (r, s = scale) => ctx.adultHealthKey(r, s);
  assert.equal(key(reading()), key(reading({ value: 180.0 }), { source_kind: 'file_import', source_name: 'scale app' }), 'name case and 180.0 do not matter');
  assert.notEqual(key(reading()), key(reading({ measured_on: '2026-09-13' })));
  assert.notEqual(key(reading()), key(reading(), { source_kind: 'manual', source_name: null }), 'a typed-in reading is not an imported one');
  assert.equal(key(reading({ external_id: 'r1', value: 180 })), key(reading({ external_id: 'r1', value: 181 })), 'with a source id, the id decides');
  const migration = flat(read(MIGRATION));
  assert.match(migration, /on public\.adult_health_records \(guardian_id, source_kind, lower\(source_name\), metric_key, external_id\)\n  where external_id is not null;/);
  assert.match(migration, /on public\.adult_health_records \(guardian_id, source_kind, coalesce\(lower\(source_name\), ''\), metric_key, measured_on, value, unit\)\n  where external_id is null;/);
});

test('a CSV is read by its header, with quotes, a byte-order mark and Windows line endings', () => {
  const ctx = context();
  const csv = '﻿Date,Metric,Value,Unit,ID\r\n2026-09-13,weight,180.2,lb,a1\r\n"2026-09-14","Resting heart rate","58","bpm",""\r\n\r\n2026-09-14,"steps, walking",9000,steps,x\n';
  const parsed = plain(ctx.adultHealthParseCsv(csv));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.rows.map(r => r.line), [2, 3, 5]);
  assert.deepEqual(parsed.rows[0], { line: 2, date: '2026-09-13', metric: 'weight', value: '180.2', unit: 'lb', id: 'a1' });
  assert.equal(parsed.rows[1].metric, 'Resting heart rate');
  assert.equal(parsed.rows[2].metric, 'steps, walking', 'a quoted comma stays in its cell');
  assert.equal(ctx.adultHealthParseCsv('date,value,unit\n2026-09-14,1,lb').ok, false, 'metric column missing');
  assert.equal(ctx.adultHealthParseCsv('').ok, false);
  const many = n => 'date,metric,value,unit\n' + '2026-09-14,steps,1,steps\n'.repeat(n);
  assert.equal(ctx.adultHealthParseCsv(many(5000)).ok, true);
  assert.equal(ctx.adultHealthParseCsv(many(5001)).ok, false);
});

test('planning an import shows what it would add, skips what is already recorded, and says why a row cannot be used', () => {
  const ctx = context();
  const c = { source_kind: 'file_import', source_name: 'Scale App', origin: 'device', today: '2026-09-14' };
  const rows = [
    { line: 2, date: '2026-09-13', metric: 'weight', value: '180', unit: 'lb', id: '' },
    { line: 3, date: '2026-09-13', metric: 'Weight', value: '180.0', unit: 'lbs', id: '' },
    { line: 4, date: '2026-09-14', metric: 'weight', value: '179.8', unit: 'lb', id: '' },
    { line: 5, date: '2026-09-14', metric: 'waist', value: '34', unit: 'in', id: '' },
    { line: 6, date: '2026-09-14', metric: 'steps', value: '9000', unit: 'steps', id: 's-14' },
    { line: 7, date: '2026-09-14', metric: 'steps', value: '9100', unit: 'steps', id: 's-14' },
  ];
  const existing = [ctx.adultHealthKey({ metric_key: 'weight', value: 179.8, unit: 'lb', measured_on: '2026-09-14', external_id: null },
    { source_kind: 'file_import', source_name: 'scale app' })];
  const plan = plain(ctx.adultHealthPlanImport(rows, existing, c));
  assert.equal(plan.received, 6);
  assert.deepEqual(plan.records.map(r => [r.metric_key, r.measured_on, r.value]), [['weight', '2026-09-13', 180], ['steps', '2026-09-14', 9000]]);
  assert.equal(plan.duplicates, 3, 'the repeat in the file, the reading already saved, and the second row with the same source id');
  assert.deepEqual(plan.rejected.map(r => [r.line, r.reason]), [[5, 'not_from_device']]);
  assert.match(plan.rejected[0].error, /Waist is a tape measurement/);
});

test('a trend compares the latest reading with the previous one in the same unit, and labels its source', () => {
  const ctx = context();
  const records = [
    { metric_key: 'weight', value: 180, unit: 'lb', measured_on: '2026-09-01', source_kind: 'manual', method: 'entered' },
    { metric_key: 'weight', value: 82, unit: 'kg', measured_on: '2026-09-07', source_kind: 'manual', method: 'entered' },
    { metric_key: 'weight', value: 178.35, unit: 'lb', measured_on: '2026-09-14', source_kind: 'file_import', source_name: 'Scale app', method: 'device_measured' },
  ];
  const t = plain(ctx.adultHealthTrend(records, 'weight'));
  assert.equal(t.previous.measured_on, '2026-09-01', 'the kilogram reading in between is skipped, not converted');
  assert.equal(t.change, -1.7);
  assert.equal(ctx.adultHealthTrend(records, 'waist'), null);
  assert.equal(ctx.adultHealthSourceLabel(records[0]), 'Typed in');
  assert.equal(ctx.adultHealthSourceLabel(records[2]), 'Scale app');
  assert.equal(ctx.adultHealthSourceLabel({ source_kind: 'file_import', source_name: 'Spreadsheet', method: 'entered' }), 'Spreadsheet (your records)');
});

test('activity this week takes one source a day, so a watch export and a typed-in number are never added together', () => {
  const ctx = context();
  const dates = Array.from({ length: 7 }, (_, i) => '2026-09-' + String(14 + i).padStart(2, '0'));
  const watch = (metric, value, unit, on, at = '2026-09-14T09:00:00Z') =>
    ({ metric_key: metric, value, unit, measured_on: on, source_kind: 'file_import', source_name: 'Watch', method: metric === 'resting_heart_rate' ? 'device_measured' : 'device_estimated', created_at: at });
  const typed = (metric, value, unit, on, at = '2026-09-14T10:00:00Z') =>
    ({ metric_key: metric, value, unit, measured_on: on, source_kind: 'manual', method: 'entered', created_at: at });
  const records = [
    // Monday's typed-in number is larger than the watch's, so taking the day's largest value across sources would show.
    typed('steps', 9500, 'steps', '2026-09-14'), watch('steps', 8000, 'steps', '2026-09-14'), watch('steps', 8200, 'steps', '2026-09-14'),
    typed('steps', 4000, 'steps', '2026-09-15'), watch('steps', 99999, 'steps', '2026-09-13'),
    watch('distance', 3, 'mi', '2026-09-14'), watch('distance', 5, 'km', '2026-09-15'), watch('distance', 2, 'mi', '2026-09-16'),
    watch('resting_heart_rate', 60, 'bpm', '2026-09-14'), watch('resting_heart_rate', 58, 'bpm', '2026-09-14'), typed('resting_heart_rate', 62, 'bpm', '2026-09-15'),
    typed('weight', 180, 'lb', '2026-09-14'),
  ];
  const week = plain(ctx.adultActivityWeek(records, dates));
  assert.deepEqual(Object.keys(week), ['steps', 'distance', 'resting_heart_rate'], 'weight is not activity, and nothing is invented for empty metrics');
  assert.deepEqual([week.steps.value, week.steps.days], [12200, 2], 'the watch wins on Monday with its largest total; last week is left out');
  assert.equal(week.steps.daily[0].source, 'Watch');
  assert.deepEqual([week.distance.value, week.distance.unit, week.distance.otherUnitReadings], [5, 'mi', 1], 'kilometres are not converted into miles');
  assert.deepEqual([week.resting_heart_rate.value, week.resting_heart_rate.summary], [60, 'average'], 'lowest of each day, averaged');
});

test('the dictionary and the database agree on every reading, and neither accepts body composition', () => {
  const ctx = context();
  const metrics = plain(vm.runInContext('ADULT_HEALTH_METRICS', ctx));
  const migration = flat(read(MIGRATION));
  for (const [key, m] of Object.entries(metrics)) {
    const methods = ['entered', ...(m.device ? [m.device] : [])];
    const bound = `value ${m.loOpen ? '>' : '>='} ${m.lo} and value ${m.hiOpen ? '<' : '<='} ${m.hi}${m.integer ? ' and value = trunc(value)' : ''}`;
    const line = `when metric = '${key}' then unit in (${m.units.map(u => `'${u}'`).join(', ')}) and method in (${methods.map(x => `'${x}'`).join(', ')}) and ${bound}\n`;
    assert.ok(migration.includes(line), key + ' should read: ' + line);
  }
  assert.equal((migration.match(/^    when metric = '/gm) || []).length, Object.keys(metrics).length, 'the database knows no reading the app does not');
  assert.doesNotMatch(Object.keys(metrics).join(' '), /fat|lean|muscle|bone|water|visceral|bmi/);
  assert.equal(vm.runInContext('ADULT_HEALTH_SAVE_MAX', ctx), 2000);
  assert.match(migration, /raise exception 'An import saves between 1 and 2000 readings\.'/);
  assert.equal(vm.runInContext('ADULT_HEALTH_IMPORT_MAX_ROWS', ctx), 5000);
  assert.match(migration, /check \(rows_received between 0 and 5000 /);
});

test("readings are the guardian's own, writing needs the allowlist, and a reading cannot be edited", () => {
  const migration = flat(read(MIGRATION));
  for (const t of ['adult_health_import_batches', 'adult_health_records']) {
    assert.match(migration, new RegExp(`create policy ${t}_select on public\\.${t} for select to authenticated using \\(guardian_id = \\(select auth\\.uid\\(\\)\\)\\);`), t + ' select');
    assert.match(migration, new RegExp(`create policy ${t}_insert on public\\.${t} for insert to authenticated\\n  with check \\(guardian_id = \\(select auth\\.uid\\(\\)\\) and private\\.adult_training_allowed\\(\\)`), t + ' insert');
    assert.match(migration, new RegExp(`alter table public\\.${t} enable row level security;`), t + ' rls');
  }
  assert.doesNotMatch(migration, /create policy adult_health_records_update/);
  assert.match(migration, /grant select, insert, delete on public\.adult_health_records to authenticated;/);
  assert.match(migration, /private\.adult_training_allowed\(\) and measured_on <= current_date \+ 1\);/);
  assert.match(migration, /create or replace function public\.save_adult_health_import\(p_batch jsonb, p_records jsonb\)\nreturns jsonb language plpgsql security invoker set search_path = ''/);
  assert.match(migration, /references public\.adult_health_import_batches \(id, guardian_id\) on delete cascade/);
  assert.doesNotMatch(migration, /can_view_athlete|can_edit_athlete|can_coach_view_athlete|can_org_view_athlete|athlete_id/);
  // Milestone 1's typed-in entries move across before their table goes.
  assert.match(migration, /select e\.guardian_id, e\.metric_key, e\.value, e\.unit, e\.measured_on, 'manual', 'entered', e\.created_at\n  from public\.adult_body_entries e\non conflict do nothing;\ndrop table public\.adult_body_entries;/);
});

test('Progress reads the one record, imports are previewed and undoable, and it all goes with the account', async () => {
  const screen = flat(read('js/screen-adult.js'));
  assert.doesNotMatch(screen, /adult_body_entries|ADULT_BODY_METRICS|adultValidateBodyEntry|adultTrend\(/);
  assert.doesNotMatch(screen, /state\.active/);
  assert.match(screen, /sb\.from\('adult_health_records'\)\.insert\(\{ guardian_id:state\.user\.id, metric_key, value, unit, measured_on, source_kind:'manual', method:'entered' \}\)/);
  assert.match(screen, /plan = adultHealthPlanImport\(parsed\.rows, existing, ctx\);/);
  assert.match(screen, /sb\.rpc\('save_adult_health_import', \{/);
  assert.match(screen, /sb\.from\('adult_health_import_batches'\)\.delete\(\)\.eq\('id', btn\.dataset\.adultImportUndo\)\.eq\('guardian_id', state\.user\.id\)/);
  for (const t of ['adult_health_records', 'adult_health_import_batches']) assert.match(screen, new RegExp(`'${t}'`), t + ' is exported');
  assert.doesNotMatch(read('js/adult-training.js'), /ADULT_BODY_METRICS|adultValidateBodyEntry|adultTrend/);

  const jsDir = path.join(base, 'js');
  for (const file of fs.readdirSync(jsDir).filter(f => /\.(m?js)$/.test(f) && !/^(screen-adult|adult-health-record|adult-progress)\.js$/.test(f)))
    assert.doesNotMatch(fs.readFileSync(path.join(jsDir, file), 'utf8'), /adult_health_(records|import_batches)|ADULT_HEALTH_METRICS/, file);

  const index = read('index.html');
  const at = name => index.indexOf('<script src="/js/' + name + '"></script>');
  assert.ok(at('adult-training.js') < at('adult-health-record.js') && at('adult-health-record.js') < at('screen-adult.js'));
  assert.match(read('sw.js'), /'\/js\/adult-training\.js','\/js\/adult-health-record\.js','\/js\/screen-adult\.js'/);

  const { ADULT_TABLES } = await import(pathToFileURL(path.join(base, 'supabase/functions/delete-account/handler.mjs')).href);
  assert.ok(!ADULT_TABLES.includes('adult_body_entries'));
  assert.ok(ADULT_TABLES.indexOf('adult_health_records') > -1 && ADULT_TABLES.indexOf('adult_health_records') < ADULT_TABLES.indexOf('adult_health_import_batches'));
  assert.match(read('privacy.html'), /you type in or import from a file exported by a scale or fitness app, each labelled with where it came from\. The file itself is read on your device and not kept\./);
});

test('the health record never claims what a reading cannot show', () => {
  const claims = /weight[- ]loss|lose weight|calorie|\bbmi\b|body[- ]fat|lean mass|muscle gain|pounds lost/i;
  for (const file of ['js/adult-health-record.js', MIGRATION]) assert.doesNotMatch(read(file), claims, file);
});

test('Bluetooth sessions on one day are separate workouts: added together, as one source whatever the equipment', () => {
  const ctx = context();
  const dates = Array.from({ length: 7 }, (_, i) => '2026-09-' + String(14 + i).padStart(2, '0'));
  const session = (id, name, metric, value, unit, at) => ({
    metric_key: metric, value, unit, measured_on: '2026-09-14', source_kind: 'file_import', source_name: name + ' via Bluetooth',
    method: metric === 'distance' ? 'device_estimated' : 'device_measured', external_id: 'bt-' + id + '-' + (metric === 'distance' ? 'distance' : 'minutes'), created_at: at,
  });
  const records = [
    session('a', 'Synthetic treadmill', 'workout_minutes', 30, 'min', '2026-09-14T07:00:00Z'), session('a', 'Synthetic treadmill', 'distance', 3.1, 'mi', '2026-09-14T07:00:00Z'),
    session('b', 'Synthetic treadmill', 'workout_minutes', 20, 'min', '2026-09-14T18:00:00Z'), session('b', 'Synthetic treadmill', 'distance', 1.95, 'mi', '2026-09-14T18:00:00Z'),
    session('c', 'Synthetic chest strap', 'workout_minutes', 15, 'min', '2026-09-14T19:00:00Z'),
  ];
  const week = plain(ctx.adultActivityWeek(records, dates));
  assert.deepEqual([week.workout_minutes.value, week.workout_minutes.days], [65, 1], 'three sessions on two pieces of equipment, not the latest one alone');
  assert.equal(week.distance.value, 5.05);
  // A file export of a daily total still takes its largest value, so a re-export never counts twice.
  const exported = [1, 2].map(n => ({ metric_key: 'workout_minutes', value: 30 * n, unit: 'min', measured_on: '2026-09-15', source_kind: 'file_import',
    source_name: 'Watch', method: 'device_measured', created_at: '2026-09-15T0' + n + ':00:00Z' }));
  assert.equal(plain(ctx.adultActivityWeek(exported, dates)).workout_minutes.value, 60);
});
