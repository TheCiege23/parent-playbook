// The reaction-time clip window.
//
// The audio is decoded over the whole recording, so the cue can land anywhere the parent
// happened to clap. Frames stopped at a flat 4 seconds. A cue at 5s therefore left no
// frames after it, and the measurement raised `no_movement` — whose copy tells the parent
// "the body left frame or the light made the outline hard to track", when the body was in
// frame the whole time and the video simply stopped being read before the cue.
//
// findCue() runs before frame extraction, so the window is now derived from the cue: far
// enough past it to contain the slowest reaction the measurement would accept, and no
// further. This pins that relationship, since the two constants living apart is exactly how
// the original drifted.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const speedSource = () => fs.readFileSync(path.join(base, 'js', 'speed-measure.js'), 'utf8');

function constants() {
  const ctx = vm.createContext({ console, Number, Math, String, Date, JSON, isFinite, isNaN });
  const source = speedSource();
  const cut = source.indexOf('async function decodeAudioSamples');
  assert.ok(cut > 0, 'speed-measure.js should still define decodeAudioSamples');
  vm.runInContext(source.slice(0, cut), ctx);
  return name => vm.runInContext(name, ctx);
}

test('the reaction window is derived from the cue, not a fixed clip length', () => {
  const source = speedSource();
  assert.match(source, /maxSeconds: Math\.min\(cueT \+ REACT_MAX_S \+ REACT_TAIL_S, REACT_HARD_CAP_S\)/,
    'the frame window should reach past wherever the cue actually landed');
  // The old fixed cap must be gone, not merely unused — an unused constant invites a
  // future edit to wire it back in.
  assert.ok(!/REACT_MAX_SECONDS/.test(source), 'the fixed 4s cap should no longer exist');
});

test('the window always contains the slowest reaction the measurement accepts', () => {
  const k = constants();
  const slowest = k('REACT_MAX_S'), tail = k('REACT_TAIL_S'), cap = k('REACT_HARD_CAP_S');
  assert.ok(tail > 0, 'the window needs margin past the slowest accepted reaction');
  // For any cue inside the hard cap, the derived window reaches past cue + slowest reaction.
  for (const cueT of [0.5, 1, 3, 5, 10, 20]) {
    const windowS = Math.min(cueT + slowest + tail, cap);
    if (cueT + slowest > cap) continue;       // beyond the cap is the cue_too_late case
    assert.ok(windowS >= cueT + slowest,
      `a cue at ${cueT}s must leave room for a ${slowest}s reaction, window was ${windowS}s`);
  }
});

test('an ordinary lead-in no longer truncates the clip before the cue', () => {
  const k = constants();
  // A parent presses record, the child settles, someone claps. Five seconds in is ordinary,
  // and it is exactly what the old 4s window could not see.
  const cueT = 5, windowS = Math.min(cueT + k('REACT_MAX_S') + k('REACT_TAIL_S'), k('REACT_HARD_CAP_S'));
  assert.ok(windowS > cueT, `a cue at ${cueT}s must be inside the window, which was ${windowS}s`);
  assert.ok(4 < cueT, 'this scenario is precisely the one the old fixed cap failed');
});

test('a cue past the hard cap is reported as its own cause, not as a failure to move', () => {
  const source = speedSource();
  assert.match(source, /cue_too_late/, 'a cue with no footage after it needs its own cause');
  assert.match(source, /cueT \+ REACT_MIN_S > frames\.readDurationS/,
    'the check should compare the cue against the window actually read');
  const copy = fs.readFileSync(path.join(base, 'js', 'speed-scan.js'), 'utf8');
  assert.match(copy, /cue_too_late:/, 'the new cause needs copy or it renders as an unknown error');
  // Read only this entry. A fixed-width slice runs into the next one, and `no_movement`
  // legitimately mentions framing and light — which made the first version of this test
  // fail on its neighbour's copy rather than on its own.
  const start = copy.indexOf('cue_too_late:');
  const end = copy.indexOf("' },", start);
  assert.ok(end > start, 'the cue_too_late entry should be a complete object literal');
  const entry = copy.slice(start, end);
  // The mistake being corrected: blaming framing or lighting for the app's own window.
  assert.ok(!/left frame|light/i.test(entry), 'the cue_too_late message must not blame framing or lighting');
  assert.match(entry, /record again|clap a little sooner/i, 'it should tell the parent what to do instead');
});

test('the reaction bounds still reject noise and non-reactions', () => {
  const k = constants();
  assert.ok(k('REACT_MIN_S') > 0 && k('REACT_MIN_S') < 0.15, 'a floor below human reaction is noise');
  assert.ok(k('REACT_MAX_S') > k('REACT_MIN_S'));
  assert.ok(k('REACT_STILL_M') < k('REACT_MOVE_M'),
    'the stillness threshold must be tighter than the movement threshold, or a still athlete registers as moving');
});

test('the hard cap still bounds the work for a pathological clip', () => {
  const k = constants();
  const cap = k('REACT_HARD_CAP_S');
  assert.ok(cap >= 20 && cap <= 60, `the cap should be generous but finite, got ${cap}`);
  assert.equal(Math.min(600 + k('REACT_MAX_S') + k('REACT_TAIL_S'), cap), cap,
    'a ten-minute recording must still stop at the cap');
});
