// The privacy page and the data-deletion page tell parents they can delete a single measurement from Growth, and until
// now no screen could. These pin the rule for which readings are deleted one at a time and which belong to a body scan,
// the Growth and sheet wiring that enforces it, and the copy that now describes it accurately.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8');

function context() {
  const ctx = vm.createContext({ console, JSON, Number, String, Date, Math, Array, Object, uuid: () => 'id' });
  vm.runInContext(read('js/dates.js'), ctx);
  vm.runInContext(read('js/scan-record.js'), ctx);
  return ctx;
}

test('a body scan output is deleted with its scan; every other reading is deleted on its own', () => {
  const { measurementDeleteRule } = context();
  const rule = row => JSON.parse(JSON.stringify(measurementDeleteRule(row)));
  assert.deepEqual(rule(null), { kind: 'none' });
  assert.deepEqual(rule({ source: 'manual' }), { kind: 'none' }, 'a row without an id cannot be deleted');
  assert.deepEqual(rule({ id: 'r1', source: 'photo', scan_assessment_id: 's1', note: 'PP_SCAN_V1:{}' }), { kind: 'scan' });
  assert.deepEqual(rule({ id: 'r2', source: 'manual' }), { kind: 'single', maturityInput: false });
  for (const source of ['guided', 'video', 'import']) assert.deepEqual(rule({ id: 'r3', source }), { kind: 'single', maturityInput: false }, source);
  // A scan output saved before scan records existed, and never linked, has no scan to delete it with.
  assert.deepEqual(rule({ id: 'r4', source: 'photo', scan_assessment_id: null, note: 'PP_SCAN_V1:{"schema":1}' }), { kind: 'single', maturityInput: false });
  const batch = JSON.stringify({ schema: 'PP_MATURITY_INPUT_V1', batchId: 'batch-0001', method: 'parent_manual_same_session' });
  assert.deepEqual(rule({ id: 'r5', source: 'manual', note: batch }), { kind: 'single', maturityInput: true });
  assert.deepEqual(rule({ id: 'r6', source: 'manual', note: '{broken' }), { kind: 'single', maturityInput: false });
  assert.deepEqual(rule({ id: 'r7', source: 'guided', note: batch }), { kind: 'single', maturityInput: false }, 'only a hand-entered reading is a maturity input');
});

test('Growth opens every reading of a measurement, and the sheet deletes only what the rule allows', () => {
  const growth = read('js/screen-growth.js'), sheets = read('js/sheets.js');
  assert.match(growth, /<div class="mtrend" data-measure-history="\$\{esc\(k\)\}" role="button" tabindex="0"/);
  assert.match(growth, /querySelectorAll\('\[data-measure-history\]'\)\.forEach\(el=>clickableCard\(el,\(\)=>openMeasureHistory\(el\.dataset\.measureHistory\)\)\)/);

  // Only a guardian who can edit sees Delete; a scan output is sent to the scan hub instead.
  assert.match(sheets, /const canEdit=state\.canEdit!==false;/);
  assert.match(sheets, /rule\.kind==='scan'\?H`<button class="btn sm ghost" data-measure-scan="1">/);
  assert.match(sheets, /rule\.kind==='single'\?H`<button class="btn sm ghost" data-measure-delete=/);
  assert.match(sheets, /data-measure-scan\]'\)\.forEach\(b=>b\.onclick=\(\)=>\{ bg\.remove\(\); renderApp\('scan'\); \}\)/);

  // Asks first, scoped to the athlete on screen, never part of a scan, and a silent refusal is a failure.
  assert.match(sheets, /function confirmDeleteMeasurement\(row, hasScanColumn, onDeleted\)\{\r?\n  const rule=measurementDeleteRule\(row\); if\(rule\.kind!=='single'\) return;/);
  assert.match(sheets, /id="deleteMeasureNo">Keep it</);
  assert.match(sheets, /sb\.from\('measurements'\)\.delete\(\)\.eq\('id',row\.id\)\.eq\('athlete_id',state\.active\.id\)/);
  assert.match(sheets, /if\(hasScanColumn\) q=q\.is\('scan_assessment_id',null\);/);
  assert.match(sheets, /await q\.select\('id'\)/);
  assert.match(sheets, /if\(error\|\|!data\|\|!data\.length\)\{/);
  // On a database without the scan link column, the read retries without it rather than showing nothing.
  assert.match(sheets, /if\(error\)\{ hasScanColumn=false; \(\{ data:rows, error \}=await read\(base\)\); \}/);
});

test('the privacy and data-deletion pages describe single-measurement deletion as it now works', () => {
  const privacy = read('privacy.html'), deletion = read('datadeletion.html');
  assert.match(privacy, /<b>Delete a single measurement<\/b>/);
  assert.match(privacy, /tap the measurement, then Delete on the reading/);
  assert.doesNotMatch(privacy, /<li>You delete the measurement from the Growth tab\.<\/li>/, 'the bare promise is replaced by the steps');
  assert.match(deletion, /<h2 id="measurement">Delete a single measurement<\/h2>/);
  assert.match(deletion, /Growth sends you to the <b>Scan<\/b> tab instead/);
  // Neither page may say a body scan can be deleted from the scan hub unconditionally: that control only exists
  // where the scan-records migration has been applied, so the copy describes it as where Growth sends you.
  for (const page of [privacy, deletion]) assert.doesNotMatch(page, /delete (it|a scan|the scan) from the Scan tab at any time/i);
  assert.match(read('js/account.js'), /delete those from Growth, one reading at a time, or a whole body scan from Scans/);
});
