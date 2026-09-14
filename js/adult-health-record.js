// ===================================================================
//  ADULT HEALTH RECORD — one source-tracked record of a parent's own readings
// ===================================================================
// The pure parts behind Progress in js/screen-adult.js: which readings the record keeps, how a typed-in or imported
// reading is normalised, the key that recognises a duplicate, CSV parsing and import planning, and the summaries.
// Kept free of the DOM and the database so tests can run them directly. The database enforces the same dictionary
// (private.adult_health_metric_ok) and the same duplicate keys (supabase/migrations/20260914140000).
//
// Nothing here derives anything about a body. A reading says what the parent typed, or what a device's export said,
// and records which. No body-composition value is accepted: that waits for its own import with its own rules.

// lo/hi bound the value; loOpen/hiOpen make a bound exclusive. device is the method a device export may claim for
// the reading, or null when only the parent can enter it.
const ADULT_HEALTH_METRICS = Object.freeze({
  weight:{ label:'Weight', group:'body', units:['lb', 'kg'], device:'device_measured', lo:0, loOpen:true, hi:2000, hiOpen:true, integer:false },
  waist:{ label:'Waist', group:'body', units:['in', 'cm'], device:null, lo:0, loOpen:true, hi:2000, hiOpen:true, integer:false },
  hips:{ label:'Hips', group:'body', units:['in', 'cm'], device:null, lo:0, loOpen:true, hi:2000, hiOpen:true, integer:false },
  chest:{ label:'Chest', group:'body', units:['in', 'cm'], device:null, lo:0, loOpen:true, hi:2000, hiOpen:true, integer:false },
  arm:{ label:'Upper arm', group:'body', units:['in', 'cm'], device:null, lo:0, loOpen:true, hi:2000, hiOpen:true, integer:false },
  thigh:{ label:'Thigh', group:'body', units:['in', 'cm'], device:null, lo:0, loOpen:true, hi:2000, hiOpen:true, integer:false },
  steps:{ label:'Steps', group:'activity', units:['steps'], device:'device_estimated', lo:0, loOpen:false, hi:200000, hiOpen:false, integer:true, summary:'total' },
  active_minutes:{ label:'Active minutes', group:'activity', units:['min'], device:'device_estimated', lo:0, loOpen:false, hi:1440, hiOpen:false, integer:true, summary:'total' },
  workout_minutes:{ label:'Workout minutes', group:'activity', units:['min'], device:'device_measured', lo:0, loOpen:false, hi:1440, hiOpen:false, integer:true, summary:'total' },
  distance:{ label:'Distance', group:'activity', units:['mi', 'km'], device:'device_estimated', lo:0, loOpen:false, hi:1000, hiOpen:true, integer:false, summary:'total' },
  resting_heart_rate:{ label:'Resting heart rate', group:'activity', units:['bpm'], device:'device_measured', lo:20, loOpen:false, hi:250, hiOpen:false, integer:true, summary:'average' },
});
const ADULT_HEALTH_METHODS = Object.freeze({ entered:'Entered by you', device_measured:'Measured by a device', device_estimated:'Estimated by a device' });
const ADULT_HEALTH_ORIGINS = Object.freeze({ device:'A device or app export', own_records:'My own records' });
const ADULT_HEALTH_IMPORT_MAX_ROWS = 5000;
const ADULT_HEALTH_SAVE_MAX = 2000;
const ADULT_HEALTH_UNIT_ALIASES = Object.freeze({
  lbs:'lb', pound:'lb', pounds:'lb', kgs:'kg', kilogram:'kg', kilograms:'kg',
  inch:'in', inches:'in', centimeter:'cm', centimeters:'cm', centimetre:'cm', centimetres:'cm',
  step:'steps', minute:'min', minutes:'min', mins:'min',
  mile:'mi', miles:'mi', kilometer:'km', kilometers:'km', kilometre:'km', kilometres:'km',
  beats_per_minute:'bpm',
});

function adultHealthText(value, max){
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim().replace(/\s+/g, ' ').slice(0, max) : '';
}
const adultHealthSlug = raw => String(raw == null ? '' : raw).trim().toLowerCase().replace(/[\s-]+/g, '_');

// A reading's key from its own spelling or its label: "resting heart rate", "Resting-Heart-Rate" and
// "resting_heart_rate" are the same reading.
function adultHealthMetricKey(raw){
  const s = adultHealthSlug(raw);
  if (Object.hasOwn(ADULT_HEALTH_METRICS, s)) return s;
  return Object.keys(ADULT_HEALTH_METRICS).find(k => adultHealthSlug(ADULT_HEALTH_METRICS[k].label) === s) || null;
}
function adultHealthUnit(raw){
  const s = adultHealthSlug(raw);
  return Object.hasOwn(ADULT_HEALTH_UNIT_ALIASES, s) ? ADULT_HEALTH_UNIT_ALIASES[s] : s;
}
function adultHealthValueOk(meta, value){
  if (!Number.isFinite(value)) return false;
  if (meta.integer && !Number.isInteger(value)) return false;
  if (meta.loOpen ? value <= meta.lo : value < meta.lo) return false;
  if (meta.hiOpen ? value >= meta.hi : value > meta.hi) return false;
  return true;
}
// A real calendar date written YYYY-MM-DD. The parts are checked against a date built from them, so 2026-02-30 fails;
// no clock or timezone is involved.
function adultHealthIsDate(on){
  const m = typeof on === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(on) : null;
  if (!m || on < '1900-01-01') return false;
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  const built = new Date(Date.UTC(y, mo, d));
  return built.getUTCFullYear() === y && built.getUTCMonth() === mo && built.getUTCDate() === d;
}
function adultHealthRange(meta){
  return (meta.loOpen ? 'more than ' : '') + meta.lo + ' to ' + (meta.hiOpen ? 'under ' : '') + meta.hi;
}

// A typed-in or imported reading, checked and put in the form the database stores. ctx names where it came from:
// { source_kind:'manual'|'file_import', origin:'device'|'own_records' (imports only), today:'YYYY-MM-DD' }.
function adultHealthNormalize(input, ctx){
  const i = input || {}, c = ctx || {};
  const no = (reason, error) => ({ ok:false, reason, error });
  const key = adultHealthMetricKey(i.metric_key);
  if (!key) return no('metric', 'That isn’t a reading this record keeps.');
  const meta = ADULT_HEALTH_METRICS[key];
  const unit = adultHealthUnit(i.unit);
  if (!meta.units.includes(unit)) return no('unit', meta.label + ' takes ' + meta.units.join(' or ') + '.');
  const raw = typeof i.value === 'string' ? i.value.trim() : i.value;
  let value = raw === '' || raw === null || raw === undefined ? NaN : Number(raw);
  if (Number.isFinite(value) && !meta.integer) value = Math.round(value * 100) / 100;
  if (!adultHealthValueOk(meta, value)) {
    return no('value', meta.label + ' should be ' + (meta.integer ? 'a whole number from ' : 'a number from ') + adultHealthRange(meta) + '.');
  }
  const on = typeof i.measured_on === 'string' ? i.measured_on.trim() : '';
  if (!adultHealthIsDate(on)) return no('date', 'Use a date written as YYYY-MM-DD.');
  if (c.today && on > c.today) return no('future', 'That date hasn’t happened yet.');
  let method = 'entered', externalId = null;
  if (c.source_kind === 'file_import') {
    if (c.origin === 'device') {
      if (!meta.device) return no('not_from_device', meta.label + ' is a tape measurement, so it can only come from your own records.');
      method = meta.device;
    }
    externalId = adultHealthText(i.external_id, 120) || null;
  }
  return { ok:true, record:{ metric_key:key, value, unit, measured_on:on, method, external_id:externalId } };
}

// The key a duplicate shares. Mirrors the two unique indexes: with the source's own id, one reading per source and
// id; without it, one per source, day, value and unit.
function adultHealthKey(record, source){
  const kind = source && source.source_kind, name = String((source && source.source_name) || '').toLowerCase();
  return record.external_id
    ? [kind, name, record.metric_key, 'id', record.external_id].join('|')
    : [kind, name, record.metric_key, record.measured_on, String(Number(record.value)), record.unit].join('|');
}

// A CSV with a header row naming date, metric, value and unit, and optionally id. Quoted cells, a byte-order mark
// and Windows line endings are handled; nothing else is guessed.
function adultHealthParseCsv(text){
  const src = String(text || '').replace(/^﻿/, '');
  const table = []; let row = [], cell = '', quoted = false, line = 1, rowLine = 1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else { if (ch === '\n') line++; cell += ch; }
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); table.push({ line:rowLine, cells:row }); row = []; cell = ''; line++; rowLine = line;
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); table.push({ line:rowLine, cells:row }); }
  const rows = table.filter(r => r.cells.some(c => c.trim() !== ''));
  if (!rows.length) return { ok:false, error:'That file is empty.' };
  const header = rows[0].cells.map(h => h.trim().toLowerCase());
  const col = name => header.indexOf(name);
  if (['date', 'metric', 'value', 'unit'].some(name => col(name) < 0)) {
    return { ok:false, error:'The first row needs the columns date, metric, value and unit (and optionally id).' };
  }
  const data = rows.slice(1);
  if (data.length > ADULT_HEALTH_IMPORT_MAX_ROWS) return { ok:false, error:'A file can hold up to ' + ADULT_HEALTH_IMPORT_MAX_ROWS + ' readings.' };
  const at = (r, name) => (col(name) < 0 ? '' : String(r.cells[col(name)] == null ? '' : r.cells[col(name)]).trim());
  return { ok:true, rows:data.map(r => ({ line:r.line, date:at(r, 'date'), metric:at(r, 'metric'), value:at(r, 'value'), unit:at(r, 'unit'), id:at(r, 'id') })) };
}

// What an import would do, before anything is saved: the readings to add, how many are already recorded (in the
// database or earlier in the same file), and each row that can't be used, with why.
function adultHealthPlanImport(rows, existingKeys, ctx){
  const seen = new Set(existingKeys || []);
  const records = [], rejected = [];
  let duplicates = 0;
  (rows || []).forEach(r => {
    const n = adultHealthNormalize({ metric_key:r.metric, value:r.value, unit:r.unit, measured_on:r.date, external_id:r.id }, ctx);
    if (!n.ok) { rejected.push({ line:r.line, reason:n.reason, error:n.error }); return; }
    const key = adultHealthKey(n.record, ctx);
    if (seen.has(key)) { duplicates++; return; }
    seen.add(key);
    records.push(n.record);
  });
  return { received:(rows || []).length, records, duplicates, rejected };
}

function adultHealthSourceLabel(record){
  if (!record || record.source_kind === 'manual') return 'Typed in';
  return (record.source_name || 'Imported') + (record.method === 'entered' ? ' (your records)' : '');
}

// The latest reading against the previous one in the same unit. A change across units is not computed: turning a
// kitchen scale's kilograms into a gym scale's pounds would claim a precision neither has.
function adultHealthTrend(records, metricKey){
  const list = (records || []).filter(r => r.metric_key === metricKey).slice()
    .sort((a, b) => String(b.measured_on).localeCompare(String(a.measured_on)) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const latest = list[0] || null;
  if (!latest) return null;
  const previous = list.slice(1).find(r => r.unit === latest.unit) || null;
  const change = previous ? Math.round((Number(latest.value) - Number(previous.value)) * 10) / 10 : null;
  return { latest, previous, change, count:list.length };
}

// This week's activity, one number a day per reading, so a phone export and a typed-in number for the same day are
// never added together. On each day the reading comes from a single source: a device's over a typed one, and among
// those the most recently saved. Within that source a total takes the day's largest value (a re-exported daily total
// only grows) and resting heart rate its lowest. Readings in a second unit are left out and counted, not converted.
function adultActivityWeek(records, dates){
  const days = new Set(dates || []), out = {};
  Object.keys(ADULT_HEALTH_METRICS).filter(k => ADULT_HEALTH_METRICS[k].group === 'activity').forEach(key => {
    const meta = ADULT_HEALTH_METRICS[key];
    const rows = (records || []).filter(r => r.metric_key === key && days.has(r.measured_on));
    if (!rows.length) return;
    const unitCount = u => rows.filter(r => r.unit === u).length;
    const unit = meta.units.slice().sort((a, b) => unitCount(b) - unitCount(a))[0];
    const daily = [];
    (dates || []).forEach(d => {
      const day = rows.filter(r => r.measured_on === d && r.unit === unit);
      if (!day.length) return;
      const sourceOf = r => r.source_kind + '|' + String(r.source_name || '').toLowerCase() + '|' + r.method;
      const pick = day.slice().sort((a, b) => ((a.method === 'entered') - (b.method === 'entered'))
        || String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
      const values = day.filter(r => sourceOf(r) === sourceOf(pick)).map(r => Number(r.value));
      daily.push({ date:d, value:meta.summary === 'average' ? Math.min(...values) : Math.max(...values), source:adultHealthSourceLabel(pick) });
    });
    const sum = daily.reduce((n, x) => n + x.value, 0);
    out[key] = {
      label:meta.label, unit, summary:meta.summary, days:daily.length, daily,
      value:meta.summary === 'average' ? Math.round(sum / daily.length) : Math.round(sum * 100) / 100,
      otherUnitReadings:rows.filter(r => r.unit !== unit).length,
    };
  });
  return out;
}
