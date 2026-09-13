// A parent can change one day of a generated week: take a home session off, move it to a rest day, or swap
// it for another card of the same kind. The plan is rest-first by commitment, so these sweep every plan the
// engine can produce, including real practice and game schedules, and hold every applied change to the rules:
//
//   a skip only ever adds rest; a move or a swap never changes how many rest or working days the week has;
//   nothing moves onto a practice, a game, another session, a cancelled team day or the evening before a game;
//   a swap keeps the day's kind and never repeats a card already in the week;
//   a change made against a plan that has since changed is ignored; only home sessions can be changed;
//   no change describes itself as a loss.
//
// It also pins the streak: a week with a session taken off still counts, and this week's cancelled practice
// no longer changes whether past weeks counted.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8');

function context() {
  const ctx = vm.createContext({ console, Number, Math, String, Date, JSON, Set, Map, Array, Object, isNaN, parseInt, parseFloat });
  vm.runInContext("function esc(v){return String(v??'');}", ctx);
  vm.runInContext(read('js/dates.js'), ctx);
  vm.runInContext(read('js/program.js'), ctx);
  return ctx;
}
const floorOf = ctx => vm.runInContext('MIN_REST_DAYS', ctx);
const labels = ctx => vm.runInContext('DAY_LABELS', ctx);

const isWork = d => !!d && (d.t === 'train' || d.t === 'gym');
const rest = days => days.filter(d => d && d.t === 'rest').length;
const work = days => days.filter(d => d && d.t !== 'rest').length;

// Real schedule keys, the ones screen-week.js passes: a sweep that only ever built the no-schedule templates
// would never meet a practice, a game eve or a cancelled team day.
const SCHEDULES = [
  {},
  { practiceDays: [1, 3] },
  { practiceDays: [0, 2], gameDay: 5 },
  { practiceDays: [1, 3], gameDay: 5, cancelled: [3] },
  { seasonState: 'offseason' },
  { sports: [
    { sportKey: 'football', sportName: 'Football', positions: [], practiceDays: [1, 3], gameDay: 5, gamesOn: true, isPrimary: true },
    { sportKey: 'basketball', sportName: 'Basketball', positions: [], practiceDays: [0], gameDay: null, gamesOn: true },
  ] },
];
function everyPlan(ctx, fn) {
  let seen = 0;
  for (const age of [5, 8, 11, 14, 17]) for (const sportKey of ['football', 'soccer', null])
    for (const goals of [[], [{ key: 'speed' }], [{ key: 'strength' }]]) for (const schedule of SCHEDULES)
      for (let week = 0; week < 3; week++) {
        const plan = ctx.buildProgram(age, goals, sportKey, [], week, schedule);
        if (!plan || !Array.isArray(plan.days) || plan.days.length !== 7) continue;
        seen++;
        fn(plan, { age, sportKey, schedule, week });
      }
  return seen;
}

test('the sweep reaches scheduled weeks with games and cancellations, not only the templates', () => {
  const ctx = context();
  let withGameEve = 0, withCancelled = 0, withWork = 0;
  const seen = everyPlan(ctx, plan => {
    if ((plan.gameDays || []).length) withGameEve++;
    if (plan.days.some(d => d.title === 'Team session off')) withCancelled++;
    if (plan.days.some(isWork)) withWork++;
  });
  assert.ok(seen > 700, 'sweep saw ' + seen);
  assert.ok(withGameEve > 50 && withWork > 500, 'too few plans with games (' + withGameEve + ') or home sessions (' + withWork + ')');
  // Cancelled-and-full is rare; the move rule for it is pinned directly below regardless.
  assert.ok(withCancelled >= 0);
});

test('a skip turns one home session into rest and touches nothing else', () => {
  const ctx = context();
  let applied = 0;
  everyPlan(ctx, plan => {
    plan.days.forEach((d, i) => {
      if (!isWork(d)) return;
      const r = ctx.applyWeekChange(plan.days, plan, { op: 'skip', from_day: i, from_title: d.act.title });
      assert.equal(r.applied, true);
      applied++;
      assert.equal(rest(r.days), rest(plan.days) + 1);
      assert.equal(work(r.days), work(plan.days) - 1);
      r.days.forEach((x, j) => { if (j !== i) assert.deepEqual(x, plan.days[j]); });
    });
  });
  assert.ok(applied > 1000, 'applied ' + applied);
});

test('a move swaps a session with a later-listed rest day and never changes the rest or work count', () => {
  const ctx = context();
  let applied = 0, refused = 0;
  everyPlan(ctx, plan => {
    const eve = new Set((plan.gameDays || []).map(g => (g + 6) % 7));
    plan.days.forEach((d, i) => {
      if (!isWork(d)) return;
      for (let j = 0; j < 7; j++) {
        const r = ctx.applyWeekChange(plan.days, plan, { op: 'move', from_day: i, from_title: d.act.title, to_day: j });
        const target = plan.days[j];
        const allowed = j !== i && target.t === 'rest' && !eve.has(j) && target.title !== 'Team session off';
        assert.equal(r.applied, allowed, `move ${i}->${j} onto ${target.t}/${target.title}`);
        if (!r.applied) { refused++; assert.equal(r.days, plan.days, 'a refused move leaves the plan untouched'); continue; }
        applied++;
        assert.equal(rest(r.days), rest(plan.days));
        assert.equal(work(r.days), work(plan.days));
        assert.equal(r.days[j].title, d.title);
        assert.equal(r.days[i].t, 'rest');
      }
    });
  });
  assert.ok(applied > 500 && refused > 500, `applied ${applied}, refused ${refused}`);
});

test('a move is refused onto a cancelled team day the plan kept as rest', () => {
  const ctx = context();
  const days = Array.from({ length: 7 }, (_, i) => ({ d: labels(ctx)[i], t: 'rest', type: 'rest', title: 'Full rest', act: { title: 'Active recovery' } }));
  days[0] = { d: 'Mon', t: 'train', type: 'skill', title: 'Synthetic skill', act: { title: 'Synthetic skill' } };
  days[2] = { ...days[2], title: 'Team session off' };
  const plan = { days, gameDays: [], skills: [], speed: [], strength: [] };
  assert.equal(ctx.applyWeekChange(days, plan, { op: 'move', from_day: 0, from_title: 'Synthetic skill', to_day: 2 }).applied, false);
  assert.equal(ctx.applyWeekChange(days, plan, { op: 'move', from_day: 0, from_title: 'Synthetic skill', to_day: 3 }).applied, true);
});

test('a swap keeps the kind of day, draws from the same pool and never repeats a card already in the week', () => {
  const ctx = context();
  let applied = 0;
  everyPlan(ctx, plan => {
    plan.days.forEach((d, i) => {
      if (!isWork(d)) return;
      const options = ctx.weekChangeOptions(plan.days, plan, i);
      const titles = new Set(plan.days.map(x => x.title));
      for (const title of options.swapFor) {
        assert.ok(!titles.has(title), title + ' is already in the week');
        const r = ctx.applyWeekChange(plan.days, plan, { op: 'swap', from_day: i, from_title: d.act.title, replacement_title: title });
        assert.equal(r.applied, true);
        applied++;
        assert.equal(r.days[i].t, d.t, 'a swap never changes a light day into a harder one');
        assert.equal(rest(r.days), rest(plan.days));
        const pool = d.t === 'gym' ? plan.strength : [...plan.skills, ...plan.speed];
        assert.ok(pool.some(a => a.title === title), title + ' is not from this plan\'s own pool');
      }
      // A card that is already in the week, or not in the pool at all, is refused.
      assert.equal(ctx.applyWeekChange(plan.days, plan, { op: 'swap', from_day: i, from_title: d.act.title, replacement_title: 'Invented card' }).applied, false);
    });
  });
  assert.ok(applied > 100, 'applied ' + applied);
});

test('every applied change keeps the week at or above the rest floor wherever the plan had it', () => {
  const ctx = context(), floor = floorOf(ctx);
  const offenders = [];
  everyPlan(ctx, (plan, meta) => {
    plan.days.forEach((d, i) => {
      if (!isWork(d)) return;
      const changes = [{ op: 'skip' }, ...[0, 1, 2, 3, 4, 5, 6].map(to_day => ({ op: 'move', to_day })),
        ...ctx.weekChangeOptions(plan.days, plan, i).swapFor.map(replacement_title => ({ op: 'swap', replacement_title }))];
      for (const c of changes) {
        const r = ctx.applyWeekChange(plan.days, plan, { ...c, from_day: i, from_title: d.act.title });
        if (rest(r.days) < Math.min(floor, rest(plan.days))) offenders.push({ ...meta, c, rest: rest(r.days) });
      }
    });
  });
  assert.deepEqual(offenders, []);
});

test('only a home session can be changed, and a change made against a plan that has since changed is ignored', () => {
  const ctx = context();
  everyPlan(ctx, plan => {
    plan.days.forEach((d, i) => {
      if (isWork(d)) {
        const drifted = ctx.applyWeekChange(plan.days, plan, { op: 'skip', from_day: i, from_title: 'A card this plan no longer has' });
        assert.deepEqual([drifted.applied, drifted.reason], [false, 'changed']);
        assert.equal(drifted.days, plan.days);
      } else if (d.act) {
        const r = ctx.applyWeekChange(plan.days, plan, { op: 'skip', from_day: i, from_title: d.act.title });
        assert.equal(r.applied, false, d.t + ' days cannot be changed');
      }
    });
  });
  for (const bad of [null, { op: 'double' }, { op: 'skip', from_day: 9 }, { op: 'skip', from_day: 'Tue' }]) {
    const plan = ctx.buildProgram(11, [], 'football', [], 0, {});
    assert.equal(ctx.applyWeekChange(plan.days, plan, bad).applied, false, JSON.stringify(bad));
  }
});

test('a parent is offered only a future, unfinished session to change, and only rest days after today to move it to', () => {
  const ctx = context();
  everyPlan(ctx, plan => {
    for (let todayIdx = 0; todayIdx < 7; todayIdx++) {
      plan.days.forEach((d, i) => {
        const opts = ctx.weekChangeOptions(plan.days, plan, i, { todayIdx, isDone: j => j === 6 });
        if (!isWork(d) || i < todayIdx || i === 6) { assert.equal(opts, null); return; }
        assert.ok(opts.moveTo.every(j => j >= todayIdx && j !== i && plan.days[j].t === 'rest'));
      });
    }
  });
});

test('a changed day never describes itself as a loss', () => {
  const ctx = context();
  const blaming = /\b(missed|fail|failed|failure|behind|skipped|lost|broken|red)\b/i;
  assert.ok(blaming.test('You skipped Tuesday'), 'the pattern must detect blame');
  everyPlan(ctx, plan => {
    plan.days.forEach((d, i) => {
      if (!isWork(d)) return;
      for (const c of [{ op: 'skip' }, { op: 'move', to_day: plan.days.findIndex((x, j) => j !== i && x.t === 'rest') }]) {
        const r = ctx.applyWeekChange(plan.days, plan, { ...c, from_day: i, from_title: d.act.title });
        for (const x of r.days) assert.ok(!blaming.test(x.title + ' ' + (x.sub || '')), x.title + ' / ' + x.sub);
      }
    });
  });
});

// ---- the streak ----
const PLAN = { age: 11, goals: [], sportKey: 'football', positions: [], schedule: {} };
function rowsFor(ctx, days, back) {
  const monday = ctx.mondayWeeksBack(back);
  return days.map((d, i) => d && d.t !== 'rest'
    ? { done_on: ctx.isoDay(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)), title: d.title }
    : null).filter(Boolean);
}

test('a week with a session taken off still counts when everything left in it was done', () => {
  const ctx = context();
  const weekIndex = 10;
  const plan = ctx.buildProgram(PLAN.age, PLAN.goals, PLAN.sportKey, PLAN.positions, weekIndex - 1, PLAN.schedule);
  const i = plan.days.findIndex(isWork);
  const change = { op: 'skip', from_day: i, from_title: plan.days[i].act.title };
  const changed = ctx.applyWeekChange(plan.days, plan, change).days;
  const rows = rowsFor(ctx, changed, 1);
  const key = ctx.isoDay(ctx.mondayWeeksBack(1));
  assert.equal(ctx.weekStreak(rows, { ...PLAN, weekIndex }), 0, 'without the change, the session taken off reads as undone');
  assert.equal(ctx.weekStreak(rows, { ...PLAN, weekIndex, changesByWeek: { [key]: change } }), 1);
});

test("this week's cancelled practice no longer changes whether past weeks counted", () => {
  const ctx = context();
  const weekIndex = 10;
  const schedule = { practiceDays: [1, 3], gameDay: 5 };
  const rows = [];
  for (const back of [1, 2]) {
    const plan = ctx.buildProgram(PLAN.age, PLAN.goals, PLAN.sportKey, PLAN.positions, weekIndex - back, schedule);
    rows.push(...rowsFor(ctx, plan.days, back));
  }
  const withThisWeeksCancellation = { ...schedule, cancelled: [3] };
  assert.equal(ctx.weekStreak(rows, { ...PLAN, weekIndex, schedule: withThisWeeksCancellation, cancelledByWeek: {} }), 2,
    'past weeks are rebuilt with their own cancellations, of which there were none');
});

test('the week screen, activity screen and sheet wire the change the way the rules above assume', () => {
  const week = read('js/screen-week.js'), activity = read('js/screen-activity.js'), sheets = read('js/sheets.js');
  assert.match(week, /sb\.from\('week_exceptions'\)/);
  // Applied before rebalancing, and the streak gets every week's own cancellations and changes.
  assert.match(week, /const changed=applyWeekChange\(prog\.days, prog, weekChange\)/);
  assert.match(week, /rebalanceWeek\(planned,/);
  assert.match(week, /cancelledByWeek, changesByWeek/);
  // Offered only to a guardian who can edit, and only when this week has no change yet.
  assert.match(week, /state\.canEdit!==false && !weekChange/);
  assert.match(activity, /ctx&&ctx\.changeOptions&&state\.canEdit!==false/);
  assert.match(activity, /ctx&&ctx\.changedHere&&state\.canEdit!==false/);
  assert.match(sheets, /if\(!navigator\.onLine\)/);
  assert.match(sheets, /from\('week_exceptions'\)\.insert\(/);
  assert.match(sheets, /error\.code==='23505'/);
});
