// The week-level streak is a product commitment, not a stat: rest days count, and a week
// counts when every non-rest day was done or moved. Two bugs made it unreachable for real
// parents, and both are pinned here.
//
//   1. Completion was tracked as a Set of session TITLES. A week's plan can use the same
//      title on two days — a five-year-old's speed week carries "Chase & tag games" twice —
//      so two completed days collapsed to one while `need` still counted two days. The
//      streak could never be earned: ticking off every day for months still showed zero.
//
//   2. Week keys were derived by subtracting back*7*86400000 milliseconds. The week holding
//      a spring-forward is 167 hours, not 168, so the result landed at 23:00 the previous
//      Sunday and snapped back a further week. Every week before a DST change was looked up
//      under the wrong key, breaking the streak each spring.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');

function context() {
  const ctx = vm.createContext({ console, Number, Math, String, Date, JSON, Set, Map, Array, Object, isNaN, parseInt, parseFloat });
  vm.runInContext("function esc(v){return String(v??'');}", ctx);
  // js/dates.js first, exactly as index.html loads it: program.js's isoDay() is
  // localDay() and nothing else, so a context without it is not the browser.
  vm.runInContext(fs.readFileSync(path.join(base, 'js', 'dates.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(base, 'js', 'program.js'), 'utf8'), ctx);
  return ctx;
}

// A five-year-old with a speed goal: the configuration whose plan repeats a title.
const PLAN = { age: 5, goals: [{ key: 'speed' }], sportKey: null, positions: [], schedule: {} };

// Every non-rest day of the last `weeks` weeks, completed honestly.
function completedWeeks(ctx, weeks, weekIndex) {
  const rows = [];
  for (let back = 1; back <= weeks; back++) {
    const plan = ctx.buildProgram(PLAN.age, PLAN.goals, PLAN.sportKey, PLAN.positions, weekIndex - back, PLAN.schedule);
    const monday = ctx.mondayWeeksBack(back);
    plan.days.forEach((d, i) => {
      if (!d || d.t === 'rest') return;
      rows.push({ done_on: ctx.isoDay(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)), title: d.title });
    });
  }
  return rows;
}

test('the week this test relies on really does repeat a title', () => {
  // If the program engine changes so no week repeats a title, the regression below stops
  // testing anything. Fail loudly here rather than passing silently there.
  const ctx = context();
  const plan = ctx.buildProgram(PLAN.age, PLAN.goals, PLAN.sportKey, PLAN.positions, 9, PLAN.schedule);
  const nonRest = plan.days.filter(d => d && d.t !== 'rest');
  const titles = new Set(nonRest.map(d => d.title));
  assert.ok(nonRest.length > titles.size,
    'this fixture needs a week whose plan uses one title on two days; pick another age/goal if the engine changed');
});

test('completing every non-rest day counts the week, even when a title repeats', () => {
  const ctx = context();
  const weekIndex = 10;
  const rows = completedWeeks(ctx, 3, weekIndex);
  assert.equal(ctx.weekStreak(rows, { ...PLAN, weekIndex }), 3);
});

test('a missed day still breaks the streak', () => {
  const ctx = context();
  const weekIndex = 10;
  const rows = completedWeeks(ctx, 3, weekIndex);
  // Drop one completed session from the middle week. That week is now incomplete, so the
  // streak stops there rather than counting through it.
  const monday = ctx.mondayWeeksBack(2);
  const inThatWeek = rows.filter(r => r.done_on >= ctx.isoDay(monday));
  const victim = rows.indexOf(inThatWeek[inThatWeek.length - 1]);
  rows.splice(victim, 1);
  const streak = ctx.weekStreak(rows, { ...PLAN, weekIndex });
  assert.ok(streak < 3, 'an incomplete week must not count');
  assert.equal(streak, 1, 'the streak should stop at the incomplete week, not before it');
});

test('re-ticking the same session on the same day cannot inflate the streak', () => {
  const ctx = context();
  const weekIndex = 10;
  const rows = completedWeeks(ctx, 1, weekIndex);
  const short = rows.slice(0, rows.length - 1);          // one day short of the week
  const padded = short.concat(short.map(r => ({ ...r }))); // every row duplicated
  assert.equal(ctx.weekStreak(padded, { ...PLAN, weekIndex }), 0,
    'duplicated rows must not substitute for the missing day');
});

test('an empty history is a zero streak, not a crash', () => {
  const ctx = context();
  assert.equal(ctx.weekStreak([], { ...PLAN, weekIndex: 10 }), 0);
  assert.equal(ctx.weekStreak(null, { ...PLAN, weekIndex: 10 }), 0);
  // Rows without a date are ignored rather than counted.
  assert.equal(ctx.weekStreak([{ title: 'x' }, { done_on: null, title: 'y' }], { ...PLAN, weekIndex: 10 }), 0);
});

test('week keys step back by exactly seven calendar days across a DST change', () => {
  const ctx = context();
  // mondayWeeksBack is relative to the real current week, so walk far enough back to cross
  // whichever DST boundary this machine's timezone has. The invariant holds regardless:
  // consecutive keys are always seven calendar days apart.
  let previous = null;
  for (let back = 0; back <= 30; back++) {
    const monday = ctx.mondayWeeksBack(back);
    assert.equal(monday.getDay(), 1, `week ${back} back is not a Monday`);
    if (previous) {
      const expected = new Date(previous.getFullYear(), previous.getMonth(), previous.getDate() - 7);
      assert.equal(ctx.isoDay(monday), ctx.isoDay(expected),
        `week ${back} back is not seven calendar days before week ${back - 1} back`);
    }
    previous = monday;
  }
});

test('the old epoch arithmetic really did drift, so this is not a theoretical fix', () => {
  // Reproduces the previous implementation against a known spring-forward. Anchored to a
  // fixed date so it does not depend on today, and skipped where the timezone has no DST.
  const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const anchor = new Date(2026, 2, 16);                       // Monday after US spring-forward
  const offsetsDiffer = new Date(2026, 0, 15).getTimezoneOffset() !== new Date(2026, 6, 15).getTimezoneOffset();
  if (!offsetsDiffer) return;                                  // no DST here; nothing to drift
  const old = iso(mondayOf(new Date(anchor.getTime() - 2 * 7 * 86400000)));
  const correct = iso(new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - 14));
  assert.notEqual(old, correct, 'the old arithmetic should drift across spring-forward');
});
