/* Getting an externally measured body composition result INTO the product.
 *
 * Three doors, one destination. A parent types a clinic printout by hand, or exports a CSV from a
 * smart scale, or hands over a JSON file another Parent Playbook install produced. All three end
 * at validateCompositionReference in js/body-composition-reference.mjs, which is the only thing
 * that decides whether a record is storable.
 *
 * This module exists for the part that module deliberately does not do: turning whatever a person
 * actually has into that shape, and explaining what went wrong in the vocabulary of the thing they
 * are looking at — a row number, a column heading, a field on a form.
 *
 * THREE DECISIONS WORTH KNOWING ABOUT, because each one refuses something a looser importer
 * would have accepted:
 *
 *   The typist never chooses `measured` vs `device_estimated`. It is derived from what the source
 *   is capable of. Asking would put the strength of a claim in the hands of whoever is doing data
 *   entry, and "measured" is exactly the option a hurried person picks.
 *
 *   A mass column must name its unit. A US smart scale exporting pounds into a column headed
 *   "Weight" is not unusual, and assuming kilograms would silently record someone at 45% of their
 *   weight — inside every plausibility range, so nothing downstream would ever catch it.
 *
 *   A date the file cannot disambiguate is refused. 01/02/2026 is two different days. The whole
 *   file is examined first, because one row with a day past the 12th settles the order for every
 *   other row; only when nothing in the file settles it does the import stop and ask.
 */

import { REFERENCE_METRICS, REFERENCE_SOURCES, validateCompositionReference } from './body-composition-reference.mjs';

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'CompositionImportError', code }); };

/* What a source is allowed to say about a quantity, worked out rather than asked.
 *
 * The contract enforces this too and will reject an overclaim outright. Deriving it here means a
 * correct record is built in the first place, so the enforcement never has to fire at someone who
 * simply picked the wrong radio button.
 */
export function statusFor(sourceClass, key) {
  const source = REFERENCE_SOURCES[sourceClass];
  if (!source) fail('UNSUPPORTED_SOURCE', sourceClass + ' is not a source this product can import.');
  if (!REFERENCE_METRICS[key]) fail('UNSUPPORTED_METRIC', key + ' is not a composition quantity this product records.');
  if (key === 'bmi') return 'calculated';
  if (source.measures.includes(key)) return 'measured';
  if (source.estimates.includes(key)) return 'device_estimated';
  return null;                       // the source does not report it at all
}

/* The quantities a given source can contribute, for building a form or validating a header.
 * Ordered as the dictionary is, so two screens never disagree about what comes first.
 */
export function importableMetrics(sourceClass) {
  return Object.freeze(Object.keys(REFERENCE_METRICS)
    .filter(key => statusFor(sourceClass, key) !== null)
    .map(key => Object.freeze({
      key,
      label: REFERENCE_METRICS[key].label,
      unit: REFERENCE_METRICS[key].unit,
      status: statusFor(sourceClass, key),
      // A mass has to be told apart from a percentage at the point of entry, not afterwards.
      unitChoices: REFERENCE_METRICS[key].unit === 'kg' ? Object.freeze(['kg', 'lb']) : Object.freeze([REFERENCE_METRICS[key].unit]),
    })));
}

/* ------------------------------------------------------------------ column headings
 *
 * Aliases people actually have, not a guess at what they should type. Matching is done on a
 * squashed form so "Body Fat %", "body_fat_pct" and "BodyFat%" are one heading.
 */
const squash = text => String(text).toLowerCase().replace(/[^a-z0-9]/g, '');

const HEADER_ALIASES = Object.freeze({
  body_fat_percent: ['bodyfat', 'bodyfatpercent', 'bodyfatpct', 'bodyfatpercentage', 'bf', 'bfpercent', 'fatpercent', 'fatpct'],
  fat_mass_kg: ['fatmass', 'bodyfatmass', 'massfat'],
  lean_mass_kg: ['leanmass', 'leanbodymass', 'lbm', 'fatfreemass', 'ffm'],
  skeletal_muscle_mass_kg: ['skeletalmusclemass', 'musclemass', 'smm', 'muscle'],
  bone_mineral_content_kg: ['bonemineralcontent', 'bmc'],
  bone_mass_kg: ['bonemass', 'bone'],
  body_water_mass_kg: ['bodywater', 'totalbodywater', 'tbw', 'water', 'watermass'],
  visceral_fat_index: ['visceralfat', 'visceralfatindex', 'visceralfatrating', 'vfi', 'vfr'],
  weight_kg: ['weight', 'bodyweight', 'mass'],
  bmi: ['bmi', 'bodymassindex'],
});

const DATE_ALIASES = ['date', 'datetime', 'measuredat', 'measurementdate', 'timestamp', 'time', 'takenat', 'recordedat', 'when'];

// "Weight (lb)", "Weight [kg]", "Fat mass - lbs". The unit rides in the heading far more often
// than it gets its own column.
const UNIT_IN_HEADER = /[([\-\s](kg|kgs|kilograms?|lb|lbs|pounds?|%|percent|index)[)\]]?\s*$/i;
const UNIT_WORDS = Object.freeze({
  kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  '%': 'percent', percent: 'percent', index: 'index',
});

function readHeading(heading) {
  const raw = String(heading ?? '').trim();
  if (!raw) return null;
  let unit = null;
  const match = raw.match(UNIT_IN_HEADER);
  let name = raw;
  if (match) {
    unit = UNIT_WORDS[match[1].toLowerCase()] || null;
    if (unit) name = raw.slice(0, match.index).trim();
  }
  const squashed = squash(name);
  if (DATE_ALIASES.includes(squashed)) return { kind: 'date', raw };
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (key === squashed || aliases.includes(squashed)) return { kind: 'metric', key, unit, raw };
  }
  return { kind: 'ignored', raw };
}

/* ------------------------------------------------------------------ dates
 *
 * Read across the whole file before reading any single row. A slash date is ambiguous on its own
 * and usually is not ambiguous in company: one row dated the 13th settles the order for all of
 * them. Inferring per row instead would let one file contain both readings.
 */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})([T ](\d{2}):(\d{2})(:(\d{2}))?)?/;
const SLASH_DATE = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})([T ](\d{2}):(\d{2})(:(\d{2}))?)?$/;

export function inferDateOrder(values) {
  let sawSlash = false;
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    if (ISO_DATE.test(text)) continue;
    const m = text.match(SLASH_DATE);
    if (!m) continue;
    sawSlash = true;
    const first = Number(m[1]), second = Number(m[2]);
    if (first > 12 && second <= 12) return { order: 'dmy', reason: text + ' has ' + first + ' where a month would be, so this file is day/month/year.' };
    if (second > 12 && first <= 12) return { order: 'mdy', reason: text + ' has ' + second + ' where a month would be, so this file is month/day/year.' };
  }
  if (!sawSlash) return { order: 'iso', reason: 'Every date in the file is unambiguous.' };
  return { order: null, reason: 'Every slash date in this file could be read either way — 01/02/2026 is the 1st of February or the 2nd of January, and nothing here settles which. Re-export with ISO dates (2026-02-01), or fix the dates before importing.' };
}

function readMoment(text, order) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  const iso = value.match(ISO_DATE);
  if (iso) {
    const stamp = Date.parse(iso[4] ? value.replace(' ', 'T') + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? '' : 'Z') : value + 'T12:00:00Z');
    return Number.isFinite(stamp) ? { iso: new Date(stamp).toISOString(), dayOnly: !iso[4] } : null;
  }
  const slash = value.match(SLASH_DATE);
  if (slash && order && order !== 'iso') {
    const day = order === 'dmy' ? Number(slash[1]) : Number(slash[2]);
    const month = order === 'dmy' ? Number(slash[2]) : Number(slash[1]);
    const year = Number(slash[3]);
    // A time of day the file did not give is noon, not midnight. Midnight lands on the previous
    // day in any timezone west of UTC, which is how a scan slides a day earlier for half the world.
    const stamp = Date.UTC(year, month - 1, day, Number(slash[5] ?? 12), Number(slash[6] ?? 0), Number(slash[8] ?? 0));
    if (!Number.isFinite(stamp)) return null;
    const back = new Date(stamp);
    if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;   // 31 February
    return { iso: back.toISOString(), dayOnly: !slash[4] };
  }
  return null;
}

/* ------------------------------------------------------------------ CSV
 *
 * Quoted fields, embedded commas, doubled quotes and newlines inside quotes, a UTF-8 byte order
 * mark, and CRLF. All of these arrive in real exports; a split(',') importer mangles them into
 * values that still look like numbers.
 */
export function parseDelimited(text) {
  const body = String(text).replace(/^﻿/, '');
  const delimiter = pickDelimiter(body);
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\r') { if (body[i + 1] === '\n') i++; rows.push([...row, field]); row = []; field = ''; continue; }
    if (ch === '\n') { rows.push([...row, field]); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) rows.push([...row, field]);
  // A blank line is not a reading. Keeping them would number every later row wrong in the report.
  return rows.filter(cells => cells.some(cell => String(cell).trim() !== ''));
}

// Semicolon exports are the European decimal-comma convention; sniffing beats asking.
function pickDelimiter(body) {
  const firstLine = body.split(/\r?\n/, 1)[0] || '';
  const counts = [[',', 0], [';', 0], ['\t', 0]];
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    const hit = counts.find(c => c[0] === ch);
    if (hit) hit[1]++;
  }
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

const readNumber = text => {
  const value = String(text ?? '').trim().replace(/\s/g, '');
  if (!value) return null;
  // 1.234,5 is one thousand two hundred thirty four point five where a comma is the decimal mark.
  const normalized = /,\d{1,2}$/.test(value) && !/\.\d/.test(value) ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
  if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};

/* Read a delimited export into records, one per row.
 *
 * A row that cannot be read does not stop the file. Thirty-eight good readings and two explained
 * failures is a usable outcome; an all-or-nothing import of a forty-row export is not.
 */
export function parseCompositionCsv(text, context = {}) {
  if (typeof text !== 'string' || !text.trim()) fail('EMPTY_IMPORT', 'That file has nothing in it.');
  if (text.length > 4_000_000) fail('IMPORT_TOO_LARGE', 'That file is larger than this import accepts. Split it, or export a narrower date range.');
  const rows = parseDelimited(text);
  if (rows.length < 2) fail('EMPTY_IMPORT', 'That file has a heading row but no readings under it.');

  const sourceClass = context.sourceClass;
  if (!REFERENCE_SOURCES[sourceClass]) fail('UNSUPPORTED_SOURCE', 'Choose what produced this file before importing it.');

  const headings = rows[0].map(readHeading);
  const dateColumn = headings.findIndex(h => h?.kind === 'date');
  if (dateColumn === -1) {
    fail('NO_DATE_COLUMN', 'This file has no column saying when each reading was taken, so its rows cannot be placed in a history. A column headed Date or Measured is enough.');
  }
  const metricColumns = headings.map((h, i) => (h?.kind === 'metric' ? { ...h, index: i } : null)).filter(Boolean);
  if (!metricColumns.length) {
    fail('NO_METRIC_COLUMNS', 'None of these columns is a body composition quantity this product records. Recognised headings include Weight, Body fat %, Lean mass and Skeletal muscle mass.');
  }

  // Every column is checked against the source before a single row is read, because "a smart
  // scale does not measure bone mineral content" is a fact about the file, not about row 14.
  const unsupported = metricColumns.filter(c => statusFor(sourceClass, c.key) === null);
  if (unsupported.length) {
    fail('UNSUPPORTED_SOURCE_COLUMN', REFERENCE_SOURCES[sourceClass].label + ' does not report '
      + unsupported.map(c => REFERENCE_METRICS[c.key].label).join(', ')
      + '. Either this file came from something else, or those columns belong to a different reading.');
  }
  const unitless = metricColumns.filter(c => REFERENCE_METRICS[c.key].unit === 'kg' && !c.unit);
  if (unitless.length) {
    fail('AMBIGUOUS_UNIT', 'These columns do not say what unit they are in: '
      + unitless.map(c => c.raw).join(', ')
      + '. A weight in pounds read as kilograms is still a believable number, so this import will not guess — put the unit in the heading, like "Weight (lb)".');
  }

  const dateOrder = inferDateOrder(rows.slice(1).map(r => r[dateColumn]));
  if (!dateOrder.order) fail('AMBIGUOUS_DATE', dateOrder.reason);

  const records = [], problems = [];
  const seenInstants = new Map();
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i], line = i + 1;
    try {
      const measured = readMoment(cells[dateColumn], dateOrder.order);
      if (!measured) fail('UNREADABLE_DATE', 'the date "' + String(cells[dateColumn] ?? '').trim() + '" could not be read');

      const outputs = [];
      for (const column of metricColumns) {
        const value = readNumber(cells[column.index]);
        if (value === null) continue;                     // a blank cell is not a reading
        outputs.push({ key: column.key, status: statusFor(sourceClass, column.key), value, unit: column.unit || REFERENCE_METRICS[column.key].unit });
      }
      if (!outputs.length) fail('EMPTY_ROW', 'it has a date but no readable values');

      // Two rows at the same instant from one device are the same reading exported twice. The
      // database refuses the duplicate; saying so here means the person is not told after
      // committing to the whole file.
      if (seenInstants.has(measured.iso)) {
        fail('DUPLICATE_IN_FILE', 'it repeats the reading already on line ' + seenInstants.get(measured.iso));
      }
      seenInstants.set(measured.iso, line);

      records.push(buildRecord({ ...context, measuredAt: measured.iso, measuredDayOnly: measured.dayOnly, outputs, line }));
    } catch (error) {
      problems.push(Object.freeze({ line, reason: error.message, code: error.code || 'ROW_REJECTED' }));
    }
  }

  return Object.freeze({
    records: Object.freeze(records),
    problems: Object.freeze(problems),
    rowsRead: rows.length - 1,
    dateOrder: dateOrder.order,
    dateReason: dateOrder.reason,
    columnsUsed: Object.freeze(metricColumns.map(c => Object.freeze({ heading: c.raw, key: c.key, unit: c.unit || REFERENCE_METRICS[c.key].unit }))),
    columnsIgnored: Object.freeze(headings.filter(h => h?.kind === 'ignored').map(h => h.raw)),
  });
}

/* ------------------------------------------------------------------ manual entry
 *
 * One reading, typed from a document in front of someone. Values arrive as strings because they
 * came out of text inputs, and an empty field means "not on the report" rather than zero.
 */
export function readManualEntry(fields = {}, context = {}) {
  const sourceClass = fields.sourceClass || context.sourceClass;
  if (!REFERENCE_SOURCES[sourceClass]) fail('UNSUPPORTED_SOURCE', 'Choose what produced this reading.');

  const measured = readMoment(fields.measuredAt, 'iso')
    || fail('UNREADABLE_DATE', 'Enter the date on the report, as 2026-09-10.');

  const outputs = [];
  for (const [key, entry] of Object.entries(fields.values || {})) {
    const raw = entry && typeof entry === 'object' ? entry.value : entry;
    const value = readNumber(raw);
    if (value === null) {
      if (raw != null && String(raw).trim() !== '') {
        fail('UNREADABLE_VALUE', (REFERENCE_METRICS[key]?.label || key) + ' is not a number.');
      }
      continue;                                            // left blank on purpose
    }
    const status = statusFor(sourceClass, key);
    if (status === null) {
      fail('UNSUPPORTED_SOURCE_COLUMN', REFERENCE_SOURCES[sourceClass].label + ' does not report ' + (REFERENCE_METRICS[key]?.label || key) + '.');
    }
    const unit = (entry && typeof entry === 'object' && entry.unit) || REFERENCE_METRICS[key]?.unit;
    outputs.push({ key, status, value, unit });
  }
  if (!outputs.length) fail('EMPTY_ROW', 'Enter at least one value from the report.');

  return buildRecord({
    ...context,
    sourceClass,
    measuredAt: measured.iso,
    measuredDayOnly: measured.dayOnly,
    outputs,
    methodLabel: fields.methodLabel ?? context.methodLabel,
    device: { ...(context.device || {}), ...(fields.device || {}) },
  });
}

/* ------------------------------------------------------------------ JSON
 *
 * A record this product wrote, coming back — from another household, an export a clinic was given,
 * a device sync. It is re-validated from scratch rather than trusted: a file that has been out of
 * our hands is exactly as untrusted as a typed one.
 */
export function parseCompositionJson(text, context = {}) {
  if (typeof text !== 'string' || !text.trim()) fail('EMPTY_IMPORT', 'That file has nothing in it.');
  if (text.length > 4_000_000) fail('IMPORT_TOO_LARGE', 'That file is larger than this import accepts.');
  let value;
  try { value = JSON.parse(text); } catch { fail('NOT_JSON', 'That file is not valid JSON.'); }

  const items = Array.isArray(value) ? value : Array.isArray(value?.records) ? value.records : [value];
  if (!items.length) fail('EMPTY_IMPORT', 'That file contains no records.');

  const records = [], problems = [];
  items.forEach((item, index) => {
    const line = index + 1;
    try {
      if (item?.schema !== 'PP_BODY_COMPOSITION_REFERENCE_V1') {
        fail('WRONG_RECORD_TYPE', 'it is not an external measurement record'
          + (item?.schema === 'PP_BODY_COMPOSITION_ESTIMATE_V1' ? ' — it is a Parent Playbook estimate, which cannot be imported as a measurement' : ''));
      }
      // The file's own outputs are kept; its ownership fields are not. Whose record this is and
      // what consent covers it are decided here, never by the file.
      records.push(buildRecord({
        ...context,
        sourceClass: item.sourceClass,
        measuredAt: item.measuredAt,
        methodLabel: item.methodLabel,
        device: item.device,
        outputs: (item.outputs || []).map(o => ({ key: o.key, status: o.status, value: o.original?.value ?? o.value, unit: o.original?.unit ?? o.unit })),
        line,
      }));
    } catch (error) {
      problems.push(Object.freeze({ line, reason: error.message, code: error.code || 'ROW_REJECTED' }));
    }
  });

  return Object.freeze({
    records: Object.freeze(records),
    problems: Object.freeze(problems),
    rowsRead: items.length,
    columnsUsed: Object.freeze([]),
    columnsIgnored: Object.freeze([]),
  });
}

/* ------------------------------------------------------------------ assembly
 *
 * Everything that decides ownership, consent and retention comes from context — the screen knows
 * these and the file does not get a say. A CSV that could name its own athlete_id would be a way
 * to write a record onto somebody else's child.
 */
function buildRecord(input) {
  const savedAt = input.savedAt || new Date().toISOString();
  // A date with no time of day is recorded at midday, because midnight is the previous day
  // everywhere west of UTC. That default can land after "now" for a reading taken this morning,
  // and the contract rightly refuses a measurement taken after it was saved — so a real reading
  // would be rejected for having been imported too promptly. When the file only gave a day, and
  // that day is not in the future, the reading happened at some unknown time no later than now;
  // clamping to savedAt says exactly that and nothing more. A date genuinely in the future still
  // fails, which is what should happen to a typo.
  const measuredAt = (() => {
    const asked = input.measuredAt;
    if (!input.measuredDayOnly || Date.parse(asked) <= Date.parse(savedAt)) return asked;
    return String(asked).slice(0, 10) <= String(savedAt).slice(0, 10) ? savedAt : asked;
  })();
  const retentionUntil = input.retentionUntil
    || new Date(Date.parse(savedAt) + 1825 * 86400000).toISOString();

  // Deterministic, so importing the same export twice produces the same identity and collides
  // instead of quietly doubling a history.
  const recordId = input.recordId
    || [input.sourceClass, String(measuredAt).slice(0, 19).replace(/[:\-]/g, ''), input.device?.model || 'nodevice']
      .join('-').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 180);

  try {
    return validateCompositionReference({
      schema: 'PP_BODY_COMPOSITION_REFERENCE_V1',
      recordId,
      subjectId: input.subjectId,
      scope: input.scope,
      athleteId: input.scope === 'child_athlete' ? input.athleteId : null,
      organizationId: input.organizationId ?? null,
      actorId: input.actorId,
      consentReference: input.consentReference,
      sourceClass: input.sourceClass,
      methodLabel: input.methodLabel ?? null,
      device: {
        manufacturer: input.device?.manufacturer ?? null,
        model: input.device?.model ?? null,
        softwareVersion: input.device?.softwareVersion ?? null,
        facility: input.device?.facility ?? null,
        operator: input.device?.operator ?? null,
        originatingApp: input.device?.originatingApp ?? null,
      },
      measuredAt, savedAt, retentionUntil,
      outputs: input.outputs,
      attachment: input.attachment ?? null,
      reportRetained: input.attachment != null ? undefined : input.reportRetained,
    });
  } catch (error) {
    // The contract's message is the useful one; it names the field and says what to do. Only the
    // code is restated so a caller can tell a row rejection from a file rejection.
    throw Object.assign(new Error(error.message), { name: 'CompositionImportError', code: error.code || 'ROW_REJECTED' });
  }
}

/* One sentence a screen can show, so three screens do not invent three ways to say the same
 * thing — and so a partial import never reads as a clean one.
 */
export function describeImportOutcome(result) {
  const kept = result.records.length, refused = result.problems.length;
  if (!kept && refused) return { tone: 'error', text: 'Nothing could be imported: all ' + refused + (refused === 1 ? ' row was' : ' rows were') + ' refused.' };
  if (!kept) return { tone: 'error', text: 'Nothing in that file could be read as a reading.' };
  if (refused) return { tone: 'warning', text: kept + (kept === 1 ? ' reading is' : ' readings are') + ' ready to import. ' + refused + (refused === 1 ? ' row was' : ' rows were') + ' refused and will not be saved.' };
  return { tone: 'ok', text: kept + (kept === 1 ? ' reading is' : ' readings are') + ' ready to import.' };
}
