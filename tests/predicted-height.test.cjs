// Predicted adult height, and the case where the card used to disappear.
//
// pctAdultHeight() capped at 100.5% and returned null above it, and growthCard renders the
// whole block only `if(pred && pct)`. So a parent who had entered both their own heights
// saw the entire "Predicted adult height" card vanish the moment their child grew past the
// midpoint — no number, no range, no explanation. That is not an edge case: the midpoint is
// a mean, so roughly half of children finish above it, and a sixteen- or seventeen-year-old
// sitting above it is ordinary.
//
// These also pin the published formulas, because they are arithmetic about somebody's child
// and a transcription slip would be silent.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
function context() {
  const ctx = vm.createContext({ console, Number, Math, String, Date, JSON, isFinite, isNaN });
  vm.runInContext("function esc(v){return String(v??'');}", ctx);
  vm.runInContext(fs.readFileSync(path.join(base, 'js', 'maturity.js'), 'utf8'), ctx);
  return ctx;
}
const near = (actual, expected, tol, what) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: expected ~${expected}, got ${actual}`);

test('mid-parental height matches the published Tanner formula', () => {
  const ctx = context();
  // 13cm = 5.118in. Boys ((mother + 13cm) + father) / 2; girls ((father - 13cm) + mother) / 2.
  near(ctx.midParentalHeight(64, 70, 'male').mid, (64 + 5.118 + 70) / 2, 1e-9, 'boys');
  near(ctx.midParentalHeight(64, 70, 'female').mid, (70 - 5.118 + 64) / 2, 1e-9, 'girls');
  // The band is the honest width of the method, not decoration.
  const p = ctx.midParentalHeight(64, 70, 'male');
  near(p.hi - p.lo, 6.6, 1e-9, 'the 2SD spread');
});

test('a missing or implausible parent height yields no prediction at all', () => {
  const ctx = context();
  // Number(null) is 0 and isFinite(0) is true, so this has to be checked, not assumed.
  for (const [m, f] of [[null, 70], [64, null], ['', 70], [64, ''], [12, 70], [64, 200], [undefined, 70]]) {
    assert.equal(ctx.midParentalHeight(m, f, 'male'), null, `mother=${m} father=${f} should not predict`);
  }
  assert.equal(ctx.midParentalHeight(64, 70, 'unknown'), null);
});

test('a child past the midpoint still gets the card', () => {
  const ctx = context();
  // The exact cases that silently lost it: ordinary parents, an ordinary older teenager.
  for (const [label, mother, father, sex, current] of [
    ['17yo boy, average parents', 64, 70, 'male', 71],
    ['16yo boy, average parents', 64, 70, 'male', 70],
    ['17yo boy, shorter parents', 62, 68, 'male', 70],
    ['17yo girl, average parents', 64, 70, 'female', 66],
  ]) {
    const predicted = ctx.midParentalHeight(mother, father, sex);
    const pct = ctx.pctAdultHeight(current, predicted);
    assert.ok(pct, `${label}: the card must still render`);
    assert.equal(pct.atOrAbovePrediction, true, `${label}: should be flagged as past the midpoint`);
    assert.ok(pct.pct > 100);
  }
});

test('a child below the midpoint is unchanged and not flagged', () => {
  const ctx = context();
  const predicted = ctx.midParentalHeight(64, 70, 'male');
  const pct = ctx.pctAdultHeight(60, predicted);
  assert.ok(pct);
  assert.equal(pct.atOrAbovePrediction, false);
  near(pct.pct, (60 / predicted.mid) * 100, 1e-9, 'percentage attained');
  // The band inverts: dividing by the TALLER prediction gives the LOWER percentage.
  assert.ok(pct.lo < pct.pct && pct.pct < pct.hi, 'the percentage band should bracket the midpoint value');
  near(pct.lo, (60 / predicted.hi) * 100, 1e-9, 'lower bound');
  near(pct.hi, (60 / predicted.lo) * 100, 1e-9, 'upper bound');
});

test('a mistyped height is still refused', () => {
  const ctx = context();
  const predicted = ctx.midParentalHeight(64, 70, 'male');
  assert.equal(ctx.pctAdultHeight(10, predicted), null, 'implausibly short should be refused');
  assert.equal(ctx.pctAdultHeight(200, predicted), null, 'a quarter taller than predicted is a data error');
  assert.equal(ctx.pctAdultHeight('abc', predicted), null);
  assert.equal(ctx.pctAdultHeight(60, null), null);
});

test('the Mirwald maturity offset matches the published combined-sample equations', () => {
  const ctx = context();
  // Recomputed here from the paper's coefficients rather than copied from the output, so a
  // transcription slip in either place shows up as a disagreement.
  const cm = inches => inches * 2.54, kg = lb => lb * 0.45359237;
  for (const [sex, heightIn, sittingIn, weightLb] of [
    ['male', 60, 31, 95],
    ['female', 58, 30, 88],
  ]) {
    const got = ctx.maturityOffsetEstimate({
      sex, birthdate: '2014-03-01', measuredOn: '2026-03-01',
      heightIn, sittingHeightIn: sittingIn, weightLb,
    });
    assert.ok(got, `${sex} case should produce an estimate`);
    const age = got.ageYears, height = cm(heightIn), sitting = cm(sittingIn), mass = kg(weightLb);
    const leg = height - sitting, ratio = mass / height * 100;
    const expected = sex === 'male'
      ? -9.236 + 0.0002708 * (leg * sitting) - 0.001663 * (age * leg) + 0.007216 * (age * sitting) + 0.02292 * ratio
      : -9.376 + 0.0001882 * (leg * sitting) + 0.0022 * (age * leg) + 0.005841 * (age * sitting) - 0.002658 * (age * mass) + 0.07693 * ratio;
    // ageYears is rounded to 2dp for display, so allow for that in the recomputation.
    near(got.offsetYears, Math.round(expected * 100) / 100, 0.02, `${sex} maturity offset`);
    near(got.ageAtPhvYears, Math.round((age - expected) * 100) / 100, 0.02, `${sex} age at PHV`);
    assert.equal(got.uncertaintyYears, 1, 'the estimate must keep its +/-1 year band');
  }
});

test('the maturity offset refuses inputs outside the equation it came from', () => {
  const ctx = context();
  const ok = { sex: 'male', birthdate: '2014-03-01', measuredOn: '2026-03-01', heightIn: 60, sittingHeightIn: 31, weightLb: 95 };
  assert.ok(ctx.maturityOffsetEstimate(ok));
  // Mirwald's sample was 8-16. Outside it the equation is extrapolation, not measurement.
  assert.equal(ctx.maturityOffsetEstimate({ ...ok, birthdate: '2019-03-01' }), null, 'too young');
  assert.equal(ctx.maturityOffsetEstimate({ ...ok, birthdate: '2008-03-01' }), null, 'too old');
  // Sitting height cannot equal or exceed standing height.
  assert.equal(ctx.maturityOffsetEstimate({ ...ok, sittingHeightIn: 60 }), null);
  assert.equal(ctx.maturityOffsetEstimate({ ...ok, sex: 'unknown' }), null);
  assert.equal(ctx.maturityOffsetEstimate({ ...ok, measuredOn: '2026-02-30' }), null, 'an impossible date is not a date');
  assert.equal(ctx.maturityOffsetEstimate({}), null);
});

test('a maturity estimate never claims more precision than it has', () => {
  const ctx = context();
  const got = ctx.maturityOffsetEstimate({
    sex: 'male', birthdate: '2014-03-01', measuredOn: '2026-03-01',
    heightIn: 60, sittingHeightIn: 31, weightLb: 95,
  });
  // Every category is hedged in its own name; none of them asserts a state of puberty.
  assert.match(got.category, /^estimated_/);
  assert.ok(['estimated_pre_phv', 'estimated_near_phv', 'estimated_post_phv'].includes(got.category));
  assert.equal(got.method, 'mirwald-combined-2002');
});
