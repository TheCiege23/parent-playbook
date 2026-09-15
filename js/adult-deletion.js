// ===================================================================
//  YOUR TRAINING → DELETING WHAT YOU RECORDED
// ===================================================================
// A parent could already remove goals, workouts, ticks, exercises, planned meals, recipes and whole imports, but not a
// reading they typed in, a day of eating habits, their food preferences or their training profile: short of deleting the
// account, those stayed. Found by a signed-in regression against production on 2026-09-15. This adds:
//
//   - one typed-in reading, from Progress → Readings you typed in. A reading cannot be edited, so a correction is a
//     delete and a new reading. Imported readings are not offered one at a time: they go with their import, from Your
//     imports, so an import is never left partly deleted;
//   - one day of eating habits, from Eating → Days you logged;
//   - the food preferences, from their own sheet (js/screen-adult-eating.js);
//   - the whole record, from the foot of either half: everything delete-account removes for Adult Training except the
//     allowlist entry, which is the operator's. The account, the children's profiles and access to Your training stay.
//
// Row-level security already lets the guardian delete each of these rows (20260914120000, 20260914130000,
// 20260914140000), so there is no migration. Every delete is also filtered by guardian, so an account that can read more
// than its own rows deletes only its own, and a delete is not reported as done while the rows are still there.

// Children before the rows they reference, in the order supabase/functions/delete-account/handler.mjs deletes them. A
// test holds the two lists together.
const ADULT_RECORD_TABLES = Object.freeze([
  'adult_workout_logs', 'adult_schedule_exercises', 'adult_schedule_items',
  'adult_goals', 'adult_health_records', 'adult_health_import_batches', 'adult_profiles',
  'adult_meal_plan_items', 'adult_recipes', 'adult_nutrition_days', 'adult_nutrition_preferences',
]);

// A database the Adult Training migrations have not reached has none of these tables: nothing to delete, not a failure,
// as delete-account treats it.
const adultTableMissing = error => !!error && (error.code === 'PGRST205' || error.code === '42P01');
const adultPlural = (n, one, many) => n + ' ' + (Number(n) === 1 ? one : many);

// Deletes the rows matching every column in match and says whether they are gone. A delete that returns no rows is read
// back: gone already (another tab got there first) is done; still there is not.
async function adultDeleteMatching(table, match){
  const filtered = query => Object.entries(match).reduce((q, [column, value]) => q.eq(column, value), query);
  const { data, error } = await filtered(sb.from(table).delete()).select('guardian_id');
  if (error) return { ok:false, error };
  if (Array.isArray(data) && data.length) return { ok:true, deleted:data.length };
  const again = await filtered(sb.from(table).select('guardian_id')).limit(1);
  if (again.error) return { ok:false, error:again.error };
  return (again.data || []).length ? { ok:false, error:new Error('Nothing was deleted from ' + table) } : { ok:true, deleted:0 };
}

// Only a reading typed in: an imported one's id deletes nothing here.
function adultDeleteTypedReading(uid, id){ return adultDeleteMatching('adult_health_records', { id, guardian_id:uid, source_kind:'manual' }); }
function adultDeleteNutritionDay(uid, id){ return adultDeleteMatching('adult_nutrition_days', { id, guardian_id:uid }); }
function adultDeletePreferences(uid){ return adultDeleteMatching('adult_nutrition_preferences', { guardian_id:uid }); }

// The parent's own imported body composition results, as Your training lists them (guardian, subject self, no athlete).
async function adultCompositionIds(uid){
  if (typeof adultCompositionRows !== 'function') return { ids:[] };
  try {
    const { data, error } = await adultCompositionRows(uid);
    if (error) return adultTableMissing(error) ? { ids:[] } : { error };
    return { ids:(data || []).map(r => r.id) };
  } catch (e) { return { error:e }; }
}

// How much the record holds, table by table, with the imported body composition results under 'composition'. The
// same count checks a whole-record delete afterwards.
async function adultRecordCounts(uid){
  const results = await Promise.all(ADULT_RECORD_TABLES.map(t => sb.from(t).select('guardian_id', { count:'exact', head:true }).eq('guardian_id', uid)));
  const counts = {};
  for (const [i, table] of ADULT_RECORD_TABLES.entries()) {
    const r = results[i];
    if (r.error && !adultTableMissing(r.error)) return { error:r.error };
    if (!r.error && typeof r.count !== 'number') return { error:new Error('No count for ' + table) };
    counts[table] = r.error ? 0 : r.count;
  }
  const composition = await adultCompositionIds(uid);
  if (composition.error) return { error:composition.error };
  counts.composition = composition.ids.length;
  return { counts };
}
const adultRecordTotal = counts => Object.values(counts || {}).reduce((n, c) => n + (Number(c) || 0), 0);

// What a whole-record delete takes, in the parent's words. Exercises go with their workouts and are not counted apart.
function adultRecordLines(c){
  return [
    c.adult_profiles ? 'Your training profile: units, where you started and your weekly aims' : '',
    c.adult_goals ? adultPlural(c.adult_goals, 'goal', 'goals') : '',
    c.adult_schedule_items ? adultPlural(c.adult_schedule_items, 'workout', 'workouts') + ' on your schedule, with ' + (c.adult_schedule_items === 1 ? 'its' : 'their') + ' exercises' : '',
    c.adult_workout_logs ? adultPlural(c.adult_workout_logs, 'workout', 'workouts') + ' ticked off' : '',
    c.adult_health_records ? adultPlural(c.adult_health_records, 'reading', 'readings') + ', typed in or imported' : '',
    c.adult_health_import_batches ? adultPlural(c.adult_health_import_batches, 'import', 'imports') : '',
    c.composition ? adultPlural(c.composition, 'imported body composition result', 'imported body composition results') : '',
    c.adult_nutrition_preferences ? 'Your food preferences, the allergens you avoid and your daily aims' : '',
    c.adult_recipes ? adultPlural(c.adult_recipes, 'recipe', 'recipes') : '',
    c.adult_meal_plan_items ? adultPlural(c.adult_meal_plan_items, 'planned meal', 'planned meals') : '',
    c.adult_nutrition_days ? adultPlural(c.adult_nutrition_days, 'day', 'days') + ' of eating habits logged' : '',
  ].filter(Boolean);
}

// Everything in Your training, then a count to prove it. Imported body composition results go one at a time through the
// same store a single result's Delete uses. Nothing stops at the first failure: the parent asked for all of it to go, so
// every part is tried, and what the count still finds is named rather than hidden. Deleting again only touches what is
// left. (A result with a report attached cannot be deleted in production today: the report's purge trigger deletes
// from storage.objects directly, which Supabase's storage.protect_delete refuses. Its count then says it is still here.)
async function adultDeleteRecord(uid){
  let failure = null;
  const composition = await adultCompositionIds(uid);
  if (composition.error) failure = composition.error;
  else if (composition.ids.length) {
    try {
      const { store } = await adultCompositionStore();
      for (const id of composition.ids) {
        try { await store.remove(id); } catch (e) { failure = failure || e; }
      }
    } catch (e) { failure = failure || e; }
  }
  for (const table of ADULT_RECORD_TABLES) {
    const { error } = await sb.from(table).delete().eq('guardian_id', uid);
    if (error && !adultTableMissing(error)) failure = failure || error;
  }
  const after = await adultRecordCounts(uid);
  if (after.error) return { ok:false, error:failure || after.error };
  const left = adultRecordTotal(after.counts);
  if (!left) return { ok:true };
  return { ok:false, left, counts:after.counts, error:failure || new Error(left + ' rows of the training record are still there') };
}

// Rows a page at a time, newest first: the API returns at most 1000 to a request.
async function adultPagedRows(build){
  const PAGE = 1000, rows = [];
  for (let page = 0; page < 20; page++) {
    const r = await build().range(page * PAGE, page * PAGE + PAGE - 1);
    if (r.error) return { data:null, error:r.error };
    rows.push(...(r.data || []));
    if (!r.data || r.data.length < PAGE) break;
  }
  return { data:rows, error:null };
}
function adultTypedReadings(uid){
  return adultPagedRows(() => sb.from('adult_health_records').select('id,metric_key,value,unit,measured_on,created_at')
    .eq('guardian_id', uid).eq('source_kind', 'manual').order('measured_on', { ascending:false }).order('created_at', { ascending:false }).order('id'));
}
function adultLoggedDays(uid){
  return adultPagedRows(() => sb.from('adult_nutrition_days').select('id,logged_on,protein_meals,plate_meals')
    .eq('guardian_id', uid).order('logged_on', { ascending:false }).order('id'));
}

function adultReadingText(r){
  const meta = ADULT_HEALTH_METRICS[r.metric_key];
  return (meta ? meta.label : r.metric_key) + ', ' + String(Number(r.value)) + ' ' + r.unit;
}
function adultLoggedDayText(d){
  return [
    d.protein_meals != null ? adultPlural(d.protein_meals, 'meal', 'meals') + ' with a protein food' : '',
    d.plate_meals != null ? adultPlural(d.plate_meals, 'meal', 'meals') + ' following the plate guide' : '',
  ].filter(Boolean).join(' · ');
}

function adultTypedReadingsMarkup(rows){
  return H`<h3>Readings you typed in</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">A reading can't be changed, so to correct one, delete it and record it again. Readings from an import are removed with their import, in Your imports.</p>
    ${rows.length ? H`<div class="card app-pad">${rows.map(r => H`<div class="mrow">
        <span><b>${esc(adultReadingText(r))}</b><small>${esc(fmtDate(r.measured_on))}</small></span>
        <button class="btn sm ghost" data-adult-reading-delete="${esc(r.id)}" aria-label="${esc('Delete ' + adultReadingText(r) + ', ' + fmtDate(r.measured_on))}">Delete</button></div>`).join('')}</div>`
      : H`<p class="empty">No readings you typed in.</p>`}`;
}
function adultLoggedDaysMarkup(rows){
  return H`<h3>Days you logged</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">Each day's eating habits. Delete a day you logged by mistake; today's you can also change with Log today.</p>
    ${rows.length ? H`<div class="card app-pad">${rows.map(d => H`<div class="mrow">
        <span><b>${esc(fmtDate(d.logged_on))}</b><small>${esc(adultLoggedDayText(d))}</small></span>
        <button class="btn sm ghost" data-adult-day-delete="${esc(d.id)}" aria-label="${esc('Delete what you logged for ' + fmtDate(d.logged_on))}">Delete</button></div>`).join('')}</div>`
      : H`<p class="empty">No days logged.</p>`}`;
}

// The sheets write their content in after loading. The dialog is named by its heading's id, as in js/adult-progress.js,
// so what is written in later keeps that id and the dialog keeps its name.
function adultSheetWriter(bg){
  const card = bg.querySelector('.sheet');
  const titleId = card.getAttribute('aria-labelledby');
  return html => { card.innerHTML = '<div class="grab"></div>' + (titleId ? html.replace('<h3>', '<h3 id="' + titleId + '">') : html); return card; };
}

// A list with a Delete on each row. After each delete the list is read again, so it shows what the database holds, and
// focus returns to the sheet rather than to a button that no longer exists.
async function adultDeleteList({ title, unavailable, load, markup, attr, describe, remove, where, failed, done }){
  if (adultTrainingOff()) return;
  const uid = state.user.id;
  const bg = sheet(H`<h3>${esc(title)}</h3><p class="muted-note" role="status">Loading…</p>`);
  const write = adultSheetWriter(bg);
  const paint = async () => {
    const { data, error } = await load(uid);
    if (error) { console.error(error); return write(H`<h3>${esc(title)}</h3><p class="empty">${esc(unavailable)}</p>`); }
    const card = write(markup(data));
    card.querySelectorAll('[' + attr + ']').forEach(btn => btn.onclick = async () => {
      const row = data.find(r => r.id === btn.getAttribute(attr)); if (!row) return;
      if (!confirm(describe(row))) return;
      btn.disabled = true;
      const result = await remove(uid, row.id);
      if (result.ok) toast(done); else adultFail(result.error, where, failed);
      (await paint()).focus();
      renderApp('adult');
    });
    return card;
  };
  await paint();
}

function openAdultTypedReadings(){
  return adultDeleteList({
    title:'Readings you typed in', unavailable:'Your readings aren’t available on this account yet.',
    load:adultTypedReadings, markup:adultTypedReadingsMarkup, attr:'data-adult-reading-delete',
    describe:r => 'Delete this reading: ' + adultReadingText(r) + ' on ' + fmtDate(r.measured_on) + '? This cannot be undone.',
    remove:adultDeleteTypedReading, where:'adult:readingDelete', failed:'Could not delete that reading', done:'Reading deleted',
  });
}
function openAdultLoggedDays(){
  return adultDeleteList({
    title:'Days you logged', unavailable:'Your eating habits aren’t available on this account yet.',
    load:adultLoggedDays, markup:adultLoggedDaysMarkup, attr:'data-adult-day-delete',
    describe:d => 'Delete what you logged for ' + fmtDate(d.logged_on) + '? This cannot be undone.',
    remove:adultDeleteNutritionDay, where:'adult:dayDelete', failed:'Could not delete that day', done:'Day deleted',
  });
}

// The foot of both halves of Your training, bound by bindAdultChrome().
function adultRecordFooter(){
  return H`<div class="card app-pad" style="margin-top:16px">
      <div class="mrow" style="border:none;padding:0;align-items:center;gap:12px">
        <span><b>Delete your training record</b><small>Everything in Your training, Training and Eating. Your account and your children's profiles stay.</small></span>
        <button class="btn sm danger" id="adultDeleteRecord">Delete…</button>
      </div>
    </div>`;
}

async function openAdultDeleteRecord(){
  if (adultTrainingOff()) return;
  const uid = state.user.id;
  const title = 'Delete your training record?';
  const bg = sheet(H`<h3>${title}</h3><p class="muted-note" role="status">Checking what it holds…</p>`);
  const write = adultSheetWriter(bg);
  const found = await adultRecordCounts(uid);
  if (found.error) {
    console.error(found.error);
    write(H`<h3>${title}</h3><p class="empty">Your training record isn’t available on this account yet.</p><button class="btn ghost" id="adDelNo">Close</button>`)
      .querySelector('#adDelNo').onclick = () => bg.remove();
    return;
  }
  const lines = adultRecordLines(found.counts);
  const card = write(adultRecordTotal(found.counts) ? H`<h3>${title}</h3>
      <p style="color:var(--muted);font-size:14px;margin:8px 0 12px;line-height:1.55">This permanently deletes everything in Your training:</p>
      <ul style="margin:0 0 14px;padding-left:20px;font-size:13.5px;line-height:1.7;color:var(--ink)">${lines.map(l => H`<li>${esc(l)}</li>`).join('')}</ul>
      <p style="color:var(--muted);font-size:13px;margin:0 0 14px;line-height:1.55">Your account stays, and so do your children's profiles and everything in them. You can start a new training record later. There is no undo.</p>
      <div class="field"><label for="adDelWord">Type DELETE to confirm</label><input id="adDelWord" autocapitalize="characters" autocomplete="off" placeholder="DELETE"/></div>
      <div class="err" id="adDelErr"></div>
      <button class="btn danger" id="adDelGo" style="margin-bottom:10px">Delete my training record</button>
      <button class="btn ghost" id="adDelNo">Keep it</button>`
    : H`<h3>${title}</h3><p class="empty">There's nothing in your training record to delete.</p><button class="btn ghost" id="adDelNo">Close</button>`);
  card.querySelector('#adDelNo').onclick = () => bg.remove();
  const go = card.querySelector('#adDelGo');
  if (!go) return;
  go.onclick = async () => {
    const err = card.querySelector('#adDelErr'); err.textContent = '';
    if ((card.querySelector('#adDelWord').value || '').trim().toUpperCase() !== 'DELETE') { err.textContent = 'Type DELETE to confirm.'; return; }
    go.disabled = true; go.innerHTML = '<span class="spinner" role="status" aria-label="Deleting"></span>';
    const result = await adultDeleteRecord(uid);
    if (!result.ok) {
      console.error(result.error);
      if (typeof reportError === 'function') reportError(result.error, 'adult:recordDelete');
      err.textContent = result.left
        ? 'These are still here: ' + adultRecordLines(result.counts).join('; ') + '. Try again, and if they stay, email support@playbookbp.com.'
        : 'Could not finish deleting your training record. Try again.';
      go.textContent = 'Delete my training record'; go.disabled = false;
      renderApp('adult');
      return;
    }
    bg.remove(); toast('Your training record is deleted'); state.adultSection = 'training'; renderApp('adult');
  };
}
