// Rest-first is a product commitment, not a tunable default. These pin the three rules
// that make it true, across every plan the engine can generate rather than one example:
//
//   the week never has fewer than MIN_REST_DAYS rest days, before or after rebalancing;
//   rebalancing moves work, it never adds any;
//   a missed day is never parked the evening before a game, and never renders as a failure.
//
// None of these was broken when the tests were written. They exist because all three are
// invisible to every other check, and each would be a quiet betrayal of what the app
// tells a parent rather than a crash anyone would notice.
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
// A top-level `const` in a classic script does not become a property of the vm global, so
// it has to be read by evaluating the name. Reading it as ctx.MIN_REST_DAYS yields
// undefined, and `rest < undefined` is false for every input — a sweep that checks
// thousands of plans and cannot fail. The guard test below is what stops that recurring.
const floorOf = ctx => vm.runInContext('MIN_REST_DAYS', ctx);

const isWork = d => !!d && (d.t === 'train' || d.t === 'gym');
const restDays = days => days.filter(d => d && d.t === 'rest').length;

// A spread wide enough that a rule can't hold by accident on one configuration.
const SPORTS = ['football', 'basketball', 'soccer', null];
const GOALS = [[], [{ key: 'speed' }], [{ key: 'speed' }, { key: 'strength' }]];
const SCHEDULES = [{}, { practice: [1, 3] }, { practice: [1, 2, 3, 4] }, { practice: [1, 2, 3, 4], games: [5, 6] }];
function everyPlan(ctx, fn) {
  let seen = 0;
  for (const age of [5, 8, 11, 14, 17]) for (const sportKey of SPORTS) for (const goals of GOALS)
    for (const schedule of SCHEDULES) for (let week = 0; week < 3; week++) {
      let plan;
      try { plan = ctx.buildProgram(age, goals, sportKey, [], week, schedule); } catch { continue; }
      const days = (plan && plan.days) || [];
      if (days.length !== 7) continue;
      seen++;
      fn({ days, age, sportKey, goals, schedule, week });
    }
  return seen;
}

test('the rest floor is a real number, so the sweeps below can actually fail', () => {
  const floor = floorOf(context());
  assert.equal(typeof floor, 'number');
  assert.ok(floor >= 2, 'rest-first means at least two rest days');
});

test('every generated week honours the rest floor', () => {
  const ctx = context(), floor = floorOf(ctx);
  const offenders = [];
  const seen = everyPlan(ctx, ({ days, age, sportKey, schedule }) => {
    if (restDays(days) < floor) offenders.push({ age, sportKey, schedule, rest: restDays(days) });
  });
  assert.ok(seen > 500, `the sweep should cover the plan space, saw only ${seen}`);
  assert.deepEqual(offenders, []);
});

test('rebalancing a fully missed week never spends the last rest days', () => {
  const ctx = context(), floor = floorOf(ctx);
  const offenders = [];
  let cases = 0;
  everyPlan(ctx, ({ days, schedule, age, sportKey }) => {
    for (let todayIdx = 0; todayIdx < 7; todayIdx++) {
      // Nothing done all week: the worst case for the floor, because every past
      // session wants somewhere to go.
      const out = ctx.rebalanceWeek(days, { todayIdx, isDone: () => false, gameDays: schedule.games || [] });
      cases++;
      if (restDays(out) < floor) offenders.push({ age, sportKey, todayIdx, rest: restDays(out) });
    }
  });
  assert.ok(cases > 3000, `expected a wide sweep, ran ${cases}`);
  assert.deepEqual(offenders, []);
});

test('rebalancing moves work and never adds any', () => {
  const ctx = context();
  const offenders = [];
  everyPlan(ctx, ({ days, schedule, age, sportKey }) => {
    const before = days.filter(isWork).length;
    for (let todayIdx = 0; todayIdx < 7; todayIdx++) {
      const out = ctx.rebalanceWeek(days, { todayIdx, isDone: () => false, gameDays: schedule.games || [] });
      const after = out.filter(isWork).length;
      if (after > before) offenders.push({ age, sportKey, todayIdx, before, after });
    }
  });
  assert.deepEqual(offenders, [], 'a rebalanced week must never carry more work than the plan did');
});

test('a moved session is never parked the evening before a game', () => {
  const ctx = context();
  const offenders = [];
  everyPlan(ctx, ({ days, schedule, age, sportKey }) => {
    const games = schedule.games || [];
    if (!games.length) return;
    for (let todayIdx = 0; todayIdx < 7; todayIdx++) {
      const out = ctx.rebalanceWeek(days, { todayIdx, isDone: () => false, gameDays: games });
      for (const g of games) {
        const eve = (g + 6) % 7;
        if (out[eve] && out[eve].moved) offenders.push({ age, sportKey, todayIdx, game: g, eve });
      }
    }
  });
  assert.deepEqual(offenders, []);
});

test('a missed day reads as moved or let go, never as a failure', () => {
  const ctx = context();
  // Word-anchored on purpose: an unanchored /red/ matches "unstructured play", which is
  // the copy for a rest day — the most encouraging line in the app failing a test meant to
  // protect encouragement.
  const blaming = /\b(missed|fail|failed|failure|behind|skipped|lost|broken|red)\b/i;
  assert.ok(blaming.test('You missed Tuesday'), 'the blaming pattern must actually detect blame');
  assert.ok(!blaming.test('Unstructured play'), 'the pattern must not fire on rest-day copy');
  const offenders = [];
  everyPlan(ctx, ({ days, schedule, age }) => {
    for (let todayIdx = 0; todayIdx < 7; todayIdx++) {
      const out = ctx.rebalanceWeek(days, { todayIdx, isDone: () => false, gameDays: schedule.games || [] });
      for (const d of out) {
        if (!d || !d.sub) continue;
        // A day that did not happen becomes `moved` — either relocated or let go. No
        // other state exists, and the copy never blames the athlete.
        if (d.t === 'moved') {
          assert.ok(d.movedTo !== undefined || d.dropped, 'a moved day should say where it went or that it was let go');
        }
        if (blaming.test(d.sub)) offenders.push({ age, todayIdx, t: d.t, sub: d.sub });
      }
    }
  });
  assert.deepEqual(offenders, [], 'no day may describe itself in language that reads as a loss');
});

test('the floor check detects a week that actually is under-rested', () => {
  // The negative control. Every sweep above reports "no offenders", which is exactly what
  // a broken check reports too. Hand the same predicate a week that genuinely breaks the
  // floor and require it to notice.
  const ctx = context(), floor = floorOf(ctx);
  const underRested = Array.from({ length: 7 }, (_, i) => ({ d: i, t: i === 6 ? 'rest' : 'train', title: 'x' }));
  assert.ok(restDays(underRested) < floor, 'the fixture should be under-rested');
  // And rebalancing an already-under-rested week must not make it worse.
  const out = ctx.rebalanceWeek(underRested, { todayIdx: 5, isDone: () => false, gameDays: [] });
  assert.ok(restDays(out) >= restDays(underRested),
    'rebalancing must never take rest away from a week that is already below the floor');
});
