// Adult Training, milestone 1: a parent's own goals, gym schedule, completed workouts and the weight or tape
// measurements they enter. These pin the pure logic, and the three promises the feature rests on:
//
//   it is off for everyone until switched on (a false flag, plus a database allowlist the migration enforces);
//   it is the parent's alone (the screen never reads the active child; account deletion and export include it);
//   it never claims what a photo or an entry cannot show (no composition words, no computed targets).
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const base = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8');
const flat = text => text.replace(/\r\n/g, '\n');

function context() {
  const ctx = vm.createContext({ console, Number, Math, String, Date, JSON, Set, Map, Array, Object });
  vm.runInContext(read('js/adult-training.js'), ctx);
  return ctx;
}
const constant = (ctx, name) => vm.runInContext(name, ctx);
const plain = value => JSON.parse(JSON.stringify(value));

test('a scheduled workout needs a name, a day and a kind; minutes are optional but whole', () => {
  const ctx = context();
  const v = input => plain(ctx.adultValidateScheduleItem(input));
  assert.deepEqual(v({ title: '  Upper   body ', weekday: '2', kind: 'strength', duration_min: '45' }),
    { ok: true, value: { title: 'Upper body', weekday: 2, kind: 'strength', duration_min: 45 } });
  assert.equal(v({ title: 'Walk', weekday: 6, kind: 'walk', duration_min: '' }).value.duration_min, null);
  // An adult may train any day of the week: the children's rest floor does not apply.
  for (let day = 0; day < 7; day++) assert.equal(v({ title: 'Run', weekday: day, kind: 'cardio' }).ok, true);
  for (const bad of [
    { title: '', weekday: 1, kind: 'strength' }, { title: 'x', weekday: 7, kind: 'strength' },
    { title: 'x', weekday: 1, kind: 'constructor' }, { title: 'x', weekday: 1, kind: 'strength', duration_min: '0' },
    { title: 'x', weekday: 1, kind: 'strength', duration_min: '2.5' }, { title: 'x', weekday: 1, kind: 'strength', duration_min: '601' },
  ]) assert.equal(v(bad).ok, false, JSON.stringify(bad));
});

test('an exercise has a name and sensible sets, reps or seconds', () => {
  const ctx = context();
  const v = input => plain(ctx.adultValidateExercise(input));
  assert.deepEqual(v({ name: 'Goblet squat', sets: '3', reps: '8', duration_sec: '' }),
    { ok: true, value: { name: 'Goblet squat', sets: 3, reps: 8, duration_sec: null } });
  for (const bad of [{ name: '' }, { name: 'x', sets: '21' }, { name: 'x', reps: '0' }, { name: 'x', duration_sec: '7201' }])
    assert.equal(v(bad).ok, false, JSON.stringify(bad));
  assert.equal(ctx.adultExerciseLine({ name: 'Goblet squat', sets: 3, reps: 8 }), 'Goblet squat · 3 × 8');
  assert.equal(ctx.adultExerciseLine({ name: 'Plank', duration_sec: 45 }), 'Plank · 45 s');
  assert.equal(ctx.adultExerciseLine({ name: 'Easy bike', duration_sec: 1200 }), 'Easy bike · 20 min');
});

test('weight takes a weight unit and a tape measurement takes a length unit, from today or earlier', () => {
  const ctx = context();
  const v = input => plain(ctx.adultValidateBodyEntry(input, '2026-09-14'));
  assert.deepEqual(v({ metric_key: 'weight', value: '182.4', unit: 'lb', measured_on: '2026-09-14' }),
    { ok: true, value: { metric_key: 'weight', value: 182.4, unit: 'lb', measured_on: '2026-09-14', source: 'manual' } });
  assert.equal(v({ metric_key: 'waist', value: '34', unit: 'in', measured_on: '2026-09-01' }).ok, true);
  for (const bad of [
    { metric_key: 'weight', value: '80', unit: 'cm', measured_on: '2026-09-14' },
    { metric_key: 'waist', value: '80', unit: 'kg', measured_on: '2026-09-14' },
    { metric_key: 'body_fat', value: '20', unit: 'lb', measured_on: '2026-09-14' },
    { metric_key: 'weight', value: '0', unit: 'lb', measured_on: '2026-09-14' },
    { metric_key: 'weight', value: '', unit: 'lb', measured_on: '2026-09-14' },
    { metric_key: 'weight', value: '180', unit: 'lb', measured_on: '2026-09-15' },
    { metric_key: 'constructor', value: '1', unit: 'lb', measured_on: '2026-09-14' },
  ]) assert.equal(v(bad).ok, false, JSON.stringify(bad));
});

test('the week lists each day\'s workouts with their exercises, and counts only what was ticked off', () => {
  const ctx = context();
  const dateFor = i => '2026-09-' + String(14 + i).padStart(2, '0');
  const items = [
    { id: 'a', weekday: 0, title: 'Upper body', kind: 'strength', duration_min: 40 },
    { id: 'b', weekday: 2, title: 'Easy run', kind: 'cardio', duration_min: 25 },
    { id: 'c', weekday: 4, title: 'Lower body', kind: 'strength', duration_min: 45 },
  ];
  const exercises = [{ id: 'e2', item_id: 'a', name: 'Row', position: 1 }, { id: 'e1', item_id: 'a', name: 'Press', position: 0 }];
  const logs = [
    { schedule_item_id: 'a', done_on: '2026-09-14' },
    { schedule_item_id: 'b', done_on: '2026-09-16' },
    { schedule_item_id: 'c', done_on: '2026-09-11' },      // last week: not this week's Friday
    { schedule_item_id: null, done_on: '2026-09-15' },     // a workout since deleted from the schedule
  ];
  const week = plain(ctx.adultWeek(items, exercises, logs, dateFor));
  assert.equal(week.length, 7);
  assert.deepEqual(week[0].items[0].exercises.map(e => e.name), ['Press', 'Row']);
  assert.deepEqual(week.map(d => d.items.map(i => i.done)), [[true], [], [true], [], [false], [], []]);
  assert.deepEqual(plain(ctx.adultWeekSummary(week)), { planned: 3, done: 2, minutesDone: 65, strengthDaysDone: 1 });
});

test('a trend compares the latest entry with the previous one in the same unit, and nothing else', () => {
  const ctx = context();
  const entries = [
    { metric_key: 'weight', value: 180, unit: 'lb', measured_on: '2026-09-01' },
    { metric_key: 'weight', value: 82, unit: 'kg', measured_on: '2026-09-07' },
    { metric_key: 'weight', value: 178.35, unit: 'lb', measured_on: '2026-09-14' },
    { metric_key: 'waist', value: 34, unit: 'in', measured_on: '2026-09-14' },
  ];
  const weight = plain(ctx.adultTrend(entries, 'weight'));
  assert.equal(weight.latest.value, 178.35);
  assert.equal(weight.previous.measured_on, '2026-09-01', 'the kilogram reading in between is skipped, not converted');
  assert.equal(weight.change, -1.7);
  assert.equal(plain(ctx.adultTrend(entries, 'waist')).change, null, 'one reading has nothing to compare');
  assert.equal(ctx.adultTrend(entries, 'hips'), null);
  const unitsChanged = plain(ctx.adultTrend([{ metric_key: 'weight', value: 80, unit: 'kg', measured_on: '2026-09-02' }, { metric_key: 'weight', value: 176, unit: 'lb', measured_on: '2026-09-09' }], 'weight'));
  assert.equal(unitsChanged.change, null);
});

test('the federal activity baseline is shown as a reference, and at most three goals', () => {
  const ctx = context();
  assert.deepEqual(plain(constant(ctx, 'ADULT_ACTIVITY_BASELINE')), { weeklyMinutesLow: 150, weeklyMinutesHigh: 300, strengthDays: 2 });
  assert.equal(constant(ctx, 'ADULT_GOAL_MAX'), 3);
  assert.deepEqual(Object.keys(constant(ctx, 'ADULT_GOAL_KINDS')), ['weight_trend', 'strength', 'mobility', 'endurance', 'energy', 'consistency']);
  const screen = read('js/screen-adult.js');
  assert.match(screen, /For reference, the federal guidelines for adults are \$\{B\.weeklyMinutesLow\} to \$\{B\.weeklyMinutesHigh\} minutes/);
  assert.match(screen, /Start wherever you are\./);
});

test('adult training never claims what an entry or a photo cannot show', () => {
  // The child-facing files are not scanned here: they already say what a reading is never used for, including a
  // weight-loss target (js/org-composition.js), and that disclaimer is the point.
  const claims = /weight[- ]loss|lose weight|calorie|\bbmi\b|body[- ]fat|lean mass|muscle gain|pounds lost/i;
  for (const file of ['js/adult-training.js', 'js/screen-adult.js', 'supabase/migrations/20260914120000_adult_training_foundation.sql']) {
    assert.doesNotMatch(read(file), claims, file);
  }
});

test('it is off unless switched on, and the database refuses writes from anyone not allowlisted', () => {
  const core = flat(read('js/core.js'));
  assert.match(core, /\nconst ADULT_TRAINING_ENABLED = false;\n/);
  assert.match(core, /function adultTrainingOn\(\)\{ return ADULT_TRAINING_ENABLED \|\| !!state\.adultTrainingAllowed; \}/);
  assert.match(read('js/auth.js'), /loadPremium\(\), loadAdultTrainingAccess\(\) \]\);/);
  const migration = flat(read('supabase/migrations/20260914120000_adult_training_foundation.sql'));
  const tables = [...migration.matchAll(/create table if not exists public\.(adult_[a-z_]+) \(/g)].map(m => m[1]);
  const record = tables.filter(t => t !== 'adult_training_access');
  assert.equal(record.length, 6);
  for (const t of record) {
    assert.match(migration, new RegExp(`create policy ${t}_insert on public\\.${t} for insert to authenticated\\n  with check \\(guardian_id = \\(select auth\\.uid\\(\\)\\) and private\\.adult_training_allowed\\(\\)`), t + ' insert');
    assert.match(migration, new RegExp(`create policy ${t}_select on public\\.${t} for select to authenticated using \\(guardian_id = \\(select auth\\.uid\\(\\)\\)\\);`), t + ' select');
  }
  // Nothing grants a co-parent, family viewer, coach or organization a way in.
  assert.doesNotMatch(migration, /can_view_athlete|can_edit_athlete|can_coach_view_athlete|can_org_view_athlete|is_admin_of_team/);
});

test('it is the parent\'s own: never tied to the active child, reachable from Account, exported and deleted with the account', async () => {
  const screen = read('js/screen-adult.js');
  assert.doesNotMatch(screen, /state\.active/);
  const shell = read('js/shell.js');
  assert.match(shell, /const APP_TABS=\[[^\]]*'adult'[^\]]*\];/);
  assert.match(shell, /if\(tab==='adult' && adultTrainingOff\(\)\) return;/);
  assert.match(shell, /if\(state\.role==='coach' && tab!=='adult'\) return renderCoachView\(\);/);
  assert.match(shell, /else if\(tab==='adult'\) await screenAdult\(\);/);
  assert.match(shell, /if\(active==='account'\|\|active==='adult'\) active='profile';/);

  const account = read('js/account.js');
  assert.match(account, /\$\{adultTrainingOn\(\)\?H`<div class="sec-title">Your training<\/div>/);
  assert.match(account, /go\('toAdult', \(\)=>renderApp\('adult'\)\);/);
  assert.match(account, /adult_training:adult\.data,/);
  assert.match(account, /if\(!ids\.length&&!adult\.hasData\)/);

  const index = read('index.html');
  const at = name => index.indexOf('<script src="/js/' + name + '"></script>');
  assert.ok(at('core.js') < at('adult-training.js') && at('adult-training.js') < at('screen-adult.js') && at('screen-adult.js') < at('init.js'));
  const sw = read('sw.js');
  assert.match(sw, /'\/js\/adult-training\.js','\/js\/screen-adult\.js'/);

  // Every table an Adult Training migration creates is deleted by delete-account, children before parents.
  const migration = fs.readdirSync(path.join(base, 'supabase/migrations')).filter(f => /_adult_[a-z_]+\.sql$/.test(f)).sort()
    .map(f => flat(read('supabase/migrations/' + f))).join('\n');
  const tables = [...migration.matchAll(/create table if not exists public\.(adult_[a-z_]+) \(/g)].map(m => m[1]);
  const { ADULT_TABLES } = await import(pathToFileURL(path.join(base, 'supabase/functions/delete-account/handler.mjs')).href);
  assert.deepEqual([...ADULT_TABLES].sort(), [...tables].sort());
  assert.ok(ADULT_TABLES.indexOf('adult_schedule_exercises') < ADULT_TABLES.indexOf('adult_schedule_items'));
  assert.ok(ADULT_TABLES.indexOf('adult_workout_logs') < ADULT_TABLES.indexOf('adult_schedule_items'));

  const privacy = read('privacy.html');
  assert.match(privacy, /<b>Your own training record<\/b>/);
  assert.match(privacy, /It is private to you: co-parents, family members, coaches and organizations cannot see it\./);
  assert.match(read('datadeletion.html'), /<li>Your own training record, if you keep one: goals, schedule, workouts, measurements, food preferences, recipes and meal plans\.<\/li>/);
});
