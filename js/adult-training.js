// ===================================================================
//  ADULT TRAINING — the pure parts of a parent's own training record
// ===================================================================
// Validation and the week view behind js/screen-adult.js, kept free of the DOM and the database so tests can run
// them directly. Nothing here computes a target. Readings (weight, tape measurements, activity) and their sources are
// kept by js/adult-health-record.js.

const ADULT_GOAL_KINDS = Object.freeze({
  weight_trend:'Weight trend', strength:'Strength', mobility:'Mobility',
  endurance:'Endurance', energy:'Energy', consistency:'Workout consistency',
});
const ADULT_ACTIVITY_KINDS = Object.freeze({
  strength:'Strength', cardio:'Cardio', mobility:'Mobility', sport:'Sport', walk:'Walk', other:'Other',
});
// The US federal Physical Activity Guidelines for adults: 150 to 300 minutes of moderate activity a week, and
// muscle-strengthening activity on at least two days. Shown as a reference a parent can start below.
const ADULT_ACTIVITY_BASELINE = Object.freeze({ weeklyMinutesLow:150, weeklyMinutesHigh:300, strengthDays:2 });
const ADULT_GOAL_MAX = 3;
const ADULT_DAY_LABELS = Object.freeze(['Mon','Tue','Wed','Thu','Fri','Sat','Sun']);

function adultText(value, max){
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}
// A whole number in range, null when left blank, NaN when it is something else.
function adultInt(value, lo, hi){
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : NaN;
}

function adultValidateScheduleItem(input){
  const title = adultText(input && input.title, 80);
  const weekday = Number(input && input.weekday);
  const kind = input && input.kind;
  const duration = adultInt(input && input.duration_min, 1, 600);
  if (!title) return { ok:false, error:'Give it a name, like "Upper body" or "Morning walk".' };
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { ok:false, error:'Pick a day.' };
  if (typeof kind !== 'string' || !Object.hasOwn(ADULT_ACTIVITY_KINDS, kind)) return { ok:false, error:'Pick a kind of workout.' };
  if (Number.isNaN(duration)) return { ok:false, error:'Minutes should be a whole number from 1 to 600.' };
  return { ok:true, value:{ title, weekday, kind, duration_min:duration } };
}

function adultValidateExercise(input){
  const name = adultText(input && input.name, 80);
  const sets = adultInt(input && input.sets, 1, 20);
  const reps = adultInt(input && input.reps, 1, 100);
  const duration = adultInt(input && input.duration_sec, 1, 7200);
  if (!name) return { ok:false, error:'Name the exercise.' };
  if (Number.isNaN(sets)) return { ok:false, error:'Sets should be a whole number from 1 to 20.' };
  if (Number.isNaN(reps)) return { ok:false, error:'Reps should be a whole number from 1 to 100.' };
  if (Number.isNaN(duration)) return { ok:false, error:'Seconds should be a whole number from 1 to 7200.' };
  return { ok:true, value:{ name, sets, reps, duration_sec:duration } };
}

// "Goblet squat · 3 × 8", "Plank · 45 s", "Easy bike · 20 min".
function adultExerciseLine(e){
  const parts = [];
  if (e.sets && e.reps) parts.push(e.sets + ' × ' + e.reps);
  else if (e.sets) parts.push(e.sets + (e.sets === 1 ? ' set' : ' sets'));
  else if (e.reps) parts.push(e.reps + ' reps');
  if (e.duration_sec) parts.push(e.duration_sec >= 60 && e.duration_sec % 60 === 0 ? (e.duration_sec / 60) + ' min' : e.duration_sec + ' s');
  return e.name + (parts.length ? ' · ' + parts.join(' · ') : '');
}

// The week, Monday first. dateFor(i) is each day's calendar date, so a tick counts toward the day it was made for.
function adultWeek(items, exercises, logs, dateFor){
  const byItem = new Map();
  (exercises || []).forEach(e => { const list = byItem.get(e.item_id) || []; list.push(e); byItem.set(e.item_id, list); });
  const done = new Set((logs || []).filter(l => l.schedule_item_id).map(l => l.schedule_item_id + '|' + l.done_on));
  return ADULT_DAY_LABELS.map((label, weekday) => {
    const date = dateFor(weekday);
    return {
      weekday, label, date,
      items: (items || []).filter(it => it.weekday === weekday).map(it => ({
        ...it,
        exercises: (byItem.get(it.id) || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0)),
        done: done.has(it.id + '|' + date),
      })),
    };
  });
}

function adultWeekSummary(week){
  let planned = 0, done = 0, minutesDone = 0;
  const strengthDays = new Set();
  (week || []).forEach(day => day.items.forEach(it => {
    planned++;
    if (!it.done) return;
    done++;
    minutesDone += it.duration_min || 0;
    if (it.kind === 'strength') strengthDays.add(day.weekday);
  }));
  return { planned, done, minutesDone, strengthDaysDone:strengthDays.size };
}
