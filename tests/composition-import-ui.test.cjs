// What the import screen says, and what the save adapter does with the answer.
//
// The markup half is tested because most of this screen's job is making a claim's strength
// visible. A layout that shows a DXA body fat and a bathroom scale's body fat identically is
// lying by arrangement, whatever the record underneath says — and nothing else in the stack
// would catch that.
//
// Every fixture is synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
function ui() {
  const ctx = vm.createContext({ console, Number, Math, Date, JSON, Object, Array, String, Boolean, Set, Map });
  vm.runInContext(`function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}`, ctx);
  // The real helper, not a stand-in: the review table renders a measurement's LOCAL day, and a
  // test that supplied its own would be free to get that right while the app got it wrong.
  vm.runInContext(fs.readFileSync(path.join(base, 'js', 'dates.js'), 'utf8'), ctx);
  // Only the markup half runs here; openCompositionImport needs a browser and is not called.
  vm.runInContext(fs.readFileSync(path.join(base, 'js', 'composition-import-ui.js'), 'utf8'), ctx);
  return ctx;
}

let IMPORT, STORE;
test.before(async () => {
  IMPORT = await import('../js/composition-import.mjs');
  STORE = await import('../js/composition-import-supabase.mjs');
});

const CONTEXT = Object.freeze({
  subjectId: 'synthetic-subject-001', scope: 'adult_reference',
  actorId: 'synthetic-actor-001', consentReference: 'synthetic-permission-001',
  savedAt: '2026-09-20T10:00:00.000Z', retentionUntil: '2029-09-20T10:00:00.000Z',
});

// ----------------------------------------------------------------- claim strength on screen
test('a device estimate is never shown as a measurement', () => {
  const c = ui();
  const scale = c.ciManualStep('smart_scale', 'Smart scale', IMPORT.importableMetrics('smart_scale'), '2026-09-20');
  const dexa = c.ciManualStep('dexa', 'DXA scan', IMPORT.importableMetrics('dexa'), '2026-09-20');
  // The same quantity, two sources, two different words on the screen.
  assert.match(scale, /Body fat <span class="ci-chip ci-chip-device_estimated"[^>]*>Device estimate<\/span>/);
  assert.match(dexa, /Body fat <span class="ci-chip ci-chip-measured"[^>]*>Measured<\/span>/);
  // And the reason is on the element, not buried in a help page.
  assert.match(scale, /manufacturer&#39;s own equation/);
});

test('the form offers only what the source can report', () => {
  const c = ui();
  const dexa = c.ciManualStep('dexa', 'DXA scan', IMPORT.importableMetrics('dexa'), '2026-09-20');
  assert.match(dexa, /Bone mineral content/);
  assert.ok(!/Visceral fat/.test(dexa), 'DXA does not produce a visceral fat index, so it must not be offered');
  const scale = c.ciManualStep('smart_scale', 'Smart scale', IMPORT.importableMetrics('smart_scale'), '2026-09-20');
  assert.match(scale, /Visceral fat/);
  assert.ok(!/Bone mineral content/.test(scale));
});

test('a mass field makes the unit a choice; a percentage has nothing to choose', () => {
  const c = ui();
  const html = c.ciManualStep('smart_scale', 'Smart scale', IMPORT.importableMetrics('smart_scale'), '2026-09-20');
  assert.match(html, /<select name="unit:weight_kg"[\s\S]*?<option value="kg">[\s\S]*?<option value="lb">/);
  assert.ok(!/unit:body_fat_percent/.test(html), 'a percentage cannot be in another unit');
});

test('each source asks for the provenance it actually needs', () => {
  const c = ui();
  const metrics = key => IMPORT.importableMetrics(key);
  assert.match(c.ciManualStep('dexa', 'DXA scan', metrics('dexa'), '2026-09-20'), /name="facility"/);
  assert.match(c.ciManualStep('health_platform', 'Health platform', metrics('health_platform'), '2026-09-20'), /name="originatingApp"/);
  assert.match(c.ciManualStep('manual_report', 'Transcribed report', metrics('manual_report'), '2026-09-20'), /name="methodLabel"/);
  // A scale has no facility and no originating app; asking would be noise.
  const scale = c.ciManualStep('smart_scale', 'Smart scale', metrics('smart_scale'), '2026-09-20');
  assert.ok(!/name="facility"/.test(scale) && !/name="originatingApp"/.test(scale));
});

test('the date field cannot be set to the future', () => {
  const c = ui();
  assert.match(c.ciManualStep('dexa', 'DXA scan', IMPORT.importableMetrics('dexa'), '2026-09-20'), /name="measuredAt"[^>]*max="2026-09-20"/);
});

test('the source step says plainly that this is not our estimate', () => {
  const c = ui();
  const html = c.ciSourceStep(IMPORT.REFERENCE_SOURCES);
  assert.match(html, /never a Parent Playbook estimate/);
  assert.match(html, /does not check the device/);
});

// ----------------------------------------------------------------- review
const parseCsv = (csv, source = 'smart_scale', extra = {}) =>
  IMPORT.parseCompositionCsv(csv, { ...CONTEXT, sourceClass: source, ...extra });

test('a partial import is shown as partial, with the refused rows in front of you', () => {
  const c = ui();
  const result = parseCsv('Date,Weight (kg)\n2026-09-10,70\nnonsense,71\n');
  const html = c.ciReviewStep(result, IMPORT.describeImportOutcome(result), 'Smart scale');
  assert.match(html, /1 reading is ready to import\. 1 row was refused and will not be saved\./);
  assert.match(html, /class="ci-summary ci-warning"/);
  // Not hidden behind a closed disclosure.
  assert.match(html, /<details class="ci-problems" open>/);
  assert.match(html, /Line 3/);
});

test('a converted value shows what the source said as well as what was stored', () => {
  const c = ui();
  const result = parseCsv('Date,Weight (lb)\n2026-09-10,170\n');
  const html = c.ciReviewStep(result, IMPORT.describeImportOutcome(result), 'Smart scale');
  // Replacing 170 lb with 77.1 kg silently would take away the reader's ability to check
  // their own data entry against the printout.
  assert.match(html, /170 lb → 77\.1 kg/);
});

test('ignored columns are named in the review, not dropped quietly', () => {
  const c = ui();
  const result = parseCsv('Date,Weight (kg),Heart rate\n2026-09-10,70,58\n');
  const html = c.ciReviewStep(result, IMPORT.describeImportOutcome(result), 'Smart scale');
  assert.match(html, /Ignored: Heart rate/);
});

test('how the file was read is stated, since a date order was inferred', () => {
  const c = ui();
  const result = parseCsv('Date,Weight (kg)\n13/02/2026,70\n01/02/2026,71\n');
  const html = c.ciReviewStep(result, IMPORT.describeImportOutcome(result), 'Smart scale');
  assert.match(html, /day\/month\/year/);
});

test('every value in the review carries how it was obtained', () => {
  const c = ui();
  const result = parseCsv('Date,Weight (kg),Body Fat %\n2026-09-10,70,18\n');
  const html = c.ciReviewStep(result, IMPORT.describeImportOutcome(result), 'Smart scale');
  assert.match(html, /Weight<\/td>\s*<td>70 kg<\/td>\s*<td><span class="ci-chip ci-chip-measured"/);
  assert.match(html, /Body fat<\/td>\s*<td>18%<\/td>\s*<td><span class="ci-chip ci-chip-device_estimated"/);
});

test('nothing importable leaves the confirm button disabled', () => {
  const c = ui();
  const result = { records: [], problems: [{ line: 2, reason: 'no' }], columnsUsed: [], columnsIgnored: [] };
  const html = c.ciReviewStep(result, IMPORT.describeImportOutcome(result), 'Smart scale');
  assert.match(html, /id="ciConfirm" disabled/);
});

test('markup escapes what a file supplies', () => {
  const c = ui();
  const result = parseCsv('Date,Weight (kg),<img src=x onerror=alert(1)>\n2026-09-10,70,1\n');
  const html = c.ciReviewStep(result, IMPORT.describeImportOutcome(result), 'Smart scale');
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;img src=x/);
});

// ----------------------------------------------------------------- form reading
test('the typed form maps onto the importer, units included', () => {
  const c = ui();
  const fields = c.ciReadForm([
    ['measuredAt', '2026-09-10'], ['facility', 'Synthetic Clinic'], ['model', ' '],
    ['value:body_fat_percent', '18.4'], ['unit:body_fat_percent', 'percent'],
    ['value:lean_mass_kg', '132'], ['unit:lean_mass_kg', 'lb'],
    ['value:fat_mass_kg', ''], ['unit:fat_mass_kg', 'kg'],
  ]);
  assert.equal(fields.measuredAt, '2026-09-10');
  assert.equal(fields.device.facility, 'Synthetic Clinic');
  assert.equal(fields.device.model, null, 'a whitespace-only optional field is absent, not blank');
  // Compared field by field: the object was built inside the vm context, so its prototype is not
  // the host's and deepStrictEqual would fail on that alone.
  assert.equal(fields.values.lean_mass_kg.value, '132');
  assert.equal(fields.values.lean_mass_kg.unit, 'lb');
  assert.ok(!('fat_mass_kg' in fields.values), 'an empty field is a value the report did not give, not a zero');

  // And the mapping feeds the real importer without adjustment.
  const record = IMPORT.readManualEntry(fields, { ...CONTEXT, sourceClass: 'dexa' });
  assert.equal(record.outputs.find(o => o.key === 'lean_mass_kg').value, 59.9);
  assert.equal(record.device.facility, 'Synthetic Clinic');
});

// ----------------------------------------------------------------- what the screen promises
test('the attachment offer explains that the document stays out of exports', () => {
  const c = ui();
  const html = c.ciDoneStep({ tone: 'ok', text: '1 reading added.', reasons: [], saved: 1 }, true);
  assert.match(html, /stored privately/);
  assert.match(html, /never part of an export/);
});
