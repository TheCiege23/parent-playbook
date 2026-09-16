// js/landing.js decides, before the app boots, whether a visitor sees the marketing page or goes straight in, and it
// rewrites any hash it does not recognise as a tab to '#app'. '#adult' was missing from that list, so a signed-in
// parent's link to Your training was rewritten before js/auth.js could read it, and opened the Week or child setup. The
// harness never showed it: tools/adult-harness leaves this script out. These run the real script against stand-ins for
// the page, the address bar and storage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const base = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8').replace(/\r\n/g, '\n');
const LANDING = read('js/landing.js');
const STORED_SESSION = 'sb-synthetic-auth-token';

// Loads js/landing.js as the page would, at `hash`, with or without a stored Supabase session.
function visit(hash, { session = false, search = '' } = {}) {
  const pushed = [];
  const booted = [];
  const el = () => ({ hidden: false, classList: { add() {} } });
  const landing = el(), root = Object.assign(el(), { hidden: true });
  const location = { hash, search, pathname: '/' };
  const store = session ? { [STORED_SESSION]: '{"synthetic":true}' } : {};
  const ctx = {
    location,
    history: { pushState(_s, _t, url) { pushed.push(url); location.hash = url; } },
    localStorage: { get length() { return Object.keys(store).length; }, key: i => Object.keys(store)[i] ?? null, getItem: k => store[k] ?? null },
    navigator: {},
    document: {
      getElementById: id => ({ landing, root }[id] || null),
      querySelectorAll: () => [],
      body: el(), documentElement: el(),
    },
    boot: mode => booted.push(mode ?? 'default'),
  };
  ctx.window = Object.assign(ctx, { matchMedia: () => ({ matches: false }), addEventListener() {} });
  vm.runInNewContext(LANDING, ctx, { filename: 'js/landing.js' });
  return { hash: location.hash, pushed, booted, landingHidden: landing.hidden, rootHidden: root.hidden };
}

test('THE CASE: a signed-in parent opening /#adult keeps #adult, so Your training opens', () => {
  const r = visit('#adult', { session: true });
  assert.deepEqual(r.booted, ['default'], 'the app boots');
  assert.equal(r.hash, '#adult');
  assert.deepEqual(r.pushed, [], 'nothing rewrites the address');
});

test('a signed-out visitor to /#adult goes into the app, where boot() shows sign-in, and keeps #adult for afterwards', () => {
  const r = visit('#adult');
  assert.deepEqual(r.booted, ['default']);
  assert.equal(r.landingHidden, true, 'the marketing page is put away');
  assert.equal(r.rootHidden, false);
  assert.equal(r.hash, '#adult');
  // init.js boot(): with no session and no mode, the sign-in form. Pinned so this stays the signed-out outcome.
  assert.match(read('js/init.js'), /if\(!state\.user\)\{[\s\S]*?if\(mode==='signup'\) return renderOnboarding\(\);\s*return renderAuth\('login'\);/);
});

test('every app tab survives as a deep link, so the next tab added to shell.js cannot be missed here again', () => {
  const tabs = JSON.parse(read('js/shell.js').match(/const APP_TABS=(\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  assert.ok(tabs.includes('adult'));
  for (const tab of tabs) {
    const r = visit('#' + tab, { session: true });
    assert.equal(r.hash, '#' + tab, tab);
    assert.deepEqual(r.pushed, [], tab);
  }
});

test('anything else still becomes #app for a signed-in visitor, and a signed-out visitor still sees the marketing page', () => {
  for (const hash of ['', '#faq', '#adultx', '#access_token_leftover']) {
    const r = visit(hash, { session: true });
    assert.deepEqual(r.pushed, ['#app'], JSON.stringify(hash));
  }
  const r = visit('#faq');
  assert.deepEqual(r.booted, [], 'no boot');
  assert.equal(r.landingHidden, false);
  assert.equal(r.hash, '#faq');
});

test('for an account without Adult Training, #adult falls back to Profile with a message, not a blank screen', () => {
  // renderApp('adult') asks adultTrainingOff() first, which says so and opens Profile. Pinned because keeping #adult
  // now reaches this path for every signed-in account.
  const core = read('js/core.js');
  assert.match(core, /function adultTrainingOff\(\)\{\s*if\(adultTrainingOn\(\)\) return false;\s*toast\('Adult training isn\\'t available yet'\);\s*renderApp\('profile'\);\s*return true;/);
  assert.match(read('js/shell.js'), /if\(tab==='adult' && adultTrainingOff\(\)\) return;/);
  assert.match(read('js/auth.js'), /const tab=\(location\.hash\|\|''\)\.slice\(1\);\s*renderApp\(APP_TABS\.includes\(tab\)\?tab:'week'\);/);
});
