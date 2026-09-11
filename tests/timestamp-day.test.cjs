// The second shape of the UTC-day fault, and the one that kept getting through.
//
// tests/local-dates.test.cjs sweeps for `toISOString().slice(0,10)`. But when the conversion
// to UTC is the DATABASE's, there is no toISOString() on the line to find: a timestamptz
// arrives from PostgREST already rendered as '2026-09-10T23:30:00+00:00', and slicing the
// first ten characters of that string still yields the UTC day. Six places were showing that
// to a parent as a calendar date:
//
//   js/body-scan.js      the consent card's "Given <date>"
//   js/screen-coach.js   four coach-update and reply dates, and the same in the reply thread
//   js/body-insights.js  the capture date on the latest assessment
//
// A consent granted at 8pm in New York read as given tomorrow. The coach screen dated an
// evening message a day ahead of the evening it was sent.
//
// This class has now been missed three times — by the original sweep, by the org-insights
// pass, and by the pass that wrote js/dates.js — because each guard was written to catch the
// expression that had just been fixed rather than the mistake behind it. This one matches by
// shape: any field whose name says it holds an instant, sliced to ten characters.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');

// Field names that hold an instant. Slicing any of them to ten characters asks the UTC
// calendar a question that should have been asked of the local one.
const INSTANT_FIELDS = [
  'created_at', 'updated_at', 'captured_at', 'saved_at', 'measured_at', 'granted_at',
  'revoked_at', 'approved_at', 'reviewed_at', 'submitted_at', 'completed_at', 'started_at',
  'sent_at', 'read_at', 'expires_at', 'deleted_at', 'capturedAt', 'createdAt', 'grantedAt',
];
const TIMESTAMP_TO_DAY = new RegExp(
  '\\.(' + INSTANT_FIELDS.join('|') + ')\\??\\.slice\\(0, ?10\\)');

test('no source file slices a database timestamp down to its UTC day', () => {
  const dir = path.join(base, 'js');
  const offenders = [];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      // A comment that quotes the bad expression is documentation, not a use of it. Three
      // guards in this repository have now flagged their own explanatory comments.
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (TIMESTAMP_TO_DAY.test(line)) offenders.push(file + ':' + (i + 1));
    }
  }
  assert.deepEqual(offenders, [],
    'a timestamptz sliced to ten characters is the UTC day; wrap it in localDay(new Date(...))');
});

test('that sweep can actually fail', () => {
  // A guard nobody has watched fail is a guard nobody has tested. These are the six lines
  // that were removed, plus shapes that are correct and must not be caught.
  const caught = [
    'esc(latest.meta.captured_at.slice(0,10))',
    'fmtDate(r.granted_at.slice(0, 10))',
    'fmtDate(u.created_at.slice(0,10))',
    'fmtDate(r.created_at.slice(0,10))',
    'const d = row.reviewed_at?.slice(0,10);',
  ];
  for (const bad of caught) {
    assert.ok(TIMESTAMP_TO_DAY.test(bad), 'the sweep should have flagged: ' + bad);
  }
  const allowed = [
    'fmtDate(localDay(new Date(u.created_at)))',
    'b.meta.captured_at.localeCompare(a.meta.captured_at)',
    // measured_on and done_on are DATE columns. They arrive as 'YYYY-MM-DD' with no instant
    // in them at all, so there is no timezone to get wrong and nothing here to flag.
    "r.measured_on.slice(0,10)",
    "row.done_on.slice(0,10)",
  ];
  for (const fine of allowed) {
    assert.ok(!TIMESTAMP_TO_DAY.test(fine), 'the sweep should have left alone: ' + fine);
  }
});

test('the three screens that were fixed render the local day', () => {
  const expected = [
    ['screen-coach.js', /fmtDate\(localDay\(new Date\(u\.created_at\)\)\)/],
    ['screen-coach.js', /fmtDate\(localDay\(new Date\(r\.created_at\)\)\)/],
    ['body-scan.js', /fmtDate\(localDay\(new Date\(r\.granted_at\)\)\)/],
    ['body-insights.js', /esc\(localDay\(new Date\(latest\.meta\.captured_at\)\)\)/],
  ];
  for (const [file, needle] of expected) {
    assert.match(fs.readFileSync(path.join(base, 'js', file), 'utf8'), needle,
      file + ' should render the local day');
  }
});

test('localDay is loaded before the screens that now call it', () => {
  // These are classic scripts sharing one global scope, so a wrong order is a ReferenceError
  // at render time rather than at load time — it would show as a blank screen, not an error
  // anyone sees in testing.
  const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
  const dates = html.indexOf('/js/dates.js');
  assert.ok(dates > 0, 'index.html should load js/dates.js');
  for (const screen of ['/js/screen-coach.js', '/js/body-scan.js', '/js/body-insights.js']) {
    const at = html.indexOf(screen);
    assert.ok(at > 0, 'index.html should load ' + screen);
    assert.ok(dates < at, 'js/dates.js must load before ' + screen);
  }
});

test("the coach screen's measurement query has a total order", () => {
  // measured_on is a DATE and one body scan writes twenty-five rows sharing it, so ordering
  // by it alone left two things to Postgres: which hundred rows the limit returns, and which
  // of several same-day readings of one metric the coach is shown. Same fault already fixed
  // in js/org.js and js/screen-scan.js.
  const text = fs.readFileSync(path.join(base, 'js', 'screen-coach.js'), 'utf8');
  assert.match(text, /\.order\('created_at', \{ ascending:false \}\)\.order\('id', \{ ascending:false \}\)\.limit\(100\)/,
    'the query needs created_at and id after the date, before the limit');
  assert.match(text, /select\('id,metric_key,value,unit,measured_on,created_at'\)/,
    'the columns it orders by have to be selected, or PostgREST has nothing to order by');
});

test('the newest-per-metric pick is stable once the order is total', () => {
  // The selection screen-coach.js performs over whatever the query returns.
  const pick = rows => {
    const latest = {};
    for (const r of rows) if (!latest[r.metric_key]) latest[r.metric_key] = r;
    return latest;
  };
  const ordered = rows => rows.slice().sort((a, b) =>
    b.measured_on.localeCompare(a.measured_on) ||
    (b.created_at || '').localeCompare(a.created_at || '') ||
    (b.id || '').localeCompare(a.id || ''));

  // A morning scan and an evening manual entry of the same metric, on one day.
  const rows = [
    { id: 'scan-1', metric_key: 'height', value: 60, measured_on: '2026-09-10', created_at: '2026-09-10T09:00:00Z' },
    { id: 'manual-1', metric_key: 'height', value: 61, measured_on: '2026-09-10', created_at: '2026-09-10T19:00:00Z' },
  ];
  assert.equal(pick(ordered(rows)).height.id, 'manual-1',
    'the most recently recorded reading wins within a day');
  assert.equal(pick(ordered(rows.slice().reverse())).height.id, 'manual-1',
    'and it wins however the database happened to return the rows');
});
