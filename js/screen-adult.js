// ===================================================================
//  YOUR TRAINING — a parent's own training record (Adult Training, milestone 1)
// ===================================================================
// A parent's goals, weekly gym or activity schedule, the workouts they tick off, and the weight or tape
// measurements they enter themselves. It belongs to the signed-in guardian alone: this screen never reads the
// active athlete, nothing here joins a child's plan, and the database lets no co-parent, family member, coach or
// organization read it. Behind ADULT_TRAINING_ENABLED and the adult_training_access allowlist (js/core.js).
//
// What it deliberately does not do: set a target weight, estimate anything about a body from a photo, or apply the
// children's rest-first rules to an adult's week. Weight is what a scale said, as the parent entered it.

function adultFail(error, where, message){
  console.error(error);
  if (typeof reportError === 'function') reportError(error, where);
  toast(message);
}

async function screenAdult(){
  if (adultTrainingOff()) return;
  if (state.adultSection === 'eating' && typeof screenAdultEating === 'function') return screenAdultEating();
  const uid = state.user.id;
  const weekStart = isoDay(mondayOfThisWeek()), weekEnd = dateForDayIndex(6), today = todayISO();
  const results = await Promise.all([
    sb.from('adult_profiles').select('*').eq('guardian_id', uid).maybeSingle(),
    sb.from('adult_goals').select('*').eq('guardian_id', uid).eq('status', 'active').order('created_at'),
    sb.from('adult_schedule_items').select('*').eq('guardian_id', uid).order('weekday').order('created_at'),
    sb.from('adult_schedule_exercises').select('*').eq('guardian_id', uid).order('position').order('created_at'),
    sb.from('adult_workout_logs').select('*').eq('guardian_id', uid).gte('done_on', weekStart).lte('done_on', weekEnd),
    sb.from('adult_health_records').select('*').eq('guardian_id', uid)
      .order('measured_on', { ascending:false }).order('created_at', { ascending:false }).limit(500),
    sb.from('adult_health_import_batches').select('*').eq('guardian_id', uid).order('received_at', { ascending:false }).limit(50),
  ]);
  const top = adultTopBar();
  if (results.some(r => r.error)) {
    results.filter(r => r.error).forEach(r => console.error(r.error));
    $("#screen").innerHTML = H`${top}<div class="app-pad"><p class="empty">Your training record isn't available on this account yet.</p></div>`;
    bindAdultChrome();
    return;
  }
  const [prof, goalRows, itemRows, exerciseRows, logRows, readingRows, batchRows] = results;
  const profile = prof.data || null, goals = goalRows.data || [], items = itemRows.data || [];
  const exercises = exerciseRows.data || [], logs = logRows.data || [];
  const readings = readingRows.data || [], batches = batchRows.data || [];
  const week = adultWeek(items, exercises, logs, dateForDayIndex);
  const sum = adultWeekSummary(week);
  const units = (profile && profile.units) || 'lb';
  const recorded = Object.keys(ADULT_HEALTH_METRICS).filter(k => ADULT_HEALTH_METRICS[k].group === 'body' && readings.some(r => r.metric_key === k));
  const activity = adultActivityWeek(readings, [0, 1, 2, 3, 4, 5, 6].map(dateForDayIndex));
  const scheduledDays = week.filter(d => d.items.length);
  const B = ADULT_ACTIVITY_BASELINE;

  $("#screen").innerHTML = H`${top}
    <div class="app-pad" style="padding-top:6px">
      ${adultSectionSwitch('training')}
      <p class="muted-note" style="margin-top:0">Private to you. Co-parents, family members, coaches and teams can't see it, and none of it appears on a child's profile.</p>

      ${!profile ? H`<div class="card app-pad">
        <div class="grow" style="border:none;padding:0"><div class="gi">🏋️</div>
          <div class="gt"><b>Set up your training</b><span>Units, where you're starting from, and a weekly aim you choose.</span></div></div>
        <button class="btn" id="adultSetup" style="margin-top:12px">Set up</button>
      </div>` : ''}

      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title">Your goals</div>
        ${goals.length < ADULT_GOAL_MAX ? '<button class="btn sm ghost" id="adultAddGoal">＋ Add</button>' : ''}
      </div>
      <div class="card app-pad">
        ${goals.length ? goals.map(g => H`<div class="mrow">
            <span><b>${esc(g.label)}</b><small>${esc(ADULT_GOAL_KINDS[g.kind] || '')}</small></span>
            <button class="btn sm ghost" data-adult-goal-remove="${esc(g.id)}">Remove</button></div>`).join('')
          : H`<p class="empty" style="margin:0">No goals yet. Pick up to ${ADULT_GOAL_MAX}: strength, mobility, endurance, energy, consistency or a weight trend.</p>`}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title">This week</div>
        <button class="btn sm ghost" id="adultAddItem">＋ Add workout</button>
      </div>
      <div class="card app-pad">
        <div class="mrow"><span>Done</span><b>${sum.done} of ${sum.planned}</b></div>
        <div class="mrow"><span>Minutes</span><b>${sum.minutesDone}</b></div>
        <div class="mrow"><span>Strength days</span><b>${sum.strengthDaysDone}</b></div>
        <p class="muted-note" style="margin:8px 0 0">For reference, the federal guidelines for adults are ${B.weeklyMinutesLow} to ${B.weeklyMinutesHigh} minutes of moderate activity a week and strength work on at least ${B.strengthDays} days.${profile && profile.weekly_minutes_target != null ? H` Your own aim is <b>${esc(String(profile.weekly_minutes_target))} minutes</b>.` : ''} Start wherever you are.</p>
      </div>
      ${scheduledDays.length ? scheduledDays.map(d => H`
        <div class="card app-pad" style="margin-top:10px">
          <div class="k-mono">${esc(d.label)} · ${esc(fmtDate(d.date))}</div>
          ${d.items.map(it => H`<div class="day adult-item">
            <button class="chk ${it.done ? 'on' : ''}" data-adult-done="${esc(it.id)}" data-date="${esc(d.date)}"
              aria-pressed="${it.done ? 'true' : 'false'}" aria-label="${it.done ? 'Mark not done' : 'Mark done'}: ${esc(it.title)}"
              ${d.date > today ? 'disabled' : ''}>${it.done ? '✓' : ''}</button>
            <div class="body"><h4>${esc(it.title)}</h4>
              <p>${esc(ADULT_ACTIVITY_KINDS[it.kind] || '')}${it.duration_min ? ' · ' + it.duration_min + ' min' : ''}</p>
              ${it.exercises.length ? H`<ul class="adult-exercises">${it.exercises.map(e => H`<li>${esc(adultExerciseLine(e))}</li>`).join('')}</ul>` : ''}
            </div>
            <button class="btn sm ghost" data-adult-edit="${esc(it.id)}">Edit</button>
          </div>`).join('')}
        </div>`).join('')
        : H`<p class="empty">Nothing scheduled. Add the workouts you plan to do, on the days you plan to do them.</p>`}

      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title">Progress</div>
        <div style="display:flex;gap:6px">
          <button class="btn sm ghost" id="adultImport">Import</button>
          <button class="btn sm ghost" id="adultAddBody">＋ Record</button>
        </div>
      </div>
      <div class="card app-pad">
        ${recorded.length ? recorded.map(k => { const t = adultHealthTrend(readings, k);
          return H`<div class="mrow"><span><b>${esc(ADULT_HEALTH_METRICS[k].label)}</b><small>${esc(fmtDate(t.latest.measured_on))} · ${esc(adultHealthSourceLabel(t.latest))}${t.change != null
            ? ' · ' + (t.change > 0 ? '+' : '') + esc(String(t.change)) + ' ' + esc(t.latest.unit) + ' since ' + esc(fmtDate(t.previous.measured_on)) : ''}</small></span>
            <b>${esc(String(Number(t.latest.value)))} ${esc(t.latest.unit)}</b></div>`; }).join('')
          : H`<p class="empty" style="margin:0">Nothing recorded yet. Type in a reading from your scale, a tape or your watch, or import a file exported from a scale or fitness app.</p>`}
        ${Object.keys(activity).length ? H`<div class="k-mono" style="margin-top:12px">Activity this week</div>
          ${Object.values(activity).map(a => H`<div class="mrow"><span><b>${esc(a.label)}</b><small>${a.summary === 'average' ? 'Average over ' : ''}${a.days} day${a.days === 1 ? '' : 's'}${a.otherUnitReadings
            ? ' · ' + a.otherUnitReadings + ' in another unit not counted' : ''}</small></span>
            <b>${esc(a.value.toLocaleString())} ${esc(a.unit)}</b></div>`).join('')}` : ''}
        <div id="adultComposition"></div>
        <button class="btn sm ghost" id="adultConnections" style="margin-top:10px">Connections</button>
        ${batches.length ? H`<button class="btn sm ghost" id="adultImports" style="margin-top:10px">Your imports (${batches.length})</button>` : ''}
      </div>

      <div class="act-stop" style="margin-top:16px"><b>Stop if</b> you feel sharp pain, chest pain, dizziness or unusual shortness of breath. If you have a health condition, check with a doctor before starting something new.</div>
    </div>`;

  bindAdultChrome();
  { const b = $("#adultSetup"); if (b) b.onclick = () => openAdultProfile(profile); }
  { const b = $("#adultAddGoal"); if (b) b.onclick = () => openAdultGoal(); }
  { const b = $("#adultAddItem"); if (b) b.onclick = () => openAdultItem(null, []); }
  { const b = $("#adultAddBody"); if (b) b.onclick = () => openAdultBodyEntry(units); }
  { const b = $("#adultImport"); if (b) b.onclick = () => openAdultImport(); }
  { const b = $("#adultImports"); if (b) b.onclick = () => openAdultImports(batches); }
  // Results measured elsewhere (DXA, clinic, smart scale, health app), painted once they load. See js/adult-composition.js.
  if (typeof adultCompositionSection === 'function') adultCompositionSection($("#adultComposition"));
  { const b = $("#adultConnections"); if (b) b.onclick = () => openConnections(); }
  $("#screen").querySelectorAll('[data-adult-goal-remove]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    const { error } = await sb.from('adult_goals').delete().eq('id', b.dataset.adultGoalRemove).eq('guardian_id', uid);
    if (error) { adultFail(error, 'adult:removeGoal', 'Could not remove that goal'); b.disabled = false; return; }
    renderApp('adult');
  });
  $("#screen").querySelectorAll('[data-adult-done]').forEach(b => b.onclick = async () => {
    const item = items.find(i => i.id === b.dataset.adultDone); if (!item) return;
    const date = b.dataset.date;
    const existing = logs.find(l => l.schedule_item_id === item.id && l.done_on === date);
    b.disabled = true;
    const { error } = existing
      ? await sb.from('adult_workout_logs').delete().eq('id', existing.id).eq('guardian_id', uid)
      : await sb.from('adult_workout_logs').insert({ guardian_id:uid, schedule_item_id:item.id, done_on:date, minutes:item.duration_min || null });
    if (error) { adultFail(error, 'adult:toggleDone', 'Could not save that'); b.disabled = false; return; }
    renderApp('adult');
  });
  $("#screen").querySelectorAll('[data-adult-edit]').forEach(b => b.onclick = () => {
    const item = items.find(i => i.id === b.dataset.adultEdit);
    if (item) openAdultItem(item, exercises.filter(e => e.item_id === item.id));
  });
}

// The header both halves of Your training share, and the switch between them.
function adultTopBar(){
  // With no child profile there is no Account screen behind this one, so the header offers setting one up and logging out.
  if (!hasActiveAthlete()) return H`<div class="top">
      <button class="pill" id="adultAddChild">Add your child</button>
      <h3 style="font-size:17px">Your training</h3>
      <button class="pill" id="adultLogout">Log out</button>
    </div>`;
  return H`<div class="top">
      <button class="pill" id="adultBack" aria-label="Back to account">← Back</button>
      <h3 style="font-size:17px">Your training</h3>
      <span style="width:62px"></span>
    </div>`;
}
function adultSectionSwitch(active){
  return H`<div class="chipgrid two" role="tablist" aria-label="Your training" style="margin:0 0 12px">${[['training', 'Training'], ['eating', 'Eating']].map(([k, l]) =>
    H`<button type="button" class="chip${k === active ? ' on' : ''}" role="tab" aria-selected="${k === active ? 'true' : 'false'}" data-adult-section="${k}">${l}</button>`).join('')}</div>`;
}
function bindAdultChrome(){
  { const b = $("#adultBack"); if (b) b.onclick = () => renderApp('account'); }
  { const b = $("#adultAddChild"); if (b) b.onclick = () => startChildSetup(); }
  { const b = $("#adultLogout"); if (b) b.onclick = () => logOutOfApp(); }
  $("#screen").querySelectorAll('[data-adult-section]').forEach(b => b.onclick = () => {
    state.adultSection = b.dataset.adultSection;
    renderApp('adult');
  });
}

function openAdultProfile(profile){
  const p = profile || {};
  const bg = sheet(H`<h3>Your training</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">You can change all of this later.</p>
    <div class="field"><label>Units for weight</label>
      <select id="adUnits"><option value="lb"${p.units !== 'kg' ? ' selected' : ''}>Pounds (lb)</option><option value="kg"${p.units === 'kg' ? ' selected' : ''}>Kilograms (kg)</option></select></div>
    <div class="field"><label>Where you're starting</label>
      <select id="adExp"><option value="">Prefer not to say</option>
        ${[['new','New to working out'],['returning','Getting back into it'],['regular','Working out regularly']].map(([v, l]) => `<option value="${v}"${p.experience === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    <div class="row2">
      <div class="field"><label>Weekly minutes, your aim</label><input id="adMin" type="number" inputmode="numeric" min="0" max="1200" value="${esc(p.weekly_minutes_target == null ? '' : String(p.weekly_minutes_target))}" placeholder="e.g. 90"/></div>
      <div class="field"><label>Strength days, your aim</label><input id="adStr" type="number" inputmode="numeric" min="0" max="7" value="${esc(p.strength_days_target == null ? '' : String(p.strength_days_target))}" placeholder="e.g. 2"/></div>
    </div>
    <p style="font-size:11.5px;color:var(--muted);margin:-4px 2px 12px">Pick numbers that fit your week now. Starting lower is fine.</p>
    <div class="err" id="adErr"></div>
    <button class="btn" id="adSave">Save</button>`);
  bg.querySelector('#adSave').onclick = async e => {
    const err = bg.querySelector('#adErr'); err.textContent = '';
    const minutes = adultInt(bg.querySelector('#adMin').value, 0, 1200), strength = adultInt(bg.querySelector('#adStr').value, 0, 7);
    if (Number.isNaN(minutes)) { err.textContent = 'Weekly minutes should be a whole number from 0 to 1200.'; return; }
    if (Number.isNaN(strength)) { err.textContent = 'Strength days should be a whole number from 0 to 7.'; return; }
    const btn = e.currentTarget; btn.disabled = true;
    const { error } = await sb.from('adult_profiles').upsert({
      guardian_id:state.user.id, units:bg.querySelector('#adUnits').value, experience:bg.querySelector('#adExp').value || null,
      weekly_minutes_target:minutes, strength_days_target:strength, updated_at:new Date().toISOString(),
    }, { onConflict:'guardian_id' });
    if (error) { adultFail(error, 'adult:profile', 'Could not save'); btn.disabled = false; return; }
    bg.remove(); toast('Saved'); renderApp('adult');
  };
}

function openAdultGoal(){
  let kind = 'strength';
  const bg = sheet(H`<h3>Add a goal</h3>
    <div class="field"><label>Kind</label>
      <div class="chipgrid">${Object.entries(ADULT_GOAL_KINDS).map(([k, l]) => H`<button class="chip${k === kind ? ' on' : ''}" data-goal-kind="${k}">${esc(l)}</button>`).join('')}</div></div>
    <div class="field"><label>In your words</label><input id="adGoalLabel" maxlength="120" placeholder="e.g. Deadlift with good form"/></div>
    <p style="font-size:11.5px;color:var(--muted);margin:-4px 2px 12px">A weight-trend goal shows the readings you enter from your scale. The app doesn't set a target for you.</p>
    <button class="btn" id="adGoalSave">Save goal</button>`);
  bg.querySelectorAll('[data-goal-kind]').forEach(c => c.onclick = () => {
    kind = c.dataset.goalKind;
    bg.querySelectorAll('[data-goal-kind]').forEach(x => x.classList.toggle('on', x === c));
  });
  bg.querySelector('#adGoalSave').onclick = async e => {
    const label = adultText(bg.querySelector('#adGoalLabel').value, 120) || ADULT_GOAL_KINDS[kind];
    const btn = e.currentTarget; btn.disabled = true;
    const { error } = await sb.from('adult_goals').insert({ guardian_id:state.user.id, kind, label });
    if (error) { adultFail(error, 'adult:goal', 'Could not save the goal'); btn.disabled = false; return; }
    bg.remove(); renderApp('adult');
  };
}

function openAdultItem(item, exercises){
  const it = item || { weekday:(new Date().getDay() + 6) % 7, kind:'strength' };
  const bg = sheet(H`<h3>${item ? 'Edit workout' : 'Add a workout'}</h3>
    <div class="field"><label>Name</label><input id="adItemTitle" maxlength="80" value="${esc(it.title || '')}" placeholder="e.g. Upper body"/></div>
    <div class="row2">
      <div class="field"><label>Day</label><select id="adItemDay">${ADULT_DAY_LABELS.map((d, i) => `<option value="${i}"${it.weekday === i ? ' selected' : ''}>${d}</option>`).join('')}</select></div>
      <div class="field"><label>Minutes</label><input id="adItemMin" type="number" inputmode="numeric" min="1" max="600" value="${esc(it.duration_min == null ? '' : String(it.duration_min))}"/></div>
    </div>
    <div class="field"><label>Kind</label><select id="adItemKind">${Object.entries(ADULT_ACTIVITY_KINDS).map(([k, l]) => `<option value="${k}"${it.kind === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    <div class="err" id="adItemErr"></div>
    <button class="btn" id="adItemSave">${item ? 'Save changes' : 'Add workout'}</button>
    ${item ? H`<div class="sec-title" style="margin-top:18px">Exercises</div>
      <div class="card app-pad">${(exercises || []).length
        ? exercises.map(x => H`<div class="mrow"><span>${esc(adultExerciseLine(x))}</span><button class="btn sm ghost" data-adult-exercise-remove="${esc(x.id)}">Remove</button></div>`).join('')
        : '<p class="empty" style="margin:0">No exercises yet.</p>'}</div>
      <div class="field" style="margin-top:10px"><label>Add an exercise</label><input id="adExName" maxlength="80" placeholder="e.g. Goblet squat"/></div>
      <div class="row2">
        <div class="field"><label>Sets</label><input id="adExSets" type="number" inputmode="numeric" min="1" max="20"/></div>
        <div class="field"><label>Reps</label><input id="adExReps" type="number" inputmode="numeric" min="1" max="100"/></div>
      </div>
      <div class="field"><label>Or seconds</label><input id="adExSec" type="number" inputmode="numeric" min="1" max="7200"/></div>
      <div class="err" id="adExErr"></div>
      <button class="btn ghost" id="adExAdd">Add exercise</button>
      <button class="btn danger" id="adItemDelete" style="margin-top:18px">Delete this workout</button>` : ''}`);

  bg.querySelector('#adItemSave').onclick = async e => {
    const err = bg.querySelector('#adItemErr'); err.textContent = '';
    const v = adultValidateScheduleItem({ title:bg.querySelector('#adItemTitle').value, weekday:bg.querySelector('#adItemDay').value,
      kind:bg.querySelector('#adItemKind').value, duration_min:bg.querySelector('#adItemMin').value });
    if (!v.ok) { err.textContent = v.error; return; }
    const btn = e.currentTarget; btn.disabled = true;
    const { error } = item
      ? await sb.from('adult_schedule_items').update(v.value).eq('id', item.id).eq('guardian_id', state.user.id)
      : await sb.from('adult_schedule_items').insert({ ...v.value, guardian_id:state.user.id });
    if (error) { adultFail(error, 'adult:item', 'Could not save the workout'); btn.disabled = false; return; }
    bg.remove(); toast(item ? 'Saved' : 'Added to your week'); renderApp('adult');
  };
  if (!item) return;

  bg.querySelector('#adExAdd').onclick = async e => {
    const err = bg.querySelector('#adExErr'); err.textContent = '';
    const v = adultValidateExercise({ name:bg.querySelector('#adExName').value, sets:bg.querySelector('#adExSets').value,
      reps:bg.querySelector('#adExReps').value, duration_sec:bg.querySelector('#adExSec').value });
    if (!v.ok) { err.textContent = v.error; return; }
    const btn = e.currentTarget; btn.disabled = true;
    const { error } = await sb.from('adult_schedule_exercises').insert({ ...v.value, item_id:item.id, guardian_id:state.user.id,
      position:Math.min((exercises || []).length, 50) });
    if (error) { adultFail(error, 'adult:exercise', 'Could not add the exercise'); btn.disabled = false; return; }
    bg.remove();
    await renderApp('adult');
    const { data } = await sb.from('adult_schedule_exercises').select('*').eq('item_id', item.id).eq('guardian_id', state.user.id)
      .order('position').order('created_at');
    openAdultItem(item, data || []);
  };
  bg.querySelectorAll('[data-adult-exercise-remove]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    const { error } = await sb.from('adult_schedule_exercises').delete().eq('id', b.dataset.adultExerciseRemove).eq('guardian_id', state.user.id);
    if (error) { adultFail(error, 'adult:exerciseRemove', 'Could not remove it'); b.disabled = false; return; }
    const row = b.closest('.mrow'); if (row) row.remove();
  });
  bg.querySelector('#adItemDelete').onclick = async e => {
    if (!confirm('Delete this workout and its exercises? Days you already ticked off stay in your record.')) return;
    const btn = e.currentTarget; btn.disabled = true;
    const { error } = await sb.from('adult_schedule_items').delete().eq('id', item.id).eq('guardian_id', state.user.id);
    if (error) { adultFail(error, 'adult:itemDelete', 'Could not delete the workout'); btn.disabled = false; return; }
    bg.remove(); toast('Workout deleted'); renderApp('adult');
  };
}

function openAdultBodyEntry(units){
  const today = todayISO();
  const entries = Object.entries(ADULT_HEALTH_METRICS);
  const option = ([k, m]) => `<option value="${k}">${esc(m.label)}</option>`;
  const bg = sheet(H`<h3>Record a reading</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">Weight from your scale, a measurement from a tape, or a number from your watch or phone. The same time of day and conditions each time keeps the trend honest.</p>
    <div class="field"><label>What are you recording?</label>
      <select id="adBodyMetric"><optgroup label="Body">${entries.filter(([, m]) => m.group === 'body').map(option).join('')}</optgroup>
        <optgroup label="Activity">${entries.filter(([, m]) => m.group === 'activity').map(option).join('')}</optgroup></select></div>
    <div class="row2">
      <div class="field"><label>Value</label><input id="adBodyValue" type="number" step="0.1" inputmode="decimal"/></div>
      <div class="field"><label>Unit</label><select id="adBodyUnit"></select></div>
    </div>
    <div class="field"><label>Date</label><input id="adBodyDate" type="date" value="${today}" max="${today}"/></div>
    <div class="err" id="adBodyErr"></div>
    <button class="btn" id="adBodySave">Save</button>`);
  const metricEl = bg.querySelector('#adBodyMetric'), unitEl = bg.querySelector('#adBodyUnit'), valueEl = bg.querySelector('#adBodyValue');
  const fillUnits = () => {
    const meta = ADULT_HEALTH_METRICS[metricEl.value];
    const metric = units === 'kg' ? ['kg', 'cm', 'km'] : ['lb', 'in', 'mi'];
    const preferred = meta.units.find(u => metric.includes(u)) || meta.units[0];
    unitEl.innerHTML = meta.units.map(u => `<option value="${u}"${u === preferred ? ' selected' : ''}>${u}</option>`).join('');
    valueEl.step = meta.integer ? '1' : '0.1';
    valueEl.inputMode = meta.integer ? 'numeric' : 'decimal';
  };
  metricEl.onchange = fillUnits; fillUnits();
  bg.querySelector('#adBodySave').onclick = async e => {
    const err = bg.querySelector('#adBodyErr'); err.textContent = '';
    const v = adultHealthNormalize({ metric_key:metricEl.value, value:valueEl.value, unit:unitEl.value,
      measured_on:bg.querySelector('#adBodyDate').value }, { source_kind:'manual', today });
    if (!v.ok) { err.textContent = v.error; return; }
    const btn = e.currentTarget; btn.disabled = true;
    const { metric_key, value, unit, measured_on } = v.record;
    const { error } = await sb.from('adult_health_records').insert({ guardian_id:state.user.id, metric_key, value, unit, measured_on, source_kind:'manual', method:'entered' });
    if (error && error.code === '23505') { err.textContent = 'That reading is already recorded for that day.'; btn.disabled = false; return; }
    if (error) { adultFail(error, 'adult:reading', 'Could not save'); btn.disabled = false; return; }
    bg.remove(); toast('Recorded'); renderApp('adult');
  };
}

// Readings from a CSV file. The file is read in this browser and never uploaded; the preview says what the import would
// add, what is already recorded and what can't be used, and the database skips duplicates again when it saves. The
// already-recorded check reads at most one page of existing readings, so a very large history can show a few rows as
// new that the save then counts as duplicates.
function openAdultImport(){
  const today = todayISO();
  let plan = null, ctx = null;
  const bg = sheet(H`<h3>Import readings</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">A CSV file whose first row names the columns <b>date</b>, <b>metric</b>, <b>value</b> and <b>unit</b>, and optionally <b>id</b>. It is read on this device and not kept; only the readings are saved, each labelled with where it came from. Readings already recorded are skipped.</p>
    <div class="field"><label>Where are they from?</label><input id="adImpName" maxlength="80" placeholder="e.g. Scale app export"/></div>
    <div class="field"><label>They are</label><select id="adImpOrigin">${Object.entries(ADULT_HEALTH_ORIGINS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
    <div class="field"><label>File</label><input id="adImpFile" type="file" accept=".csv,text/csv"/></div>
    <div id="adImpPlan"></div>
    <p class="muted-note" style="margin:0 2px 12px">Readings this record keeps: ${esc(Object.values(ADULT_HEALTH_METRICS).map(m => m.label.toLowerCase()).join(', '))}. Body-composition values aren't imported.</p>
    <div class="err" id="adImpErr"></div>
    <button class="btn" id="adImpSave" disabled>Import</button>`);
  const nameEl = bg.querySelector('#adImpName'), originEl = bg.querySelector('#adImpOrigin'), fileEl = bg.querySelector('#adImpFile');
  const planEl = bg.querySelector('#adImpPlan'), saveEl = bg.querySelector('#adImpSave'), err = bg.querySelector('#adImpErr');
  const preview = async () => {
    err.textContent = ''; planEl.innerHTML = ''; plan = null; saveEl.disabled = true;
    const file = fileEl.files && fileEl.files[0];
    if (!file) return;
    const name = adultHealthText(nameEl.value, 80);
    if (!name) { err.textContent = 'Say where these readings are from, so each one is labelled.'; return; }
    if (file.size > 2 * 1024 * 1024) { err.textContent = 'That file is larger than 2 MB.'; return; }
    const parsed = adultHealthParseCsv(await file.text());
    if (!parsed.ok) { err.textContent = parsed.error; return; }
    ctx = { source_kind:'file_import', source_name:name, origin:originEl.value, today };
    const dates = parsed.rows.map(r => r.date).filter(adultHealthIsDate).sort();
    let existing = [];
    if (dates.length) {
      const { data, error } = await sb.from('adult_health_records').select('metric_key,value,unit,measured_on,external_id,source_kind,source_name')
        .eq('guardian_id', state.user.id).eq('source_kind', 'file_import').gte('measured_on', dates[0]).lte('measured_on', dates[dates.length - 1]);
      if (error) { adultFail(error, 'adult:importExisting', 'Could not check what is already recorded'); return; }
      existing = (data || []).filter(r => String(r.source_name || '').toLowerCase() === name.toLowerCase()).map(r => adultHealthKey(r, r));
    }
    plan = adultHealthPlanImport(parsed.rows, existing, ctx);
    plan.batchId = uuid();
    planEl.innerHTML = H`<div class="card app-pad" style="margin-bottom:12px">
      <div class="mrow"><span>New readings</span><b>${plan.records.length}</b></div>
      <div class="mrow"><span>Already recorded</span><b>${plan.duplicates}</b></div>
      <div class="mrow"><span>Can't be used</span><b>${plan.rejected.length}</b></div>
      ${plan.rejected.slice(0, 5).map(r => H`<p class="muted-note" style="margin:6px 0 0">Line ${r.line}: ${esc(r.error)}</p>`).join('')}
      ${plan.rejected.length > 5 ? H`<p class="muted-note" style="margin:6px 0 0">And ${plan.rejected.length - 5} more.</p>` : ''}
    </div>`;
    if (plan.records.length > ADULT_HEALTH_SAVE_MAX) { err.textContent = 'An import can add up to ' + ADULT_HEALTH_SAVE_MAX + ' readings. Split the file and import each part.'; return; }
    saveEl.disabled = !plan.records.length;
  };
  fileEl.onchange = preview; originEl.onchange = preview; nameEl.onchange = preview;
  saveEl.onclick = async () => {
    if (!plan || !plan.records.length || plan.records.length > ADULT_HEALTH_SAVE_MAX) return;
    saveEl.disabled = true; err.textContent = '';
    const { data, error } = await sb.rpc('save_adult_health_import', {
      p_batch:{ id:plan.batchId, source_name:ctx.source_name, origin:ctx.origin, rows_received:plan.received, rows_rejected:plan.rejected.length },
      p_records:plan.records,
    });
    if (error) { adultFail(error, 'adult:import', 'Could not import those readings'); saveEl.disabled = false; return; }
    const saved = data && data.saved != null ? data.saved : plan.records.length;
    bg.remove(); toast('Imported ' + saved + (saved === 1 ? ' reading' : ' readings')); renderApp('adult');
  };
}

// Each import, and a way to undo one: deleting the import deletes exactly the readings it added.
function openAdultImports(batches){
  const bg = sheet(H`<h3>Your imports</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">Undoing an import removes exactly the readings it added. Readings you typed in and other imports stay.</p>
    <div class="card app-pad">${(batches || []).map(b => H`<div class="mrow">
      <span><b>${esc(b.source_name)}</b><small>${esc(fmtDate(localDay(new Date(b.received_at))))} · ${b.rows_saved} added${b.rows_duplicate ? ' · ' + b.rows_duplicate + ' already recorded' : ''}${b.rows_rejected ? ' · ' + b.rows_rejected + ' not used' : ''}</small></span>
      <button class="btn sm ghost" data-adult-import-undo="${esc(b.id)}" data-n="${esc(String(b.rows_saved))}">Undo</button></div>`).join('')}</div>`);
  bg.querySelectorAll('[data-adult-import-undo]').forEach(btn => btn.onclick = async () => {
    const n = Number(btn.dataset.n) || 0;
    if (!confirm('Remove this import and the ' + n + (n === 1 ? ' reading' : ' readings') + ' it added?')) return;
    btn.disabled = true;
    const { error } = await sb.from('adult_health_import_batches').delete().eq('id', btn.dataset.adultImportUndo).eq('guardian_id', state.user.id);
    if (error) { adultFail(error, 'adult:importUndo', 'Could not undo that import'); btn.disabled = false; return; }
    bg.remove(); toast('Import removed'); renderApp('adult');
  });
}

// For "Export everything": the parent's own record, even when the account has no athlete. A database without these
// tables yields nothing rather than failing the export.
async function adultTrainingExport(){
  if (!state.user) return { hasData:false, data:null };
  const tables = ['adult_profiles', 'adult_goals', 'adult_schedule_items', 'adult_schedule_exercises', 'adult_workout_logs', 'adult_health_records', 'adult_health_import_batches',
    'adult_nutrition_preferences', 'adult_recipes', 'adult_meal_plan_items', 'adult_nutrition_days'];
  const results = await Promise.all(tables.map(t => sb.from(t).select('*').eq('guardian_id', state.user.id)));
  const data = {}; let hasData = false;
  tables.forEach((t, i) => {
    const rows = results[i].error ? [] : (results[i].data || []);
    data[t.replace(/^adult_/, '')] = rows;
    if (rows.length) hasData = true;
  });
  const composition = typeof adultCompositionExport === 'function' ? await adultCompositionExport(state.user.id) : [];
  data.composition_imports = composition;
  if (composition.length) hasData = true;
  return { hasData, data };
}
