// Replicate rows in the NHANES DXA files.
//
// The failure being prevented: the 1999-2004 whole-body DXA files carry exactly five rows per
// participant, and a join that ignores that multiplies the cohort by five. It does not error and
// does not look wrong -- one person becomes five people who happen to agree, every standard error
// shrinks, and any model fitted on the result looks better than it is.
//
// Fixtures are synthetic and shaped like the real files. The real counts they imitate are recorded
// in research/NHANES-DATA-STRUCTURE.md, measured rather than recalled.
const test = require('node:test');
const assert = require('node:assert/strict');

let R;
test.before(async () => { R = await import('../tools/nhanes/replicates.mjs'); });

// A measured participant: five identical replicates, imputation flag clear.
const measured = (seqn, bodyFat) => [1, 2, 3, 4, 5].map(version =>
  ({ SEQN: seqn, _MULT_: version, DXITOT: 0, DXAEXSTS: 1, DXDTOPF: bodyFat }));

// An imputed participant: five replicates that genuinely differ.
const imputed = (seqn, values) => values.map((bodyFat, i) =>
  ({ SEQN: seqn, _MULT_: i + 1, DXITOT: 1, DXAEXSTS: 6, DXDTOPF: bodyFat }));

const EARLY = [
  ...measured(1, 31.0), ...measured(2, 24.4), ...measured(3, 18.2),
  ...imputed(4, [30.6, 31.3, 31.0, 30.9, 31.2]),
];
// A later cycle: one row per participant, no imputation apparatus at all.
const LATE = [
  { SEQN: 10, DXDTOPF: 27.1, DXAEXSTS: 1 },
  { SEQN: 11, DXDTOPF: 19.8, DXAEXSTS: 1 },
];

const rejects = (fn, code) => {
  try { fn(); assert.fail('expected rejection ' + code); }
  catch (error) { assert.equal(error.code, code, 'message was: ' + error.message); return error; }
};

// ----------------------------------------------------------------- detection
test('a replicated file is recognised by counting, not by its filename', () => {
  const shape = R.detectReplicates(EARLY);
  assert.equal(shape.rows, 20);
  assert.equal(shape.participants, 4);
  assert.equal(shape.rowsPerParticipant, 5);
  assert.equal(shape.replicated, true);
  assert.equal(shape.uniform, true);
  assert.deepEqual([...shape.versions], [1, 2, 3, 4, 5]);
});

test('a one-row-per-participant file is recognised as not replicated', () => {
  const shape = R.detectReplicates(LATE);
  assert.equal(shape.replicated, false);
  assert.equal(shape.hasVersionVariable, false);
  assert.equal(shape.rowsPerParticipant, 1);
});

test('a row with no participant identifier is refused, not skipped', () => {
  // Skipping it would change the cohort without telling anyone.
  rejects(() => R.detectReplicates([{ _MULT_: 1, DXDTOPF: 20 }]), 'MISSING_PARTICIPANT_ID');
});

// ----------------------------------------------------------------- the refusal
test('a replicated file without a named policy is refused, with the counts in the message', () => {
  const error = rejects(() => R.collapseReplicates(EARLY), 'REPLICATE_POLICY_REQUIRED');
  assert.match(error.message, /5\.00 rows per participant/);
  assert.match(error.message, /one person as 5 people/);
  // The person choosing needs to know what they are choosing between.
  assert.match(error.message, /measured_only/);
  assert.match(error.message, /single_imputation/);
  assert.match(error.message, /all_imputations/);
  assert.match(error.message, /no default/);
});

test('an unknown policy is refused rather than treated as the nearest thing', () => {
  rejects(() => R.collapseReplicates(EARLY, { policy: 'average_them' }), 'UNKNOWN_REPLICATE_POLICY');
});

test('an uneven replicate count is refused, because it is not this structure', () => {
  const uneven = [...measured(1, 31.0), ...measured(2, 24.4).slice(0, 3)];
  const error = rejects(() => R.collapseReplicates(uneven, { policy: 'measured_only' }), 'UNEVEN_REPLICATES');
  assert.match(error.message, /between 3 and 5 rows/);
  assert.match(error.message, /Find out why/);
});

test('a file that needs no policy passes through and says so', () => {
  const out = R.collapseReplicates(LATE);
  assert.equal(out.policy, 'not_replicated');
  assert.equal(out.rows.length, 2);
  assert.equal(out.report.dropped, 0);
});

// ----------------------------------------------------------------- the policies
test('measured only keeps the measured participants, one row each', () => {
  const out = R.collapseReplicates(EARLY, { policy: 'measured_only' });
  assert.equal(out.rows.length, 3, 'three measured participants, one row apiece');
  assert.equal(out.report.participantsKept, 3);
  assert.equal(out.report.participantsDropped, 1);
  assert.deepEqual(out.rows.map(r => r.SEQN), [1, 2, 3]);
  // Twenty rows in, three out. The count that matters is participants, and it is reported.
  assert.equal(out.report.rows, 20);
  assert.equal(out.report.kept, 3);
});

test('first imputation keeps everyone, and says what that costs', () => {
  const out = R.collapseReplicates(EARLY, { policy: 'single_imputation' });
  assert.equal(out.rows.length, 4);
  assert.equal(out.report.imputedParticipants, 1);
  assert.equal(out.report.measuredParticipants, 3);
  assert.match(out.report.policyCost, /Discards imputation uncertainty/);
  // The imputed participant contributes its first replicate, not an average of five.
  assert.equal(out.rows.find(r => r.SEQN === 4).DXDTOPF, 30.6);
});

test('all imputations keeps every row and says out loud that they are not observations', () => {
  const out = R.collapseReplicates(EARLY, { policy: 'all_imputations' });
  assert.equal(out.rows.length, 20);
  assert.match(out.report.warning, /NOT independent observations/);
  assert.match(out.report.warning, /Rubin/);
  assert.match(out.report.warning, /understate every standard error/);
});

test('the chosen policy is carried in the report, not left to be remembered', () => {
  for (const policy of ['measured_only', 'single_imputation', 'all_imputations']) {
    const out = R.collapseReplicates(EARLY, { policy });
    assert.equal(out.report.policy, policy);
    assert.ok(out.report.policyLabel, 'the report should name the policy in words');
    assert.ok(out.report.policyCost, 'and say what it costs');
  }
});

test('picking the first version takes version 1, not whatever order the file happened to be in', () => {
  const shuffled = [...imputed(9, [1, 2, 3, 4, 5])].reverse();
  const out = R.collapseReplicates(shuffled, { policy: 'single_imputation' });
  assert.equal(out.rows[0]._MULT_, 1);
  assert.equal(out.rows[0].DXDTOPF, 1);
});

// ----------------------------------------------------------------- agreement
test('replicates of a measured participant agree; replicates of an imputed one do not', () => {
  // This is what makes "measured only" meaningful rather than a flag anyone could have set: where
  // nothing was imputed, the five rows carry no extra information at all.
  const agreement = R.replicatesAgree(EARLY, 'DXDTOPF');
  assert.equal(agreement.participants, 4);
  assert.equal(agreement.identical, 3);
  assert.equal(agreement.varying, 1);
});

test('the counts this module is built around are recorded as measured, not recalled', () => {
  // research/NHANES-DATA-STRUCTURE.md states them; this keeps the document and the reason for
  // this module from drifting apart silently.
  const fs = require('node:fs'), path = require('node:path');
  const doc = fs.readFileSync(path.join(__dirname, '..', 'research', 'NHANES-DATA-STRUCTURE.md'), 'utf8');
  assert.match(doc, /31,175/, 'the row count of the 1999-2000 DXA file');
  assert.match(doc, /6,235/, 'its participant count');
  assert.match(doc, /4,671/, 'the participants with a genuine unimputed measurement');
  assert.match(doc, /5\.00/, 'the replicate ratio');
  assert.match(doc, /Rubin/, 'the correct combination rule is named');
});

// ----------------------------------------------------------------- documents agree
test('the preregistration and the data-structure findings state the same population and counts', () => {
  // Two documents now depend on the same measured numbers, and they were written on the same day
  // by the same person. That is exactly when they start to drift: one gets corrected and the other
  // keeps a figure nobody rechecks.
  const fs = require('node:fs'), path = require('node:path');
  const read = name => fs.readFileSync(path.join(__dirname, '..', 'research', name), 'utf8');
  const prereg = read('NHANES-PREREGISTRATION.md'), findings = read('NHANES-DATA-STRUCTURE.md');

  for (const doc of [prereg, findings]) {
    assert.match(doc, /14,348/, 'the development cohort after both amendments');
    assert.match(doc, /2,452/, 'the holdout cohort');
    assert.match(doc, /1,589/, 'the participants the age narrowing costs');
  }
  // The narrowed population, and the reason, in both places.
  assert.match(prereg, /18-59|18–59/);
  assert.match(findings, /18–59|18-59/);
  assert.match(prereg, /contains no participant aged 60-69/);

  // The population section must STATE the narrowed bound. It may also mention the old one -- the
  // document deliberately shows what changed rather than quietly replacing it -- so the check is
  // that no ordinary line still asserts 18-69, while a quoted change note may say what it used to be.
  const populationSection = prereg.slice(prereg.indexOf('## 2. Population'), prereg.indexOf('## 3. Inputs'));
  assert.match(populationSection, /\*\*Included:\*\*[^\n]*18[–-]59/,
    'the population section has to state the narrowed bound, not only reference the amendment');
  const asserting = populationSection.split('\n')
    .filter(line => !line.trimStart().startsWith('>') && /18[–-]69/.test(line));
  assert.deepEqual(asserting, [],
    'a line outside the change note still asserts 18-69: ' + asserting.join(' | '));
});

test('the body-fat definition the study predicts is written down, not assumed', () => {
  const fs = require('node:fs'), path = require('node:path');
  const findings = fs.readFileSync(path.join(__dirname, '..', 'research', 'NHANES-DATA-STRUCTURE.md'), 'utf8');
  // Fat over total mass INCLUDING bone and head. The plausible alternative is off by about 0.9 pp,
  // against a 3.5 pp release threshold -- small enough to look like noise and large enough to matter.
  assert.match(findings, /fat \+ lean \+ bone mineral/);
  assert.match(findings, /including the head/);
  assert.match(findings, /0\.9 pp|0\.025 pp/);
});

test('the exclusion rules name the test that implements them, not just the intent', () => {
  // For three of these the obvious implementation is wrong and produces a plausible cohort rather
  // than an error, so the preregistration has to carry the test and not only the intention.
  const fs = require('node:fs'), path = require('node:path');
  const prereg = fs.readFileSync(path.join(__dirname, '..', 'research', 'NHANES-PREREGISTRATION.md'), 'utf8');
  const section = prereg.slice(prereg.indexOf('## 2. Population'), prereg.indexOf('## 3. Inputs'));

  // Validity is the presence of the value, and explicitly NOT the exam status flag.
  assert.match(section, /DXDTOPF` is null/);
  assert.match(section, /\*\*Not\*\* `DXAEXSTS/);
  // Pregnancy is an exclusion, not a requirement. The inverted reading drops most of the cohort.
  assert.match(section, /`RIDEXPRG` is 1 or 3/);
  assert.match(section, /\*\*Not\*\* "keep where `RIDEXPRG = 2`"/);
  // And the imputation filter is scoped to the era that has imputation at all.
  assert.match(section, /DXITOT ≠ 0`, early cycles only/);
});

test('the findings record why exam status cannot be the validity test', () => {
  const fs = require('node:fs'), path = require('node:path');
  const findings = fs.readFileSync(path.join(__dirname, '..', 'research', 'NHANES-DATA-STRUCTURE.md'), 'utf8');
  assert.match(findings, /678 of the 4,336/, 'completed exams with no total');
  assert.match(findings, /opposite ways/, 'the two eras handle an unusable scan differently');
  // The pregnancy trap, with the number that makes it concrete.
  assert.match(findings, /2,596 of 3,706/);
  assert.match(findings, /never asked/);
});

test('measured_only names who it dropped and whether each had an imputed value', () => {
  // The cohort flow needs to know who left the file here: they are gone before any exclusion runs,
  // and without this they were counted as having no DXA record at all.
  const rows = [
    ...measured(10, 20.0),
    ...imputed(11, [30.1, 30.6, 29.8, 30.3, 30.0]),
    ...[1, 2, 3, 4, 5].map(version => ({ SEQN: 12, _MULT_: version, DXITOT: 2, DXAEXSTS: 6, DXDTOPF: null })),
  ];
  const out = R.collapseReplicates(rows, { policy: 'measured_only' });
  assert.deepEqual(out.droppedParticipants.map(d => [d.id, d.hasValue]), [[11, true], [12, false]]);
  assert.equal(out.report.participantsDropped, 2);
  assert.equal(out.report.droppedWithImputedValue, 1);
  assert.equal(out.report.droppedWithoutValue, 1);
  assert.ok(Object.isFrozen(out.droppedParticipants));

  // Only measured_only removes anyone, and a file that needed no collapsing removes no one.
  for (const policy of ['single_imputation', 'all_imputations']) {
    assert.deepEqual([...R.collapseReplicates(rows, { policy }).droppedParticipants], []);
  }
  assert.deepEqual([...R.collapseReplicates(LATE).droppedParticipants], []);
});
