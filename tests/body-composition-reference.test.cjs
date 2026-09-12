// Externally measured body composition — DEXA, clinical BIA, smart scales, health platforms and
// transcribed reports.
//
// The acceptance criterion this module exists for, stated in the plan as: "An imported DEXA result
// can never be presented as a Parent Playbook estimate." That is not a UI rule. A screen that
// works out the label from whichever fields happen to be present will eventually meet a record
// shape nobody anticipated, and the way it gets that wrong is by calling somebody's clinical scan
// a guess we produced. So the two record types have different schemas, the reference validator
// refuses anything carrying model provenance, and one function answers "what is this" for both.
//
// The other thing being defended here is the meaning of the word "measured". Bioimpedance does not
// measure fat mass — it measures impedance and derives the rest through the manufacturer's
// equation. DXA does not isolate skeletal muscle or report a visceral-fat index. BMI is arithmetic
// and nothing measures it at all. Those are enforced per output and per source, because the
// alternative is a dropdown that lets whoever is typing decide what a machine did.
const test = require('node:test');
const assert = require('node:assert/strict');

let REF;
test.before(async () => { REF = await import('../js/body-composition-reference.mjs'); });

const SCHEMA = 'PP_BODY_COMPOSITION_REFERENCE_V1';

const dexa = (over = {}) => ({
  schema: SCHEMA, recordId: 'synthetic-record-1', subjectId: 'synthetic-adult-1',
  scope: 'adult_reference', actorId: 'synthetic-actor-1', consentReference: 'synthetic-consent-1',
  sourceClass: 'dexa',
  device: { manufacturer: 'Synthetic Imaging', model: 'Model A', facility: 'Synthetic Clinic', operator: 'synthetic-operator-1', softwareVersion: '1.2.3' },
  measuredAt: '2026-09-01T10:00:00Z', savedAt: '2026-09-01T10:05:00Z', retentionUntil: '2027-09-01T10:00:00Z',
  outputs: [
    { key: 'body_fat_percent', value: 22.4, unit: 'percent', status: 'measured' },
    { key: 'fat_mass_kg', value: 18.2, unit: 'kg', status: 'measured' },
    { key: 'lean_mass_kg', value: 58.1, unit: 'kg', status: 'measured' },
  ],
  ...over,
});

const refuses = (input, code, what) => {
  assert.throws(() => REF.validateCompositionReference(input),
    error => {
      assert.equal(error.name, 'BodyCompositionReferenceError', what);
      assert.equal(error.code, code, what + ' (got ' + error.code + ': ' + error.message + ')');
      assert.ok(error.message.length > 30, 'the message should tell a person what to do: ' + error.message);
      return true;
    }, what);
};

test('a DEXA record is accepted, normalized and marked as external', () => {
  const record = REF.validateCompositionReference(dexa());
  assert.equal(record.schema, SCHEMA);
  assert.equal(record.origin, 'external_measurement');
  assert.equal(record.sourceLabel, 'DXA scan');
  assert.equal(record.outputs.length, 3);
  assert.equal(record.outputs[0].status, 'measured');
  assert.match(record.limitations, /Parent Playbook did not perform this measurement/);
  assert.ok(Object.isFrozen(record) && Object.isFrozen(record.outputs));
});

test('THE CASE: an imported DEXA result can never be presented as our estimate', () => {
  const record = REF.validateCompositionReference(dexa());
  const described = REF.describeCompositionOrigin(record);
  assert.equal(described.isParentPlaybookEstimate, false);
  assert.equal(described.label, 'Externally measured');
  assert.equal(described.origin, 'external_measurement');
  for (const key of ['body_fat_percent', 'fat_mass_kg', 'lean_mass_kg']) {
    assert.equal(described.perOutput[key], 'Externally measured');
  }

  // And the same function labels a model estimate as ours, so the two answers come from one place.
  const estimate = { schema: 'PP_BODY_COMPOSITION_ESTIMATE_V1', provider: { model: 'synthetic-model' }, outputs: [{ key: 'body_fat_percent' }] };
  const asEstimate = REF.describeCompositionOrigin(estimate);
  assert.equal(asEstimate.isParentPlaybookEstimate, true);
  assert.equal(asEstimate.label, 'Parent Playbook estimated');
  assert.equal(asEstimate.perOutput.body_fat_percent, 'Parent Playbook estimated');

  // Anything else has no honest label and must not get a default one.
  assert.throws(() => REF.describeCompositionOrigin({ schema: 'something-else' }), /UNKNOWN_RECORD_TYPE|honest label/);
  assert.throws(() => REF.describeCompositionOrigin(null), /UNKNOWN_RECORD_TYPE|honest label/);
});

test('a model estimate cannot be stored as an external measurement', () => {
  // The inverse of the case above, and the more dangerous direction: an estimate wearing a
  // reference record's schema would be shown to a parent as a clinical result.
  refuses({ ...dexa(), provider: { id: 'p', version: '1', model: 'm' } }, 'NOT_AN_ESTIMATE', 'carrying model provenance');
  refuses({ ...dexa(), modelManifest: { schema: 'x' } }, 'NOT_AN_ESTIMATE', 'carrying a model manifest');
  refuses({ ...dexa(), status: 'estimated' }, 'NOT_AN_ESTIMATE', 'declaring itself estimated');
});

test('a source cannot be credited with a quantity its method does not produce', () => {
  // DXA resolves fat, lean and bone from two X-ray energies. It does not isolate skeletal muscle
  // from lean soft tissue, and it does not produce the visceral-fat index consumer scales report.
  refuses(dexa({ outputs: [{ key: 'skeletal_muscle_mass_kg', value: 32, unit: 'kg', status: 'measured' }] }),
    'UNSUPPORTED_SOURCE_CLAIM', 'DXA reporting skeletal muscle mass');
  refuses(dexa({ outputs: [{ key: 'visceral_fat_index', value: 8, unit: 'index', status: 'measured' }] }),
    'UNSUPPORTED_SOURCE_CLAIM', 'DXA reporting a visceral fat index');
  refuses(dexa({ outputs: [{ key: 'body_water_mass_kg', value: 40, unit: 'kg', status: 'measured' }] }),
    'UNSUPPORTED_SOURCE_CLAIM', 'DXA reporting total body water');
});

test('bioimpedance estimates; it does not measure', () => {
  const scale = over => ({
    ...dexa(), sourceClass: 'smart_scale',
    device: { manufacturer: 'Synthetic Scales', model: 'S1' },
    outputs: [{ key: 'body_fat_percent', value: 22.4, unit: 'percent', status: 'device_estimated' }],
    ...over,
  });
  const ok = REF.validateCompositionReference(scale());
  assert.equal(ok.outputs[0].status, 'device_estimated');
  assert.equal(REF.describeCompositionOrigin(ok).label, 'Device estimated',
    'a record with nothing measured must not read as "Externally measured"');

  refuses(scale({ outputs: [{ key: 'body_fat_percent', value: 22.4, unit: 'percent', status: 'measured' }] }),
    'UNSUPPORTED_SOURCE_CLAIM', 'a scale claiming to have measured body fat');

  // Its own scale really does measure weight, and refusing that would be the opposite error.
  const withWeight = REF.validateCompositionReference(scale({
    outputs: [{ key: 'weight_kg', value: 81.3, unit: 'kg', status: 'measured' },
              { key: 'body_fat_percent', value: 22.4, unit: 'percent', status: 'device_estimated' }],
  }));
  assert.equal(withWeight.outputs[0].status, 'measured');
  assert.equal(REF.describeCompositionOrigin(withWeight).perOutput.weight_kg, 'Externally measured');
  assert.equal(REF.describeCompositionOrigin(withWeight).perOutput.body_fat_percent, 'Device estimated');
});

test('BMI is arithmetic and nothing measures it', () => {
  refuses(dexa({ outputs: [{ key: 'bmi', value: 24.1, unit: 'kg_m2', status: 'measured' }] }),
    'UNSUPPORTED_SOURCE_CLAIM', 'BMI recorded as measured');
  refuses(dexa({ outputs: [{ key: 'bmi', value: 24.1, unit: 'kg_m2', status: 'device_estimated' }] }),
    'UNSUPPORTED_SOURCE_CLAIM', 'BMI recorded as device-estimated');
  const ok = REF.validateCompositionReference(dexa({ outputs: [{ key: 'bmi', value: 24.1, unit: 'kg_m2', status: 'calculated' }] }));
  assert.equal(ok.outputs[0].status, 'calculated');
  assert.equal(REF.describeCompositionOrigin(ok).perOutput.bmi, 'Calculated');
});

test('units are converted without erasing what the source reported', () => {
  // A scale that reported pounds was rounded to a tenth of a pound before anyone saw kilograms.
  // A reader comparing two records needs that, so the original survives beside the normalized one.
  const record = REF.validateCompositionReference(dexa({
    outputs: [{ key: 'weight_kg', value: 179.5, unit: 'lb', status: 'measured' }],
  }));
  const output = record.outputs[0];
  assert.equal(output.unit, 'kg');
  assert.equal(output.value, 81.4, '179.5 lb is 81.42 kg, stored to a tenth');
  assert.deepEqual({ ...output.original }, { value: 179.5, unit: 'lb' });

  // A unit the metric cannot be expressed in is refused rather than silently treated as the
  // storage unit, which is how a pound becomes a kilogram.
  refuses(dexa({ outputs: [{ key: 'body_fat_percent', value: 22, unit: 'kg', status: 'measured' }] }),
    'INVALID_REFERENCE_RECORD', 'body fat expressed in kilograms');
});

test('physiologically impossible values are refused, not stored', () => {
  for (const [key, value, unit] of [['body_fat_percent', 140, 'percent'], ['body_fat_percent', 0.2, 'percent'],
                                    ['fat_mass_kg', 500, 'kg'], ['weight_kg', 0.5, 'kg']]) {
    refuses(dexa({ outputs: [{ key, value, unit, status: 'measured' }] }),
      'IMPLAUSIBLE_REFERENCE_VALUE', key + ' of ' + value + ' ' + unit);
  }
  // The boundary is inclusive, so a real edge value is not rejected as a typo.
  assert.doesNotThrow(() => REF.validateCompositionReference(dexa({ outputs: [{ key: 'body_fat_percent', value: 75, unit: 'percent', status: 'measured' }] })));
});

test('a clinical document never enters the record, and neither does a name', () => {
  // The reason an attachment is a storage key: a PDF in the JSON drags a name, a date of birth
  // and a referring physician into every export and audit row that touches this record.
  for (const [what, over] of [
    ['file bytes', { attachment: { storageKey: 'k', contentType: 'application/pdf', verification: { status: 'unverified' }, bytes: 'JVBERi0' } }],
    ['base64 contents', { attachment: { storageKey: 'k', contentType: 'application/pdf', verification: { status: 'unverified' }, base64: 'x' } }],
    ['a patient name', { device: { facility: 'F', patientName: 'Synthetic Person' } }],
    ['a date of birth', { device: { facility: 'F', dateOfBirth: '1990-01-01' } }],
    ['a medical record number', { device: { facility: 'F', mrn: '12345' } }],
    ['an email address', { device: { facility: 'F', email: 'x@y.invalid' } }],
    ['a scan image', { device: { facility: 'F', scanImage: 'data:...' } }],
  ]) refuses(dexa(over), 'CAPTURE_DATA_FORBIDDEN', what);
});

test('an attachment records whether anyone checked it against the document', () => {
  const withReport = REF.validateCompositionReference(dexa({
    attachment: { storageKey: 'private/report-1', contentType: 'application/pdf', verification: { status: 'unverified' } },
  }));
  assert.equal(withReport.reportRetained, true);
  assert.equal(withReport.attachment.verification.status, 'unverified');

  const verified = REF.validateCompositionReference(dexa({
    attachment: {
      storageKey: 'private/report-1', contentType: 'application/pdf',
      verification: { status: 'verified_against_report', verifiedBy: 'synthetic-verifier-1', verifiedAt: '2026-09-02T09:00:00Z' },
    },
  }));
  assert.equal(verified.attachment.verification.verifiedBy, 'synthetic-verifier-1');

  refuses(dexa({ attachment: { storageKey: 'k', contentType: 'application/pdf', verification: { status: 'verified_against_report' } } }),
    'INVALID_REFERENCE_RECORD', 'claiming verification without saying who or when');
  refuses(dexa({ attachment: { storageKey: 'k', contentType: 'application/pdf', verification: { status: 'looks_fine' } } }),
    'INVALID_REFERENCE_RECORD', 'an invented verification status');
});

test('a transcription has to say whether the document still exists', () => {
  const transcribed = over => ({
    ...dexa(), sourceClass: 'manual_report', methodLabel: 'DXA report, synthetic clinic',
    device: { facility: 'Synthetic Clinic' }, ...over,
  });
  refuses(transcribed(), 'INVALID_REFERENCE_RECORD', 'no attachment and no explicit statement');
  assert.doesNotThrow(() => REF.validateCompositionReference(transcribed({ reportRetained: false })),
    'stating the document was not kept is a valid answer');
  assert.doesNotThrow(() => REF.validateCompositionReference(transcribed({
    attachment: { storageKey: 'private/r', contentType: 'application/pdf', verification: { status: 'unverified' } },
  })));
  // And it must say what method produced the document it is transcribing.
  refuses({ ...transcribed({ reportRetained: false }), methodLabel: null },
    'INVALID_REFERENCE_RECORD', 'a transcription with no stated method');
});

test('a health platform names the app that produced the value', () => {
  const platform = over => ({
    ...dexa(), sourceClass: 'health_platform', device: { model: 'Synthetic Phone' },
    outputs: [{ key: 'body_fat_percent', value: 22, unit: 'percent', status: 'device_estimated' }], ...over,
  });
  refuses(platform(), 'INVALID_REFERENCE_RECORD', 'no originating app');
  const ok = REF.validateCompositionReference(platform({ device: { model: 'Synthetic Phone', originatingApp: 'Synthetic Scale App' } }));
  assert.equal(ok.device.originatingApp, 'Synthetic Scale App');
});

test('a facility is required where two machines would otherwise be indistinguishable', () => {
  refuses(dexa({ device: { manufacturer: 'Synthetic Imaging', model: 'Model A' } }),
    'INVALID_REFERENCE_RECORD', 'a DXA scan with no facility');
  // A smart scale in somebody's bathroom has no facility, and demanding one would be theatre.
  assert.doesNotThrow(() => REF.validateCompositionReference({
    ...dexa(), sourceClass: 'smart_scale', device: { model: 'S1' },
    outputs: [{ key: 'weight_kg', value: 81, unit: 'kg', status: 'measured' }],
  }));
});

test('scope decides whether an athlete identifier belongs on the record', () => {
  refuses(dexa({ athleteId: 'synthetic-child-1' }), 'INVALID_REFERENCE_RECORD',
    'an adult reference carrying an athlete identifier');
  const child = REF.validateCompositionReference(dexa({ scope: 'child_athlete', athleteId: 'synthetic-child-1' }));
  assert.equal(child.athleteId, 'synthetic-child-1');
  refuses(dexa({ scope: 'child_athlete' }), 'INVALID_REFERENCE_RECORD', 'a child record with no athlete');
  refuses(dexa({ scope: 'whatever' }), 'INVALID_REFERENCE_RECORD', 'an unsupported scope');
});

test('the timeline has to be possible', () => {
  refuses(dexa({ measuredAt: '2026-09-02T10:00:00Z' }), 'INVALID_REFERENCE_RECORD', 'measured after it was saved');
  refuses(dexa({ retentionUntil: '2026-09-01T10:05:00Z' }), 'INVALID_REFERENCE_RECORD', 'retention expiring the moment it is written');
  refuses(dexa({ measuredAt: 'last tuesday' }), 'INVALID_REFERENCE_RECORD', 'a date nobody can parse');
});

test('every source class has a working accept path', () => {
  // The negative control for all of the above: the rules must not have made the module refuse
  // everything. One valid record per supported source.
  const cases = {
    dexa: dexa(),
    bia_clinical: { ...dexa(), sourceClass: 'bia_clinical', device: { manufacturer: 'Synthetic BIA', model: 'B1', facility: 'Synthetic Clinic' },
      outputs: [{ key: 'skeletal_muscle_mass_kg', value: 34.2, unit: 'kg', status: 'device_estimated' }] },
    smart_scale: { ...dexa(), sourceClass: 'smart_scale', device: { model: 'S1' },
      outputs: [{ key: 'body_fat_percent', value: 22, unit: 'percent', status: 'device_estimated' }] },
    health_platform: { ...dexa(), sourceClass: 'health_platform', device: { model: 'Phone', originatingApp: 'Synthetic App' },
      outputs: [{ key: 'body_fat_percent', value: 22, unit: 'percent', status: 'device_estimated' }] },
    manual_report: { ...dexa(), sourceClass: 'manual_report', methodLabel: 'DXA report', reportRetained: false,
      outputs: [{ key: 'body_fat_percent', value: 22, unit: 'percent', status: 'measured' }] },
  };
  for (const [name, input] of Object.entries(cases)) {
    const record = REF.validateCompositionReference(input);
    assert.equal(record.sourceClass, name);
    assert.equal(record.origin, 'external_measurement');
    assert.equal(REF.describeCompositionOrigin(record).isParentPlaybookEstimate, false);
  }
  assert.equal(Object.keys(cases).length, Object.keys(REF.REFERENCE_SOURCES).length,
    'a new source class needs an accept-path case here, or it ships untested');
});

test('the dictionary covers what the plan asked for', () => {
  // The plan names the outputs the import system must support. If one is dropped from the
  // dictionary, that is a product decision rather than a refactor, and it should fail here first.
  for (const key of ['body_fat_percent', 'fat_mass_kg', 'lean_mass_kg', 'skeletal_muscle_mass_kg',
                     'bone_mass_kg', 'body_water_mass_kg', 'visceral_fat_index', 'weight_kg', 'bmi']) {
    assert.ok(REF.REFERENCE_METRICS[key], key + ' is missing from the reference dictionary');
  }
  // Bone mineral content and bone mass are different quantities from different methods, and
  // collapsing them would let a scale's figure be read as a DXA one.
  assert.ok(REF.REFERENCE_METRICS.bone_mineral_content_kg && REF.REFERENCE_METRICS.bone_mass_kg);
  assert.ok(REF.REFERENCE_SOURCES.dexa.measures.includes('bone_mineral_content_kg'));
  assert.ok(!REF.REFERENCE_SOURCES.dexa.measures.includes('bone_mass_kg'));
  assert.ok(REF.REFERENCE_SOURCES.smart_scale.estimates.includes('bone_mass_kg'));
  assert.ok(!REF.REFERENCE_SOURCES.smart_scale.estimates.includes('bone_mineral_content_kg'));
});
