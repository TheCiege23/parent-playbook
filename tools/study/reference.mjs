/* Reference measurements for the measurement study: what is measured by hand, how repeat readings
 * become one value, and which scan output each is compared with.
 *
 * The catalogue and the mapping transcribe research/MEASUREMENT-STUDY-PROTOCOL.md §2. The mapping is
 * deliberately incomplete: four scan outputs have no standard hand-measured counterpart and are
 * marked descriptive-only, and several mapped outputs carry a caveat because the scan's own
 * definition says they are not the clinical quantity with a similar name. A comparison that pretended
 * otherwise would produce a clean-looking agreement statistic between two different things.
 *
 * NO SCIENTIFIC DEFAULTS
 *
 * The tolerance that triggers a third reading, and the rule for combining readings, come from the
 * study configuration. There is no fallback. The protocol leaves them in brackets for the measurement
 * lead and the statistician, and a tool that supplied a number would be making that decision.
 */

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'StudyReferenceError', code }); };

const cm = (label, extra = {}) => Object.freeze({ label, unit: 'cm', ...extra });
const sides = (key, label, extra) => ({
  [key + '_left']: cm(label + ', left', extra),
  [key + '_right']: cm(label + ', right', extra),
});

export const REFERENCE_MEASURES = Object.freeze({
  stature: cm('Stature (stadiometer)', { role: 'scaling', note: 'Given to the scan as its height, so every output depends on it.' }),
  arm_span: cm('Arm span'),
  standing_reach_height: cm('Standing reach height'),
  biacromial_breadth: cm('Biacromial breadth'),
  trochanterion_height: cm('Trochanterion height'),
  ...sides('acromiale_radiale', 'Acromiale–radiale length'),
  ...sides('radiale_stylion', 'Radiale–stylion length'),
  ...sides('trochanterion_tibiale_laterale', 'Trochanterion–tibiale laterale length'),
  ...sides('tibiale_laterale_sphyrion', 'Tibiale laterale–sphyrion length'),
  ...sides('acromiale_trochanterion', 'Acromiale–trochanterion vertical distance'),
  ...sides('foot_length', 'Foot length'),
  // Research data only (protocol §2): never compared with a product output, never shown to anyone as a girth.
  tape_over_garment_shoulder: cm('Tape perimeter over the study garment, shoulder plane', { role: 'research_only' }),
  tape_over_garment_torso: cm('Tape perimeter over the study garment, torso-midpoint plane', { role: 'research_only' }),
  tape_over_garment_hip: cm('Tape perimeter over the study garment, hip plane', { role: 'research_only' }),
  anatomical_girth_shoulder: cm('Anatomical girth, shoulder plane', { role: 'research_only' }),
  anatomical_girth_torso: cm('Anatomical girth, torso-midpoint plane', { role: 'research_only' }),
  anatomical_girth_hip: cm('Anatomical girth, hip plane', { role: 'research_only' }),
});

/* Sums of entered measurements, never entered themselves. */
export const DERIVED_REFERENCES = Object.freeze({
  arm_path_left: Object.freeze(['acromiale_radiale_left', 'radiale_stylion_left']),
  arm_path_right: Object.freeze(['acromiale_radiale_right', 'radiale_stylion_right']),
  leg_path_left: Object.freeze(['trochanterion_tibiale_laterale_left', 'tibiale_laterale_sphyrion_left']),
  leg_path_right: Object.freeze(['trochanterion_tibiale_laterale_right', 'tibiale_laterale_sphyrion_right']),
});

const map = (reference, caveat = false) => Object.freeze({ reference, caveat });
const pairMap = (segment, reference, caveat = false) => ({
  ['left_' + segment + '_length']: map(reference + '_left', caveat),
  ['right_' + segment + '_length']: map(reference + '_right', caveat),
});

/* Every body-outputs-v2 key. null means descriptive only: no standard counterpart exists. */
export const SCAN_TO_REFERENCE = Object.freeze({
  wingspan: map('arm_span'),
  standing_reach: map('standing_reach_height'),
  shoulder_width: map('biacromial_breadth', true),
  hip_width: null,
  ear_width: null,
  torso_length: null,
  leg_length: map('trochanterion_height', true),
  ...pairMap('upper_arm', 'acromiale_radiale'),
  ...pairMap('forearm', 'radiale_stylion'),
  ...pairMap('arm_path', 'arm_path'),
  ...pairMap('thigh', 'trochanterion_tibiale_laterale'),
  ...pairMap('lower_leg', 'tibiale_laterale_sphyrion'),
  ...pairMap('leg_path', 'leg_path'),
  ...pairMap('shoulder_hip', 'acromiale_trochanterion', true),
  left_ankle_heel_length: null,
  right_ankle_heel_length: null,
  ...pairMap('foot', 'foot_length', true),
});

export const COMBINE_RULES = Object.freeze(['mean_of_two_median_of_three']);

/* Checks that a configuration can support entry for every measure it will be asked to record. */
export function assertReferenceConfig(referenceConfig) {
  if (!referenceConfig || typeof referenceConfig !== 'object') fail('NO_REFERENCE_CONFIG', 'The study configuration has no reference section.');
  if (!COMBINE_RULES.includes(referenceConfig.combine)) {
    fail('NO_COMBINE_RULE', 'The configuration must name the rule for combining repeat readings (' + COMBINE_RULES.join(', ') + '). There is no default.');
  }
  const tolerances = referenceConfig.tolerancesCm;
  if (!tolerances || typeof tolerances !== 'object') fail('NO_TOLERANCES', 'The configuration must give a tolerance in cm for each reference measure. There is no default.');
  for (const [key, value] of Object.entries(tolerances)) {
    if (!REFERENCE_MEASURES[key]) fail('UNKNOWN_MEASURE', 'Tolerance given for an unknown measure: ' + key);
    if (!(Number.isFinite(value) && value > 0)) fail('BAD_TOLERANCE', 'Tolerance for ' + key + ' must be a positive number of cm.');
  }
  return true;
}

export function toleranceFor(referenceConfig, measure) {
  if (!REFERENCE_MEASURES[measure]) fail('UNKNOWN_MEASURE', 'Unknown reference measure: ' + measure);
  const value = referenceConfig?.tolerancesCm?.[measure];
  if (!(Number.isFinite(value) && value > 0)) {
    fail('NO_TOLERANCE', 'No tolerance is configured for ' + measure + '. Add one to the study configuration before recording it; there is no default.');
  }
  return value;
}

/* Where one participant's readings for one measure, visit and measurer stand.
 *
 * readings: numbers in the order taken. Two readings within tolerance are complete; two outside it
 * need a third, and three are resolved by the median.
 */
export function evaluateReadings(readings, tolerance, rule) {
  if (!COMBINE_RULES.includes(rule)) fail('NO_COMBINE_RULE', 'Unsupported combine rule: ' + rule);
  if (!(Number.isFinite(tolerance) && tolerance > 0)) fail('BAD_TOLERANCE', 'Tolerance must be a positive number.');
  if (!Array.isArray(readings) || !readings.every(Number.isFinite)) fail('BAD_READINGS', 'Readings must be finite numbers.');
  if (readings.length > 3) fail('TOO_MANY_READINGS', 'The protocol allows at most three readings per measure; got ' + readings.length + '.');
  if (readings.length === 0) return Object.freeze({ status: 'needs_first', final: null });
  if (readings.length === 1) return Object.freeze({ status: 'needs_second', final: null });
  const spread = Math.abs(readings[0] - readings[1]);
  if (readings.length === 2) {
    return spread <= tolerance
      ? Object.freeze({ status: 'complete', final: (readings[0] + readings[1]) / 2, method: 'mean_of_two', spread })
      : Object.freeze({ status: 'needs_third', final: null, spread, flag: 'first two readings differ by more than the tolerance' });
  }
  const sorted = [...readings].sort((a, b) => a - b);
  return Object.freeze({ status: 'complete', final: sorted[1], method: 'median_of_three', spread, flag: 'resolved by a third reading' });
}

/* The reference value a scan output is compared with, or a stated reason there is none. */
export function referenceForScanOutput(scanKey, finals) {
  if (!Object.hasOwn(SCAN_TO_REFERENCE, scanKey)) fail('UNKNOWN_SCAN_OUTPUT', 'Not a body-outputs-v2 key: ' + scanKey);
  const entry = SCAN_TO_REFERENCE[scanKey];
  if (!entry) return Object.freeze({ value: null, reason: 'descriptive_only' });
  const parts = DERIVED_REFERENCES[entry.reference];
  if (parts) {
    const values = parts.map(part => finals[part]);
    if (!values.every(Number.isFinite)) return Object.freeze({ value: null, reason: 'reference_incomplete', reference: entry.reference, caveat: entry.caveat });
    return Object.freeze({ value: values.reduce((a, b) => a + b, 0), reference: entry.reference, derived: true, caveat: entry.caveat });
  }
  const value = finals[entry.reference];
  return Number.isFinite(value)
    ? Object.freeze({ value, reference: entry.reference, caveat: entry.caveat })
    : Object.freeze({ value: null, reason: 'reference_incomplete', reference: entry.reference, caveat: entry.caveat });
}
