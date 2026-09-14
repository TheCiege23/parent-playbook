// Your training → Progress over time: eight weeks of a parent's own record, week by week. These run the real functions
// and markup, and pin what the view promises: one source a day and one unit across the weeks, weight on an honest scale,
// every chart read out in words, and nothing that scores the parent or sets a target. Every fixture is synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));

function context() {
  const ctx = vm.createContext({ console, Number, Math, String, Date, JSON, Set, Map, Array, Object, Intl });
  vm.runInContext(`const H=(s,...v)=>s.reduce((a,x,i)=>a+x+(v[i]??''),'');
    function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
    function fmtDate(d){return d;}`, ctx);
  for (const file of ['js/dates.js', 'js/adult-health-record.js', 'js/adult-nutrition.js', 'js/adult-progress.js']) vm.runInContext(read(file), ctx);
  return ctx;
}

test('eight Monday-to-Sunday weeks ending this week, across a month and a year', () => {
  const ctx = context();
  const weeks = plain(ctx.adultProgressWeeks('2027-01-04'));
  assert.equal(weeks.length, 8);
  assert.deepEqual([weeks[0].start, weeks[7].start, weeks[7].end], ['2026-11-16', '2027-01-04', '2027-01-10']);
  assert.ok(weeks.every(w => w.dates.length === 7));
  assert.deepEqual(weeks[6].dates.slice(-2), ['2027-01-02', '2027-01-03'], 'weeks run on without gaps or overlaps');
});

test('workouts by week count ticks, minutes and strength days, and keep a tick whose workout was deleted', () => {
  const ctx = context();
  const weeks = ctx.adultProgressWeeks('2026-09-14', 2);
  const items = [{ id: 'lift', kind: 'strength' }, { id: 'walk', kind: 'walk' }];
  const logs = [
    { schedule_item_id: 'lift', done_on: '2026-09-08', minutes: 40 },
    { schedule_item_id: 'walk', done_on: '2026-09-09', minutes: 30 },
    { schedule_item_id: 'lift', done_on: '2026-09-14', minutes: 45 },
    { schedule_item_id: null, done_on: '2026-09-15', minutes: 20 },
    { schedule_item_id: 'lift', done_on: '2026-08-30', minutes: 99 },
  ];
  assert.deepEqual(plain(ctx.adultWorkoutsByWeek(logs, weeks, items)), [
    { start: '2026-09-07', workouts: 2, minutes: 70, strengthDays: 1 },
    { start: '2026-09-14', workouts: 2, minutes: 65, strengthDays: 1 },
  ]);
});

test('activity by week takes one source a day and one unit across all the weeks', () => {
  const ctx = context();
  const weeks = ctx.adultProgressWeeks('2026-09-14', 2);
  const row = (metric, value, unit, on, kind = 'manual', extra = {}) => ({ metric_key: metric, value, unit, measured_on: on, source_kind: kind,
    method: kind === 'manual' ? 'entered' : 'device_estimated', source_name: kind === 'manual' ? null : 'Watch', created_at: on + 'T08:00:00Z', ...extra });
  const records = [
    row('steps', 9500, 'steps', '2026-09-08'), row('steps', 8000, 'steps', '2026-09-08', 'file_import'),
    row('steps', 4000, 'steps', '2026-09-15'),
    row('distance', 3, 'mi', '2026-09-08', 'file_import'), row('distance', 2, 'mi', '2026-09-15', 'file_import'), row('distance', 5, 'km', '2026-09-16', 'file_import'),
  ];
  const steps = plain(ctx.adultActivityByWeek(records, weeks, 'steps'));
  assert.deepEqual(steps.weeks.map(w => w.value), [8000, 4000], "the watch's reading, not the typed one added to it");
  const distance = plain(ctx.adultActivityByWeek(records, weeks, 'distance'));
  assert.equal(distance.unit, 'mi');
  assert.equal(distance.otherUnitReadings, 1);
  assert.deepEqual(distance.weeks.map(w => w.value), [3, 2], 'kilometres are left out, not added in');
  assert.deepEqual(plain(ctx.adultActivityByWeek(records, weeks, 'active_minutes')).weeks.map(w => w.value), [null, null]);
});

test('weight is one unit, oldest first, with its sources, on a scale that cannot exaggerate', () => {
  const ctx = context();
  const records = [
    { metric_key: 'weight', value: 180, unit: 'lb', measured_on: '2026-09-01', source_kind: 'manual', method: 'entered' },
    { metric_key: 'weight', value: 82, unit: 'kg', measured_on: '2026-09-03', source_kind: 'manual', method: 'entered' },
    { metric_key: 'weight', value: 179, unit: 'lb', measured_on: '2026-09-10', source_kind: 'file_import', source_name: 'Scale app', method: 'device_measured' },
    { metric_key: 'weight', value: 170, unit: 'lb', measured_on: '2026-07-01', source_kind: 'manual', method: 'entered' },
  ];
  const series = plain(ctx.adultWeightSeries(records, '2026-08-01'));
  assert.equal(series.unit, 'lb');
  assert.deepEqual(series.points.map(p => [p.date, p.value, p.source]), [['2026-09-01', 180, 'Typed in'], ['2026-09-10', 179, 'Scale app']]);
  assert.equal(series.otherUnitReadings, 1);
  // A one-pound change on a 180 lb scale moves the line a little, not from the bottom of the chart to the top.
  const ys = [...ctx.adultWeightSvg(series).matchAll(/<circle cx="\d+" cy="(\d+)"/g)].map(m => Number(m[1]));
  assert.ok(Math.abs(ys[0] - ys[1]) < 12, 'moved ' + Math.abs(ys[0] - ys[1]) + ' of 64');
  assert.equal(ctx.adultWeightSvg({ unit: 'lb', points: [series.points[0]], otherUnitReadings: 0 }), '', 'one reading draws no line');
  const shown = ctx.adultProgressMarkup({ weeks: ctx.adultProgressWeeks('2026-09-14', 8), workouts: [], activity: {}, weight: series, habits: [], prefs: null });
  assert.match(shown, /Sources: Typed in, Scale app\. 1 in another unit not shown\./);
});

test('every chart is read out in words, a quiet week is nothing recorded, and nothing scores or targets the parent', () => {
  const ctx = context();
  const weeks = ctx.adultProgressWeeks('2026-09-14', 8);
  const html = ctx.adultProgressMarkup({
    weeks,
    workouts: ctx.adultWorkoutsByWeek([{ schedule_item_id: 'lift', done_on: '2026-09-14', minutes: 40 }], weeks, [{ id: 'lift', kind: 'strength' }]),
    activity: { steps: ctx.adultActivityByWeek([{ metric_key: 'steps', value: 7000, unit: 'steps', measured_on: '2026-09-14', source_kind: 'manual', method: 'entered' }], weeks, 'steps') },
    weight: ctx.adultWeightSeries([], weeks[0].start),
    habits: ctx.adultHabitsByWeek([{ logged_on: '2026-09-14', protein_meals: 2 }], { protein_meals_target: 2 }, weeks),
    prefs: { protein_meals_target: 2 },
  });
  const svgs = [...html.matchAll(/<svg [^>]*role="img" aria-label="([^"]+)"/g)].map(m => m[1]);
  assert.equal(svgs.length, 3, 'workouts, steps and the protein aim; no weight chart without readings');
  for (const label of svgs) assert.equal((label.match(/week of /g) || []).length, 8, label);
  assert.match(svgs[0], /^Workouts ticked off, by week: week of [^,]+, nothing recorded;/);
  assert.match(svgs[0], /, 1 workout$/, 'a count is spoken with what it counts, in agreement');
  assert.match(svgs[2], /, 1 day$/);
  assert.doesNotMatch(html, /\b1 (workouts|days|strength days)\b/);
  assert.match(html, /<b>1 workout · 40 min · 1 strength day<\/b>/);
  assert.match(html, /<b>1 of 1 day logged<\/b>/);
  assert.match(html, /Days meeting your protein aim/);
  assert.match(html, /Your record compared with nothing but itself\. A quiet week is just a quiet week\./);
  const src = read('js/adult-progress.js');
  assert.doesNotMatch(src.replace(/\/\/[^\n]*/g, ''), /target weight|goal weight|lose weight|weight[- ]loss|calorie|\bbmi\b|body[- ]fat|streak|score|behind|failed|on track/i);
  const empty = ctx.adultProgressMarkup({ weeks, workouts: ctx.adultWorkoutsByWeek([], weeks, []), activity: {}, weight: ctx.adultWeightSeries([], weeks[0].start), habits: ctx.adultHabitsByWeek([], null, weeks), prefs: null });
  assert.match(empty, /No workouts ticked off in these eight weeks yet\./);
  assert.doesNotMatch(empty, /<svg/);
});

test("it reads only the parent's own rows, never a child, and opens from Progress in Your training", () => {
  const src = read('js/adult-progress.js');
  const queries = [...src.matchAll(/sb\.from\('([a-z_]+)'\)[^\n]*/g)];
  assert.equal(queries.length, 5);
  for (const q of queries) {
    assert.match(q[1], /^adult_/);
    assert.match(q[0], /\.eq\('guardian_id', uid\)/, q[1]);
  }
  assert.doesNotMatch(src, /state\.active|athlete/);
  const screen = read('js/screen-adult.js');
  assert.match(screen, /<button class="btn sm ghost" id="adultProgressOverTime" style="margin-top:10px">Progress over time<\/button>/);
  assert.match(screen, /\{ const b = \$\("#adultProgressOverTime"\); if \(b\) b\.onclick = \(\) => openAdultProgress\(\); \}/);
  const index = read('index.html');
  const at = name => index.indexOf('<script src="/js/' + name + '"></script>');
  assert.ok(at('adult-health-record.js') < at('adult-progress.js') && at('adult-nutrition.js') < at('adult-progress.js') && at('adult-progress.js') < at('init.js'));
  assert.match(read('sw.js'), /'\/js\/adult-composition\.js','\/js\/adult-progress\.js',/);
});
