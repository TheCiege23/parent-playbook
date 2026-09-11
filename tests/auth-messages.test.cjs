// What a failed sign-in says to the person in front of it.
//
// Two branches handed a parent an instruction only the operator could carry out — "enable
// the Email provider in Supabase", "add the Site URL in Supabase settings" — naming our
// infrastructure vendor to them, and being the first thing a prospective buyer would see if
// auth were misconfigured during a demo.
//
// The detail still matters, so it now goes to the log and to monitoring instead of to the
// user. Two of friendlyAuthErr's four call sites never logged the raw error, so without that
// it would have been lost rather than merely hidden.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const authSource = () => fs.readFileSync(path.join(base, 'js', 'auth.js'), 'utf8');

// friendlyAuthErr and its logging helper, without the screens around them.
function context() {
  const logged = [];
  const reported = [];
  const ctx = vm.createContext({
    console: { error: (...a) => logged.push(a.join(' ')) },
    reportError: (e, tag) => reported.push(tag + ':' + e.message),
    Error, RegExp, String,
  });
  const source = authSource();
  const start = source.indexOf('function authConfigProblem');
  const end = source.indexOf('\nfunction addResend');
  assert.ok(start > 0 && end > start, 'auth.js should define authConfigProblem before addResend');
  vm.runInContext(source.slice(start, end), ctx);
  return { ctx, logged, reported };
}

test('a mail-server failure is told apart from an unconfirmed address', () => {
  const { ctx } = context();
  // The ordering this function documents: GoTrue reports a send failure with the word
  // "confirm" in it, and the generic branch used to swallow it.
  const send = ctx.friendlyAuthErr('Error sending confirmation email');
  assert.match(send, /wasn't created/, 'a failed signup is rolled back and must say so');
  assert.match(send, /fault on our side/);
  const reset = ctx.friendlyAuthErr('Error sending recovery email');
  assert.match(reset, /reset email/);
  assert.ok(!/wasn't created/.test(reset), 'a failed reset did not destroy an account');
  // And the ordinary unconfirmed case still reaches its own branch.
  assert.match(ctx.friendlyAuthErr('Email not confirmed'), /check your inbox/i);
});

test('a configuration fault reads as ours, without naming our vendor', () => {
  const { ctx } = context();
  for (const raw of ['Email provider is disabled', 'Email logins are disabled', 'redirect_to is not allowed']) {
    const shown = ctx.friendlyAuthErr(raw);
    assert.match(shown, /fault on our side/, `"${raw}" should read as our fault`);
    assert.ok(!/Supabase/i.test(shown), `"${raw}" must not name the vendor to a user`);
    assert.ok(!/settings|provider|Site URL/i.test(shown),
      `"${raw}" must not hand the user an instruction only the operator can act on`);
  }
});

test('the configuration detail still reaches the log and monitoring', () => {
  const { ctx, logged, reported } = context();
  ctx.friendlyAuthErr('Email provider is disabled');
  assert.equal(logged.length, 1, 'the operator needs the raw cause');
  assert.match(logged[0], /Email provider is disabled/);
  assert.equal(reported.length, 1);
  assert.match(reported[0], /^auth:config:/);
});

test('logging never breaks the message the user sees', () => {
  // reportError is optional and console can be stubbed away; neither may throw out of a
  // function whose whole job is to produce a sentence.
  const source = authSource();
  const start = source.indexOf('function authConfigProblem');
  const ctx = vm.createContext({
    console: { error() { throw new Error('console is gone'); } },
    Error, RegExp, String,
  });
  vm.runInContext(source.slice(start, source.indexOf('\nfunction addResend')), ctx);
  assert.match(ctx.friendlyAuthErr('Email provider is disabled'), /fault on our side/);
});

test('the everyday sign-in errors keep their plain wording', () => {
  const { ctx } = context();
  assert.match(ctx.friendlyAuthErr('Invalid login credentials'), /incorrect/i);
  assert.match(ctx.friendlyAuthErr('User already registered'), /already has an account/i);
  assert.match(ctx.friendlyAuthErr('rate limit exceeded'), /Too many tries/i);
  // Anything unrecognised is passed through rather than replaced with a guess.
  assert.equal(ctx.friendlyAuthErr('something entirely new'), 'something entirely new');
});

test('no user-facing auth string names the infrastructure vendor', () => {
  // Scoped to returned strings: an earlier version of this check matched the explanatory
  // comment that quotes the old copy, which is a way of passing by accident.
  const offenders = authSource().split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /return\s+"[^"]*Supabase/.test(line))
    .map(({ n }) => 'line ' + n);
  assert.deepEqual(offenders, [], 'these return a vendor name to the person signing in');
});
