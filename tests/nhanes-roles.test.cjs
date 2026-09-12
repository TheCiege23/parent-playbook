// Which part each survey cycle plays, and the guard that one unread holdout stays unread.
//
// The first attempt kept the cycle-to-role map in four tools, and read-holdout.cjs put every
// cycle that was not its holdout into development. Adding the next holdout would have fed it into a
// baseline fit. These tests hold the single source of truth to what amendment 5 says it is.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let R;
test.before(async () => { R = await import('../tools/nhanes/roles.mjs'); });

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools', 'nhanes', 'sources.json'), 'utf8'));
const rejects = (fn, code) => {
  try { fn(); assert.fail('expected rejection ' + code); }
  catch (error) { assert.equal(error.code, code, 'message was: ' + error.message); return error; }
};

test('manifest roles map to cohort roles, and a spent holdout takes no part', () => {
  assert.equal(R.cohortRoleFor('development', 'x'), 'development');
  assert.equal(R.cohortRoleFor('candidate-final-holdout', 'x'), 'holdout');
  assert.equal(R.cohortRoleFor('spent-holdout', 'x'), null);
});

test('an unknown role throws instead of being skipped by one tool and included by another', () => {
  const error = rejects(() => R.cohortRoleFor('holdout-maybe', '2019-2020'), 'UNKNOWN_ROLE');
  assert.match(error.message, /2019-2020/);
  rejects(() => R.cohortRoleFor(undefined, '2019-2020'), 'UNKNOWN_ROLE');
  // Inherited names are not roles.
  rejects(() => R.cohortRoleFor('toString', '2019-2020'), 'UNKNOWN_ROLE');
});

test('there is exactly one unread holdout, and zero or two is an error', () => {
  const entry = (cycle, role) => ({ cycle, role });
  assert.equal(R.holdoutCycleOf([entry('a', 'development'), entry('b', 'candidate-final-holdout'), entry('b', 'candidate-final-holdout')]), 'b');
  rejects(() => R.holdoutCycleOf([entry('a', 'development'), entry('c', 'spent-holdout')]), 'HOLDOUT_NOT_UNIQUE');
  rejects(() => R.holdoutCycleOf([entry('b', 'candidate-final-holdout'), entry('c', 'candidate-final-holdout')]), 'HOLDOUT_NOT_UNIQUE');
});

test('sources.json matches amendment 5: 2015-2016 is the holdout, 2017-2018 is spent', () => {
  const roleOf = Object.fromEntries(manifest.cycles.map(c => [c.cycle, c.role]));
  for (const cycle of manifest.cycles) R.cohortRoleFor(cycle.role, cycle.cycle);
  assert.equal(R.holdoutCycleOf(manifest.cycles), '2015-2016');
  // Read once for attempt 1. If this ever becomes a holdout again, a result has been read twice.
  assert.equal(roleOf['2017-2018'], 'spent-holdout');
});

test('development is exactly the five cycles attempt 1 trained on', () => {
  // Amendment 5 holds development fixed so arm circumference is the only thing that changed. Adding
  // a cycle here would make the attempt-2 result impossible to attribute.
  const development = manifest.cycles.filter(c => R.cohortRoleFor(c.role, c.cycle) === 'development').map(c => c.cycle);
  assert.deepEqual(development, ['1999-2000', '2001-2002', '2003-2004', '2011-2012', '2013-2014']);
});

test('no driver keeps its own copy of the role map', () => {
  // The bug this module exists to prevent. A tool reading roles any other way is a second copy.
  for (const name of ['build-cohort.cjs', 'run-baselines.cjs', 'run-candidates.cjs', 'freeze-model.cjs', 'read-holdout.cjs']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'nhanes', name), 'utf8');
    assert.ok(!/const ROLES\s*=/.test(source), name + ' declares its own ROLES map');
    assert.match(source, /roles\.mjs/, name + ' does not read roles from roles.mjs');
  }
});

test('read-holdout never puts a non-development cycle into its baseline fit', () => {
  // A bare else here would send the unread holdout into development the moment it joined the lock.
  const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'nhanes', 'read-holdout.cjs'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(source, /else if \(cohortRoleFor\(entry\.role, entry\.cycle\) === 'development'\)/);
  assert.ok(!/HOLDOUT_CYCLE\) holdout\[slot\] = readXport\(buffer\)\.rows;\n\s*else \{/.test(source));
});
