// The offline week snapshot is what a parent sees on a field with no signal. It was kept
// for eight days, which is not the same as "this week": a plan cached last Monday was still
// served THIS Monday — a new week, showing last week's plan with last week's days already
// ticked off. That is the exact failure the age check was written to prevent, and its own
// comment described it ("Monday's session on the following Thursday").
//
// It now compares weeks. These cover the boundary in both directions, the DST weeks where
// elapsed time and calendar weeks disagree most, and the upgrade case where an older
// snapshot carries no week at all.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');

// A context with a controllable clock and a real-enough localStorage.
function context(now) {
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  const RealDate = Date;
  // Date.now() and `new Date()` both follow the injected clock; explicit arguments do not,
  // so the calendar arithmetic under test still behaves normally.
  class FakeDate extends RealDate {
    constructor(...args) { return args.length ? new RealDate(...args) : new RealDate(now); }
    static now() { return new RealDate(now).getTime(); }
  }
  const ctx = vm.createContext({ console, Number, Math, String, JSON, Date: FakeDate, localStorage, self: {}, navigator: {} });
  const source = fs.readFileSync(path.join(base, 'js', 'offline.js'), 'utf8');
  // Only the snapshot half: the outbox needs IndexedDB and Supabase.
  const cut = source.indexOf('function owOpen()');
  assert.ok(cut > 0, 'offline.js should still define owOpen');
  vm.runInContext(source.slice(0, cut), ctx);
  return { ctx, store };
}

const SNAPSHOT = { athlete_id: 'a1', first_name: 'Sam', sub: '', days: [{ d: 0, t: 'train', title: 'x' }], done: [1] };

// Write on one date, read on another, and report whether the plan survived.
function survives(writeOn, readOn) {
  const a = context(writeOn);
  a.ctx.owSaveWeek(SNAPSHOT);
  const raw = a.store.get('pp_week_cache');
  const b = context(readOn);
  b.store.set('pp_week_cache', raw);
  return b.ctx.owReadWeek() !== null;
}

test('the Monday of a week is found for every day in it', () => {
  const { ctx } = context('2026-09-11T12:00:00');
  // Monday 7 September 2026 through Sunday the 13th all belong to the same week.
  for (const day of [7, 8, 9, 10, 11, 12, 13]) {
    assert.equal(ctx.owWeekStart(new Date(2026, 8, day, 12, 0)), '2026-09-07', `Sept ${day}`);
  }
  // The next Monday starts a new one.
  assert.equal(ctx.owWeekStart(new Date(2026, 8, 14, 0, 5)), '2026-09-14');
});

test('a plan written this week is still served later in the same week', () => {
  assert.equal(survives('2026-09-07T09:00:00', '2026-09-07T18:00:00'), true, 'same day');
  assert.equal(survives('2026-09-07T09:00:00', '2026-09-10T07:30:00'), true, 'Thursday');
  assert.equal(survives('2026-09-07T09:00:00', '2026-09-13T23:30:00'), true, 'Sunday night');
});

test('a plan from last week is refused once the new week starts', () => {
  // The case the age check let through: seven days later is a different week, not a stale
  // copy of the same one.
  assert.equal(survives('2026-09-07T09:00:00', '2026-09-14T08:00:00'), false, 'the following Monday');
  assert.equal(survives('2026-09-07T09:00:00', '2026-09-14T00:01:00'), false, 'one minute into the new week');
  assert.equal(survives('2026-09-13T23:59:00', '2026-09-14T00:01:00'), false, 'two minutes apart, across the boundary');
});

test('the boundary is the week, not an elapsed number of hours', () => {
  // Under the old rule these two had opposite outcomes purely because of elapsed time.
  // Both are now decided by which week they belong to, which is the question being asked.
  assert.equal(survives('2026-09-07T09:00:00', '2026-09-13T09:00:00'), true, 'six days, same week: kept');
  assert.equal(survives('2026-09-08T09:00:00', '2026-09-14T09:00:00'), false, 'six days, next week: refused');
});

test('a week containing a DST change is still one week', () => {
  // US clocks go forward on Sunday 8 March 2026. An elapsed-time rule measures that week as
  // 167 hours; a calendar rule does not care.
  const { ctx } = context('2026-03-10T12:00:00');
  for (const day of [2, 5, 8]) {
    assert.equal(ctx.owWeekStart(new Date(2026, 2, day, 12, 0)), '2026-03-02', `March ${day}`);
  }
  assert.equal(survives('2026-03-02T09:00:00', '2026-03-08T20:00:00'), true, 'across the spring-forward, same week');
  assert.equal(survives('2026-03-02T09:00:00', '2026-03-09T09:00:00'), false, 'the Monday after it');
});

test('a snapshot from a build that recorded no week is refused, not trusted', () => {
  const { ctx, store } = context('2026-09-09T09:00:00');
  store.set('pp_week_cache', JSON.stringify({ at: Date.now(), ...SNAPSHOT }));   // no week_start
  assert.equal(ctx.owReadWeek(), null);
});

test('a missing, empty or corrupt snapshot reads as no snapshot', () => {
  const { ctx, store } = context('2026-09-09T09:00:00');
  assert.equal(ctx.owReadWeek(), null, 'nothing stored');
  store.set('pp_week_cache', 'not json at all');
  assert.equal(ctx.owReadWeek(), null, 'unparseable');
  store.set('pp_week_cache', JSON.stringify({ at: Date.now(), week_start: '2026-09-07' }));
  assert.equal(ctx.owReadWeek(), null, 'no days');
});
