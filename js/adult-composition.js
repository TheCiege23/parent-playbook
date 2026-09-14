// ===================================================================
//  YOUR TRAINING → BODY COMPOSITION MEASURED ELSEWHERE
// ===================================================================
// A parent's own results from a DXA scan, a clinic's bioimpedance analyser, a smart scale, a health app or a report
// they type in. They go through the same provider-neutral import a child's result does (js/composition-import-ui.js,
// js/composition-import-supabase.mjs, public.external_composition_records), as an adult reference about the signed-in
// guardian: subject 'self', no athlete, and never shared with an organization from here. The database lets only that
// guardian write or read such a row.
//
// Parent Playbook produces none of these numbers. Every value is shown with what obtained it, measured or a device
// estimate, and a change is only ever worked out against an earlier value from the same kind of source with the same
// status: a smart scale's estimate is never compared with a DXA measurement. Weight from these imports stays with
// the import (the weight trend comes from the health record), and the arithmetic index is not shown in Your training.

const ADULT_COMPOSITION_SUBJECT = 'self';
const ADULT_COMPOSITION_HIDDEN = Object.freeze(['weight_kg', 'bmi']);
const ADULT_COMPOSITION_STATUS = Object.freeze({ measured:'Measured', device_estimated:'Device estimate', calculated:'Calculated' });
const ADULT_COMPOSITION_UNIT = Object.freeze({ percent:'%', kg:'kg', index:'', kg_m2:'kg/m²' });

// The newest value of each quantity, with the change since the previous value from the same kind of source, with the
// same status and unit.
function adultCompositionLatest(rows){
  const readings = [];
  (rows || []).forEach(row => {
    const record = row && row.record;
    if (!record || record.schema !== 'PP_BODY_COMPOSITION_REFERENCE_V1' || !Array.isArray(record.outputs)) return;
    record.outputs.forEach(o => {
      if (!o || ADULT_COMPOSITION_HIDDEN.includes(o.key) || typeof o.status !== 'string' || !Object.hasOwn(ADULT_COMPOSITION_STATUS, o.status)) return;
      if (!Number.isFinite(Number(o.value))) return;
      readings.push({
        key:o.key, label:o.label, value:Number(o.value), unit:o.unit, status:o.status,
        sourceClass:record.sourceClass, sourceLabel:record.sourceLabel, measuredAt:record.measuredAt, rowId:row.id,
      });
    });
  });
  readings.sort((a, b) => String(b.measuredAt).localeCompare(String(a.measuredAt)));
  const latest = new Map();
  readings.forEach(r => { if (!latest.has(r.key)) latest.set(r.key, r); });
  return [...latest.values()].map(r => {
    const previous = readings.find(p => p !== r && p.key === r.key && p.sourceClass === r.sourceClass && p.status === r.status
      && p.unit === r.unit && String(p.measuredAt) < String(r.measuredAt)) || null;
    return { ...r, statusLabel:ADULT_COMPOSITION_STATUS[r.status], previous,
      change:previous ? Math.round((r.value - previous.value) * 10) / 10 : null };
  });
}

function adultCompositionValue(r){
  const unit = Object.hasOwn(ADULT_COMPOSITION_UNIT, r.unit) ? ADULT_COMPOSITION_UNIT[r.unit] : r.unit;
  return String(r.value) + (unit === '%' ? '%' : unit ? ' ' + unit : '');
}

function adultCompositionMarkup(latest){
  return H`<div class="k-mono" style="margin-top:12px">Body composition, measured elsewhere</div>
    ${latest.length ? latest.map(r => H`<div class="mrow"><span><b>${esc(r.label)}</b><small>${esc(r.statusLabel)} · ${esc(r.sourceLabel)} · ${esc(fmtDate(localDay(new Date(r.measuredAt))))}${r.change != null
        ? ' · ' + (r.change > 0 ? '+' : '') + esc(String(r.change)) + ' since the previous ' + esc(String(r.sourceLabel).toLowerCase()) + ' result' : ''}</small></span>
      <b>${esc(adultCompositionValue(r))}</b></div>`).join('')
      : H`<p class="muted-note" style="margin:6px 0 0">You can import results from a DXA scan, a clinic, a smart scale or a health app. Parent Playbook doesn't produce these numbers; each one is shown as measured or as a device estimate.</p>`}
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="btn sm ghost" id="adultCompImport">Import a result</button>
      ${latest.length ? '<button class="btn sm ghost" id="adultCompManage">Your results</button>' : ''}
    </div>`;
}

// The signed-in guardian's own results about themselves. Filtered by guardian as well as subject, so an account that
// can read more than its own rows (a platform administrator) still sees only its own here.
function adultCompositionRows(uid){
  return sb.from('external_composition_records').select('id,record_id,measured_at,source_class,record')
    .eq('guardian_id', uid).eq('subject_scope', 'adult_reference').eq('subject_reference', ADULT_COMPOSITION_SUBJECT).is('athlete_id', null)
    .order('measured_at', { ascending:false }).limit(400);
}

// Painted after the rest of Your training. A database without the table, or a failed read, leaves it out rather than
// taking the screen down.
async function adultCompositionSection(slot){
  if (!slot || !state.user) return;
  let rows = [];
  try {
    const { data, error } = await adultCompositionRows(state.user.id);
    if (error) { console.error(error); return; }
    rows = data || [];
  } catch (e) { console.error(e); return; }
  slot.innerHTML = adultCompositionMarkup(adultCompositionLatest(rows));
  { const b = slot.querySelector('#adultCompImport'); if (b) b.onclick = () => openAdultCompositionImport(); }
  { const b = slot.querySelector('#adultCompManage'); if (b) b.onclick = () => openAdultCompositionResults(rows); }
}

async function adultCompositionStore(){
  const { createExternalCompositionStore, summarizeSave } = await import('/js/composition-import-supabase.mjs');
  return { store:createExternalCompositionStore(sb, { scope:'adult_reference', subjectReference:ADULT_COMPOSITION_SUBJECT }), summarizeSave };
}

async function openAdultCompositionImport(){
  try {
    const { store, summarizeSave } = await adultCompositionStore();
    await openCompositionImport({
      subjectId:ADULT_COMPOSITION_SUBJECT, scope:'adult_reference', athleteId:null,
      actorId:state.user.id, consentReference:'adult-self-import',
      save:async records => summarizeSave(await store.save(records)),
      attach:(recordUuid, file) => store.attachReport(recordUuid, file),
      onDone:() => renderApp('adult'),
    });
  } catch (e) { adultFail(e, 'adult:compositionImport', 'Could not open the import'); }
}

function openAdultCompositionResults(rows){
  const bg = sheet(H`<h3>Your imported results</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">Each import, and what obtained each number in it.</p>
    <div class="card app-pad">${(rows || []).map(row => { const rec = row.record || {};
      const shown = (rec.outputs || []).filter(o => !ADULT_COMPOSITION_HIDDEN.includes(o.key))
        .map(o => o.label + ' (' + String(ADULT_COMPOSITION_STATUS[o.status] || o.status).toLowerCase() + ')').join(', ');
      return H`<div class="mrow"><span><b>${esc(rec.sourceLabel || row.source_class)}</b><small>${esc(fmtDate(localDay(new Date(row.measured_at))))} · ${esc(shown || 'Weight only')}</small></span>
        <button class="btn sm ghost" data-adult-comp-delete="${esc(row.id)}">Delete</button></div>`; }).join('')}</div>`);
  bg.querySelectorAll('[data-adult-comp-delete]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Delete this imported result? This cannot be undone.')) return;
    btn.disabled = true;
    try {
      const { store } = await adultCompositionStore();
      if (!(await store.remove(btn.dataset.adultCompDelete))) throw new Error('Nothing was deleted');
      bg.remove(); toast('Result deleted'); renderApp('adult');
    } catch (e) { adultFail(e, 'adult:compositionDelete', 'Could not delete that result'); btn.disabled = false; }
  });
}

// For "Export everything": the parent's own imported results.
async function adultCompositionExport(uid){
  try {
    const { data, error } = await adultCompositionRows(uid);
    return error ? [] : (data || []);
  } catch (e) { return []; }
}
