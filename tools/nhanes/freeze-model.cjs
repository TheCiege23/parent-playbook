#!/usr/bin/env node
'use strict';

/**
 * Freeze candidate B+ into an immutable artifact.
 *
 *   node tools/nhanes/freeze-model.cjs --data <dir> [--verify]
 *
 * Freezing happens BEFORE the holdout is read, which is the whole point. A model frozen after
 * seeing its final evaluation is not a frozen model; it is a model that was adjusted until the
 * evaluation looked right, and no amount of care afterwards recovers the difference. The artifact
 * this writes is what the single holdout read will be run against, unchanged.
 *
 * --verify refits from the same sources and checks the result is byte-identical to the committed
 * artifact. The fit is fully deterministic — no subsampling, no random initialisation, no seed to
 * record — so anyone with the sources can reproduce it rather than trust it.
 *
 * The artifact is a CANDIDATE. It carries status:"candidate" and holdoutRead:false, and nothing
 * downstream may treat it as a released model. Those fields are not decoration: the predictor
 * refuses to produce a released-model estimate from an artifact that has not passed a holdout.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const LOCKFILE = path.join(HERE, 'sources.lock.json');
const OUT_DIR = path.join(REPO, 'research', 'model');
const ARTIFACT = path.join(OUT_DIR, 'bodyfat-candidate-v0.1.0.json');

const args = process.argv.slice(2);
const valueFor = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
if (args.includes('--help') || !args.includes('--data')) {
  console.error('Usage: node tools/nhanes/freeze-model.cjs --data <dir> [--verify]');
  process.exit(args.includes('--help') ? 0 : 2);
}
const DATA = path.resolve(valueFor('--data'));
const VERIFY = args.includes('--verify');

const ROLES = {
  '1999-2000': 'development', '2001-2002': 'development', '2003-2004': 'development',
  '2011-2012': 'development', '2013-2014': 'development', '2017-2018': 'holdout',
};
// Exactly the hyperparameters candidate B+ was reported with. Changing any of them makes a
// different model and must produce a different version.
const HYPERPARAMETERS = Object.freeze({
  features: ['ageYears', 'sexMale', 'heightCm', 'weightKg', 'waistCm'],
  trees: 300, learningRate: 0.05, depth: 3, minLeaf: 20,
});

(async () => {
  const { readXport } = await import('../../tools/nhanes/xport.mjs');
  const { buildCohort, modelReadyExport } = await import('../../tools/nhanes/cohort.mjs');
  const M = await import('../../tools/nhanes/models.mjs');

  const lock = JSON.parse(fs.readFileSync(LOCKFILE, 'utf8'));
  const cycles = new Map();
  for (const entry of lock.files) {
    if (ROLES[entry.cycle] !== 'development') continue;       // the holdout is not read
    const buffer = fs.readFileSync(path.join(DATA, entry.name + '.xpt'));
    if (crypto.createHash('sha256').update(buffer).digest('hex') !== entry.sha256) {
      console.error('  CHANGED  ' + entry.name + ' no longer matches sources.lock.json.'); process.exit(1);
    }
    if (!cycles.has(entry.cycle)) cycles.set(entry.cycle, { cycle: entry.cycle, role: 'development', replicatePolicy: 'measured_only' });
    cycles.get(entry.cycle)[{ 'demographics': 'demo', 'body-measures': 'bmx', 'dxa-whole-body': 'dxa' }[entry.component]] = readXport(buffer).rows;
  }

  const cohort = buildCohort([...cycles.values()].sort((a, b) => a.cycle.localeCompare(b.cycle)));
  const train = modelReadyExport(cohort.participants.filter(p => p.split === 'train'))
    .filter(row => Number.isFinite(row.waistCm));
  const model = M.fitBoostedTrees(train, HYPERPARAMETERS);

  // The hash of the sources, so the artifact names the exact bytes it learned from.
  const sourceDigest = crypto.createHash('sha256')
    .update(lock.files.filter(f => ROLES[f.cycle] === 'development').map(f => f.name + ' ' + f.sha256).join('\n'))
    .digest('hex');

  const artifact = {
    schema: 'PP_BODY_COMPOSITION_MODEL_V1',
    id: 'parent-playbook-nhanes-bodyfat',
    version: '0.1.0-candidate',

    // Not decoration. The predictor refuses to present an estimate from this as a released
    // model's, and the single holdout read is what would change these two fields.
    status: 'candidate',
    holdoutRead: false,
    releaseDecision: null,

    frozenAt: new Date().toISOString(),
    preregistration: 'research/NHANES-PREREGISTRATION.md',

    supportedPopulation: {
      ageYears: { min: 18, max: 59 },
      note: 'Adults 18-59. The upper bound is not a modelling choice: no NHANES cycle after 2004 '
        + 'scanned anyone over 59, so the holdout cannot validate them and the model must not be '
        + 'offered to them. See amendment 2.',
    },

    inputs: [
      { key: 'ageYears', unit: 'years', required: true, range: [18, 59] },
      { key: 'sexMale', unit: 'indicator', required: true, values: [0, 1] },
      { key: 'heightCm', unit: 'cm', required: true, range: [120, 220] },
      { key: 'weightKg', unit: 'kg', required: true, range: [30, 300] },
      { key: 'waistCm', unit: 'cm', required: true, range: [50, 200],
        note: 'REQUIRED, not optional. Without waist this model family fails the subgroup bias '
          + 'criterion by a wide margin, and there is no fallback to a model that does not need it '
          + 'because every such model fails. A person who cannot supply a waist measurement is '
          + 'refused, and that refusal is a supported-population rule rather than an error.' },
    ],
    // Race, ethnicity, identifiers and survey design variables are absent by construction: the fit
    // was run on rows from modelReadyExport, which do not contain them.
    forbiddenInputs: ['race', 'ethnicity', 'participant identifiers', 'survey design variables',
      'health outcomes', 'diagnoses', 'medications'],

    outputs: [
      { key: 'bodyFatPercent', unit: 'percent', derivation: 'predicted directly' },
      { key: 'fatMassKg', unit: 'kg', derivation: 'totalMassKg * bodyFatPercent / 100' },
      { key: 'leanMassKg', unit: 'kg', derivation: 'totalMassKg - fatMassKg, including bone mineral' },
    ],
    notSkeletalMuscle: 'Lean mass here is everything that is not fat, including bone mineral, '
      + 'matching the NHANES DXA definition this was trained against. It is NOT skeletal muscle '
      + 'mass, and no conversion factor turns it into one.',

    refusalConditions: [
      'Age outside 18-59.',
      'Any required input missing, including waist.',
      'Any input outside its stated range.',
      'A predicted body-fat percentage outside 1-75, which is refused rather than clamped: a '
        + 'clamped value looks measured and is not.',
      'The artifact has not passed a holdout, for any caller asking for a released estimate.',
    ],

    training: {
      cohort: 'research/NHANES-DATA-STRUCTURE.md',
      developmentParticipants: cohort.total,
      trainPartition: cohort.participants.filter(p => p.split === 'train').length,
      fittedOn: model.fittedOn,
      droppedForMissingWaist: cohort.participants.filter(p => p.split === 'train').length - model.fittedOn,
      sourceFilesDigest: sourceDigest,
      replicatePolicy: 'measured_only',
    },

    calibrationReport: {
      partition: 'calibration',
      n: 2868, mae: 2.627, rmse: 3.292, bias: -0.013, calibrationSlope: 1.005,
      worstSubgroupBias: 0.865,
      subgroupBiasLimit: 1.0,
      caveat: 'Calibration is the tuning partition, so these are optimistic by construction. They '
        + 'are recorded because a frozen artifact should carry what was known when it was frozen, '
        + 'not because they are a result.',
    },
    holdoutReport: null,

    model: {
      kind: model.kind, target: model.target, features: model.features,
      base: model.base, learningRate: model.learningRate, depth: model.depth,
      minLeaf: model.minLeaf, trees: model.trees, ensemble: model.ensemble,
    },

    ownership: 'Trained by Parent Playbook on NHANES public-use data published by the US National '
      + 'Center for Health Statistics, which is in the public domain. The trained model and this '
      + 'artifact are owned by Parent Playbook. NCHS does not endorse this work.',
    limitations: 'Predicts NHANES whole-body DXA body-fat percentage for US survey participants '
      + 'aged 18-59 from four body measurements. Establishes nothing about DEXA equivalence, '
      + 'clinical validity, children, non-US populations, or any Parent Playbook photo scan.',
  };

  // Canonical serialization, so the hash depends on content rather than key order or spacing.
  //
  // NOT JSON.stringify(value, keys, 2). The array form of the second argument is a property
  // ALLOWLIST applied at every nesting level, so passing the top-level keys emptied every nested
  // object: the first version of this froze an artifact with no model in it, no inputs and no
  // supported population — 2 KB instead of 215 — and --verify reported VERIFIED because it was
  // comparing two identically gutted objects. Sorting has to be done by walking the structure.
  const canonicalize = value => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
      return out;
    }
    return value;
  };
  const canonical = JSON.stringify(canonicalize(artifact), null, 2) + '\n';
  const digest = crypto.createHash('sha256').update(canonical).digest('hex');

  // A freeze that produced nothing is worse than a failed one, because it looks like success.
  if (!artifact.model?.ensemble?.length || !artifact.inputs?.length) {
    console.error('The artifact lost its model or its input schema during serialization. Refusing to write it.');
    process.exit(1);
  }

  if (VERIFY) {
    if (!fs.existsSync(ARTIFACT)) { console.error('No artifact at ' + path.relative(REPO, ARTIFACT) + ' to verify.'); process.exit(1); }
    const existing = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
    // Checked before comparing, because two empty things match each other perfectly. The first
    // version of this verified a gutted artifact against a gutted refit and reported success.
    if (!existing.model?.ensemble?.length) {
      console.error('The committed artifact contains no model ensemble. It is not a frozen model, whatever it verifies against.');
      process.exit(1);
    }
    // frozenAt is when it was written, not what it contains, so it is excluded from the comparison.
    const strip = value => { const { frozenAt, ...rest } = value; return JSON.stringify(canonicalize(rest), null, 2); };
    const same = strip(existing) === strip(artifact);
    console.log(same
      ? 'VERIFIED — refitting from the locked sources reproduces the committed artifact exactly.'
      : 'DIFFERS — refitting does not reproduce the committed artifact. Something changed: the sources, the cohort rules, the hyperparameters or the fitting code.');
    process.exit(same ? 0 : 1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(ARTIFACT, canonical, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'bodyfat-candidate-v0.1.0.sha256'), digest + '  bodyfat-candidate-v0.1.0.json\n', 'utf8');
  console.log('Froze ' + path.relative(REPO, ARTIFACT));
  console.log('  status         candidate  (holdout not read)');
  console.log('  fitted on      ' + model.fittedOn + ' participants');
  console.log('  trees          ' + model.trees + ', depth ' + model.depth + ', lr ' + model.learningRate);
  console.log('  size           ' + (canonical.length / 1024).toFixed(0) + ' KB');
  console.log('  sha-256        ' + digest);
  console.log('\nThis is what the single holdout read will be run against, unchanged.');
})();
