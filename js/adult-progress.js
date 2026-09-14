// ===================================================================
//  YOUR TRAINING → PROGRESS OVER TIME
// ===================================================================
// Step 7 of the device connections plan, for the parent's own record: eight weeks of what they did and what they
// recorded, week by week. Workouts ticked off, their minutes and strength days; activity from the health record (one
// source a day, as js/adult-health-record.js decides, in one unit across the eight weeks); weight readings in one unit
// with their sources; and how often the eating habits met the parent's own aims.
//
// It compares the parent with themselves and nothing else: no target, no score, no verdict. A week with nothing in it is
// shown as nothing recorded, never as a failure, and the weight line is drawn on a scale that cannot turn a small
// wobble into a cliff.

const ADULT_PROGRESS_WEEKS = 8;
const ADULT_PROGRESS_ACTIVITY = Object.freeze(['steps', 'active_minutes', 'workout_minutes', 'distance', 'resting_heart_rate']);

// The weeks ending with the one that starts on thisMonday (YYYY-MM-DD), oldest first, each with its seven dates.
function adultProgressWeeks(thisMonday, n){
  const count = n || ADULT_PROGRESS_WEEKS;
  const [y, m, d] = String(thisMonday).split('-').map(Number);
  return Array.from({ length:count }, (_, i) => {
    const start = new Date(y, m - 1, d - 7 * (count - 1 - i));
    const dates = Array.from({ length:7 }, (_, k) => localDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + k)));
    return { start:dates[0], end:dates[6], dates };
  });
}

// Workouts ticked off each week, their minutes, and the days with a strength workout. A tick whose workout was since
// deleted from the schedule still counts as a workout; its kind is no longer known, so it is not a strength day.
function adultWorkoutsByWeek(logs, weeks, items){
  const strength = new Set((items || []).filter(i => i.kind === 'strength').map(i => i.id));
  return weeks.map(w => {
    const inWeek = (logs || []).filter(l => l.done_on >= w.start && l.done_on <= w.end);
    return {
      start:w.start, workouts:inWeek.length,
      minutes:inWeek.reduce((n, l) => n + (Number(l.minutes) || 0), 0),
      strengthDays:new Set(inWeek.filter(l => strength.has(l.schedule_item_id)).map(l => l.done_on)).size,
    };
  });
}

// One activity reading, week by week, in the unit used most across all the weeks; readings in another unit are counted
// and left out rather than converted.
function adultActivityByWeek(records, weeks, metricKey){
  const first = weeks[0].start, last = weeks[weeks.length - 1].end;
  const rows = (records || []).filter(r => r.metric_key === metricKey && r.measured_on >= first && r.measured_on <= last);
  const units = [...new Set(rows.map(r => r.unit))];
  const unit = units.sort((a, b) => rows.filter(r => r.unit === b).length - rows.filter(r => r.unit === a).length)[0] || null;
  const kept = rows.filter(r => r.unit === unit);
  return {
    unit, otherUnitReadings:rows.length - kept.length,
    weeks:weeks.map(w => {
      const a = adultActivityWeek(kept, w.dates)[metricKey];
      return { start:w.start, value:a ? a.value : null, days:a ? a.days : 0 };
    }),
  };
}

// Weight readings from the first week on, oldest first, in the unit used most.
function adultWeightSeries(records, from){
  const rows = (records || []).filter(r => r.metric_key === 'weight' && r.measured_on >= from);
  if (!rows.length) return { unit:null, points:[], otherUnitReadings:0 };
  const count = u => rows.filter(r => r.unit === u).length;
  const unit = ['lb', 'kg'].sort((a, b) => count(b) - count(a))[0];
  const points = rows.filter(r => r.unit === unit).slice()
    .sort((a, b) => String(a.measured_on).localeCompare(String(b.measured_on)) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .map(r => ({ date:r.measured_on, value:Number(r.value), source:adultHealthSourceLabel(r) }));
  return { unit, points, otherUnitReadings:rows.length - points.length };
}

// Days logged each week, and the days that met the parent's own aims (null where no aim is set).
function adultHabitsByWeek(days, prefs, weeks){
  return weeks.map(w => ({ start:w.start, ...adultHabitSummary((days || []).filter(d => d.logged_on >= w.start && d.logged_on <= w.end), prefs) }));
}

function adultWeekLabel(start){
  const [y, m, d] = String(start).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month:'short', day:'numeric' });
}
function adultProgressNumber(v){ return Number(v).toLocaleString(undefined, { maximumFractionDigits:1 }); }
// A count with what it counts: '1 workout', '3 workouts'. A unit given as a plain string ('steps', 'lb') never changes.
function adultProgressCount(v, unit){
  const word = Array.isArray(unit) ? unit[Number(v) === 1 ? 0 : 1] : unit;
  return adultProgressNumber(v) + (word ? ' ' + word : '');
}

// Bars for one number a week. The text alternative reads every week out, including the ones with nothing recorded.
function adultBarsSvg(values, label, unit){
  const w = 280, h = 64, gap = 6, n = values.length;
  const max = Math.max(1, ...values.map(v => Number(v.value) || 0));
  const bw = (w - gap * (n - 1)) / n;
  const bars = values.map((v, i) => {
    const bh = v.value ? Math.max(2, Math.round((Number(v.value) / max) * (h - 10))) : 0;
    return `<rect x="${Math.round(i * (bw + gap))}" y="${h - bh}" width="${Math.max(1, Math.round(bw))}" height="${bh}" rx="3" fill="var(--green)"${i === n - 1 ? '' : ' opacity="0.55"'}></rect>`;
  }).join('');
  const spoken = values.map(v => 'week of ' + adultWeekLabel(v.start) + ', ' + (v.value == null || v.value === 0 && !v.days ? 'nothing recorded' : adultProgressCount(v.value, unit))).join('; ');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="${esc(label + ', by week: ' + spoken)}">${bars}</svg>`;
}

// A line through the weight readings. The vertical scale spans at least five percent of the readings' average, so a
// change of a pound or two looks like a change of a pound or two. Each reading sits at its date across the eight weeks,
// so a change over two days does not look as gradual as one over six weeks.
function adultWeightSvg(series, from, days = ADULT_PROGRESS_WEEKS * 7){
  if (series.points.length < 2) return '';
  const w = 280, h = 64;
  const vals = series.points.map(p => p.value);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const span = Math.max(Math.max(...vals) - Math.min(...vals), mean * 0.05, 1);
  const mid = (Math.max(...vals) + Math.min(...vals)) / 2;
  const lo = mid - span / 2;
  const [fy, fm, fd] = String(from).split('-').map(Number);
  const dayOf = on => { const [y, m, d] = String(on).split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(fy, fm - 1, fd)) / 86400000); };
  const xOf = on => Math.round(Math.min(Math.max(dayOf(on), 0), days - 1) / (days - 1) * w);
  const pts = series.points.map(p => [xOf(p.date), Math.round(h - 6 - ((p.value - lo) / span) * (h - 12))]);
  const spoken = series.points.map(p => fmtDate(p.date) + ', ' + adultProgressNumber(p.value) + ' ' + series.unit).join('; ');
  return `<svg viewBox="-4 0 ${w + 8} ${h}" width="100%" height="${h}" role="img" aria-label="${esc('Weight readings: ' + spoken)}">`
    + `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="var(--green)" stroke-width="2"></polyline>`
    + pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="var(--green)"></circle>`).join('') + '</svg>';
}

function adultProgressMarkup(data){
  const { weeks, workouts, activity, weight, habits, prefs } = data;
  const last = arr => arr[arr.length - 1];
  const section = (title, body) => H`<div class="sec-title">${esc(title)}</div><div class="card app-pad">${body}</div>`;
  const nothing = text => H`<p class="empty" style="margin:0">${esc(text)}</p>`;
  const out = [];

  const done = workouts.map(w => ({ start:w.start, value:w.workouts }));
  out.push(section('Workouts ticked off', workouts.some(w => w.workouts)
    ? adultBarsSvg(done, 'Workouts ticked off', ['workout', 'workouts']) + H`
      <div class="mrow"><span>This week</span><b>${adultProgressCount(last(workouts).workouts, ['workout', 'workouts'])} · ${last(workouts).minutes} min · ${adultProgressCount(last(workouts).strengthDays, ['strength day', 'strength days'])}</b></div>
      <div class="mrow"><span>Eight weeks</span><b>${adultProgressCount(workouts.reduce((n, w) => n + w.workouts, 0), ['workout', 'workouts'])} · ${workouts.reduce((n, w) => n + w.minutes, 0)} min</b></div>`
    : nothing('No workouts ticked off in these eight weeks yet.')));

  for (const key of ADULT_PROGRESS_ACTIVITY) {
    const a = activity[key];
    if (!a || !a.weeks.some(w => w.days)) continue;
    const meta = ADULT_HEALTH_METRICS[key];
    out.push(section(meta.label + (meta.summary === 'average' ? ', weekly average' : ', weekly total'),
      adultBarsSvg(a.weeks, meta.label, a.unit) + H`
      <div class="mrow"><span>This week</span><b>${last(a.weeks).days ? esc(adultProgressNumber(last(a.weeks).value)) + ' ' + esc(a.unit) : 'Nothing recorded'}</b></div>
      ${a.otherUnitReadings ? H`<p class="muted-note" style="margin:6px 0 0">${a.otherUnitReadings} ${a.otherUnitReadings === 1 ? 'reading' : 'readings'} in another unit not counted.</p>` : ''}`));
  }

  if (weight.points.length) {
    const first = weight.points[0], latest = last(weight.points);
    out.push(section('Weight readings', adultWeightSvg(weight, weeks[0].start) + H`
      <div class="mrow"><span>First in these weeks</span><b>${esc(adultProgressNumber(first.value))} ${esc(weight.unit)} · ${esc(fmtDate(first.date))}</b></div>
      <div class="mrow"><span>Latest</span><b>${esc(adultProgressNumber(latest.value))} ${esc(weight.unit)} · ${esc(fmtDate(latest.date))}</b></div>
      <p class="muted-note" style="margin:6px 0 0">${new Set(weight.points.map(p => p.source)).size === 1 ? 'Source' : 'Sources'}: ${esc([...new Set(weight.points.map(p => p.source))].join(', '))}.${weight.otherUnitReadings ? ' ' + weight.otherUnitReadings + ' in another unit not shown.' : ''}</p>`));
  }

  if (habits.some(h => h.daysLogged)) {
    const aim = prefs && prefs.protein_meals_target != null;
    const values = habits.map(h => ({ start:h.start, value:aim ? h.proteinDaysMet : h.daysLogged, days:h.daysLogged }));
    out.push(section(aim ? 'Days meeting your protein aim' : 'Eating habit days logged',
      adultBarsSvg(values, aim ? 'Days meeting your protein aim' : 'Eating habit days logged', ['day', 'days']) + H`
      <div class="mrow"><span>This week</span><b>${aim ? last(habits).proteinDaysMet + ' of ' + adultProgressCount(last(habits).daysLogged, ['day', 'days']) + ' logged' : adultProgressCount(last(habits).daysLogged, ['day', 'days']) + ' logged'}</b></div>`));
  }

  return H`<h3>Progress over time</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">The last eight weeks of your own record, from the week of ${esc(adultWeekLabel(weeks[0].start))}. The darker bar is this week.</p>
    ${out.join('')}
    <p class="muted-note" style="margin-top:14px">Your record compared with nothing but itself. A quiet week is just a quiet week.</p>`;
}

// Every reading in the eight weeks, a page at a time. The API returns at most 1000 rows to a request, and a parent with
// large imports can have more, which would otherwise drop the latest weeks without a word.
async function adultProgressReadings(uid, from, to){
  const PAGE = 1000, rows = [];
  for (let page = 0; page < 20; page++) {
    const r = await sb.from('adult_health_records').select('*').eq('guardian_id', uid).gte('measured_on', from).lte('measured_on', to).in('metric_key', ['weight', ...ADULT_PROGRESS_ACTIVITY]).order('measured_on').order('id').range(page * PAGE, page * PAGE + PAGE - 1);
    if (r.error) return { data:null, error:r.error };
    rows.push(...(r.data || []));
    if (!r.data || r.data.length < PAGE) break;
  }
  return { data:rows, error:null };
}

async function openAdultProgress(){
  if (adultTrainingOff()) return;
  const uid = state.user.id;
  const weeks = adultProgressWeeks(isoDay(mondayOfThisWeek()));
  const from = weeks[0].start, to = weeks[weeks.length - 1].end;
  const bg = sheet('<h3>Progress over time</h3><p class="muted-note" role="status">Loading…</p>');
  const card = bg.querySelector('.sheet');
  // The dialog is named by its heading's id; content written in later keeps that id, so the dialog keeps its name.
  const titleId = card.getAttribute('aria-labelledby');
  const named = html => titleId ? html.replace('<h3>', '<h3 id="' + titleId + '">') : html;
  const results = await Promise.all([
    sb.from('adult_workout_logs').select('schedule_item_id,done_on,minutes').eq('guardian_id', uid).gte('done_on', from).lte('done_on', to),
    sb.from('adult_schedule_items').select('id,kind').eq('guardian_id', uid),
    adultProgressReadings(uid, from, to),
    sb.from('adult_nutrition_days').select('*').eq('guardian_id', uid).gte('logged_on', from).lte('logged_on', to),
    sb.from('adult_nutrition_preferences').select('*').eq('guardian_id', uid).maybeSingle(),
  ]);
  if (results.some(r => r.error)) {
    results.filter(r => r.error).forEach(r => console.error(r.error));
    card.innerHTML = '<div class="grab"></div>' + named('<h3>Progress over time</h3><p class="empty">Your progress isn’t available on this account yet.</p>');
    return;
  }
  const [logs, items, readings, days, prefs] = results.map(r => r.data);
  const records = readings || [];
  const activity = Object.fromEntries(ADULT_PROGRESS_ACTIVITY.map(k => [k, adultActivityByWeek(records, weeks, k)]));
  card.innerHTML = '<div class="grab"></div>' + named(adultProgressMarkup({
    weeks, workouts:adultWorkoutsByWeek(logs || [], weeks, items || []), activity,
    weight:adultWeightSeries(records, from), habits:adultHabitsByWeek(days || [], prefs || null, weeks), prefs:prefs || null,
  }));
}
