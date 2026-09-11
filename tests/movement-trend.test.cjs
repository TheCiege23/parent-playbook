// Movement trends may only compare readings that measured the same thing the same way.
//
// The growth screen shows a "▲ better" chip and a bar chart under a teach card that reads
// "Same test, same conditions". Before this, that card was advice and nothing enforced it:
// the chip compared row[0] to row[1] whatever units, timing method or conditions they had.
// A vertical recorded at 24 in and later at 44 cm produced "▲ better 20 cm" — a confident
// arrow describing nothing. Body scans already refused this via scanCompatibility(); these
// cover the same rule for the measurements a parent enters by hand.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');

// screen-growth.js is a classic script full of screen wiring; only the pure comparison
// helpers are exercised here, loaded the same way the body-insights tests load theirs.
function context() {
  const ctx = vm.createContext({ console, Number, Math, String, Date, JSON });
  const source = fs.readFileSync(path.join(base, 'js', 'screen-growth.js'), 'utf8');
  // Take the helpers, not the screen: everything below the first `async function` needs
  // app state, DOM and Supabase that this context deliberately does not provide.
  const cut = source.indexOf('async function screenGrowth');
  assert.ok(cut > 0, 'screen-growth.js should still define screenGrowth');
  vm.runInContext(source.slice(0, cut), ctx);
  return ctx;
}

const reading = (over = {}) => ({
  metric_key: 'vertical', value: 24, unit: 'in', source: 'manual',
  conditions: null, measured_on: '2026-09-01', ...over,
});

test('readings measured the same way are comparable', () => {
  const c = context();
  assert.equal(c.movementComparable(reading(), reading({ value: 26, measured_on: '2026-08-01' })), true);
  // Whitespace and case in free-text conditions are not a real difference.
  assert.equal(c.movementComparable(reading({ conditions: 'Track' }), reading({ conditions: ' track ' })), true);
});

test('a different unit, source, conditions or metric is not a comparison', () => {
  const c = context();
  const latest = reading();
  for (const [what, other] of [
    ['unit', reading({ unit: 'cm', value: 61 })],
    ['source', reading({ source: 'app' })],
    ['conditions', reading({ conditions: 'grass' })],
    ['metric', reading({ metric_key: 'broad_jump' })],
  ]) {
    assert.equal(c.movementComparable(latest, other), false, `${what} should block the comparison`);
  }
  // Missing conditions is not treated as matching recorded conditions.
  assert.equal(c.movementComparable(reading({ conditions: null }), reading({ conditions: 'track' })), false);
  assert.equal(c.movementComparable(null, latest), false);
  assert.equal(c.movementComparable(latest, undefined), false);
});

test('the comparable run keeps only readings that match the most recent one', () => {
  const c = context();
  // Newest first, as the screen orders them.
  const list = [
    reading({ measured_on: '2026-09-01', value: 24 }),
    reading({ measured_on: '2026-08-01', value: 61, unit: 'cm' }), // unit changed
    reading({ measured_on: '2026-07-01', value: 23 }),
    reading({ measured_on: '2026-06-01', value: 22, conditions: 'grass' }),
  ];
  const run = c.comparableRun(list);
  assert.deepEqual(run.map(r => r.measured_on), ['2026-09-01', '2026-07-01']);
});

test('a non-numeric value never reaches the chart', () => {
  const c = context();
  const list = [reading(), reading({ measured_on: '2026-08-01', value: 'n/a' }), reading({ measured_on: '2026-07-01', value: 23 })];
  assert.deepEqual(c.comparableRun(list).map(r => r.value), [24, 23]);
});

test('trend bars refuse to draw a mixed-unit history', () => {
  const c = context();
  // The exact case that produced a false arrow: inches, then centimetres.
  const mixed = [reading({ value: 24 }), reading({ measured_on: '2026-08-01', value: 44, unit: 'cm' })];
  assert.equal(c.trendBars(mixed, false), '', 'two readings in different units are not a trend');

  const clean = [reading({ value: 24 }), reading({ measured_on: '2026-08-01', value: 22 })];
  const bars = c.trendBars(clean, false);
  assert.match(bars, /<div class="bars">/);
  assert.equal((bars.match(/<i /g) || []).length, 2);
  // The most recent reading is the highlighted bar.
  assert.match(bars, /class="on"><\/i>$|class="on"><\/i></);
});

test('trend bars cap at five comparable readings and keep oldest-to-newest order', () => {
  const c = context();
  const many = [60, 50, 40, 30, 20, 10].map((value, i) =>
    reading({ value, measured_on: `2026-0${6 - i}-01` }));
  const bars = c.trendBars(many, false);
  assert.equal((bars.match(/<i /g) || []).length, 5);
  // lowerIsBetter=false: the largest value is the tallest bar. The newest reading (60) is
  // first in the list, so after reversing it must be the LAST bar, and the tallest.
  const heights = [...bars.matchAll(/height:(\d+)%/g)].map(m => Number(m[1]));
  assert.equal(heights[heights.length - 1], 100);
  assert.ok(heights[0] < heights[heights.length - 1], 'oldest reading is not the tallest');
});

test('lower-is-better metrics invert the bar heights', () => {
  const c = context();
  // A sprint time: the faster (smaller) reading should be the taller bar.
  const times = [
    reading({ metric_key: 'dash_40', unit: 's', value: 6.1 }),
    reading({ metric_key: 'dash_40', unit: 's', value: 6.8, measured_on: '2026-08-01' }),
  ];
  const heights = [...c.trendBars(times, true).matchAll(/height:(\d+)%/g)].map(m => Number(m[1]));
  assert.equal(heights[heights.length - 1], 100, 'the faster time should be the tallest bar');
});
