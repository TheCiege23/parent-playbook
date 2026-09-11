// The sprint clip window, and the failure it used to report as the parent's mistake.
//
// Frames were read for the first 8 seconds of the clip only, while the measurement accepted
// an elapsed time of up to 15 seconds — so most of the range the code claimed to allow could
// never be observed. A 40-yard dash takes a young child 8-9 seconds by itself, before any
// lead-in from pressing record, so the finish crossing fell outside the window and came back
// as `no_crossing_detected`, whose copy tells the parent to re-check their marks. They could
// re-mark forever and never succeed.
//
// These cover the arithmetic, the crossing interpolation, and the window relationship. The
// measurement itself needs a real video and a browser, so what is exercised here is the pure
// logic the failure actually lived in.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
function sprintSource() { return fs.readFileSync(path.join(base, 'js', 'sprint-measure.js'), 'utf8'); }

function context() {
  const ctx = vm.createContext({ console, Number, Math, String, Date, JSON, isFinite, isNaN });
  const source = sprintSource();
  // Load the pure top of the file: the constants and crossingTime, stopping before the
  // async measurement that needs a document and a video element.
  const cut = source.indexOf('async function measureSprintFromVideo');
  assert.ok(cut > 0, 'sprint-measure.js should still define measureSprintFromVideo');
  vm.runInContext(source.slice(0, cut), ctx);
  return ctx;
}
const num = name => vm.runInContext(name, context());

test('the examined window covers the longest run the measurement will accept', () => {
  const readWindow = num('SPRINT_MAX_SECONDS');
  const longestAccepted = num('SPRINT_MEAS_MAX_S');
  assert.ok(readWindow > longestAccepted,
    `frames are read for ${readWindow}s but an elapsed time up to ${longestAccepted}s is accepted — ` +
    'the extra margin is the lead-in before the run starts, and without it the finish crossing ' +
    'cannot be seen for the slowest runs the code says it allows');
});

test('the window leaves room for a realistic lead-in before the run', () => {
  // A parent presses record, the child gets set, then goes. A window with no margin over the
  // run itself only works if recording starts at the instant of the first stride.
  const readWindow = num('SPRINT_MAX_SECONDS');
  const slowYouth40 = 9;            // seconds, a young child over 40 yards
  assert.ok(readWindow >= slowYouth40 + 5,
    `a ${slowYouth40}s run plus a few seconds of lead-in must fit inside the ${readWindow}s window`);
});

test('yards per second converts to miles per hour correctly', () => {
  const ydToMi = num('YD_TO_MI');
  assert.equal(ydToMi, 1 / 1760);
  // 40 yards in 5 seconds is 8 yd/s, which is 8 * 3600 / 1760 mph.
  const mph = (40 / 5) * 3600 * ydToMi;
  assert.ok(Math.abs(mph - 16.3636) < 0.001, `expected ~16.36 mph, got ${mph}`);
});

test('the crossing instant is interpolated between samples, in either direction', () => {
  const ctx = context();
  // Left to right: crosses 0.5 midway between t=1 and t=2.
  const rightward = [{ t: 0, x: 0.1 }, { t: 1, x: 0.4 }, { t: 2, x: 0.6 }];
  assert.ok(Math.abs(ctx.crossingTime(rightward, 0.5) - 1.5) < 1e-9);
  // Right to left: the same marker, the opposite run direction.
  const leftward = [{ t: 0, x: 0.9 }, { t: 1, x: 0.6 }, { t: 2, x: 0.4 }];
  assert.ok(Math.abs(ctx.crossingTime(leftward, 0.5) - 1.5) < 1e-9);
  // A marker the athlete never reaches has no crossing, rather than a guessed one.
  assert.equal(ctx.crossingTime(rightward, 0.95), null);
});

test('the first crossing is the one taken, so a walk back does not rewrite the run', () => {
  const ctx = context();
  // Across the finish at t=1.5, then back over it at t=3.5 while walking to the start.
  const thereAndBack = [{ t: 0, x: 0.1 }, { t: 1, x: 0.4 }, { t: 2, x: 0.6 }, { t: 3, x: 0.6 }, { t: 4, x: 0.4 }];
  assert.ok(Math.abs(ctx.crossingTime(thereAndBack, 0.5) - 1.5) < 1e-9);
});

test('a stationary series at the marker does not produce a bogus crossing time', () => {
  const ctx = context();
  // Sitting exactly on the mark: the crossing is the first sample, not an interpolation
  // through a zero-width step, and it must not be NaN.
  const parked = [{ t: 0, x: 0.5 }, { t: 1, x: 0.5 }];
  const t = ctx.crossingTime(parked, 0.5);
  assert.ok(t !== null && Number.isFinite(t), `expected a finite crossing, got ${t}`);
});

test('the truncation branch is what reports a clip that ran past the window', () => {
  // The measurement needs a browser, so this asserts the source distinguishes the two causes
  // rather than collapsing them back into one message. Without it a parent whose marks were
  // correct is told to re-check their marks.
  const source = sprintSource();
  assert.match(source, /sourceDurationS > frames\.readDurationS/,
    'the crossing failure should compare the clip length against the window that was read');
  assert.match(source, /clip_too_long/, 'a truncated clip needs its own cause');
  const copy = fs.readFileSync(path.join(base, 'js', 'sprint-scan.js'), 'utf8');
  assert.match(copy, /clip_too_long:/, 'the new cause needs copy, or it renders as an unknown error');
  // And the copy must not blame the marks, which is the mistake being corrected.
  const entry = copy.slice(copy.indexOf('clip_too_long:'), copy.indexOf('clip_too_long:') + 500);
  assert.ok(!/re-?check that the marks/i.test(entry), 'the truncation message must not blame the marks');
});
