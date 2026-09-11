// The second shape of the UTC-day fault, and the one that kept getting through.
//
// tests/local-dates.test.cjs sweeps for `toISOString().slice(0,10)`. When the conversion to
// UTC is the DATABASE's there is nothing on the line to find: a timestamptz arrives from
// PostgREST already rendered as '2026-09-10T23:30:00+00:00', and slicing the first ten
// characters of that still yields the UTC day. Nine places were doing it:
//
//   js/body-scan.js      the consent card's "Given <date>"
//   js/screen-coach.js   four coach-update and reply dates
//   js/body-insights.js  the capture date on the latest assessment
//   js/admin.js          the expiry date a reviewer typed into a screening check
//   js/sheets.js         the date under a photo with no taken_on
//   js/org-insights.js   when an authorized reference copy was saved
//
// A consent granted at 8pm in New York read as given tomorrow. A photo added in the evening
// was dated the next day under a parent's own child's picture.
//
// ---------------------------------------------------------------------------------------
// Why this file is a DENY-LIST of allowed sites rather than a search for bad ones.
//
// The first version of this sweep matched `.<field ending in _at>.slice(0,10)`, which is
// the shape the six known sites happened to have. Three more were sitting in the tree that
// it could not see, because an expression can be spelled other ways:
//
//   String(v.expires_at).slice(0,10)        the slice is on String(...), not on the field
//   (m.created_at||'').slice(0,10)          the slice is on a parenthesised fallback
//   record.savedAt.slice(0,10)              camelCase, absent from a list of snake_case names
//
// That is the fourth time a guard for this bug has been written against the expression in
// front of it and missed the ones beside it. So the question is inverted: EVERY `.slice(0,
// 10)` in js/ has to appear below with a reason, and anything else fails. A new one cannot
// be spelled around the check, only justified or fixed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(base, p), 'utf8');

// Slicing ten characters off a string is only ever right when the string is already a
// calendar date. Each entry says which, and why nobody should "fix" it later.
const ALLOWED = [
  ['core.js', 'String(bd).slice(0,10)',
    'birthdate is a DATE column. It arrives as YYYY-MM-DD with no instant in it, so there is no timezone to get wrong.'],
  ['program.js', 'String(r.measured_on).slice(0,10)',
    'measured_on is a DATE column, same reason.'],
  ['screen-edit.js', "(a.birthdate||'').slice(0,10)",
    'birthdate again, with a fallback for a profile that has none.'],
  ['admin-drills.js', 'String(d.reviewed_on).slice(0,10)',
    'reviewed_on is declared `date` in the drills migration, not timestamptz.'],
  ['maturity.js', 'born.toISOString().slice(0,10)!==birthdate',
    'UTC on BOTH sides. This builds a Date from YYYY-MM-DDT00:00:00Z and compares it back in UTC to prove the input was a real calendar date — a different question, and correct.'],
  ['maturity.js', 'measured.toISOString().slice(0,10)!==measuredOn',
    'the same round-trip check for the measurement date.'],
  // The three retention_until sites are the interesting exception: slicing is not merely
  // tolerable there, it is the only correct reading, and localDay() would be WRONG.
  ['org-insights.js', "row.retention_until?.slice(0,10)",
    'retention_until on the company tables is a DATE deliberately encoded as `<date>T23:59:59.000Z` (js/org-insights.js builds it that way, and the retention sweep deletes on `retention_until<=now()`). Slicing recovers the date that was encoded. localDay() would report the NEXT day anywhere east of UTC, claiming the record lasts a day longer than it does.'],
  ['org-insights.js', 'record.retentionUntil?.slice(0,10)',
    'the same end-of-UTC-day encoding, read back off a stored record.'],
  ['org-insights.js', 'company.retention_until.slice(0,10)',
    'and again for the athlete-scoped company copy.'],
];

function slicesIn(file) {
  const out = [];
  read(path.join('js', file)).split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    // A comment that quotes the expression is documentation, not a use of it. Guards in
    // this repository have now flagged their own explanatory comments three times.
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    let at = -1;
    while ((at = line.indexOf('.slice(0,10)', at + 1)) !== -1) out.push({ line: i + 1, text: line });
    at = -1;
    while ((at = line.indexOf('.slice(0, 10)', at + 1)) !== -1) out.push({ line: i + 1, text: line });
  });
  return out;
}

const jsFiles = () => fs.readdirSync(path.join(base, 'js')).filter(f => f.endsWith('.js'));

test('every ten-character slice in js/ is one somebody justified', () => {
  const unexplained = [];
  for (const file of jsFiles()) {
    for (const hit of slicesIn(file)) {
      const ok = ALLOWED.some(([f, snippet]) => f === file && hit.text.includes(snippet));
      if (!ok) unexplained.push(file + ':' + hit.line + '  ' + hit.text.trim().slice(0, 110));
    }
  }
  assert.deepEqual(unexplained, [],
    'slicing ten characters off a string is only right when the string is already a calendar '
    + 'date. If these are timestamps, wrap them in localDay(new Date(...)); if they are DATE '
    + 'columns, add them to ALLOWED in this file with the reason.');
});

test('the allow-list has no stale entries left behind after a fix', () => {
  // Otherwise a site gets corrected, its justification stays, and the next person reads a
  // reason for code that is no longer there.
  const stale = [];
  for (const [file, snippet] of ALLOWED) {
    const found = slicesIn(file).some(hit => hit.text.includes(snippet));
    if (!found) stale.push(file + ': ' + snippet);
  }
  assert.deepEqual(stale, [], 'these allow-list entries no longer match anything; delete them');
});

test('every allow-list entry says why, not just that', () => {
  for (const [file, snippet, why] of ALLOWED) {
    assert.ok(why && why.length > 40,
      'the entry for ' + file + ' / ' + snippet + ' needs a reason somebody can check');
  }
});

test('the sweep catches all nine shapes, including the three that got past the last one', () => {
  // The negative control. The previous guard matched `.<field>_at.slice(0,10)`; the last
  // three of these are the spellings it could not see, and they were all in the tree.
  const wereWrong = [
    'esc(latest.meta.captured_at.slice(0,10))',
    'fmtDate(r.granted_at.slice(0, 10))',
    'fmtDate(u.created_at.slice(0,10))',
    'fmtDate(r.created_at.slice(0,10))',
    "const expVal=v.expires_at?String(v.expires_at).slice(0,10):'';",
    "esc(fmtDate((m.created_at||'').slice(0,10)))",
    'esc(record.savedAt.slice(0,10))',
    'someNewThing.timestamp.slice(0,10)',
    'whateverItIsCalledNext.slice(0, 10)',
  ];
  for (const bad of wereWrong) {
    const onList = ALLOWED.some(([, snippet]) => bad.includes(snippet));
    assert.ok(!onList, 'the sweep must not already excuse: ' + bad);
    assert.ok(/\.slice\(0, ?10\)/.test(bad), 'and it must be the shape the sweep looks for: ' + bad);
  }
});

test('the six screens that were fixed render the local day', () => {
  const expected = [
    ['screen-coach.js', /fmtDate\(localDay\(new Date\(u\.created_at\)\)\)/],
    ['screen-coach.js', /fmtDate\(localDay\(new Date\(r\.created_at\)\)\)/],
    ['body-scan.js', /fmtDate\(localDay\(new Date\(r\.granted_at\)\)\)/],
    ['body-insights.js', /esc\(localDay\(new Date\(latest\.meta\.captured_at\)\)\)/],
    ['admin.js', /const expVal=v\.expires_at\?localDay\(new Date\(v\.expires_at\)\):''/],
    ['org-insights.js', /esc\(localDay\(new Date\(record\.savedAt\)\)\)/],
  ];
  for (const [file, needle] of expected) {
    assert.match(read(path.join('js', file)), needle, file + ' should render the local day');
  }
  // sheets.js needed a null guard as well: localDay(new Date(undefined)) is NaN-NaN-NaN,
  // where the old fallback merely produced an empty string.
  assert.match(read('js/sheets.js'),
    /m\.created_at\?fmtDate\(localDay\(new Date\(m\.created_at\)\)\):'—'/,
    'media with no created_at should render an em dash, not NaN-NaN-NaN');
});

test('localDay is loaded before every file that calls it', () => {
  // These are classic scripts sharing one global scope, so a wrong order is a ReferenceError
  // at render time rather than at load time — a blank screen, not an error anyone sees in
  // testing.
  const html = read('index.html');
  const dates = html.indexOf('/js/dates.js');
  assert.ok(dates > 0, 'index.html should load js/dates.js');
  const callers = jsFiles().filter(f => f !== 'dates.js' && /\blocalDay\(/.test(read(path.join('js', f))));
  assert.ok(callers.length >= 6, 'expected several callers, found ' + callers.length);
  for (const file of callers) {
    const at = html.indexOf('/js/' + file);
    assert.ok(at > 0, 'index.html should load js/' + file + ', which calls localDay()');
    assert.ok(dates < at, 'js/dates.js must load before js/' + file);
  }
});

test("the coach screen's measurement query has a total order", () => {
  // measured_on is a DATE and one body scan writes twenty-five rows sharing it, so ordering
  // by it alone left two things to Postgres: which hundred rows the limit returns, and which
  // of several same-day readings of one metric the coach is shown. Same fault already fixed
  // in js/org.js and js/screen-scan.js.
  const text = read('js/screen-coach.js');
  assert.match(text, /\.order\('created_at', \{ ascending:false \}\)\.order\('id', \{ ascending:false \}\)\.limit\(100\)/,
    'the query needs created_at and id after the date, before the limit');
  assert.match(text, /select\('id,metric_key,value,unit,measured_on,created_at'\)/,
    'the columns it orders by have to be selected, or PostgREST has nothing to order by');
});

test('the newest-per-metric pick is stable once the order is total', () => {
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

test('a screening expiry survives a round trip in any timezone', () => {
  // adminSetVerification stores `new Date(typed+'T12:00:00').toISOString()` — noon LOCAL,
  // a hedge that covers offsets up to ±11 hours and no further. At UTC+13 noon local is
  // 23:00Z the day before, so the UTC slice handed back the previous day and re-saving
  // walked it back again each time. localDay() of the same instant returns what was typed,
  // at every offset, which is what makes the noon hedge no longer load-bearing.
  const localDay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
  const typed = '2027-06-01';
  const stored = new Date(typed + 'T12:00:00');          // exactly what admin.js constructs
  assert.equal(localDay(stored), typed, 'what the reviewer typed is what they see again');

  // And the failure it replaces, stated in terms of the instant rather than of the local
  // clock this suite happens to run on.
  const atUtcPlus13 = new Date(Date.UTC(2027, 4, 31, 23, 0));   // noon on 1 June at UTC+13
  assert.equal(atUtcPlus13.toISOString().slice(0, 10), '2027-05-31',
    'the UTC slice of that instant is the day before, which is what was being shown');
});
