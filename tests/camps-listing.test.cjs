// Camps & programs listed every approved camp with no date filter, ordered by start_date
// ASCENDING — so the oldest listings sat at the top of the screen. campWhen() printed no
// year, so "Jun 3 – Jun 8" from fifteen months ago read exactly like an upcoming camp, and a
// parent could follow a dead sign-up link believing it was current.
//
// Dates here are plain YYYY-MM-DD with no timezone, which is why the comparison is done on
// strings: constructing a Date and comparing instants shifts the day across midnight for
// anyone west of UTC, and would hide a camp on its own opening day.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
function context() {
  const ctx = vm.createContext({ console, Number, Math, String, Date, JSON });
  vm.runInContext("function esc(v){return String(v??'');}", ctx);
  const source = fs.readFileSync(path.join(base, 'js', 'camps.js'), 'utf8');
  // Load the pure helpers, stopping before the screen that needs the DOM and Supabase.
  const cut = source.indexOf('async function openCamps');
  assert.ok(cut > 0, 'camps.js should still define openCamps');
  vm.runInContext(source.slice(0, cut), ctx);
  return ctx;
}

test("today is computed in local time, not shifted through a Date's instant", () => {
  const ctx = context();
  // A local date near midnight must render as that local day. Constructing this as a local
  // Date and reading local getters is the only way that holds in every timezone.
  const d = new Date(2026, 5, 3, 23, 30);       // 3 June, half an hour before midnight
  assert.equal(ctx.campTodayISO(d), '2026-06-03');
  const early = new Date(2026, 0, 1, 0, 15);    // New Year's Day, just after midnight
  assert.equal(ctx.campTodayISO(early), '2026-01-01');
});

test('a camp is over only after its last day has passed', () => {
  const ctx = context();
  const today = '2026-06-10';
  // Ended yesterday.
  assert.equal(ctx.campIsOver({ start_date: '2026-06-01', end_date: '2026-06-09' }, today), true);
  // Running right now, and on its final day — still current.
  assert.equal(ctx.campIsOver({ start_date: '2026-06-01', end_date: '2026-06-15' }, today), false);
  assert.equal(ctx.campIsOver({ start_date: '2026-06-01', end_date: '2026-06-10' }, today), false);
  // A one-day camp happening today is not over.
  assert.equal(ctx.campIsOver({ start_date: '2026-06-10', end_date: null }, today), false);
  // Single-day camp that has passed.
  assert.equal(ctx.campIsOver({ start_date: '2026-06-09', end_date: null }, today), true);
  // Still to come.
  assert.equal(ctx.campIsOver({ start_date: '2026-08-01', end_date: '2026-08-05' }, today), false);
});

test('a listing with no dates is "Dates TBD", never expired', () => {
  const ctx = context();
  assert.equal(ctx.campIsOver({ start_date: null, end_date: null }, '2026-06-10'), false);
  assert.equal(ctx.campWhen({ start_date: null }), 'Dates TBD');
  assert.equal(ctx.campIsOver(null, '2026-06-10'), false);
});

test('the year is shown when the camp is not in the current year', () => {
  const ctx = context();
  const thisYear = new Date().getFullYear();
  const nextYear = thisYear + 1;
  const sameYear = ctx.campWhen({ start_date: `${thisYear}-06-03`, end_date: `${thisYear}-06-08` });
  const otherYear = ctx.campWhen({ start_date: `${nextYear}-01-05`, end_date: `${nextYear}-01-09` });
  assert.ok(!sameYear.includes(String(thisYear)),
    `a camp this year needs no year: got "${sameYear}"`);
  assert.ok(otherYear.includes(String(nextYear)),
    `a camp in another year must show it, or it reads as weeks away: got "${otherYear}"`);
});

test('the age range reads correctly at every boundary', () => {
  const ctx = context();
  assert.equal(ctx.campAges({ age_min: null, age_max: null }), 'All ages');
  assert.equal(ctx.campAges({ age_min: 8, age_max: 12 }), 'Ages 8–12');
  assert.equal(ctx.campAges({ age_min: 8, age_max: null }), 'Ages 8+');
  assert.equal(ctx.campAges({ age_min: null, age_max: 12 }), 'Up to age 12');
  // Zero is a real bound, not a missing one — `age_min: 0` must not read as "All ages".
  assert.equal(ctx.campAges({ age_min: 0, age_max: 5 }), 'Ages 0–5');
});

test('the screen filters finished camps out of the list it renders', () => {
  // openCamps needs the DOM and Supabase, so this asserts the filter is wired into the
  // rendered set rather than computed and discarded.
  const source = fs.readFileSync(path.join(base, 'js', 'camps.js'), 'utf8');
  assert.match(source, /const current = camps\.filter\(c => !campIsOver\(c, today\)\)/,
    'finished camps should be removed before rendering');
  assert.match(source, /const shown = campSport \? current\./,
    'the sport filter must narrow the CURRENT camps, not the unfiltered list');
});
