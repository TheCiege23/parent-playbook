// Twenty-one places used `new Date().toISOString().slice(0,10)` to mean "today". That is
// the UTC day, so it is TOMORROW for a whole evening everywhere west of UTC and YESTERDAY
// for a whole morning east of it. The two that mattered:
//
//   measured_on — a jump measured at 8pm in New York was stamped with tomorrow's date. A
//   future reading, which Body Insights then filters out of its own snapshot, so the scan
//   a parent just took could be missing from today's insights.
//
//   the biometric consent gate — `retention_until >= utcToday` meant a consent valid until
//   tonight read as expired from mid-afternoon in the Americas, while one that expired
//   yesterday kept working through the morning in Australia. That gate governs scans of
//   children.
//
// These pin the helper and prove the failure it replaces, by running the old expression and
// the new one side by side at the same instant in a fixed timezone.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');

// A context whose clock is fixed, so "now" is an instant we choose.
function contextAt(iso) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) { return args.length ? new RealDate(...args) : new RealDate(iso); }
    static now() { return new RealDate(iso).getTime(); }
  }
  const ctx = vm.createContext({ console, Number, Math, String, JSON, Date: FakeDate });
  vm.runInContext(fs.readFileSync(path.join(base, 'js', 'dates.js'), 'utf8'), ctx);
  return ctx;
}

test('localDay reports the local calendar day, not the UTC one', () => {
  // An explicit local date, so this holds wherever the suite runs.
  const ctx = contextAt('2026-09-10T12:00:00');
  assert.equal(ctx.localDay(new Date(2026, 8, 10, 23, 59)), '2026-09-10', 'a minute before local midnight');
  assert.equal(ctx.localDay(new Date(2026, 8, 11, 0, 1)), '2026-09-11', 'a minute after it');
  assert.equal(ctx.localDay(new Date(2026, 0, 1, 0, 0)), '2026-01-01', 'new year, zero-padded');
  assert.equal(ctx.localDay(new Date(2026, 11, 31, 23, 0)), '2026-12-31');
});

test('todayISO follows the clock it is given', () => {
  assert.equal(contextAt('2026-09-10T12:00:00').todayISO(), '2026-09-10');
  assert.equal(contextAt('2026-09-11T00:30:00').todayISO(), '2026-09-11');
});

test('the old expression and the new one disagree exactly when the UTC day has rolled over', () => {
  // Constructed from a local wall-clock time, so this is meaningful in any timezone that
  // has an offset at all; where the offset is zero the two simply agree, which is also
  // correct and is asserted rather than skipped.
  const evening = new Date(2026, 8, 10, 23, 30);        // 11:30pm local on the 10th
  const utcDay = evening.toISOString().slice(0, 10);
  const ctx = contextAt('2026-09-10T12:00:00');
  const localDay = ctx.localDay(evening);
  assert.equal(localDay, '2026-09-10', 'the local day is the 10th, whatever UTC thinks');
  if (evening.getTimezoneOffset() > 0) {
    // West of UTC: UTC has already rolled to the 11th while it is still the 10th here.
    assert.equal(utcDay, '2026-09-11', 'the old expression would have said tomorrow');
    assert.notEqual(utcDay, localDay);
  } else if (evening.getTimezoneOffset() === 0) {
    assert.equal(utcDay, localDay, 'at UTC the two agree');
  }
});

test('a retention date lands on the local calendar day months out', () => {
  const ctx = contextAt('2026-09-10T23:30:00');
  const from = new Date(2026, 8, 10, 23, 30);
  assert.equal(ctx.localDayMonthsFrom(12, from), '2027-09-10', 'twelve months on, same day');
  assert.equal(ctx.localDayMonthsFrom(3, from), '2026-12-10');
  // Month arithmetic rolls: 31 January plus one month is 3 March in a non-leap year, which
  // is JavaScript's own behaviour and not something this helper should silently "fix".
  assert.equal(ctx.localDayMonthsFrom(1, new Date(2026, 0, 31, 12, 0)), '2026-03-03');
});

test('no source file still derives a calendar day from UTC, except the one that should', () => {
  // The sweep that keeps this from creeping back. maturity.js builds a Date from
  // 'YYYY-MM-DDT00:00:00Z' and compares it back in UTC to prove the input was a real
  // calendar date — UTC on both sides, a different question, and correct.
  const dir = path.join(base, 'js');
  const offenders = [];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const [i, line] of text.split('\n').entries()) {
      if (!/toISOString\(\)\.slice\(0, ?10\)/.test(line)) continue;
      // A comment that quotes the bad expression is documentation, not a use of it —
      // js/dates.js explains the failure by naming it, and flagged itself on the first run.
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (file === 'maturity.js' && /born\.toISOString|measured\.toISOString/.test(line)) continue;
      offenders.push(`${file}:${i + 1}`);
    }
  }
  assert.deepEqual(offenders, [],
    'these derive a calendar day from UTC; use localDay()/todayISO() from js/dates.js');
});

test('the helper loads before anything that uses it', () => {
  const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
  const dates = html.indexOf('/js/dates.js');
  assert.ok(dates > 0, 'index.html should load js/dates.js');
  // Every other app script must come after it, since they call todayISO().
  for (const other of ['/js/core.js', '/js/body-scan.js', '/js/maturity.js', '/js/sheets.js']) {
    const at = html.indexOf(other);
    if (at < 0) continue;
    assert.ok(dates < at, `js/dates.js must load before ${other}`);
  }
  const sw = fs.readFileSync(path.join(base, 'sw.js'), 'utf8');
  assert.ok(sw.includes('/js/dates.js'), 'the service worker must cache js/dates.js or it is missing offline');
});
