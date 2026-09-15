// The organization's view of a family's imported measurements, and the family's decision to share.
//
// Two of these tests guard product decisions rather than code. A roster table sorted by body fat
// is a ranking of children by body fat whatever the column is called, and a "share" that quietly
// includes the source PDF hands over a document with a child's name and date of birth on it.
// Neither would be caught by anything else in the stack.
//
// Every fixture is synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
function ui(file) {
  const ctx = vm.createContext({ console, Number, Math, Date, JSON, Object, Array, String, Boolean, Set, Map });
  vm.runInContext(`function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}`, ctx);
  vm.runInContext(fs.readFileSync(path.join(base, 'js', 'dates.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(base, 'js', file), 'utf8'), ctx);
  return ctx;
}

let IMPORT, STORE;
test.before(async () => {
  IMPORT = await import('../js/composition-import.mjs');
  STORE = await import('../js/composition-import-supabase.mjs');
});

const CONTEXT = Object.freeze({
  subjectId: 'synthetic-athlete-a', scope: 'adult_reference', actorId: 'synthetic-actor-001',
  consentReference: 'synthetic-permission-001',
  savedAt: '2026-09-20T10:00:00.000Z', retentionUntil: '2029-09-20T10:00:00.000Z',
});
const reading = (source, values, measuredAt, extra = {}) =>
  IMPORT.readManualEntry({ measuredAt, values },
    { ...CONTEXT, sourceClass: source, device: extra.device || (source === 'dexa' ? { facility: 'Synthetic Imaging Clinic' } : {}), ...extra });

const row = (athleteId, record, measuredAt) => ({
  id: 'row-' + athleteId + '-' + measuredAt, record_id: record.recordId,
  athlete_id: athleteId, measured_at: measuredAt, source_class: record.sourceClass, record,
});

const ATHLETES = new Map([
  ['ath-z', { id: 'ath-z', first_name: 'Zoe' }],
  ['ath-a', { id: 'ath-a', first_name: 'Adam' }],
]);

// ----------------------------------------------------------------- the ranking guard
test('rows are ordered by name, never by a value', () => {
  const c = ui('org-composition.js');
  // Zoe has the higher body fat and the later reading. Neither may float her to the top.
  const rows = [
    row('ath-z', reading('dexa', { body_fat_percent: '31' }, '2026-09-18'), '2026-09-18T12:00:00.000Z'),
    row('ath-a', reading('dexa', { body_fat_percent: '12' }, '2026-09-10'), '2026-09-10T12:00:00.000Z'),
  ];
  const groups = c.ocRows(rows, ATHLETES);
  // Joined rather than deep-compared: the array comes from the vm realm, so its prototype is not
  // the host's and deepStrictEqual would fail on that alone.
  assert.equal(groups.map(g => g.name).join(','), 'Adam,Zoe');
});

test('the ordering guard lives in the data layer, so markup cannot re-sort what it is given', () => {
  const c = ui('org-composition.js');
  // Handed already-sorted-by-value groups, the markup still renders them in the order it received
  // — the point being that ocRows is the only thing that decides order, and it decides by name.
  const rows = [
    row('ath-z', reading('smart_scale', { body_fat_percent: '31' }, '2026-09-18'), '2026-09-18T12:00:00.000Z'),
    row('ath-a', reading('smart_scale', { body_fat_percent: '12' }, '2026-09-10'), '2026-09-10T12:00:00.000Z'),
  ];
  const html = c.ocMarkup(c.ocRows(rows, ATHLETES), 'Synthetic Org');
  assert.ok(html.indexOf('Adam') < html.indexOf('Zoe'), 'Adam sorts before Zoe by name');
  // And the screen says why it cannot be sorted, so the next person to add a sort header reads it.
  assert.match(html, /cannot be sorted by value/);
  assert.match(html, /ranking of children by body fat/);
});

test('the screen states what these are not for', () => {
  const c = ui('org-composition.js');
  const html = c.ocMarkup([], 'Synthetic Org');
  for (const forbidden of [/eligibility/, /team selection/, /athletic-potential ranking/, /weight-loss target/, /automatic training change/]) {
    assert.match(html, forbidden);
  }
});

test('no sortable control is rendered anywhere in the section', () => {
  const c = ui('org-composition.js');
  const rows = [row('ath-a', reading('dexa', { body_fat_percent: '12' }, '2026-09-10'), '2026-09-10T12:00:00.000Z')];
  const html = c.ocMarkup(c.ocRows(rows, ATHLETES), 'Synthetic Org');
  assert.ok(!/data-sort|aria-sort|<select/.test(html), 'a sort control would make this a league table');
});

// ----------------------------------------------------------------- claim strength, org side
test('an organization can tell a DXA scan from a bathroom scale', () => {
  const c = ui('org-composition.js');
  const rows = [
    row('ath-a', reading('dexa', { body_fat_percent: '12' }, '2026-09-10'), '2026-09-10T12:00:00.000Z'),
    row('ath-z', reading('smart_scale', { body_fat_percent: '31' }, '2026-09-18'), '2026-09-18T12:00:00.000Z'),
  ];
  const html = c.ocMarkup(c.ocRows(rows, ATHLETES), 'Synthetic Org');
  assert.match(html, /DXA scan · Synthetic Imaging Clinic/);
  assert.match(html, /ci-chip-measured"[^>]*>Measured</);
  assert.match(html, /ci-chip-device_estimated"[^>]*>Device estimate</);
});

test('the section never presents these as ours', () => {
  const c = ui('org-composition.js');
  const html = c.ocMarkup([], 'Synthetic Org');
  assert.match(html, /Parent Playbook did not perform them/);
  assert.match(html, /has not checked the devices/);
  assert.match(html, /makes no accuracy claim/);
});

test('a reading with several values repeats neither its date nor its source', () => {
  const c = ui('org-composition.js');
  const rows = [row('ath-a', reading('dexa', { body_fat_percent: '12', lean_mass_kg: '55' }, '2026-09-10'), '2026-09-10T12:00:00.000Z')];
  const html = c.ocMarkup(c.ocRows(rows, ATHLETES), 'Synthetic Org');
  assert.equal((html.match(/Synthetic Imaging Clinic/g) || []).length, 1, 'the source belongs to the reading, not to each value');
});

test('the empty state does not read as something missing', () => {
  const c = ui('org-composition.js');
  const html = c.ocMarkup([], 'Synthetic Org');
  // A family sharing nothing is the default and a legitimate permanent answer. A screen that
  // implies otherwise turns it into a request an administrator can make of a parent.
  assert.match(html, /Sharing is theirs to offer, not yours to request/);
  assert.match(html, /no athlete is missing anything by not appearing here/);
});

test('markup escapes what a family supplied', () => {
  const c = ui('org-composition.js');
  const rows = [row('ath-a', reading('dexa', { body_fat_percent: '12' }, '2026-09-10',
    { device: { facility: '<img src=x onerror=alert(1)>' } }), '2026-09-10T12:00:00.000Z')];
  const html = c.ocMarkup(c.ocRows(rows, ATHLETES), 'Synthetic Org');
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;img src=x/);
});

test('a row with no record is skipped rather than rendered half-formed', () => {
  const c = ui('org-composition.js');
  const groups = c.ocRows([{ id: 'x', athlete_id: 'ath-a', measured_at: '2026-09-10T12:00:00.000Z', record: null }], ATHLETES);
  assert.equal(groups.length, 0);
});

// ----------------------------------------------------------------- the family's side
test('the family list says what sharing does, and what it never includes', () => {
  const c = ui('composition-sharing-ui.js');
  const rows = [{ id: 'r1', measuredAt: '2026-09-10T12:00:00.000Z', sourceClass: 'dexa', sharedWithTeamId: null,
    record: reading('dexa', { body_fat_percent: '12', lean_mass_kg: '55' }, '2026-09-10') }];
  const html = c.csMarkup(rows, 'Synthetic Org');
  assert.match(html, /can read the numbers in a shared reading and nothing else/);
  assert.match(html, /cannot change it, cannot keep a copy/);
  assert.match(html, /lose access the moment you stop sharing/);
  // The decision a parent is actually making: numbers, not the document with a name on it.
  assert.match(html, /report or file it came from is never shared/);
  assert.match(html, /name and date of birth/);
});

test('a shared reading offers to stop, an unshared one offers to share', () => {
  const c = ui('composition-sharing-ui.js');
  const base = { measuredAt: '2026-09-10T12:00:00.000Z', sourceClass: 'smart_scale',
    record: reading('smart_scale', { body_fat_percent: '18' }, '2026-09-10') };
  const html = c.csMarkup([{ ...base, id: 'r1', sharedWithTeamId: null }, { ...base, id: 'r2', sharedWithTeamId: 'team-1' }], 'Synthetic Org');
  assert.match(html, /data-cs-share="0">Share with Synthetic Org</);
  assert.match(html, /data-cs-share="1">Stop sharing</);
  assert.match(html, /Shared with Synthetic Org/);
});

test('with no organization there is nothing to share with, and the list says so plainly', () => {
  const c = ui('composition-sharing-ui.js');
  const rows = [{ id: 'r1', measuredAt: '2026-09-10T12:00:00.000Z', sourceClass: 'dexa', sharedWithTeamId: null,
    record: reading('dexa', { body_fat_percent: '12' }, '2026-09-10') }];
  const html = c.csMarkup(rows, null);
  assert.match(html, /Join an organization to share a reading/);
  assert.ok(!/data-cs-share/.test(html), 'there is no team to share with, so no button pretends there is');
  // And the explanation of sharing is absent rather than hypothetical.
  assert.ok(!/What sharing does/.test(html));
});

test('a reading line says how strong its strongest claim is', () => {
  const c = ui('composition-sharing-ui.js');
  const dexa = c.csReadingLine({ measuredAt: '2026-09-10T12:00:00.000Z', sourceClass: 'dexa',
    record: reading('dexa', { body_fat_percent: '12', lean_mass_kg: '55' }, '2026-09-10') });
  assert.match(dexa, /DXA scan · 2 values, 2 measured/);
  const scale = c.csReadingLine({ measuredAt: '2026-09-10T12:00:00.000Z', sourceClass: 'smart_scale',
    record: reading('smart_scale', { body_fat_percent: '18' }, '2026-09-10') });
  assert.match(scale, /Smart scale · 1 value, 1 device estimate/);
});

test('deleting warns that the attached report goes too', () => {
  // The document may be the only copy the family has, and the store removes it, through the Storage API, before the record.
  const source = fs.readFileSync(path.join(base, 'js', 'composition-sharing-ui.js'), 'utf8');
  assert.match(source, /that document is deleted too/);
  assert.match(source, /cannot be undone/);
});
