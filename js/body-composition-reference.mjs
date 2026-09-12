/* Externally measured body composition: DEXA, clinical BIA, smart scales, health platforms and
 * transcribed reports.
 *
 * This is a DIFFERENT RECORD TYPE from js/body-composition-contract.mjs, deliberately and at the
 * schema level. That module describes what a MODEL estimated; this one describes what a DEVICE or
 * a clinic MEASURED. They must never be interchangeable, because the entire value of importing a
 * DEXA scan is that it is not a guess — and the entire honesty of an estimate is that it is.
 * A reader holding either record can tell which it is without knowing where it came from.
 *
 * WHAT THIS DOES NOT ACCEPT, and why each one matters:
 *
 *   Report bytes, images or file contents. An attachment is referenced by an opaque storage key.
 *   Putting a PDF in the JSON would drag a clinical document containing a name, a date of birth
 *   and a referring physician into every export and audit row that touches the record.
 *
 *   A subject's name. Records address a subject by identifier. A clinic report has a name on it;
 *   the transcription must not.
 *
 *   A measured claim a source cannot make. BIA does not measure fat mass, it estimates it from
 *   impedance. DXA does not measure skeletal muscle mass or visceral fat. BMI is never measured
 *   by anything — it is arithmetic on height and weight. These are enforced per output and per
 *   source rather than left to whoever fills in the form.
 */

const SCHEMA = 'PP_BODY_COMPOSITION_REFERENCE_V1';

// Everything a reference record may carry. Wider than the model dictionary on purpose: consumer
// devices report quantities no model here produces, and refusing to record them would push
// people into writing them somewhere unstructured.
const METRICS = Object.freeze({
  body_fat_percent:         { unit: 'percent', min: 1,   max: 75,  label: 'Body fat' },
  fat_mass_kg:              { unit: 'kg',      min: 0,   max: 180, label: 'Fat mass' },
  lean_mass_kg:             { unit: 'kg',      min: 5,   max: 220, label: 'Lean mass' },
  skeletal_muscle_mass_kg:  { unit: 'kg',      min: 2,   max: 140, label: 'Skeletal muscle mass' },
  bone_mineral_content_kg:  { unit: 'kg',      min: 0.2, max: 10,  label: 'Bone mineral content' },
  bone_mass_kg:             { unit: 'kg',      min: 0.5, max: 15,  label: 'Bone mass' },
  body_water_mass_kg:       { unit: 'kg',      min: 5,   max: 120, label: 'Total body water' },
  visceral_fat_index:       { unit: 'index',   min: 1,   max: 60,  label: 'Visceral fat index' },
  weight_kg:                { unit: 'kg',      min: 2,   max: 400, label: 'Weight' },
  bmi:                      { unit: 'kg_m2',   min: 5,   max: 90,  label: 'Body mass index' },
});

// What each kind of source is actually capable of saying, and how strongly.
//
// `measures` are quantities the method observes. `estimates` are quantities it derives from
// something else it observed. The distinction is the whole point of the record: a DEXA fat mass
// and a bathroom-scale fat mass are not the same claim, and a product that shows them identically
// is lying by layout.
const SOURCES = Object.freeze({
  dexa: Object.freeze({
    label: 'DXA scan',
    // DXA resolves fat, lean and bone from two X-ray energies. It does not isolate skeletal
    // muscle from lean soft tissue, and it does not report a visceral-fat index on the
    // consumer scale devices use — refusing both here stops a DXA import from silently
    // acquiring a quantity the scan never produced.
    measures: ['body_fat_percent', 'fat_mass_kg', 'lean_mass_kg', 'bone_mineral_content_kg', 'weight_kg'],
    estimates: [],
    requiresFacility: true,
  }),
  bia_clinical: Object.freeze({
    label: 'Clinical bioimpedance',
    // Impedance is what is measured. Everything reported is derived from it by the device's own
    // equation, so nothing here may be labelled `measured` except body weight from its scale.
    measures: ['weight_kg'],
    estimates: ['body_fat_percent', 'fat_mass_kg', 'lean_mass_kg', 'skeletal_muscle_mass_kg',
                'bone_mass_kg', 'body_water_mass_kg', 'visceral_fat_index'],
    requiresFacility: true,
  }),
  smart_scale: Object.freeze({
    label: 'Smart scale',
    measures: ['weight_kg'],
    estimates: ['body_fat_percent', 'fat_mass_kg', 'lean_mass_kg', 'skeletal_muscle_mass_kg',
                'bone_mass_kg', 'body_water_mass_kg', 'visceral_fat_index'],
    requiresFacility: false,
  }),
  health_platform: Object.freeze({
    label: 'Health platform',
    // Apple Health and Health Connect transport a value some other app or device produced. The
    // platform is not the source, so the originating app must be named or the provenance is a
    // dead end.
    measures: ['weight_kg'],
    estimates: ['body_fat_percent', 'fat_mass_kg', 'lean_mass_kg', 'skeletal_muscle_mass_kg',
                'bone_mass_kg', 'body_water_mass_kg', 'visceral_fat_index'],
    requiresFacility: false,
    requiresOriginatingApp: true,
  }),
  manual_report: Object.freeze({
    label: 'Transcribed report',
    // A person read a document and typed the numbers. What the underlying method measured is
    // recorded in `methodLabel`; the transcription itself is never stronger than the document,
    // so the record must say whether that document is retained.
    measures: ['body_fat_percent', 'fat_mass_kg', 'lean_mass_kg', 'bone_mineral_content_kg', 'weight_kg'],
    estimates: ['skeletal_muscle_mass_kg', 'bone_mass_kg', 'body_water_mass_kg', 'visceral_fat_index'],
    requiresFacility: false,
    requiresMethodLabel: true,
  }),
});

// BMI is arithmetic. No device measures it and no device estimates it; it is computed from a
// height and a weight, and saying otherwise would make "measured" meaningless.
const ALWAYS_CALCULATED = Object.freeze(['bmi']);

const FORBIDDEN = /(^|_)(photo|photos|image|images|scan_image|landmark|landmarks|mask|masks|contour|contours|mesh|meshes|geometry|geometries|vertex|vertices|face|faces|bytes|base64|blob|file_data|contents|first_name|last_name|full_name|patient|patient_name|dob|date_of_birth|ssn|mrn|address|phone|email)($|_)/i;

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'BodyCompositionReferenceError', code }); };

const clean = (value, label, max = 300) => {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max
    || /[\u0000-\u001f\u007f]/.test(value)) fail('INVALID_REFERENCE_RECORD', label + ' is invalid.');
  return value;
};
const optional = (value, label, max = 300) => (value == null ? null : clean(value, label, max));
const instant = (value, label) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('INVALID_REFERENCE_RECORD', label + ' must be an ISO date.');
  return new Date(value).toISOString();
};

function rejectForbidden(value, path = 'record') {
  if (Array.isArray(value)) { value.forEach((v, i) => rejectForbidden(v, path + '[' + i + ']')); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    if (FORBIDDEN.test(normalized)) {
      fail('CAPTURE_DATA_FORBIDDEN', 'A reference record cannot contain ' + path + '.' + key
        + '. Report documents are referenced by storage key, never embedded, and a subject is addressed by identifier.');
    }
    rejectForbidden(item, path + '.' + key);
  }
}

// Convert to the storage unit, keeping what the source actually said. A scale that reported
// pounds must not have that fact erased: a reader comparing two records needs to know one of them
// was rounded to the nearest 0.1 lb before it became kilograms.
const CONVERSIONS = Object.freeze({
  kg: Object.freeze({ kg: 1 }),
  lb: Object.freeze({ kg: 0.45359237 }),
  percent: Object.freeze({ percent: 1 }),
  index: Object.freeze({ index: 1 }),
  kg_m2: Object.freeze({ kg_m2: 1 }),
});

function normalize(key, value, unit) {
  const metric = METRICS[key];
  const table = CONVERSIONS[unit];
  const factor = table && table[metric.unit];
  if (!Number.isFinite(value) || factor === undefined) {
    fail('INVALID_REFERENCE_RECORD', key + ' cannot be read as ' + unit + '; supported units for it are ' + Object.keys(CONVERSIONS).filter(u => CONVERSIONS[u][metric.unit] !== undefined).join(', ') + '.');
  }
  const normalized = value * factor;
  if (normalized < metric.min || normalized > metric.max) {
    fail('IMPLAUSIBLE_REFERENCE_VALUE', metric.label + ' of ' + value + ' ' + unit + ' is outside the range this record type accepts ('
      + metric.min + '–' + metric.max + ' ' + metric.unit + '). A transcription error is far more likely than a real value here, so it is refused rather than stored.');
  }
  // Round to a tenth of the storage unit. Carrying float noise from a unit conversion into a
  // clinical record invents precision the source never had.
  return Math.round(normalized * 10) / 10;
}

function readOutput(item, source, seen) {
  const key = clean(item?.key, 'output key', 100);
  const metric = METRICS[key];
  if (!metric) fail('INVALID_REFERENCE_RECORD', key + ' is not a supported composition quantity.');
  if (seen.has(key)) fail('INVALID_REFERENCE_RECORD', key + ' appears more than once.');
  seen.add(key);

  const declared = clean(item?.status, 'output status', 40);
  if (!['measured', 'device_estimated', 'calculated'].includes(declared)) {
    fail('INVALID_REFERENCE_RECORD', key + ' must say whether it was measured, device_estimated or calculated.');
  }

  if (ALWAYS_CALCULATED.includes(key) && declared !== 'calculated') {
    fail('UNSUPPORTED_SOURCE_CLAIM', metric.label + ' is arithmetic on height and weight. No device measures or estimates it, so it can only be recorded as calculated.');
  }
  if (!ALWAYS_CALCULATED.includes(key)) {
    const canMeasure = source.measures.includes(key), canEstimate = source.estimates.includes(key);
    if (!canMeasure && !canEstimate) {
      fail('UNSUPPORTED_SOURCE_CLAIM', source.label + ' does not report ' + metric.label + '. Recording it here would attribute a quantity to a method that never produced it.');
    }
    if (declared === 'measured' && !canMeasure) {
      fail('UNSUPPORTED_SOURCE_CLAIM', source.label + ' derives ' + metric.label + ' rather than measuring it; record it as device_estimated.');
    }
    if (declared === 'device_estimated' && !canEstimate && canMeasure) {
      fail('UNSUPPORTED_SOURCE_CLAIM', source.label + ' measures ' + metric.label + ' directly; recording it as an estimate understates what the source actually did.');
    }
  }

  const originalUnit = clean(item?.unit, key + ' unit', 20);
  const value = item?.value;
  return Object.freeze({
    key,
    label: metric.label,
    status: declared,
    value: normalize(key, value, originalUnit),
    unit: metric.unit,
    original: Object.freeze({ value: Number.isFinite(value) ? value : fail('INVALID_REFERENCE_RECORD', key + ' has no numeric value.'), unit: originalUnit }),
  });
}

export const REFERENCE_METRICS = METRICS;
export const REFERENCE_SOURCES = SOURCES;

/* Validate an externally measured composition record.
 *
 * Returns a frozen, normalized record. Throws with a code and a sentence explaining what a person
 * should do about it — these are read by whoever is typing a clinic report into a form, and
 * "INVALID" on its own sends them to support rather than to the field they mistyped.
 */
export function validateCompositionReference(input) {
  rejectForbidden(input);

  if (input?.schema !== SCHEMA) fail('INVALID_REFERENCE_RECORD', 'A record must declare schema ' + SCHEMA + '.');
  // The one claim this record type can never make. An estimate has its own schema and its own
  // validator; conflating them is the failure this whole module exists to prevent.
  if ('estimated' === input.status || input.provider != null || input.modelManifest != null) {
    fail('NOT_AN_ESTIMATE', 'This record type describes an external measurement. A model estimate uses PP_BODY_COMPOSITION_ESTIMATE_V1 and must not be recorded here.');
  }

  const sourceClass = clean(input.sourceClass, 'sourceClass', 40);
  const source = SOURCES[sourceClass];
  if (!source) fail('INVALID_REFERENCE_RECORD', sourceClass + ' is not a supported source. Supported: ' + Object.keys(SOURCES).join(', ') + '.');

  const scope = clean(input.scope, 'scope', 40);
  if (!['adult_reference', 'child_athlete'].includes(scope)) fail('INVALID_REFERENCE_RECORD', 'scope must be adult_reference or child_athlete.');

  const device = input.device || {};
  const facility = optional(device.facility, 'device.facility', 200);
  if (source.requiresFacility && !facility) {
    fail('INVALID_REFERENCE_RECORD', source.label + ' results come from a facility; record which one, so a reader can tell two scanners apart.');
  }
  const originatingApp = optional(device.originatingApp, 'device.originatingApp', 200);
  if (source.requiresOriginatingApp && !originatingApp) {
    fail('INVALID_REFERENCE_RECORD', 'A health platform only transports a value another app recorded. Name the originating app or the provenance ends at the platform.');
  }
  const methodLabel = optional(input.methodLabel, 'methodLabel', 200);
  if (source.requiresMethodLabel && !methodLabel) {
    fail('INVALID_REFERENCE_RECORD', 'A transcribed report must say what method produced it; the transcription is never better evidence than the document.');
  }

  if (!Array.isArray(input.outputs) || !input.outputs.length || input.outputs.length > Object.keys(METRICS).length) {
    fail('INVALID_REFERENCE_RECORD', 'A record needs at least one output and cannot repeat the dictionary.');
  }
  const seen = new Set();
  const outputs = input.outputs.map(item => readOutput(item, source, seen));

  const measuredAt = instant(input.measuredAt, 'measuredAt');
  const savedAt = instant(input.savedAt, 'savedAt');
  if (Date.parse(measuredAt) > Date.parse(savedAt)) {
    fail('INVALID_REFERENCE_RECORD', 'A measurement cannot have been taken after it was saved.');
  }
  const retentionUntil = instant(input.retentionUntil, 'retentionUntil');
  if (Date.parse(retentionUntil) <= Date.parse(savedAt)) {
    fail('INVALID_REFERENCE_RECORD', 'retentionUntil must be after savedAt, or the record expires the moment it is written.');
  }

  const attachment = input.attachment == null ? null : Object.freeze({
    storageKey: clean(input.attachment.storageKey, 'attachment.storageKey', 300),
    contentType: clean(input.attachment.contentType, 'attachment.contentType', 100),
    verification: (() => {
      const status = clean(input.attachment.verification?.status, 'attachment.verification.status', 40);
      if (!['unverified', 'verified_against_report'].includes(status)) {
        fail('INVALID_REFERENCE_RECORD', 'An attachment is either unverified or verified_against_report.');
      }
      if (status === 'unverified') return Object.freeze({ status });
      return Object.freeze({
        status,
        verifiedBy: clean(input.attachment.verification.verifiedBy, 'attachment.verification.verifiedBy', 180),
        verifiedAt: instant(input.attachment.verification.verifiedAt, 'attachment.verification.verifiedAt'),
      });
    })(),
  });

  if (sourceClass === 'manual_report' && attachment == null && input.reportRetained !== false) {
    fail('INVALID_REFERENCE_RECORD', 'A transcribed report must either reference the retained document or state reportRetained:false, so a reader knows whether the original can still be checked.');
  }

  return Object.freeze({
    schema: SCHEMA,
    origin: 'external_measurement',
    recordId: clean(input.recordId, 'recordId', 180),
    subjectId: clean(input.subjectId, 'subjectId', 180),
    scope,
    athleteId: scope === 'child_athlete'
      ? (typeof input.athleteId === 'string' && input.athleteId.trim()
          ? clean(input.athleteId, 'athleteId', 180)
          : fail('INVALID_REFERENCE_RECORD', 'A child record must name the athlete it belongs to. Without one it cannot be bound to a guardian consent, and nothing would stop it being read for the wrong child.'))
      : (input.athleteId == null ? null : fail('INVALID_REFERENCE_RECORD', 'An adult reference record must not carry an athlete identifier. Mixing the two scopes is how an adult reference ends up inside a child roster.')),
    organizationId: optional(input.organizationId, 'organizationId', 180),
    actorId: clean(input.actorId, 'actorId', 180),
    consentReference: clean(input.consentReference, 'consentReference', 180),
    sourceClass,
    sourceLabel: source.label,
    methodLabel,
    device: Object.freeze({
      manufacturer: optional(device.manufacturer, 'device.manufacturer', 200),
      model: optional(device.model, 'device.model', 200),
      softwareVersion: optional(device.softwareVersion, 'device.softwareVersion', 100),
      facility,
      operator: optional(device.operator, 'device.operator', 200),
      originatingApp,
    }),
    measuredAt, savedAt, retentionUntil,
    outputs: Object.freeze(outputs),
    attachment,
    reportRetained: attachment != null,
    limitations: 'Externally supplied measurement recorded as reported by its source. Parent Playbook did not perform this measurement, has not verified the device calibration, and makes no accuracy claim about it. Device-estimated values are the device manufacturer’s derivation, not a direct measurement.',
  });
}

/* How a reader must label a record, whichever type it is.
 *
 * Exists so the answer lives in one place. A screen that works it out from whichever fields
 * happen to be present will eventually get it wrong on a record shape nobody anticipated, and the
 * way it gets it wrong is by calling somebody's DEXA scan a Parent Playbook estimate.
 */
export function describeCompositionOrigin(record) {
  if (record?.schema === SCHEMA) {
    const anyMeasured = (record.outputs || []).some(o => o.status === 'measured');
    return Object.freeze({
      origin: 'external_measurement',
      isParentPlaybookEstimate: false,
      label: anyMeasured ? 'Externally measured' : 'Device estimated',
      detail: record.sourceLabel + (record.device?.model ? ' · ' + record.device.model : ''),
      perOutput: Object.freeze(Object.fromEntries((record.outputs || []).map(o => [o.key,
        o.status === 'measured' ? 'Externally measured'
          : o.status === 'device_estimated' ? 'Device estimated'
            : 'Calculated'])),),
    });
  }
  if (record?.schema === 'PP_BODY_COMPOSITION_ESTIMATE_V1') {
    return Object.freeze({
      origin: 'model_estimate',
      isParentPlaybookEstimate: true,
      label: 'Parent Playbook estimated',
      detail: record.provider?.model || 'model estimate',
      perOutput: Object.freeze(Object.fromEntries((record.outputs || []).map(o => [o.key, 'Parent Playbook estimated']))),
    });
  }
  fail('UNKNOWN_RECORD_TYPE', 'A composition record must be an external reference or a model estimate; anything else has no honest label.');
}
