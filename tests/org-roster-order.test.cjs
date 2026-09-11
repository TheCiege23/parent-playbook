// The roster card shows one measurement per athlete: the latest. It picked that by taking
// the first row of a query ordered only by measured_on — a DATE.
//
// One body scan writes twenty-five rows sharing a single measured_on, so every athlete with
// a scan had twenty-five rows tied for latest and Postgres chose between them. The card
// showed Wingspan on one load and Vertical on the next, from identical data. This repository
// had already met and fixed the same fault in screen-week.js, where unordered goals made the
// week's headline change between page loads.
//
// The fix is a total order: measured_on, then created_at (what was actually recorded last),
// then id. These cover the pick and the query that feeds it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const orgSource = () => fs.readFileSync(path.join(base, 'js', 'org.js'), 'utf8');

// The selection org.js performs: first row wins, per athlete.
const pickLatest = rows => {
  const out = {};
  for (const r of rows) if (!out[r.athlete_id]) out[r.athlete_id] = r;
  return out;
};
// A total order over the same rows.
const ordered = rows => rows.slice().sort((a, b) =>
  b.measured_on.localeCompare(a.measured_on) ||
  (b.created_at || '').localeCompare(a.created_at || '') ||
  (b.id || '').localeCompare(a.id || ''));

// One body scan: twenty-five metrics, one date, written in one go.
const scan = (athlete, date, stamp) => Array.from({ length: 25 }, (_, i) => ({
  id: `${athlete}-${date}-${String(i).padStart(2, '0')}`,
  athlete_id: athlete, metric_key: `metric_${i}`, value: 10 + i, unit: 'in',
  measured_on: date, created_at: stamp,
}));

test('a scan really does tie twenty-five rows on one date', () => {
  const rows = scan('a1', '2026-09-10', '2026-09-10T20:00:00Z');
  assert.equal(rows.length, 25);
  assert.equal(new Set(rows.map(r => r.measured_on)).size, 1,
    'if a scan ever stops sharing one date, this regression stops being reachable');
});

test('the pick is stable however the database returns a tied scan', () => {
  const rows = scan('a1', '2026-09-10', '2026-09-10T20:00:00Z');
  // Three plausible arrival orders for the same tied rows.
  const forward = ordered(rows);
  const backward = ordered(rows.slice().reverse());
  const shuffled = ordered([...rows.slice(13), ...rows.slice(0, 13)]);
  const pickOf = list => pickLatest(list).a1.metric_key;
  assert.equal(pickOf(forward), pickOf(backward));
  assert.equal(pickOf(forward), pickOf(shuffled),
    'the same data must not produce a different card between page loads');
});

test('the newest date still wins over an older scan', () => {
  const rows = [
    ...scan('a1', '2026-08-01', '2026-08-01T10:00:00Z'),
    ...scan('a1', '2026-09-10', '2026-09-10T20:00:00Z'),
  ];
  assert.equal(pickLatest(ordered(rows)).a1.measured_on, '2026-09-10');
});

test('within one date the most recently recorded row wins', () => {
  // A manual entry added in the evening, on the same day as a morning scan.
  const rows = [
    ...scan('a1', '2026-09-10', '2026-09-10T09:00:00Z'),
    { id: 'manual-1', athlete_id: 'a1', metric_key: 'height', value: 60, unit: 'in',
      measured_on: '2026-09-10', created_at: '2026-09-10T19:00:00Z' },
  ];
  assert.equal(pickLatest(ordered(rows)).a1.metric_key, 'height');
});

test('a missing created_at falls through to id rather than throwing', () => {
  const rows = [
    { id: 'b', athlete_id: 'a1', metric_key: 'x', value: 1, unit: 'in', measured_on: '2026-09-10' },
    { id: 'a', athlete_id: 'a1', metric_key: 'y', value: 2, unit: 'in', measured_on: '2026-09-10' },
  ];
  const first = pickLatest(ordered(rows)).a1.id;
  assert.equal(first, pickLatest(ordered(rows.slice().reverse())).a1.id,
    'legacy rows without created_at must still order deterministically');
});

test('the roster query asks the database for that same total order', () => {
  const source = orgSource();
  assert.match(source, /\.order\('measured_on',\{ascending:false\}\)\.order\('created_at',\{ascending:false\}\)\.order\('id',\{ascending:false\}\)/,
    'the roster measurement query needs a total order, not just a date');
  assert.match(source, /select\('id,athlete_id,metric_key,value,unit,measured_on,created_at'\)/,
    'the columns it orders by have to be selected');
});
