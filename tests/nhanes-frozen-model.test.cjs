// The frozen candidate artifact, and the runtime that refuses to misuse it.
//
// The artifact is the thing the single holdout read will be run against. Two properties matter
// more than anything else here: that it actually contains a model, and that nothing can present
// its output as a validated estimate while no holdout has been read.
//
// The first of those is not hypothetical. The first version of the freeze tool serialized an
// artifact with no model in it, no input schema and no supported population — 2 KB instead of
// 448 — because JSON.stringify's array replacer is an allowlist applied at every nesting level.
// Its --verify step reported success, because it was comparing two identically gutted objects.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ARTIFACT_PATH = path.join(__dirname, '..', 'research', 'model', 'bodyfat-candidate-v0.1.0.json');
let P, artifact;
test.before(async () => {
  P = await import('../tools/nhanes/frozen-predict.mjs');
  artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
});

const adult = (over = {}) => ({ ageYears: 42, sexMale: 1, heightCm: 178, weightKg: 88, waistCm: 98, ...over });
const estimate = (person, options = { allowCandidate: true }) => P.estimateBodyComposition(artifact, person, options);

// ----------------------------------------------------------------- the artifact is real
test('the frozen artifact contains an actual model, not a shell that hashes cleanly', () => {
  assert.equal(artifact.model.ensemble.length, 300, 'all 300 trees');
  assert.ok(artifact.model.ensemble.every(tree => tree.leaf || (tree.feature && Number.isFinite(tree.threshold))));
  assert.equal(artifact.inputs.length, 5);
  assert.equal(artifact.supportedPopulation.ageYears.max, 59);
  // The size is the tell: an artifact this shape cannot be small.
  assert.ok(fs.statSync(ARTIFACT_PATH).size > 100_000,
    'a 300-tree ensemble cannot fit in ' + fs.statSync(ARTIFACT_PATH).size + ' bytes; the model has been serialized away');
});

test('the recorded checksum matches the file it names', () => {
  const crypto = require('node:crypto');
  const recorded = fs.readFileSync(path.join(__dirname, '..', 'research', 'model', 'bodyfat-candidate-v0.1.0.sha256'), 'utf8').split(/\s+/)[0];
  // Normalized before hashing, for the same reason the freeze tool normalizes: with core.autocrlf
  // a Windows clone rewrites this file to CRLF, and a hash over the raw bytes would fail on a
  // machine that had changed nothing. Checked here as well so the property is enforced rather than
  // trusted to the tool that produced it.
  const content = fs.readFileSync(ARTIFACT_PATH, 'utf8').replace(/\r\n/g, '\n');
  const actual = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  assert.equal(actual, recorded);

  // And the hazard itself, so nobody removes the normalization as redundant.
  const asCrlf = crypto.createHash('sha256').update(content.replace(/\n/g, '\r\n'), 'utf8').digest('hex');
  assert.notEqual(asCrlf, recorded, 'if these ever matched, the normalization would be proving nothing');
});

test('the artifact records that it was read and that it failed', () => {
  // The holdout was read on 2026-09-12 and the model failed one of six criteria. These fields
  // are what stop it being treated as released, so they are asserted rather than assumed.
  assert.equal(artifact.status, 'not_released');
  assert.equal(artifact.holdoutRead, true);
  assert.equal(artifact.releaseDecision, 'not_released');
  assert.ok(artifact.holdoutReport, 'the report has to be there, whatever it says');

  // Five passed and exactly one failed, and the one that failed is the subgroup bias criterion.
  const criteria = artifact.holdoutReport.criteria;
  assert.equal(criteria.length, 6);
  assert.equal(criteria.filter(c => c.pass).length, 5);
  const failed = criteria.find(c => !c.pass);
  assert.equal(failed.id, 'subgroup_bias');
  assert.ok(failed.value > 1.0, 'the failing value has to exceed the limit it failed');

  // And the review that no tool can perform is recorded as outstanding rather than quietly
  // dropped now that it no longer gates anything.
  assert.equal(artifact.holdoutReport.statisticianReview.completed, false);
});

test('waist is declared required, and the artifact says why there is no fallback', () => {
  const waist = artifact.inputs.find(input => input.key === 'waistCm');
  assert.equal(waist.required, true);
  assert.match(waist.note, /REQUIRED, not optional/);
  assert.match(waist.note, /no fallback|there is no fallback/i);
});

test('the artifact records what it may never be taken to mean', () => {
  assert.match(artifact.notSkeletalMuscle, /NOT skeletal muscle/);
  assert.match(artifact.limitations, /Establishes nothing about DEXA equivalence/);
  assert.deepEqual([...artifact.forbiddenInputs].slice(0, 4),
    ['race', 'ethnicity', 'participant identifiers', 'survey design variables']);
});

// ----------------------------------------------------------------- the candidate gate
test('a candidate artifact refuses to produce an estimate for a caller that has not said so', () => {
  // The default path is the one a careless integration takes.
  const refused = P.estimateBodyComposition(artifact, adult());
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'NOT_RELEASED');
  assert.match(refused.message, /no holdout has been read/);
  assert.match(refused.message, /must not be shown to anyone/);
});

test('a research caller can opt in, and what comes back says the model FAILED validation', () => {
  // Not merely "not validated". The first version of this keyed the message on whether a holdout
  // had been read, so the moment this model was read and refused it would have started announcing
  // validation. Reading a holdout is not passing one.
  const result = estimate(adult());
  assert.equal(result.ok, true);
  assert.equal(result.modelStatus, 'not_released');
  assert.match(result.validated, /FAILED VALIDATION/);
  assert.match(result.validated, /did not meet its release criteria/);
  assert.match(result.validated, /subgroup bias/i);
  assert.ok(!/^Validated/.test(result.validated));
});

// ----------------------------------------------------------------- refusals
test('someone outside the supported ages is refused, not extrapolated to', () => {
  for (const age of [17, 60, 75]) {
    const refused = estimate(adult({ ageYears: age }));
    assert.equal(refused.ok, false, 'age ' + age + ' should be refused');
    assert.equal(refused.code, 'OUTSIDE_SUPPORTED_POPULATION');
  }
  assert.equal(estimate(adult({ ageYears: 18 })).ok, true);
  assert.equal(estimate(adult({ ageYears: 59 })).ok, true);
});

test('no waist means no estimate, and the message says there is nothing to fall back to', () => {
  const refused = estimate(adult({ waistCm: null }));
  assert.equal(refused.code, 'MISSING_INPUT');
  assert.match(refused.message, /waistCm is required/);
  assert.match(refused.message, /nothing to fall back to/);
});

test('an implausible input is refused rather than producing a confident answer', () => {
  assert.equal(estimate(adult({ weightKg: 500 })).code, 'INPUT_OUT_OF_RANGE');
  assert.equal(estimate(adult({ heightCm: 30 })).code, 'INPUT_OUT_OF_RANGE');
  assert.equal(estimate(adult({ sexMale: 2 })).code, 'INVALID_INPUT');
});

test('an artifact with no model refuses, whatever else it claims about itself', () => {
  const gutted = { ...artifact, model: { ...artifact.model, ensemble: [] } };
  const refused = P.estimateBodyComposition(gutted, adult(), { allowCandidate: true });
  assert.equal(refused.code, 'EMPTY_ARTIFACT');
  assert.match(refused.message, /whatever else it says about itself/);
});

test('something that is not one of our artifacts is refused by schema', () => {
  assert.equal(P.estimateBodyComposition({ schema: 'SOMETHING_ELSE' }, adult()).code, 'UNKNOWN_ARTIFACT');
});

// ----------------------------------------------------------------- the estimate itself
test('an estimate reconciles with total body mass and carries its own definition', () => {
  const result = estimate(adult());
  assert.ok(result.bodyFatPercent > 5 && result.bodyFatPercent < 60, 'got ' + result.bodyFatPercent);
  assert.ok(Math.abs((result.fatMassKg + result.leanMassKg) - 88) < 0.15);
  assert.match(result.leanMassDefinition, /not skeletal muscle mass/i);
  assert.equal(result.isParentPlaybookEstimate, true);
  assert.equal(result.origin, 'model_estimate');
});

test('the estimate moves in the directions the fitted relationship implies', () => {
  // Not a claim about accuracy. A larger waist at the same height and weight should not lower the
  // estimate, and a woman should not be estimated leaner than a man at identical measurements --
  // if either reversed, something is wired backwards rather than merely imprecise.
  const base = estimate(adult()).bodyFatPercent;
  const wider = estimate(adult({ waistCm: 112 })).bodyFatPercent;
  assert.ok(wider >= base, 'a larger waist lowered the estimate: ' + base + ' -> ' + wider);
  const female = estimate(adult({ sexMale: 0 })).bodyFatPercent;
  assert.ok(female > base, 'at identical measurements a woman should not be estimated leaner: ' + base + ' vs ' + female);
});

test('the same inputs give the same answer every time', () => {
  // The artifact is a fixed structure with no randomness, so this is a property the release
  // depends on rather than a coincidence worth assuming.
  const a = estimate(adult()), b = estimate(adult());
  assert.equal(a.bodyFatPercent, b.bodyFatPercent);
  assert.equal(a.fatMassKg, b.fatMassKg);
});

// ----------------------------------------------------------------- describing it
test('an artifact describes itself honestly to someone deciding whether to trust it', () => {
  const described = P.describeArtifact(artifact);
  assert.equal(described.releasable, false, 'a model that failed its holdout is not releasable');
  assert.equal(described.holdoutRead, true);
  assert.ok(described.holdoutReport, 'the report travels with the description');
  assert.deepEqual([...described.requiredInputs], ['ageYears', 'sexMale', 'heightCm', 'weightKg', 'waistCm']);
  assert.equal(described.calibrationMae, 2.627);
  assert.ok(described.refusalConditions.length >= 5);
});

test('the model card and the artifact agree, and the card leads with the status', () => {
  // A card that says something different from the artifact is the version people will read.
  const card = fs.readFileSync(path.join(__dirname, '..', 'research', 'model', 'MODEL-CARD.md'), 'utf8');
  const flat = card.replace(/\s+/g, ' ');
  assert.match(card.split('\n').slice(0, 6).join(' '), /Status: NOT RELEASED/,
    'the status belongs at the top, not in a limitations section further down');
  assert.match(flat, /failed one of six[\s\S]{0,40}release criteria/);
  assert.match(flat, /1\.19/, 'the size of the failure, not just the fact of it');
  assert.match(flat, new RegExp(String(artifact.training.fittedOn).replace(/(\d)(?=(\d{3})+$)/g, '$1,')));
  assert.match(flat, /2\.627/);
  assert.match(flat, /0\.865/);
  assert.match(flat, /optimistic by construction/);
  // The two rules that constrain what can be built on top of the number.
  assert.match(flat, /Waist is required, not optional/);
  assert.match(flat, /Lean mass is not skeletal muscle mass/);
  assert.match(flat, /NCHS does not endorse this work/);
});

// ----------------------------------------------------------------- the holdout is spent
test('the holdout cannot be read a second time', () => {
  // "Read once" is only a rule if something enforces it, and the thing most likely to break it is
  // someone re-running a command to see the output again. The tool checks holdoutRead and exits.
  const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'nhanes', 'read-holdout.cjs'), 'utf8');
  assert.match(source, /if \(artifact\.holdoutRead\)/);
  assert.match(source, /There is no second read/);
  // And it cannot be reached by tab-completing something shorter.
  assert.match(source, /--i-am-making-the-release-decision/);
});

test('the holdout record states the failure and refuses the obvious next move', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'research', 'NHANES-HOLDOUT.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(doc, /NOT RELEASED/);
  assert.match(doc, /1\.188/);
  assert.match(doc, /2\.726/);
  // The criterion that caught it was added after seeing calibration, and the record says so
  // rather than presenting it as having been there all along.
  assert.match(doc, /added after seeing results/i);
  // The tempting move, named and refused.
  assert.match(doc, /Not a reason to remove the criterion/);
  assert.match(doc, /it came back inconvenient/);
  // And that the holdout is spent, with the honest account of why another one is available.
  assert.match(doc, /2017–2018 is spent|2017-2018 is spent/);
  assert.match(doc, /omitted from the candidate source list by oversight/);
});
