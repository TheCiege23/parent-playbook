// Adult Training: body composition a parent imports about themselves, from a DXA scan, a clinic, a smart scale, a
// health app or a transcribed report. It reuses the provider-neutral import (js/composition-import*.js) as an adult
// reference about the signed-in guardian. These pin that every value says what obtained it, that a scale's estimate is
// never trended against a DXA measurement, and that the result stays the parent's own. Every fixture is synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));

let REF;
test.before(async () => { REF = await import('../js/body-composition-reference.mjs'); });

function context() {
  const ctx = vm.createContext({ console, Number, Math, String, Date, JSON, Set, Map, Array, Object, Intl });
  vm.runInContext(read('js/dates.js'), ctx);
  vm.runInContext(`const H=(s,...v)=>s.reduce((a,x,i)=>a+x+(v[i]??''),'');
    function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
    function fmtDate(d){return d;}`, ctx);
  vm.runInContext(read('js/adult-composition.js'), ctx);
  return ctx;
}

// A row as the database returns it, holding a record the real contract validated.
const row = (sourceClass, measuredAt, outputs) => ({
  id: 'row-' + sourceClass + '-' + measuredAt.slice(0, 10), measured_at: measuredAt, source_class: sourceClass,
  record: plain(REF.validateCompositionReference({
    schema: 'PP_BODY_COMPOSITION_REFERENCE_V1', sourceClass, scope: 'adult_reference',
    recordId: 'synthetic-' + sourceClass + '-' + measuredAt.slice(0, 10), subjectId: 'self',
    actorId: 'synthetic-parent', consentReference: 'adult-self-import', outputs, measuredAt,
    savedAt: '2026-09-14T12:00:00.000Z', retentionUntil: '2031-09-13T12:00:00.000Z',
    device: sourceClass === 'dexa' ? { facility: 'Synthetic sports lab' } : {},
  })),
});
const ROWS = () => [
  row('smart_scale', '2026-09-01T12:00:00.000Z', [
    { key: 'body_fat_percent', status: 'device_estimated', value: 21, unit: 'percent' },
    { key: 'weight_kg', status: 'measured', value: 80, unit: 'kg' },
  ]),
  row('dexa', '2026-08-15T12:00:00.000Z', [
    { key: 'body_fat_percent', status: 'measured', value: 20, unit: 'percent' },
    { key: 'lean_mass_kg', status: 'measured', value: 60, unit: 'kg' },
  ]),
  row('smart_scale', '2026-08-01T12:00:00.000Z', [{ key: 'body_fat_percent', status: 'device_estimated', value: 22.5, unit: 'percent' }]),
];

test('the newest value of each quantity is compared only with the same kind of source, never a scale with a DXA scan', () => {
  const ctx = context();
  const latest = plain(ctx.adultCompositionLatest(ROWS()));
  assert.deepEqual(latest.map(r => r.key), ['body_fat_percent', 'lean_mass_kg'], 'weight stays with the import');
  const [fat, lean] = latest;
  assert.deepEqual([fat.statusLabel, fat.sourceLabel, fat.value, fat.change], ['Device estimate', 'Smart scale', 21, -1.5]);
  assert.equal(fat.previous.measuredAt, '2026-08-01T12:00:00.000Z', 'the DXA value in between is not the comparison');
  assert.deepEqual([lean.statusLabel, lean.sourceLabel, lean.change], ['Measured', 'DXA scan', null]);
  assert.deepEqual(plain(ctx.adultCompositionLatest([{ id: 'x', record: { schema: 'something else' } }, null])), []);
});

test('every value on screen says what obtained it, and Parent Playbook claims none of them', () => {
  const ctx = context();
  const html = ctx.adultCompositionMarkup(ctx.adultCompositionLatest(ROWS()));
  const rows = html.split('<div class="mrow">').slice(1);
  assert.equal(rows.length, 2);
  for (const r of rows) assert.match(r, /<small>(Measured|Device estimate) · /);
  assert.match(html, /<b>Body fat<\/b><small>Device estimate · Smart scale · 2026-09-01 · -1\.5 since the previous smart scale result<\/small><\/span>\s*<b>21%<\/b>/);
  assert.match(html, /<b>Lean mass<\/b><small>Measured · DXA scan · 2026-08-15<\/small><\/span>\s*<b>60 kg<\/b>/);
  const empty = ctx.adultCompositionMarkup([]);
  assert.match(empty, /Parent Playbook doesn't produce these numbers; each one is shown as measured or as a device estimate\./);
  assert.doesNotMatch(empty, /adultCompManage/);
  assert.doesNotMatch(read('js/adult-composition.js'), /Parent Playbook estimat|weight[- ]loss|lose weight|muscle gain|pounds lost|\btargets?\b|\bgoal/i);
});

test("the import and the list are the parent's own adult reference, and the database agrees", () => {
  const src = read('js/adult-composition.js');
  assert.match(src, /\.eq\('guardian_id', uid\)\.eq\('subject_scope', 'adult_reference'\)\.eq\('subject_reference', ADULT_COMPOSITION_SUBJECT\)\.is\('athlete_id', null\)/);
  assert.match(src, /createExternalCompositionStore\(sb, \{ scope:'adult_reference', subjectReference:ADULT_COMPOSITION_SUBJECT \}\)/);
  assert.match(src, /subjectId:ADULT_COMPOSITION_SUBJECT, scope:'adult_reference', athleteId:null,/);
  assert.doesNotMatch(src, /\.share\(|team_id|state\.active/, 'nothing here shares with an organization or reads the child');
  const migration = read('supabase/migrations/20260912100000_external_body_composition_records.sql');
  // Writing an adult reference needs no athlete and allows only the importing guardian.
  assert.match(migration, /select requested_guardian = \(select auth\.uid\(\)\)\n    and \(requested_athlete is null or private\.can_edit_athlete\(requested_athlete\)\);/);
  // An organization reads a shared result only when it names an athlete, which an adult reference never does.
  assert.match(migration, /or \(requested_team is not null and requested_athlete is not null/);
  assert.match(migration, /check \(\(subject_scope = 'child_athlete'\) = \(athlete_id is not null\)\)/);
});

test('it is part of Your training, exported with it, and described on the privacy pages', () => {
  const screen = read('js/screen-adult.js');
  assert.match(screen, /<div id="adultComposition"><\/div>/);
  assert.match(screen, /if \(typeof adultCompositionSection === 'function'\) adultCompositionSection\(\$\("#adultComposition"\)\);/);
  assert.match(screen, /data\.composition_imports = composition;/);
  const index = read('index.html');
  const at = name => index.indexOf('<script src="/js/' + name + '"></script>');
  assert.ok(at('composition-import-ui.js') > -1 && at('composition-import-ui.js') < at('adult-composition.js') && at('adult-composition.js') < at('init.js'));
  assert.match(read('sw.js'), /'\/js\/screen-adult-eating\.js','\/js\/adult-composition\.js'/);
  const jsDir = path.join(base, 'js');
  for (const file of fs.readdirSync(jsDir).filter(f => /\.(m?js)$/.test(f) && !/^(screen-adult|adult-composition|adult-deletion)\.js$/.test(f)))
    assert.doesNotMatch(fs.readFileSync(path.join(jsDir, file), 'utf8'), /adultComposition|ADULT_COMPOSITION_/, file);
  assert.match(read('privacy.html'), /You can also import body composition results about yourself from a DXA scan, a clinic, a smart scale or a health app; each number is shown as measured or as a device estimate, and Parent Playbook does not produce them\./);
  assert.match(read('datadeletion.html'), /readings and imports, imported body composition results, food preferences, recipes, meal plans and logged eating habits\.<\/li>/);
});
