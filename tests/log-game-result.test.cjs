// Logging a game result, and the undo that did not undo.
//
// A parent can record a result two ways: step the scores, or tap Won / Lost / Tied when
// nobody kept score. Tapping a chip nulls the scores and writes `result` directly. Tapping
// the same chip again is the undo.
//
// That undo read `LG.row.result = lgDerivedResult(LG.row)`, and lgDerivedResult returns the
// CURRENT result unchanged when either score is null — which it always is at that point,
// because selecting the chip nulled them. So the assignment was a no-op: the chip cleared
// visually, the summary line still read "Win", and lgCommit saved a win the parent had just
// undone.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
function context() {
  const ctx = vm.createContext({ console, Number, Math, String, JSON, Date });
  const source = fs.readFileSync(path.join(base, 'js', 'log-game.js'), 'utf8');
  // The pure result helpers; everything else needs the DOM, Supabase and app state.
  vm.runInContext(source.slice(source.indexOf('function lgDerivedResult')), ctx);
  return ctx;
}

const row = over => ({ our_score: null, their_score: null, result: 'na', ...over });

test('a result is derived from the scores whenever both are present', () => {
  const ctx = context();
  assert.equal(ctx.lgDerivedResult(row({ our_score: 3, their_score: 1 })), 'win');
  assert.equal(ctx.lgDerivedResult(row({ our_score: 1, their_score: 3 })), 'loss');
  assert.equal(ctx.lgDerivedResult(row({ our_score: 2, their_score: 2 })), 'tie');
  // Nil-nil is a real scoreline, not a missing one.
  assert.equal(ctx.lgDerivedResult(row({ our_score: 0, their_score: 0 })), 'tie');
  assert.equal(ctx.lgDerivedResult(row({ our_score: 1, their_score: 0 })), 'win');
});

test('a directly chosen result survives having no scores', () => {
  const ctx = context();
  // This is the behaviour the undo bug hid behind: it is correct on its own.
  assert.equal(ctx.lgDerivedResult(row({ result: 'win' })), 'win');
  assert.equal(ctx.lgDerivedResult(row({ result: 'loss' })), 'loss');
  assert.equal(ctx.lgDerivedResult(row({ result: 'na' })), 'na');
});

test('scores win over a previously chosen result', () => {
  const ctx = context();
  // If a parent taps Won and then actually enters 1-3, the scoreline is the truth.
  assert.equal(ctx.lgDerivedResult(row({ result: 'win', our_score: 1, their_score: 3 })), 'loss');
});

test('clearing a chosen result leaves no result behind', () => {
  const ctx = context();
  // What the undo now writes. Previously it wrote lgDerivedResult(row) instead, which
  // returned 'win' and left the game recorded as a win.
  const undone = row({ result: 'na' });
  assert.equal(ctx.lgDerivedResult(undone), 'na');
  assert.equal(ctx.lgResultLabel(undone), '', 'an undone result must show no label');
});

test('the undo assigns na rather than re-deriving the result it is undoing', () => {
  // The handler needs the DOM, so this reads the source. Re-deriving is exactly the
  // no-op that caused the bug, and it looks correct enough to be reintroduced.
  const source = fs.readFileSync(path.join(base, 'js', 'log-game.js'), 'utf8');
  const handler = source.slice(source.indexOf("bg.querySelectorAll('#lgRes .chip')"));
  const undo = handler.slice(0, handler.indexOf('else{'));
  assert.match(undo, /if\(already\)\{\s*LG\.row\.result='na';/,
    'deselecting must clear the result to na');
  assert.ok(!/if\(already\)\{\s*LG\.row\.result=lgDerivedResult/.test(undo),
    're-deriving on undo is a no-op when the scores are null, which they always are here');
});

test('the label is blank for no result and named for every real one', () => {
  const ctx = context();
  assert.equal(ctx.lgResultLabel(row({ result: 'na' })), '');
  assert.equal(ctx.lgResultLabel(row({ our_score: 2, their_score: 1 })), 'Win');
  assert.equal(ctx.lgResultLabel(row({ our_score: 1, their_score: 2 })), 'Loss');
  assert.equal(ctx.lgResultLabel(row({ our_score: 1, their_score: 1 })), 'Tie');
});
