// The organization dashboard filters and displays assessments by calendar day. `today` and
// the date picker on that screen are built from local getters, but the captured day was
// derived by slicing a UTC ISO string — so the two sides of the comparison meant different
// days.
//
// A scan captured at 8pm west of UTC has a UTC day of tomorrow. Viewing the roster "as of"
// the day it was taken skipped it, and the athlete read "No recorded photo assessment"
// while the scan sat in the database. The table and the export filename showed it a day late.
//
// The earlier sweep in tests/local-dates.test.cjs did not catch this: it looks for
// `toISOString().slice(0,10)` on one line, and here the conversion and the slice were on
// different lines. That blind spot is why this file also checks the pattern structurally.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const source = () => fs.readFileSync(path.join(base, 'js', 'org-insights.js'), 'utf8');

// The local day, computed the way js/dates.js does it.
const localDay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

test('an evening capture belongs to the local day it happened on', () => {
  // 8pm local. Whether this differs from the UTC day depends on the timezone, which is the
  // whole point: the dashboard must agree with the parent's calendar either way.
  const captured = new Date(2026, 8, 10, 20, 0);
  assert.equal(localDay(captured), '2026-09-10');
  if (captured.getTimezoneOffset() > 0) {
    assert.equal(captured.toISOString().slice(0, 10), '2026-09-11',
      'west of UTC the old expression yields tomorrow');
    assert.notEqual(captured.toISOString().slice(0, 10), localDay(captured));
  }
});

test('the as-of filter compares a local captured day, not a UTC one', () => {
  const text = source();
  assert.match(text, /captured_day:\s*localDay\(new Date\(raw\.captured_at\)\)/,
    'the scan meta should carry a local calendar day');
  assert.match(text, /if\(meta\.captured_day>date\)continue;/,
    'the as-of filter must compare the local day');
  assert.ok(!/meta\.captured_at\.slice\(0, ?10\)/.test(text),
    'the filter must not slice the UTC instant');
});

test('the instant is kept for ordering, because ordering is not a calendar question', () => {
  const text = source();
  // Two scans on the same local day still need a deterministic order, and that is an
  // instant comparison. Removing captured_at in favour of the day would lose it.
  assert.match(text, /captured_at:new Date\(raw\.captured_at\)\.toISOString\(\)/,
    'the UTC instant should still be carried');
  assert.match(text, /b\.meta\.captured_at\.localeCompare\(a\.meta\.captured_at\)/,
    'ordering should still use the instant');
});

test('no surface in this screen derives a calendar day from UTC', () => {
  const text = source();
  const offenders = [];
  for (const [i, line] of text.split('\n').entries()) {
    if (line.trim().startsWith('//')) continue;
    // Either shape: slicing a UTC ISO directly, or slicing a field known to hold one.
    if (/captured_at\??\.slice\(0, ?10\)/.test(line)) offenders.push(`line ${i + 1}: captured_at slice`);
    if (/capturedAt\.slice\(0, ?10\)/.test(line)) offenders.push(`line ${i + 1}: capturedAt slice`);
  }
  assert.deepEqual(offenders, [],
    'these show or compare a UTC day; use localDay() so the dashboard agrees with the parent');
});

test('the roster table and the export filename both use the local day', () => {
  const text = source();
  assert.match(text, /esc\(s\.latest\?\.meta\.captured_day\|\|'—'\)/,
    'the roster table should print the local captured day');
  assert.match(text, /'adult-reference-comparison-'\+localDay\(new Date\(result\.current\.capturedAt\)\)/,
    'the downloaded file should be named for the local day, not a UTC one');
});

test('the reference table renders a missing capture date rather than crashing', () => {
  const text = source();
  // localDay(new Date(undefined)) would be NaN-NaN-NaN, so the null case must short-circuit.
  assert.match(text, /row\.captured_at\?localDay\(new Date\(row\.captured_at\)\):'—'/,
    'a reference row with no capture date should render an em dash');
});
