// Your training → deleting what you recorded (js/adult-deletion.js). A signed-in regression against production on
// 2026-09-15 found that a typed-in reading, a logged day of eating habits, the food preferences and the training profile
// could not be deleted short of deleting the account. These run the real deletion functions against the harness's
// in-memory database (tools/adult-harness/fake-supabase.js), which holds only synthetic rows, with a second guardian's
// rows beside the parent's so a delete that forgot its guardian filter would show; they drive the sheets' handlers
// against a small stand-in for the DOM; and, marked as such, they read the source for the wiring and the policy pages.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const base = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8').replace(/\r\n/g, '\n');
const json = value => JSON.stringify(value);
const total = (ctx, counts) => vm.runInContext('adultRecordTotal', ctx)(counts);
const OTHER = '00000000-0000-4000-8000-0000000000bb';
const COMP_ME = '00000000-0000-4000-8000-00000000c0a1', COMP_OTHER = '00000000-0000-4000-8000-00000000c0b2';

// The source of one top-level function, found by its header and balanced braces.
function extract(source, header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, 'missing: ' + header);
  for (let i = source.indexOf('{', start + header.length - 1), depth = 0; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced: ' + header);
}

// A stand-in for sheet() and the few element operations the sheets use. Writing innerHTML replaces the elements, as the
// DOM does; an element exists only if the markup has its id; a list of buttons is found by its data attribute.
function fakeSheets() {
  const opened = [];
  const card = () => ({
    html: '', els: {}, focused: false,
    set innerHTML(h) { this.html = h; this.els = {}; },
    get innerHTML() { return this.html; },
    getAttribute: name => (name === 'aria-labelledby' ? 'sheetTitle1' : null),
    focus() { this.focused = true; },
    querySelector(sel) {
      const id = sel.startsWith('#') ? sel.slice(1) : null;
      if (!id || !this.html.includes('id="' + id + '"')) return null;
      return (this.els[id] ||= { id, value: '', textContent: '', innerHTML: '', disabled: false, onclick: null });
    },
    querySelectorAll(sel) {
      const attr = /^\[([a-z-]+)\]$/.exec(sel)[1];
      return [...this.html.matchAll(new RegExp(attr + '="([^"]*)"', 'g'))]
        .map((m, i) => (this.els[attr + ':' + i] ||= { disabled: false, onclick: null, getAttribute: () => m[1] }));
    },
  });
  const sheet = html => {
    const c = card(); c.innerHTML = html;
    const bg = { removed: false, remove() { this.removed = true; }, querySelector: sel => (sel === '.sheet' ? c : c.querySelector(sel)), querySelectorAll: sel => c.querySelectorAll(sel) };
    opened.push({ bg, card: c });
    return bg;
  };
  return { opened, sheet, last: () => opened[opened.length - 1] };
}

// The real deletion code over the harness's database, with the browser globals it calls replaced by recorders.
async function harness(search = '') {
  const ui = { toasts: [], renders: [], confirms: [], answer: true, failures: [] };
  const sheets = fakeSheets();
  const ctx = vm.createContext({
    console: { error() {}, log() {} }, crypto: require('node:crypto').webcrypto, URLSearchParams,
    location: { search },
  });
  ctx.window = ctx;
  vm.runInContext(read('tools/adult-harness/fake-supabase.js'), ctx);
  ctx.sb = ctx.window.supabase.createClient();
  vm.runInContext(read('js/adult-health-record.js'), ctx);
  vm.runInContext(read('js/adult-composition.js'), ctx);
  vm.runInContext(read('js/adult-deletion.js'), ctx);
  // The composition store is an ES module the browser imports from /js; here it is the same file, over the same client.
  const { createExternalCompositionStore } = await import(pathToFileURL(path.join(base, 'js/composition-import-supabase.mjs')).href);
  ctx.adultCompositionStore = async () => ({ store: createExternalCompositionStore(ctx.sb, { scope: 'adult_reference', subjectReference: 'self' }) });
  Object.assign(ctx, {
    H: (strings, ...v) => strings.reduce((a, s, i) => a + s + (v[i] ?? ''), ''),
    esc: s => (s ?? '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fmtDate: d => d || '',
    state: { user: ctx.window.__harness.USER, adultSection: 'eating' },
    sheet: sheets.sheet, adultTrainingOff: () => false,
    confirm: m => { ui.confirms.push(m); return ui.answer; },
    toast: m => ui.toasts.push(m), renderApp: tab => ui.renders.push(tab),
    adultFail: (error, where, message) => ui.failures.push([where, message]), reportError: () => {},
  });
  const h = ctx.window.__harness;
  return { ctx, ui, sheets, db: h.db, me: h.USER.id };
}

async function seed(ctx, guardian) {
  const mine = guardian !== OTHER;
  const insert = async (table, rows) => { const r = await ctx.sb.from(table).insert(rows); assert.equal(r.error, null, table); };
  const suffix = mine ? 'me' : 'other';
  await insert('adult_profiles', { guardian_id: guardian, units: 'lb', weekly_minutes_target: 120 });
  await insert('adult_goals', { guardian_id: guardian, kind: 'strength', label: 'Synthetic goal', status: 'active' });
  await insert('adult_schedule_items', { id: 'item-' + suffix, guardian_id: guardian, weekday: 0, title: 'Synthetic workout', kind: 'strength' });
  await insert('adult_schedule_exercises', [{ guardian_id: guardian, item_id: 'item-' + suffix, name: 'Synthetic squat' }, { guardian_id: guardian, item_id: 'item-' + suffix, name: 'Synthetic row' }]);
  await insert('adult_workout_logs', { guardian_id: guardian, schedule_item_id: 'item-' + suffix, done_on: '2026-09-14', minutes: 30 });
  await insert('adult_health_records', [
    { id: 'typed-a-' + suffix, guardian_id: guardian, metric_key: 'weight', value: 180.4, unit: 'lb', measured_on: '2026-09-13', source_kind: 'manual', method: 'entered' },
    { id: 'typed-b-' + suffix, guardian_id: guardian, metric_key: 'waist', value: 34, unit: 'in', measured_on: '2026-09-06', source_kind: 'manual', method: 'entered' },
  ]);
  await ctx.sb.rpc('save_adult_health_import', { p_batch: { id: 'batch-' + suffix, source_name: 'Synthetic scale', origin: 'device', rows_received: 1, rows_rejected: 0 },
    p_records: [{ metric_key: 'weight', value: mine ? 179.8 : 150.2, unit: 'lb', measured_on: '2026-09-14', method: 'device_measured' }] });
  // The fake's import saves as its one synthetic parent; a second guardian's import is moved across to them.
  ctx.window.__harness.db.adult_health_import_batches.filter(b => b.id === 'batch-' + suffix).forEach(b => { b.guardian_id = guardian; });
  ctx.window.__harness.db.adult_health_records.filter(r => r.batch_id === 'batch-' + suffix).forEach(r => { r.guardian_id = guardian; });
  await insert('adult_nutrition_preferences', { guardian_id: guardian, avoid_allergens: ['peanuts'], protein_meals_target: 2 });
  await insert('adult_recipes', { id: 'recipe-' + suffix, guardian_id: guardian, title: 'Synthetic noodles', ingredients: ['noodles'] });
  await insert('adult_meal_plan_items', { guardian_id: guardian, planned_on: '2026-09-15', slot: 'dinner', recipe_id: 'recipe-' + suffix, title: 'Synthetic noodles' });
  await insert('adult_nutrition_days', [
    { id: 'day-1-' + suffix, guardian_id: guardian, logged_on: '2026-09-15', protein_meals: 2, plate_meals: 1 },
    { id: 'day-2-' + suffix, guardian_id: guardian, logged_on: '2026-09-14', protein_meals: 1, plate_meals: null },
  ]);
  const comp = mine ? COMP_ME : COMP_OTHER;
  await insert('external_composition_records', { id: comp, guardian_id: guardian, subject_scope: 'adult_reference', subject_reference: 'self', athlete_id: null,
    record_id: 'synthetic-' + suffix, measured_at: '2026-09-10T12:00:00Z', source_class: 'dxa', record: { schema: 'PP_BODY_COMPOSITION_REFERENCE_V1', outputs: [] } });
  await insert('external_composition_attachments', { record_uuid: comp, storage_key: comp + '/report.pdf', content_type: 'application/pdf' });
}
const TABLES = ['adult_profiles', 'adult_goals', 'adult_schedule_items', 'adult_schedule_exercises', 'adult_workout_logs', 'adult_health_records',
  'adult_health_import_batches', 'adult_nutrition_preferences', 'adult_recipes', 'adult_meal_plan_items', 'adult_nutrition_days', 'external_composition_records'];
const held = (db, guardian) => Object.fromEntries(TABLES.map(t => [t, (db[t] || []).filter(r => r.guardian_id === guardian).length]));

// Replace one table's delete: with an error, or with a delete that matches nothing, as row-level security would.
function breakDelete(ctx, table, error) {
  const real = ctx.sb.from;
  ctx.sb.from = name => {
    const q = real(name);
    if (name === table) q.delete = error ? () => ({ eq() { return this; }, select() { return this; }, then(resolve) { resolve({ data: null, error }); } }) : () => real('refused_by_policy').delete();
    return q;
  };
  return () => { ctx.sb.from = real; };
}

test('the whole record is every Adult Training table account deletion removes, less the allowlist, in the same order, and what export reads', async () => {
  const ctx = vm.createContext({});
  vm.runInContext(read('js/adult-deletion.js'), ctx);
  const tables = JSON.parse(json(vm.runInContext('ADULT_RECORD_TABLES', ctx)));
  const { ADULT_TABLES } = await import(pathToFileURL(path.join(base, 'supabase/functions/delete-account/handler.mjs')).href);
  assert.deepEqual(tables, ADULT_TABLES.filter(t => t !== 'adult_training_access'), 'children before the rows they reference, as account deletion');
  const exported = extract(read('js/screen-adult.js'), 'async function adultTrainingExport(){').match(/const tables = \[([^\]]+)\]/)[1].match(/adult_[a-z_]+/g);
  assert.deepEqual([...tables].sort(), [...exported].sort(), 'the record deleted is the record exported');
});

test("a typed-in reading is deleted alone: never an imported reading, never another guardian's, and gone already is done", async () => {
  const { ctx, db, me } = await harness();
  await seed(ctx, me); await seed(ctx, OTHER);
  const imported = db.adult_health_records.find(r => r.guardian_id === me && r.source_kind === 'file_import');

  const listed = await ctx.adultTypedReadings(me);
  assert.equal(json(listed.data.map(r => r.id)), json(['typed-a-me', 'typed-b-me']), 'only what this parent typed, newest first');

  assert.equal(json(await ctx.adultDeleteTypedReading(me, 'typed-a-me')), json({ ok: true, deleted: 1 }));
  assert.ok(!db.adult_health_records.some(r => r.id === 'typed-a-me'));
  assert.equal(json(await ctx.adultDeleteTypedReading(me, 'typed-a-me')), json({ ok: true, deleted: 0 }), 'another tab got there first');

  await ctx.adultDeleteTypedReading(me, imported.id);
  assert.ok(db.adult_health_records.some(r => r.id === imported.id), 'an imported reading goes only with its import');
  await ctx.adultDeleteTypedReading(me, 'typed-a-other');
  assert.ok(db.adult_health_records.some(r => r.id === 'typed-a-other'), "another guardian's reading stays");
  assert.equal(db.adult_health_records.filter(r => r.guardian_id === OTHER).length, 3);
});

test('a delete the database does not carry out is reported, not claimed', async () => {
  const { ctx, db, me } = await harness();
  await seed(ctx, me);
  let restore = breakDelete(ctx, 'adult_health_records');
  const refused = await ctx.adultDeleteTypedReading(me, 'typed-a-me');
  assert.equal(refused.ok, false);
  assert.match(String(refused.error && refused.error.message), /Nothing was deleted/);
  assert.ok(db.adult_health_records.some(r => r.id === 'typed-a-me'));
  restore();
  restore = breakDelete(ctx, 'adult_nutrition_days', { code: '42501', message: 'permission denied' });
  const failed = await ctx.adultDeleteNutritionDay(me, 'day-1-me');
  assert.equal(json([failed.ok, failed.error.code]), json([false, '42501']));
  restore();
});

test("a logged day and the food preferences are deleted for this parent only", async () => {
  const { ctx, db, me } = await harness();
  await seed(ctx, me); await seed(ctx, OTHER);
  const days = await ctx.adultLoggedDays(me);
  assert.equal(json(days.data.map(d => [d.logged_on, ctx.adultLoggedDayText(d)])),
    json([['2026-09-15', '2 meals with a protein food · 1 meal following the plate guide'], ['2026-09-14', '1 meal with a protein food']]));
  assert.equal(json(await ctx.adultDeleteNutritionDay(me, 'day-2-me')), json({ ok: true, deleted: 1 }));
  await ctx.adultDeleteNutritionDay(me, 'day-2-other');
  assert.equal(json(db.adult_nutrition_days.map(d => d.id).sort()), json(['day-1-me', 'day-1-other', 'day-2-other']));

  assert.equal(json(await ctx.adultDeletePreferences(me)), json({ ok: true, deleted: 1 }));
  assert.equal(json(db.adult_nutrition_preferences.map(p => p.guardian_id)), json([OTHER]));
  assert.equal(json(held(db, me).adult_recipes), '1', 'recipes, planned meals and logged days stay');
});

test('the whole record goes, with the imported body composition results, and a count proves it; another guardian and the allowlist are untouched', async () => {
  const { ctx, db, me } = await harness();
  await seed(ctx, me); await seed(ctx, OTHER);
  const before = await ctx.adultRecordCounts(me);
  assert.equal(json(before.counts), json({ adult_workout_logs: 1, adult_schedule_exercises: 2, adult_schedule_items: 1, adult_goals: 1, adult_health_records: 3,
    adult_health_import_batches: 1, adult_profiles: 1, adult_meal_plan_items: 1, adult_recipes: 1, adult_nutrition_days: 2, adult_nutrition_preferences: 1, composition: 1 }));
  assert.equal(json(ctx.adultRecordLines(before.counts)), json([
    'Your training profile: units, where you started and your weekly aims', '1 goal', '1 workout on your schedule, with its exercises',
    '1 workout ticked off', '3 readings, typed in or imported', '1 import', '1 imported body composition result',
    'Your food preferences, the allergens you avoid and your daily aims', '1 recipe', '1 planned meal', '2 days of eating habits logged']));
  const otherBefore = held(db, OTHER);

  assert.equal(json(await ctx.adultDeleteRecord(me)), json({ ok: true }));
  assert.equal(json(Object.values(held(db, me))), json(TABLES.map(() => 0)));
  assert.equal(json(held(db, OTHER)), json(otherBefore));
  assert.equal(json(db.external_composition_attachments.map(a => a.record_uuid)), json([COMP_OTHER]), 'an attachment row goes with its result');
  assert.equal(db.adult_training_access.length, 1, "the allowlist entry is the operator's, and access stays");
  assert.equal(total(ctx, (await ctx.adultRecordCounts(me)).counts), 0);
  assert.equal(json(await ctx.adultDeleteRecord(me)), json({ ok: true }), 'deleting an empty record is done');
});

test('a part that will not delete does not stop the rest, and is named afterwards; deleting again finishes', async () => {
  const { ctx, db, me } = await harness();
  await seed(ctx, me);
  const restore = breakDelete(ctx, 'adult_recipes', { code: '42501', message: 'permission denied' });
  const realStore = ctx.adultCompositionStore;
  ctx.adultCompositionStore = async () => ({ store: { remove: async () => { throw new Error('Direct deletion from storage tables is not allowed.'); } } });
  const partial = await ctx.adultDeleteRecord(me);
  assert.equal(partial.ok, false);
  assert.equal(partial.left, 2);
  assert.equal(json(ctx.adultRecordLines(partial.counts)), json(['1 imported body composition result', '1 recipe']));
  assert.match(partial.error.message, /Direct deletion/, 'the first failure is the one reported');
  assert.equal(held(db, me).adult_profiles, 0, 'everything else went');
  restore(); ctx.adultCompositionStore = realStore;
  assert.equal(json(await ctx.adultDeleteRecord(me)), json({ ok: true }));
  assert.equal(json(Object.values(held(db, me))), json(TABLES.map(() => 0)));
});

test('a database the Adult Training migrations have not reached has nothing to delete, and says so without failing', async () => {
  const { ctx, me } = await harness('?scenario=family');
  const counts = await ctx.adultRecordCounts(me);
  assert.equal(counts.error, undefined);
  assert.equal(total(ctx, counts.counts), 0);
  assert.equal(json(await ctx.adultDeleteRecord(me)), json({ ok: true }));
});

test('Readings you typed in: each Delete asks first, deletes that reading, reads the list again and keeps focus in the sheet', async () => {
  const { ctx, ui, sheets, db, me } = await harness();
  await seed(ctx, me);
  await ctx.openAdultTypedReadings();
  const { card } = sheets.last();
  assert.match(card.html, /^<div class="grab"><\/div><h3 id="sheetTitle1">Readings you typed in<\/h3>/, 'the dialog keeps its name');
  assert.equal(json([...card.html.matchAll(/data-adult-reading-delete="([^"]+)"/g)].map(m => m[1])), json(['typed-a-me', 'typed-b-me']));
  assert.match(card.html, /Readings from an import are removed with their import, in Your imports\./);
  assert.match(card.html, /aria-label="Delete Weight, 180\.4 lb, 2026-09-13"/);

  ui.answer = false;
  await card.querySelectorAll('[data-adult-reading-delete]')[0].onclick();
  assert.equal(json(ui.confirms), json(['Delete this reading: Weight, 180.4 lb on 2026-09-13? This cannot be undone.']));
  assert.equal(db.adult_health_records.filter(r => r.guardian_id === me).length, 3, 'cancelled, nothing deleted');

  ui.answer = true;
  await card.querySelectorAll('[data-adult-reading-delete]')[0].onclick();
  assert.ok(!db.adult_health_records.some(r => r.id === 'typed-a-me'));
  assert.equal(json([...card.html.matchAll(/data-adult-reading-delete="([^"]+)"/g)].map(m => m[1])), json(['typed-b-me']), 'read again from the database');
  assert.equal(json([ui.toasts, ui.renders, card.focused]), json([['Reading deleted'], ['adult'], true]));

  const restore = breakDelete(ctx, 'adult_health_records', { code: '42501', message: 'permission denied' });
  await card.querySelectorAll('[data-adult-reading-delete]')[0].onclick();
  assert.equal(json(ui.failures), json([['adult:readingDelete', 'Could not delete that reading']]));
  assert.match(card.html, /data-adult-reading-delete="typed-b-me"/, 'still listed, because it is still there');
  restore();
});

test('Delete your training record asks for DELETE, deletes, and names what stays if anything does', async () => {
  const { ctx, ui, sheets, db, me } = await harness();
  await seed(ctx, me);
  await ctx.openAdultDeleteRecord();
  let { bg, card } = sheets.last();
  assert.match(card.html, /<h3 id="sheetTitle1">Delete your training record\?<\/h3>/);
  assert.match(card.html, /<li>1 imported body composition result<\/li>/);
  assert.match(card.html, /Your account stays, and so do your children's profiles and everything in them\./);
  assert.match(card.html, /<label for="adDelWord">Type DELETE to confirm<\/label>/);

  card.querySelector('#adDelWord').value = 'delete it';
  await card.querySelector('#adDelGo').onclick();
  assert.equal(card.querySelector('#adDelErr').textContent, 'Type DELETE to confirm.');
  assert.equal(held(db, me).adult_profiles, 1, 'nothing deleted without the word');

  const restore = breakDelete(ctx, 'adult_recipes', { code: '42501', message: 'permission denied' });
  card.querySelector('#adDelWord').value = ' delete ';
  await card.querySelector('#adDelGo').onclick();
  assert.equal(card.querySelector('#adDelErr').textContent, 'These are still here: 1 recipe. Try again, and if they stay, email support@playbookbp.com.');
  assert.equal(json([card.querySelector('#adDelGo').disabled, card.querySelector('#adDelGo').textContent, bg.removed]), json([false, 'Delete my training record', false]));
  assert.equal(json(ui.renders), json(['adult']), 'the screen behind shows what is left');
  restore();

  await card.querySelector('#adDelGo').onclick();
  assert.equal(json([bg.removed, ui.toasts, ui.renders, ctx.state.adultSection]), json([true, ['Your training record is deleted'], ['adult', 'adult'], 'training']));
  assert.equal(json(Object.values(held(db, me))), json(TABLES.map(() => 0)));

  await ctx.openAdultDeleteRecord();
  ({ card } = sheets.last());
  assert.match(card.html, /There's nothing in your training record to delete\./);
  assert.equal(card.querySelector('#adDelGo'), null);
  card.querySelector('#adDelNo').onclick();
  assert.equal(sheets.last().bg.removed, true);
});

test('the food preferences sheet offers Delete only when there are preferences, and says the allergen flags go with them', async () => {
  const src = read('js/screen-adult-eating.js');
  const run = async prefs => {
    const sheets = fakeSheets(), ui = { confirms: [], toasts: [], renders: [], deleted: [] };
    const open = new Function(...Object.keys(stubs()), extract(src, 'function openAdultPreferences(prefs){') + '\nreturn openAdultPreferences;')(...Object.values(stubs()));
    function stubs() {
      return {
        H: (strings, ...v) => strings.reduce((a, s, i) => a + s + (v[i] ?? ''), ''), esc: s => String(s ?? ''), sheet: sheets.sheet,
        adultOptions: () => '', adultChips: () => '', bindAdultChips: () => {}, adultChipValues: () => [], adultValidatePreferences: () => ({ ok: false }),
        ADULT_EATING_PATTERNS: {}, ADULT_ALLERGENS: {}, ADULT_BUDGETS: {}, ADULT_COOK_TIMES: [], sb: {}, state: { user: { id: 'u1' } },
        adultFail: () => {}, toast: m => ui.toasts.push(m), renderApp: t => ui.renders.push(t), confirm: m => { ui.confirms.push(m); return true; },
        adultDeletePreferences: async uid => { ui.deleted.push(uid); return { ok: true, deleted: 1 }; },
      };
    }
    open(prefs);
    const { bg, card } = sheets.last();
    if (card.querySelector('#anPrefDelete')) await card.querySelector('#anPrefDelete').onclick({ currentTarget: card.querySelector('#anPrefDelete') });
    return { bg, card, ui };
  };
  const none = await run(null);
  assert.doesNotMatch(none.card.html, /anPrefDelete/);
  const some = await run({ avoid_allergens: ['peanuts'] });
  assert.match(some.card.html, /<button class="btn danger" id="anPrefDelete" style="margin-top:12px">Delete your preferences<\/button>/);
  assert.match(some.ui.confirms[0], /Recipes and planned meals will no longer be flagged for allergens you avoid\. Your recipes, planned meals and logged days stay\./);
  assert.equal(json([some.ui.deleted, some.bg.removed, some.ui.toasts, some.ui.renders]), json([['u1'], true, ['Preferences deleted'], ['adult']]));
});

// Source-text assertions: how the controls are reached, and what the policy pages say. Documentation, held in place.
test('source: Your training counts only typed-in readings, lists logged days, and offers the whole record at the foot of both halves', () => {
  const training = read('js/screen-adult.js');
  assert.match(training, /sb\.from\('adult_health_records'\)\.select\('id', \{ count:'exact', head:true \}\)\.eq\('guardian_id', uid\)\.eq\('source_kind', 'manual'\),/);
  assert.match(training, /\$\{typed \? H`<button class="btn sm ghost" id="adultTypedReadings" style="margin-top:10px">Readings you typed in \(\$\{typed\}\)<\/button>` : ''\}/);
  assert.match(training, /\{ const b = \$\("#adultTypedReadings"\); if \(b\) b\.onclick = \(\) => openAdultTypedReadings\(\); \}/);
  assert.match(extract(training, 'function bindAdultChrome(){'), /\{ const b = \$\("#adultDeleteRecord"\); if \(b\) b\.onclick = \(\) => openAdultDeleteRecord\(\); \}/);
  const eating = read('js/screen-adult-eating.js');
  assert.match(eating, /sb\.from\('adult_nutrition_days'\)\.select\('id', \{ count:'exact', head:true \}\)\.eq\('guardian_id', uid\),/);
  assert.match(eating, /\{ const b = \$\("#adultLoggedDays"\); if \(b\) b\.onclick = \(\) => openAdultLoggedDays\(\); \}/);
  for (const [name, src] of [['training', training], ['eating', eating]])
    assert.match(src, /\$\{typeof adultRecordFooter === 'function' \? adultRecordFooter\(\) : ''\}\n    <\/div>`;/, name);

  const deletion = read('js/adult-deletion.js');
  assert.doesNotMatch(deletion, /state\.active|athlete_id(?!', null)/, 'never reads a child');
  for (const q of deletion.matchAll(/sb\.from\([^)]*\)\.delete\(\)[^;\n]*/g)) assert.match(q[0], /guardian_id/, q[0]);
  assert.equal((deletion.match(/if \(adultTrainingOff\(\)\) return;/g) || []).length, 2, 'both ways into a deleting sheet keep the gate');

  const index = read('index.html');
  const at = name => index.indexOf('<script src="/js/' + name + '"></script>');
  assert.ok(at('adult-composition.js') < at('adult-deletion.js') && at('adult-progress.js') < at('adult-deletion.js') && at('adult-deletion.js') < at('init.js'));
  assert.match(read('sw.js'), /'\/js\/adult-progress\.js','\/js\/adult-deletion\.js','\/js\/bluetooth-equipment\.js',/);
  const account = extract(read('js/sheets.js'), 'function confirmDeleteAccount(){');
  assert.match(account, /\$\{adultTrainingOn\(\)\?'<li>Your own training record<\/li>':''\}/);
  assert.match(account, /Only want to stop using Your training\? Delete your training record at the foot of Your training instead, and keep your account\./);
});

test('source: the privacy and data deletion pages say how to delete the training record, or part of it, without the account', () => {
  const privacy = read('privacy.html');
  assert.match(privacy, /<li><b>Delete your own training record, or part of it<\/b> — in the app, in Your training, without deleting your account\./);
  assert.match(privacy, /<b>Delete your training record<\/b>, at the foot of Your training, permanently removes all of it:/);
  const deletion = read('datadeletion.html');
  assert.match(deletion, /<h2 id="training">Delete your own training record<\/h2>/);
  for (const phrase of ['<b>Readings you typed in</b>', '<b>Your imports</b> and choose <b>Undo</b>', '<b>Days you logged</b>', '<b>Delete your preferences</b>', '<b>Delete your training record</b>, type DELETE and confirm'])
    assert.ok(deletion.includes(phrase), phrase);
  assert.ok(deletion.indexOf('id="training"') < deletion.indexOf('<h2>Delete your entire account</h2>'));
  // Reports go through the Storage API before their result (20260915200000), so the pages may say so.
  assert.match(deletion, /A report you attached to it, such as a scan printout, is deleted first, from storage itself\./);
  assert.match(deletion + privacy, /imported body composition results and any reports attached to them/);
});
