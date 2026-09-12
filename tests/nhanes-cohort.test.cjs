// Building the analysis cohort under the frozen research question.
//
// Three of the six exclusions have an obvious implementation that is wrong, and wrong in the worst
// available way: it produces a plausible cohort rather than an error. Those three get a test that
// asserts the inverted version would have been catastrophic, so the reason the code looks the way
// it does survives the next person to simplify it.
//
// Fixtures are synthetic. The real counts they imitate are in research/NHANES-DATA-STRUCTURE.md.
const test = require('node:test');
const assert = require('node:assert/strict');

let C;
test.before(async () => { C = await import('../tools/nhanes/cohort.mjs'); });

// One participant's worth of the three components, with everything valid unless overridden.
const demo = (seqn, over = {}) => ({
  SEQN: seqn, RIAGENDR: 1, RIDAGEYR: 35, RIDEXPRG: null, RIDRETH1: 3,
  SDMVPSU: 1, SDMVSTRA: 40, WTMEC2YR: 12345.6, ...over,
});
const bmx = (seqn, over = {}) => ({ SEQN: seqn, BMXHT: 175.2, BMXWT: 80.4, BMXBMI: 26.2, BMXWAIST: 92.1, ...over });
// Grams, as the survey stores them.
const dxa = (seqn, over = {}) => ({ SEQN: seqn, DXDTOPF: 24.4, DXDTOFAT: 19617, DXDTOLI: 60783, DXDTOTOT: 80400, DXAEXSTS: 1, ...over });

const cycle = (name, role, people, extra = {}) => ({
  cycle: name, role,
  demo: people.map(p => p.demo), bmx: people.map(p => p.bmx).filter(Boolean), dxa: people.flatMap(p => p.dxa ? [p.dxa] : []),
  ...extra,
});
const person = (seqn, over = {}) => ({
  demo: demo(seqn, over.demo), bmx: over.bmx === null ? null : bmx(seqn, over.bmx),
  dxa: over.dxa === null ? null : dxa(seqn, over.dxa),
});

const rejects = (fn, code) => {
  try { fn(); assert.fail('expected rejection ' + code); }
  catch (error) { assert.equal(error.code, code, 'message was: ' + error.message); return error; }
};

const build = (...cycles) => C.buildCohort(cycles);
const step = (result, cycleIndex, id) => result.flow[cycleIndex].steps.find(s => s.step === id);

// ----------------------------------------------------------------- the three inverted rules
test('pregnancy is an exclusion, not a requirement — the inverted rule would drop almost everyone', () => {
  // RIDEXPRG is asked only of women aged 20-44. In the real 2017-2018 cycle, 2,596 of 3,706
  // adults are null: every man, and every woman outside those ages.
  const people = [
    person(1, { demo: { RIAGENDR: 1, RIDEXPRG: null } }),      // man, never asked
    person(2, { demo: { RIAGENDR: 2, RIDAGEYR: 52, RIDEXPRG: null } }), // woman 52, never asked
    person(3, { demo: { RIAGENDR: 2, RIDAGEYR: 30, RIDEXPRG: 2 } }),    // asked, not pregnant
    person(4, { demo: { RIAGENDR: 2, RIDAGEYR: 30, RIDEXPRG: 1 } }),    // pregnant
    person(5, { demo: { RIAGENDR: 2, RIDAGEYR: 30, RIDEXPRG: 3 } }),    // cannot determine
  ];
  const result = build(cycle('2017-2018', 'holdout', people));
  assert.equal(result.total, 3, 'the three who were not pregnant, however the question reached them');
  assert.deepEqual(result.participants.map(p => p.seqn), [1, 2, 3]);
  assert.equal(step(result, 0, 'pregnant_or_undetermined').excluded, 2);

  // What the inverted rule would have done, stated so the cost is visible rather than argued.
  const wouldSurvive = people.filter(p => p.demo.RIDEXPRG === 2).length;
  assert.equal(wouldSurvive, 1, 'requiring RIDEXPRG=2 would keep one of five, and the survivors would all be women aged 20-44');
});

test('DXA validity is the value being present, not the exam status flag', () => {
  // In the real 2017-2018 file, 678 rows carry DXAEXSTS=1 and no total body fat at all.
  const people = [
    person(1),                                                     // complete and usable
    person(2, { dxa: { DXAEXSTS: 1, DXDTOPF: null, DXDTOFAT: null, DXDTOLI: null, DXDTOTOT: null } }),
    person(3, { dxa: { DXAEXSTS: 6 } }),                            // status not 1, values present
  ];
  const result = build(cycle('2017-2018', 'holdout', people));
  assert.deepEqual(result.participants.map(p => p.seqn), [1, 3], 'status 6 with a real value is usable; status 1 with no value is not');
  assert.equal(step(result, 0, 'dxa_not_usable').excluded, 1);
});

test('the imputation filter applies where imputation exists and is inert where it does not', () => {
  const early = build(cycle('1999-2000', 'development', [
    person(1, { dxa: { DXITOT: 0 } }),
    person(2, { dxa: { DXITOT: 1 } }),
  ]));
  assert.equal(step(early, 0, 'dxa_imputed').excluded, 1);

  // The later files have no DXITOT at all. The rule must not exclude everyone for its absence.
  const late = build(cycle('2017-2018', 'holdout', [
    person(3, { dxa: { DXITOT: undefined } }),
    person(4, { dxa: { DXITOT: undefined } }),
  ]));
  assert.equal(step(late, 0, 'dxa_imputed').excluded, 0);
  assert.equal(late.total, 2);
});

// ----------------------------------------------------------------- the race rule
test('the model-ready export cannot carry race, identifiers or survey design', () => {
  const result = build(cycle('2017-2018', 'holdout', [person(1)]));
  const rows = C.modelReadyExport(result.participants);
  const keys = Object.keys(rows[0]);
  assert.deepEqual(keys, [...C.MODEL_FEATURES, ...C.MODEL_TARGETS]);
  for (const forbidden of ['raceEthnicity', 'seqn', 'cycle', 'sdmvpsu', 'sdmvstra', 'wtmec2yr', 'split']) {
    assert.ok(!keys.includes(forbidden), forbidden + ' reached a model-ready row');
  }
});

test('a forbidden field added by hand is caught, not carried', () => {
  // The failure this guards: a row with one extra field still trains, still evaluates, and still
  // reports a number. Nothing downstream would notice.
  const error = rejects(() => C.assertModelReady([{ ageYears: 35, raceEthnicity: 3 }]), 'FORBIDDEN_MODEL_FEATURE');
  assert.match(error.message, /evaluation-only/);
  rejects(() => C.assertModelReady([{ ageYears: 35, sdmvstra: 40 }]), 'FORBIDDEN_MODEL_FEATURE');
  rejects(() => C.assertModelReady([{ ageYears: 35, seqn: 1 }]), 'FORBIDDEN_MODEL_FEATURE');
});

test('an undeclared field is refused even when it is harmless', () => {
  // A feature nobody chose is still a feature. The allowlist has to be edited deliberately.
  const error = rejects(() => C.assertModelReady([{ ageYears: 35, shoeSize: 11 }]), 'UNDECLARED_MODEL_FEATURE');
  assert.match(error.message, /a feature nobody chose/);
});

test('the evaluation export carries exactly what the model may not see', () => {
  // The other half of the same rule: subgroup error cannot be found in data that does not record
  // the subgroup.
  const result = build(cycle('2017-2018', 'holdout', [person(1)]));
  const row = C.evaluationExport(result.participants)[0];
  assert.equal(row.raceEthnicity, 3);
  assert.equal(row.sdmvstra, 40);
  assert.equal(row.wtmec2yr, 12345.6);
  assert.equal(row.seqn, 1);
});

// ----------------------------------------------------------------- exclusions and flow
test('age bounds follow the narrowed population', () => {
  const result = build(cycle('1999-2000', 'development', [
    person(1, { demo: { RIDAGEYR: 17 } }), person(2, { demo: { RIDAGEYR: 18 } }),
    person(3, { demo: { RIDAGEYR: 59 } }), person(4, { demo: { RIDAGEYR: 60 } }),
    person(5, { demo: { RIDAGEYR: 71 } }),
  ]));
  assert.deepEqual(result.participants.map(p => p.seqn), [2, 3]);
  assert.equal(step(result, 0, 'age_under_18').excluded, 1);
  assert.equal(step(result, 0, 'age_over_59').excluded, 2);
  assert.match(step(result, 0, 'age_over_59').note, /holdout cannot validate/);
});

test('a missing component is its own exclusion line, not a silent drop', () => {
  const result = build(cycle('2017-2018', 'holdout', [
    person(1), person(2, { dxa: null }), person(3, { bmx: null }),
  ]));
  assert.equal(step(result, 0, 'no_dxa_record').excluded, 1);
  assert.equal(step(result, 0, 'no_body_measures').excluded, 1);
  assert.equal(result.total, 1);
});

test('missing height, weight or sex is an exclusion, never an imputation', () => {
  const result = build(cycle('2017-2018', 'holdout', [
    person(1), person(2, { bmx: { BMXHT: null } }), person(3, { bmx: { BMXWT: null } }),
    person(4, { demo: { RIAGENDR: null } }),
  ]));
  assert.equal(step(result, 0, 'missing_inputs').excluded, 3);
  assert.equal(result.total, 1);
});

test('the flow accounts for every participant from start to finish', () => {
  const people = [person(1), person(2, { demo: { RIDAGEYR: 12 } }), person(3, { dxa: null }),
    person(4, { demo: { RIDEXPRG: 1, RIAGENDR: 2, RIDAGEYR: 30 } })];
  const result = build(cycle('2017-2018', 'holdout', people));
  const steps = result.flow[0].steps;
  assert.equal(steps[0].remaining, 4);
  // Every participant either survives or is attributed to exactly one rule.
  const excluded = steps.filter(s => s.step !== 'start').reduce((n, s) => n + s.excluded, 0);
  assert.equal(excluded + result.total, 4);
});

// ----------------------------------------------------------------- replicates and splits
test('replicates are collapsed before anything is counted', () => {
  // Counting first would make every number in the flow five times too large.
  const replicated = [1, 2, 3, 4, 5].map(v => ({ ...dxa(1), _MULT_: v, DXITOT: 0 }));
  const result = C.buildCohort([{
    cycle: '1999-2000', role: 'development',
    demo: [demo(1)], bmx: [bmx(1)], dxa: replicated, replicatePolicy: 'measured_only',
  }]);
  assert.equal(result.total, 1);
  assert.equal(result.flow[0].replicateReport.rows, 5);
  assert.equal(result.flow[0].replicatePolicy, 'measured_only');
});

test('a holdout cycle is never split, and a development cycle always is', () => {
  const result = build(
    cycle('1999-2000', 'development', [person(1), person(2), person(3), person(4), person(5)]),
    cycle('2017-2018', 'holdout', [person(90), person(91)]),
  );
  const holdout = result.participants.filter(p => p.cycle === '2017-2018');
  assert.ok(holdout.every(p => p.split === 'holdout'));
  const dev = result.participants.filter(p => p.cycle === '1999-2000');
  assert.ok(dev.every(p => p.split === 'train' || p.split === 'calibration'));
});

test('the split is deterministic, so two runs and two machines agree', () => {
  // A random split would need a recorded seed, and a recorded seed is a worse version of this.
  const first = C.assignSplit(62161), second = C.assignSplit(62161);
  assert.equal(first, second);
  assert.equal(C.assignSplit(62161), C.assignSplit('62161'), 'the identifier type must not change the assignment');
  const assignments = Array.from({ length: 400 }, (_, i) => C.assignSplit(90000 + i));
  const train = assignments.filter(a => a === 'train').length;
  assert.ok(train > 280 && train < 360, 'roughly 80% train, got ' + train + '/400');
});

test('a participant appearing in two cycles is refused rather than split twice', () => {
  const error = rejects(() => build(
    cycle('1999-2000', 'development', [person(1)]),
    cycle('2017-2018', 'holdout', [person(1)]),
  ), 'DUPLICATE_PARTICIPANT');
  assert.match(error.message, /both 1999-2000 and 2017-2018/);
  assert.match(error.message, /join key needs the cycle in it/);
});

test('a cycle with no role is refused, because it would silently be left out', () => {
  rejects(() => C.buildCohort([{ cycle: 'x', role: 'maybe', demo: [demo(1)], bmx: [bmx(1)], dxa: [dxa(1)] }]), 'UNKNOWN_ROLE');
});

// ----------------------------------------------------------------- units and shape
test('grams become kilograms once, here', () => {
  const result = build(cycle('2017-2018', 'holdout', [person(1)]));
  const p = result.participants[0];
  assert.equal(p.fatMassKg, 19.617);
  assert.equal(p.leanMassKg, 60.783);
  assert.equal(p.totalMassKg, 80.4);
  assert.equal(p.bodyFatPercent, 24.4);
  // And the composition reconciles: fat + lean is the total the survey reports.
  assert.ok(Math.abs((p.fatMassKg + p.leanMassKg) - p.totalMassKg) < 0.01);
});

test('the flow reads as a table a person can check', () => {
  const result = build(cycle('2017-2018', 'holdout', [person(1), person(2, { demo: { RIDAGEYR: 12 } })]));
  const text = C.formatCohortFlow(result);
  assert.match(text, /2017-2018  \(holdout/);
  assert.match(text, /Age under 18/);
  assert.match(text, /TOTAL 1/);
});

test('the flow always says which replicate policy ran, including when none was needed', () => {
  // This printed "undefined" for every post-2004 cycle: a file that needs no handling reports
  // 'not_replicated' on the result rather than inside the report, and the flow was reading the
  // inner one. A report that cannot say what it did is not a report.
  const result = build(
    cycle('2017-2018', 'holdout', [person(1)]),
  );
  assert.equal(result.flow[0].replicatePolicy, 'not_replicated');

  const replicated = [1, 2, 3, 4, 5].map(v => ({ ...dxa(2), _MULT_: v, DXITOT: 0 }));
  const early = C.buildCohort([{ cycle: '1999-2000', role: 'development',
    demo: [demo(2)], bmx: [bmx(2)], dxa: replicated, replicatePolicy: 'measured_only' }]);
  assert.equal(early.flow[0].replicatePolicy, 'measured_only');
  for (const flow of [...result.flow, ...early.flow]) {
    assert.ok(flow.replicatePolicy && flow.replicatePolicy !== 'undefined',
      'every cycle in the flow has to name the policy that ran');
  }
});

test('the built cohort numbers are recorded, and the two documents agree on them', () => {
  // The flow table in the findings is the committed record of a build whose outputs are not
  // committed. If it drifts from the preregistration's figure, the study has two answers.
  const fs = require('node:fs'), path = require('node:path');
  const read = name => fs.readFileSync(path.join(__dirname, '..', 'research', name), 'utf8');
  const findings = read('NHANES-DATA-STRUCTURE.md'), prereg = read('NHANES-PREREGISTRATION.md');
  for (const doc of [findings, prereg]) assert.match(doc, /14,295/, 'the built development cohort');
  assert.match(findings, /11,417 train, 2,878 calibration/);
  // The finding the flow exists to make visible: the two eras exclude the same people by
  // opposite mechanisms, and a single filter would have kept one group or the other.
  assert.match(findings, /trade places between eras/);
  // Whitespace-tolerant: the document is hard-wrapped, so a phrase this long spans a line break.
  assert.match(findings.replace(/\s+/g, ' '), /one filter would have kept one group or the other/);
});

// ----------------------------------------------------------------- amendment 5

test('arm circumference is carried from BMXARMC, and a missing one is null rather than an exclusion', () => {
  // A model that needs arm circumference refuses someone without it. The cohort does not drop them:
  // attempt 1's models do not use it, and they must see exactly the cohort they saw before.
  const result = build(cycle('2013-2014', 'development', [person(1, { bmx: { BMXARMC: 33.46 } }), person(2)]));
  assert.equal(result.total, 2);
  const [withArm, withoutArm] = [...result.participants].sort((a, b) => a.seqn - b.seqn);
  assert.equal(withArm.armCircumferenceCm, 33.5);
  assert.equal(withoutArm.armCircumferenceCm, null);

  assert.ok(C.MODEL_FEATURES.includes('armCircumferenceCm'));
  const rows = C.modelReadyExport(result.participants);
  assert.ok(rows.every(row => Object.hasOwn(row, 'armCircumferenceCm')));
});

test('hip circumference is not a model feature, because NHANES measured it in one spent cycle', () => {
  // The literature's suggestion, refused by the data. See amendment 5's availability table.
  assert.ok(!C.MODEL_FEATURES.some(key => /hip/i.test(key)));
});
