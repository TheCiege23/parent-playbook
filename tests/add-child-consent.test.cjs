// A parent who is already signed in saves a new child straight from the reveal: a sibling, or a first child on an account
// that has none. The consent boxes lived only on the account step, which a signed-in parent never sees, so every such save
// was refused and then crashed writing the refusal into an error line the reveal did not have. Found by a signed-in
// regression in production on 2026-09-15. These run the real onboarding functions against stand-ins for the DOM and the
// database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(base, 'js/onboarding.js'), 'utf8').replace(/\r\n/g, '\n');
const H = (strings, ...v) => strings.reduce((a, s, i) => a + s + (v[i] ?? ''), '');
const esc = s => String(s);

// The source of one top-level function, found by its header and balanced braces.
function extract(header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, 'missing: ' + header);
  for (let i = source.indexOf('{', start + header.length - 1), depth = 0; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced: ' + header);
}
const build = (header, name, stubs) => new Function(...Object.keys(stubs), extract(header) + '\nreturn ' + name + ';')(...Object.values(stubs));
const CONSENTS = (() => {
  const start = source.indexOf('const CONSENTS = [');
  return new Function(source.slice(start, source.indexOf('\n];', start) + 3) + '\nreturn CONSENTS;')();
})();
const OB_FLOW = build('const OB_FLOW = {', 'OB_FLOW', {});
const MESSAGE = 'Please check the required consent boxes.';

function reveal(state, ob) {
  const obConsentFields = build('function obConsentFields(){', 'obConsentFields', { H, esc, ob, CONSENTS });
  const obConsentNote = build('function obConsentNote(){', 'obConsentNote', { H });
  const week = Array.from({ length: 7 }, () => ({ t: 'train', title: 'Synthetic drill', sub: '10 min', act: { dur: '10 min' } }));
  return build('function obReveal(){', 'obReveal', {
    H, esc, ob, state, ageFrom: () => 11, obPreviewProgram: () => ({ days: week }),
    DAY_LABELS: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], OB_STRIP: {}, obConsentFields, obConsentNote,
  })();
}
const blankOb = patch => ({ i: 0, mode: 'create', familyId: null, familyName: '', athlete: { first: 'Kid', bd: '2015-03-01' }, sport: 'football',
  positions: [], level: '', seasonState: '', practiceDays: [], gameDay: null, seasonStart: null, goals: [], consents: {}, teamCode: '', teamId: null, ...patch });

test('signed in, the reveal asks for consent itself; signed out, the boxes stay on the account step', () => {
  const signedIn = reveal({ user: { id: 'u' }, ref: { sports: [] } }, blankOb());
  for (const c of CONSENTS) assert.match(signedIn, new RegExp('data-c="' + c.key + '"'), c.key);
  assert.match(signedIn, /<div class="err" id="oberr"><\/div>/, 'somewhere to say a box is missing');
  assert.match(signedIn, /verifiable parental consent under COPPA/);
  assert.ok(signedIn.indexOf('data-c="child_data"') < signedIn.indexOf('id="n"'), 'the boxes come before Save');

  const signedOut = reveal({ user: null, ref: { sports: [] } }, blankOb());
  assert.doesNotMatch(signedOut, /data-c=|id="oberr"|COPPA/, 'a new signup is asked once, on the account step');

  const account = build('function obAccount(){', 'obAccount', {
    H, esc, ob: blankOb(),
    obConsentFields: build('function obConsentFields(){', 'obConsentFields', { H, esc, ob: blankOb(), CONSENTS }),
    obConsentNote: build('function obConsentNote(){', 'obConsentNote', { H }),
  })();
  for (const c of CONSENTS) assert.match(account, new RegExp('data-c="' + c.key + '"'), 'account step still has ' + c.key);
  assert.match(account, /id="oberr"/);
  assert.match(account, /verifiable parental consent under COPPA/);

  // One set of boxes, so the two places cannot drift apart. A box ticked before going Back stays ticked.
  assert.equal(source.match(/data-c="\$\{c\.key\}"/g).length, 1);
  assert.match(reveal({ user: { id: 'u' }, ref: { sports: [] } }, blankOb({ consents: { child_data: true } })), /data-c="child_data" checked/);
});

test('the reveal binds the boxes, and Save saves when signed in and moves on to the account step when not', () => {
  for (const user of [{ id: 'u' }, null]) {
    const calls = [], clicks = {};
    build('function obRevealBind(){', 'obRevealBind', {
      $: sel => ({ set onclick(fn) { clicks[sel] = fn; } }), state: { user }, obBack: () => calls.push('back'),
      obBindConsents: () => calls.push('bindConsents'), finishOnboarding: () => calls.push('finish'), obNext: () => calls.push('next'),
    })();
    clicks['#n']();
    assert.deepEqual(calls, ['bindConsents', user ? 'finish' : 'next']);
  }

  const ob = blankOb();
  const boxes = ['child_data', 'account', 'media'].map(key => ({ dataset: { c: key }, checked: false }));
  build('function obBindConsents(){', 'obBindConsents', { ob, document: { querySelectorAll: sel => (sel === 'input[data-c]' ? boxes : []) } })();
  boxes[0].checked = true; boxes[0].onchange();
  boxes[1].checked = true; boxes[1].onchange();
  boxes[1].checked = false; boxes[1].onchange();
  assert.deepEqual(ob.consents, { child_data: true, account: false });
});

function finishWith({ ob, screen, rpcError = null }) {
  const calls = { rpc: [], toasts: [], reopened: 0, rendered: [], updates: [] };
  const state = { user: { id: 'u' }, athletes: [], active: null };
  let onScreen = screen;
  const finishOnboarding = build('async function finishOnboarding(){', 'finishOnboarding', {
    $: sel => (onScreen ? onScreen[sel] || null : null), CONSENTS, ob, state, console: { error() {} },
    toast: m => calls.toasts.push(m), reportError: () => {}, todayISO: () => '2026-09-15', clearTeamCode: () => {}, obClearStash: () => {},
    obReopenReveal: () => { calls.reopened++; onScreen = { '#oberr': { textContent: '' }, '#n': { textContent: 'Save', innerHTML: '', disabled: false } }; },
    sb: {
      rpc: async (name, args) => { calls.rpc.push([name, args]); return rpcError ? { data: null, error: rpcError } : { data: 'athlete-1', error: null }; },
      from: table => ({ update: extra => ({ eq: async () => { calls.updates.push([table, extra]); return { error: null }; } }), insert: async () => ({ error: null }) }),
    },
    loadAthletes: async () => { state.athletes = [{ id: 'athlete-1', first_name: 'Kid' }]; },
    renderApp: tab => calls.rendered.push(tab), nudgeGrowthScan: () => {},
  });
  return { calls, state, finishOnboarding, screenNow: () => onScreen };
}
const revealScreen = () => ({ '#oberr': { textContent: '' }, '#n': { textContent: "Save Kid's playbook", innerHTML: '', disabled: false } });

test('Save on the reveal refuses without the required boxes, says so beside them, and saves nothing', async () => {
  for (const consents of [{}, { child_data: true }, { account: true, media: true }]) {
    const screen = revealScreen();
    const r = finishWith({ ob: blankOb({ mode: 'addChild', familyId: 'fam-1', consents }), screen });
    await r.finishOnboarding();
    assert.equal(screen['#oberr'].textContent, MESSAGE, JSON.stringify(consents));
    assert.deepEqual(r.calls.rpc, [], 'no child is written without both required consents');
    assert.equal(screen['#n'].disabled, false);
    assert.equal(r.calls.reopened, 0);
  }
});

test('with the required boxes ticked, a sibling joins the household with exactly the consents given', async () => {
  const screen = revealScreen();
  const ob = blankOb({ mode: 'addChild', familyId: 'fam-1', seasonState: 'in_season', consents: { child_data: true, account: true, media: false },
    goals: [{ type: 'skill', key: 'hands', label: 'More reliable hands' }] });
  const r = finishWith({ ob, screen });
  await r.finishOnboarding();
  assert.equal(r.calls.rpc.length, 1);
  const [name, args] = r.calls.rpc[0];
  assert.equal(name, 'create_athlete_onboarding');
  assert.equal(args.p_new_family, false);
  assert.equal(args.p_family_id, 'fam-1');
  assert.deepEqual(args.p_consents, [{ consent_type: 'child_data' }, { consent_type: 'account' }], 'an unticked optional box is not recorded');
  assert.deepEqual(args.p_goals, [{ type: 'skill', key: 'hands', label: 'More reliable hands' }]);
  assert.deepEqual(r.calls.updates, [['athlete_sports', { season_state: 'in_season' }]]);
  assert.equal(r.state.active.id, 'athlete-1');
  assert.deepEqual(r.calls.rendered, ['week']);
  assert.equal(screen['#oberr'].textContent, '');

  // A first child on a signed-in account with no household gets a new one.
  const first = finishWith({ ob: blankOb({ mode: 'addChild', familyId: null, consents: { child_data: true, account: true } }), screen: revealScreen() });
  await first.finishOnboarding();
  assert.equal(first.calls.rpc[0][1].p_new_family, true);
  assert.equal(first.calls.rpc[0][1].p_family_id, null);
});

test('a replayed stash with nothing on screen reopens the reveal instead of leaving the spinner up', async () => {
  // The stash is written on the account step, which a signed-in parent does not have: its step number points past the end.
  const obSteps = ob => build('function obSteps(){', 'obSteps', { ob, state: { user: { id: 'u' } }, OB_FLOW });
  const stashed = blankOb({ i: OB_FLOW.create.indexOf('account') });
  assert.equal(obSteps(stashed)()[stashed.i], undefined, 'why obStep() used to throw here');
  for (const mode of ['create', 'addChild']) {
    const ob = blankOb({ i: 5, mode });
    const shown = [];
    build('function obReopenReveal(){', 'obReopenReveal', { ob, obSteps: obSteps(ob), obStep: () => shown.push(obSteps(ob)()[ob.i]) })();
    assert.deepEqual(shown, ['reveal'], mode);
  }

  // Missing consents: open the reveal, then say it beside the boxes.
  const missing = finishWith({ ob: blankOb({ i: 5, consents: {} }), screen: null });
  await missing.finishOnboarding();
  assert.equal(missing.calls.reopened, 1);
  assert.equal(missing.screenNow()['#oberr'].textContent, MESSAGE);
  assert.deepEqual(missing.calls.rpc, []);

  // The save itself fails: say so, and open the reveal so Save can be pressed again with the boxes still ticked.
  const failed = finishWith({ ob: blankOb({ i: 5, consents: { child_data: true, account: true } }), screen: null, rpcError: { message: 'offline' } });
  await failed.finishOnboarding();
  assert.equal(failed.calls.rpc.length, 1);
  assert.deepEqual(failed.calls.toasts, ['Could not save the profile — try again']);
  assert.equal(failed.calls.reopened, 1);
  assert.deepEqual(failed.calls.rendered, []);
});
