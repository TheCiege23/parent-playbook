// Contract tests for js/composition-import.mjs — the three doors an externally measured body
// composition result comes in through.
//
// The cases that matter here are the ones where a looser importer produces a believable wrong
// number rather than an error: pounds read as kilograms, 01/02 read as the wrong day, a smart
// scale's derived body fat recorded as measured. Each of those lands inside every plausibility
// range downstream, so nothing else would ever catch them.
//
// Every fixture is synthetic. No real person's measurement appears in this file.
const test = require('node:test');
const assert = require('node:assert/strict');

let IMPORT;
test.before(async () => { IMPORT = await import('../js/composition-import.mjs'); });

// A guardian importing for their own adult reference. Ownership and consent come from here and
// never from the file.
const CONTEXT = Object.freeze({
  subjectId: 'synthetic-subject-001',
  scope: 'adult_reference',
  actorId: 'synthetic-actor-001',
  consentReference: 'synthetic-permission-001',
  savedAt: '2026-09-20T10:00:00.000Z',
  retentionUntil: '2029-09-20T10:00:00.000Z',
});
const withSource = (sourceClass, extra = {}) => ({ ...CONTEXT, sourceClass, ...extra });
const SCALE = withSource('smart_scale');
const DEXA = withSource('dexa', { device: { facility: 'Synthetic Imaging Clinic' } });

const rejects = (fn, code) => {
  try { fn(); assert.fail('expected a rejection with code ' + code); }
  catch (error) {
    assert.equal(error.name, 'CompositionImportError', 'unexpected error: ' + error.message);
    assert.equal(error.code, code, 'wrong code; message was: ' + error.message);
    return error;
  }
};

// ----------------------------------------------------------------- claim strength
test('what a source may claim is derived, never asked', () => {
  // The whole reason this is not a form field: "measured" is what a hurried person picks.
  assert.equal(IMPORT.statusFor('dexa', 'body_fat_percent'), 'measured');
  assert.equal(IMPORT.statusFor('smart_scale', 'body_fat_percent'), 'device_estimated');
  assert.equal(IMPORT.statusFor('bia_clinical', 'body_fat_percent'), 'device_estimated');
  assert.equal(IMPORT.statusFor('smart_scale', 'weight_kg'), 'measured');
  assert.equal(IMPORT.statusFor('dexa', 'bmi'), 'calculated');
  // A quantity the source does not produce at all is neither, and callers branch on null.
  assert.equal(IMPORT.statusFor('dexa', 'visceral_fat_index'), null);
  assert.equal(IMPORT.statusFor('smart_scale', 'bone_mineral_content_kg'), null);
});

test('a form built for a source offers only what that source reports', () => {
  const dexa = IMPORT.importableMetrics('dexa').map(m => m.key);
  assert.ok(dexa.includes('bone_mineral_content_kg'));
  assert.ok(!dexa.includes('visceral_fat_index'), 'DXA does not produce a visceral fat index');
  const scale = IMPORT.importableMetrics('smart_scale');
  assert.ok(scale.some(m => m.key === 'visceral_fat_index'));
  // A mass offers both units at the point of entry; a percentage has nothing to choose.
  assert.deepEqual(scale.find(m => m.key === 'weight_kg').unitChoices, ['kg', 'lb']);
  assert.deepEqual(scale.find(m => m.key === 'body_fat_percent').unitChoices, ['percent']);
});

// ----------------------------------------------------------------- CSV shape
test('a quoted CSV with commas, doubled quotes, CRLF and a BOM parses', () => {
  const rows = IMPORT.parseDelimited('﻿a,"b,c","say ""hi"""\r\nd,e,f\r\n');
  assert.deepEqual(rows, [['a', 'b,c', 'say "hi"'], ['d', 'e', 'f']]);
});

test('blank lines are dropped rather than counted as readings', () => {
  const rows = IMPORT.parseDelimited('a,b\n\n1,2\n   \n3,4\n');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2'], ['3', '4']]);
});

test('a semicolon export is read as a semicolon export', () => {
  const rows = IMPORT.parseDelimited('Date;Weight (kg)\n2026-09-10;70,5\n');
  assert.deepEqual(rows, [['Date', 'Weight (kg)'], ['2026-09-10', '70,5']]);
});

// ----------------------------------------------------------------- units
test('a mass column with no unit is refused instead of assumed', () => {
  // 170 lb read as kg is 170 kg — inside the plausibility range, so nothing downstream catches it.
  const error = rejects(() => IMPORT.parseCompositionCsv('Date,Weight\n2026-09-10,170\n', SCALE), 'AMBIGUOUS_UNIT');
  assert.match(error.message, /Weight/);
  assert.match(error.message, /pounds read as kilograms/i);
});

test('a percentage column needs no unit, because it cannot mean anything else', () => {
  const out = IMPORT.parseCompositionCsv('Date,Body Fat %\n2026-09-10,18.4\n', SCALE);
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].outputs[0].value, 18.4);
});

test('pounds are converted, and what the scale actually said is kept', () => {
  const out = IMPORT.parseCompositionCsv('Date,Weight (lb)\n2026-09-10,170\n', SCALE);
  const weight = out.records[0].outputs.find(o => o.key === 'weight_kg');
  assert.equal(weight.unit, 'kg');
  assert.equal(weight.value, 77.1);
  // A reader comparing two records needs to know this one was rounded in pounds first.
  assert.deepEqual(weight.original, { value: 170, unit: 'lb' });
});

test('the unit is read from several heading spellings', () => {
  for (const heading of ['Weight (lb)', 'Weight [lbs]', 'Weight - pounds', 'weight lbs']) {
    const out = IMPORT.parseCompositionCsv('Date,' + heading + '\n2026-09-10,170\n', SCALE);
    assert.equal(out.records[0].outputs[0].value, 77.1, heading + ' should have been read as pounds');
  }
});

// ----------------------------------------------------------------- dates
test('an ambiguous date file is refused, with the reason a person can act on', () => {
  const error = rejects(() => IMPORT.parseCompositionCsv('Date,Weight (kg)\n01/02/2026,70\n03/04/2026,71\n', SCALE), 'AMBIGUOUS_DATE');
  assert.match(error.message, /1st of February or the 2nd of January/);
});

test('one unambiguous row settles the order for the whole file', () => {
  // 13 cannot be a month, so this file is day/month/year and the other rows follow it.
  const out = IMPORT.parseCompositionCsv('Date,Weight (kg)\n13/02/2026,70\n01/02/2026,71\n', SCALE);
  assert.equal(out.dateOrder, 'dmy');
  assert.equal(out.records.length, 2);
  assert.equal(out.records[0].measuredAt.slice(0, 10), '2026-02-13');
  assert.equal(out.records[1].measuredAt.slice(0, 10), '2026-02-01');
});

test('the same file read as month/day when that is what settles it', () => {
  const out = IMPORT.parseCompositionCsv('Date,Weight (kg)\n02/13/2026,70\n02/01/2026,71\n', SCALE);
  assert.equal(out.dateOrder, 'mdy');
  assert.equal(out.records[1].measuredAt.slice(0, 10), '2026-02-01');
});

test('a date with no time lands at midday, not midnight', () => {
  // Midnight UTC is the previous day everywhere west of it, which slides a scan a day earlier
  // for half the world.
  const out = IMPORT.parseCompositionCsv('Date,Weight (kg)\n2026-09-10,70\n', SCALE);
  assert.equal(out.records[0].measuredAt, '2026-09-10T12:00:00.000Z');
});

test('an impossible date is refused rather than rolled forward', () => {
  const out = IMPORT.parseCompositionCsv('Date,Weight (kg)\n31/02/2026,70\n13/01/2026,71\n', SCALE);
  assert.equal(out.records.length, 1);
  assert.equal(out.problems.length, 1);
  assert.equal(out.problems[0].line, 2);
  assert.match(out.problems[0].reason, /could not be read/);
});

test('a reading dated today is not refused for having been imported promptly', () => {
  // A date with no time becomes midday. Import it at 10am and the reading is two hours in the
  // future, and the contract refuses a measurement taken after it was saved -- so a genuine
  // reading from this morning would be rejected for arriving too soon. It is clamped to the
  // moment we took custody instead, which is all a day-only date ever claimed.
  const today = { ...SCALE, savedAt: '2026-09-20T10:00:00.000Z', retentionUntil: '2029-09-20T10:00:00.000Z' };
  const out = IMPORT.parseCompositionCsv('Date,Weight (kg)\n2026-09-20,70\n', today);
  assert.equal(out.problems.length, 0, out.problems.map(p => p.reason).join('; '));
  assert.equal(out.records[0].measuredAt, '2026-09-20T10:00:00.000Z');
});

test('a date genuinely in the future is still refused', () => {
  const today = { ...SCALE, savedAt: '2026-09-20T10:00:00.000Z', retentionUntil: '2029-09-20T10:00:00.000Z' };
  const out = IMPORT.parseCompositionCsv('Date,Weight (kg)\n2026-09-21,70\n', today);
  assert.equal(out.records.length, 0);
  assert.match(out.problems[0].reason, /cannot have been taken after it was saved/);
});

test('an explicit future time is refused rather than clamped', () => {
  // The clamp is only for a date that never stated a time. A file that says 14:00 and is wrong
  // about it is a different thing from one that never claimed a time at all.
  const today = { ...SCALE, savedAt: '2026-09-20T10:00:00.000Z', retentionUntil: '2029-09-20T10:00:00.000Z' };
  const out = IMPORT.parseCompositionCsv('Date,Weight (kg)\n2026-09-20 14:00,70\n', today);
  assert.equal(out.records.length, 0);
  assert.match(out.problems[0].reason, /cannot have been taken after it was saved/);
});

// ----------------------------------------------------------------- source capability
test('a file claiming a quantity its source cannot produce is refused whole', () => {
  const error = rejects(() => IMPORT.parseCompositionCsv('Date,Bone mineral content (kg)\n2026-09-10,2.4\n', SCALE), 'UNSUPPORTED_SOURCE_COLUMN');
  assert.match(error.message, /Smart scale does not report Bone mineral content/);
});

test('a smart scale body fat is recorded as an estimate, not a measurement', () => {
  const out = IMPORT.parseCompositionCsv('Date,Body Fat %\n2026-09-10,18\n', SCALE);
  assert.equal(out.records[0].outputs[0].status, 'device_estimated');
});

test('the same column from a DXA report is recorded as measured', () => {
  const out = IMPORT.parseCompositionCsv('Date,Body Fat %\n2026-09-10,18\n', DEXA);
  assert.equal(out.records[0].outputs[0].status, 'measured');
});

test('a DXA import with no facility is refused, because two scanners must be tellable apart', () => {
  const out = IMPORT.parseCompositionCsv('Date,Body Fat %\n2026-09-10,18\n', withSource('dexa'));
  assert.equal(out.records.length, 0);
  assert.equal(out.problems.length, 1);
  assert.match(out.problems[0].reason, /facility/i);
});

// ----------------------------------------------------------------- per-row isolation
test('a bad row is reported by line number and the rest of the file still imports', () => {
  const csv = ['Date,Weight (kg),Body Fat %',
    '2026-09-10,70,18',
    '2026-09-11,not-a-number,',        // no readable value at all
    '2026-09-12,71,19',
    'nonsense,72,20',                  // unreadable date
    '2026-09-14,73,21'].join('\n');
  const out = IMPORT.parseCompositionCsv(csv, SCALE);
  assert.equal(out.rowsRead, 5);
  assert.equal(out.records.length, 3);
  assert.deepEqual(out.problems.map(p => p.line), [3, 5]);
  assert.match(out.problems[0].reason, /no readable values/);
  assert.match(out.problems[1].reason, /date "nonsense"/);
});

test('a blank cell is a value that was not reported, not a zero', () => {
  const out = IMPORT.parseCompositionCsv('Date,Weight (kg),Body Fat %\n2026-09-10,70,\n', SCALE);
  assert.deepEqual(out.records[0].outputs.map(o => o.key), ['weight_kg']);
});

test('a repeated reading is caught before the file is committed, not after', () => {
  const out = IMPORT.parseCompositionCsv('Date,Weight (kg)\n2026-09-10,70\n2026-09-10,70\n', SCALE);
  assert.equal(out.records.length, 1);
  assert.equal(out.problems[0].code, 'DUPLICATE_IN_FILE');
  assert.match(out.problems[0].reason, /already on line 2/);
});

test('unrecognised columns are ignored and named, not silently dropped', () => {
  const out = IMPORT.parseCompositionCsv('Date,Weight (kg),Heart rate,Notes\n2026-09-10,70,58,fasted\n', SCALE);
  assert.deepEqual(out.columnsIgnored, ['Heart rate', 'Notes']);
  assert.deepEqual(out.columnsUsed.map(c => c.key), ['weight_kg']);
});

test('a file with no date column is refused, because rows cannot be placed in a history', () => {
  rejects(() => IMPORT.parseCompositionCsv('Weight (kg)\n70\n', SCALE), 'NO_DATE_COLUMN');
});

test('a file with no recognised quantity says which headings would work', () => {
  const error = rejects(() => IMPORT.parseCompositionCsv('Date,Steps\n2026-09-10,8000\n', SCALE), 'NO_METRIC_COLUMNS');
  assert.match(error.message, /Weight, Body fat %/);
});

test('a heading row with no rows under it is refused as empty', () => {
  rejects(() => IMPORT.parseCompositionCsv('Date,Weight (kg)\n', SCALE), 'EMPTY_IMPORT');
});

// ----------------------------------------------------------------- plausibility
test('an implausible value is refused as a row, not stored and shown to a parent', () => {
  const out = IMPORT.parseCompositionCsv('Date,Body Fat %\n2026-09-10,140\n2026-09-11,18\n', SCALE);
  assert.equal(out.records.length, 1);
  assert.equal(out.problems.length, 1);
  assert.equal(out.problems[0].code, 'IMPLAUSIBLE_REFERENCE_VALUE');
});

// ----------------------------------------------------------------- manual entry
test('a typed clinic report becomes a record', () => {
  const record = IMPORT.readManualEntry({
    measuredAt: '2026-09-10',
    values: { body_fat_percent: '18.4', lean_mass_kg: { value: '132', unit: 'lb' } },
  }, DEXA);
  assert.equal(record.sourceClass, 'dexa');
  assert.equal(record.outputs.find(o => o.key === 'body_fat_percent').status, 'measured');
  const lean = record.outputs.find(o => o.key === 'lean_mass_kg');
  assert.equal(lean.value, 59.9);
  assert.deepEqual(lean.original, { value: 132, unit: 'lb' });
});

test('an empty field is left out; a field with rubbish in it is an error', () => {
  const record = IMPORT.readManualEntry({ measuredAt: '2026-09-10', values: { body_fat_percent: '18', lean_mass_kg: '' } }, DEXA);
  assert.equal(record.outputs.length, 1);
  rejects(() => IMPORT.readManualEntry({ measuredAt: '2026-09-10', values: { body_fat_percent: 'about twenty' } }, DEXA), 'UNREADABLE_VALUE');
});

test('a form with nothing filled in says so instead of saving an empty record', () => {
  rejects(() => IMPORT.readManualEntry({ measuredAt: '2026-09-10', values: {} }, DEXA), 'EMPTY_ROW');
});

test('a transcribed report must say what method produced it', () => {
  const fields = { measuredAt: '2026-09-10', values: { body_fat_percent: '18' } };
  const error = rejects(() => IMPORT.readManualEntry(fields, withSource('manual_report', { reportRetained: false })), 'INVALID_REFERENCE_RECORD');
  assert.match(error.message, /what method produced it/);
  const ok = IMPORT.readManualEntry({ ...fields, methodLabel: 'DXA, Synthetic Clinic report' },
    withSource('manual_report', { reportRetained: false }));
  assert.equal(ok.methodLabel, 'DXA, Synthetic Clinic report');
});

// ----------------------------------------------------------------- JSON
test('a record this product wrote can come back in', () => {
  const original = IMPORT.readManualEntry({ measuredAt: '2026-09-10', values: { body_fat_percent: '18' } }, DEXA);
  const out = IMPORT.parseCompositionJson(JSON.stringify([original]), DEXA);
  assert.equal(out.problems.length, 0, out.problems.map(p => p.reason).join('; '));
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].outputs[0].value, 18);
});

test('a Parent Playbook estimate cannot be imported as a measurement', () => {
  const out = IMPORT.parseCompositionJson(JSON.stringify({ schema: 'PP_BODY_COMPOSITION_ESTIMATE_V1', outputs: [] }), DEXA);
  assert.equal(out.records.length, 0);
  assert.match(out.problems[0].reason, /is a Parent Playbook estimate/);
});

test('a file cannot name the athlete it is written onto', () => {
  // The dangerous shape: a JSON file that carries its own athleteId and consent, imported by
  // someone who has neither.
  const original = IMPORT.readManualEntry({ measuredAt: '2026-09-10', values: { body_fat_percent: '18' } }, DEXA);
  const hostile = { ...original, athleteId: 'someone-elses-child', scope: 'child_athlete', consentReference: 'forged', subjectId: 'someone-else' };
  const out = IMPORT.parseCompositionJson(JSON.stringify([hostile]), DEXA);
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].subjectId, CONTEXT.subjectId, 'the importing context decides the subject');
  assert.equal(out.records[0].scope, 'adult_reference');
  assert.equal(out.records[0].athleteId, null);
  assert.equal(out.records[0].consentReference, CONTEXT.consentReference);
});

test('malformed JSON says so plainly', () => {
  rejects(() => IMPORT.parseCompositionJson('{not json', DEXA), 'NOT_JSON');
});

// ----------------------------------------------------------------- identity and framing
test('importing the same export twice produces the same identity, so it collides rather than doubles', () => {
  const csv = 'Date,Weight (kg)\n2026-09-10,70\n';
  const first = IMPORT.parseCompositionCsv(csv, SCALE).records[0];
  const second = IMPORT.parseCompositionCsv(csv, { ...SCALE, savedAt: '2027-01-01T00:00:00.000Z', retentionUntil: '2029-01-01T00:00:00.000Z' }).records[0];
  assert.equal(first.recordId, second.recordId);
});

test('an imported record never claims to be our estimate', () => {
  const record = IMPORT.parseCompositionCsv('Date,Weight (kg)\n2026-09-10,70\n', SCALE).records[0];
  assert.equal(record.origin, 'external_measurement');
  assert.equal(record.provider, undefined);
  assert.equal(record.modelManifest, undefined);
  assert.match(record.limitations, /Parent Playbook did not perform this measurement/);
});

test('a partial import is never described as a clean one', () => {
  const clean = IMPORT.describeImportOutcome({ records: [1, 2], problems: [] });
  assert.equal(clean.tone, 'ok');
  const partial = IMPORT.describeImportOutcome({ records: [1, 2], problems: [{}] });
  assert.equal(partial.tone, 'warning');
  assert.match(partial.text, /1 row was refused and will not be saved/);
  const none = IMPORT.describeImportOutcome({ records: [], problems: [{}, {}] });
  assert.equal(none.tone, 'error');
});
