// A parent who keeps only their own training, with no child profile, can reach Your training. Until now every route
// needed an active child: with none the app went straight to child setup, and Your training's own Back button led to
// Account, which needs a child. These run the real routing, header and setup functions against stand-ins for the DOM
// and the database, and check that nothing changes for anyone without Adult Training.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8').replace(/\r\n/g, '\n');
const H = (strings, ...v) => strings.reduce((a, s, i) => a + s + (v[i] ?? ''), '');

// The source of one top-level function, found by its header and balanced braces.
function extract(source, header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, 'missing: ' + header);
  for (let i = source.indexOf('{', start + header.length - 1), depth = 0; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced: ' + header);
}
function build(file, header, name, stubs) {
  const src = extract(read(file), header);
  return new Function(...Object.keys(stubs), src + '\nreturn ' + name + ';')(...Object.values(stubs));
}

function shellStubs(state, opts = {}) {
  const calls = [];
  const nav = { removed: false, remove() { this.removed = true; } };
  const root = { innerHTML: '' };
  const screen = name => async () => { calls.push(name); };
  return {
    calls, nav, root,
    stubs: {
      state, root, H, console,
      adultTrainingOff: () => opts.off === true,
      afterLogin: async () => { calls.push('afterLogin'); },
      document: { body: { classList: { remove() {} } } },
      setAppBg() {}, loadRole: async () => {}, renderCoachView: async () => { calls.push('coach'); },
      location: { hash: '', pathname: '/', search: '' }, history: { pushState() {}, replaceState() {} },
      navBtn: () => '', bindNav: () => { calls.push('bindNav'); }, screenError: () => { calls.push('screenError'); },
      $: sel => (sel === '#nav' ? nav : null),
      screenWeek: screen('week'), screenGrowth: screen('growth'), screenScan: screen('scan'), screenBodyInsights: screen('insights'),
      screenJourney: screen('journey'), screenAccount: screen('account'), screenAdult: screen('adult'),
      screenActivity: screen('activity'), screenProfile: screen('profile'),
    },
  };
}
const renderAppWith = (state, opts) => {
  const s = shellStubs(state, opts);
  return { ...s, renderApp: build('js/shell.js', 'async function renderApp(tab, fromPop){', 'renderApp', s.stubs) };
};

test('with no child profile, Your training opens on its own and every other route goes back to child setup', async () => {
  let r = renderAppWith({ active: null, canEdit: true, role: 'owner' });
  await r.renderApp('adult');
  assert.deepEqual(r.calls, ['bindNav', 'adult']);
  assert.equal(r.nav.removed, true, 'no Week, Growth, Scan or Journey buttons that would lead nowhere');

  for (const tab of ['week', 'growth', 'scan', 'journey', 'profile', 'account']) {
    r = renderAppWith({ active: null, canEdit: true, role: 'owner' });
    await r.renderApp(tab);
    assert.deepEqual(r.calls, ['afterLogin'], tab + ' should not render without a child');
    assert.equal(r.root.innerHTML, '');
  }

  r = renderAppWith({ active: null, canEdit: true, role: 'owner' }, { off: true });
  await r.renderApp('adult');
  assert.deepEqual(r.calls, [], 'with Adult Training off, the adult route does nothing here');
});

test('with a child profile the app is unchanged, including Your training', async () => {
  for (const tab of ['week', 'adult']) {
    const r = renderAppWith({ active: { id: 'a1', first_name: 'Sam' }, canEdit: true, role: 'owner' });
    await r.renderApp(tab);
    assert.deepEqual(r.calls, ['bindNav', tab]);
    assert.equal(r.nav.removed, false);
    assert.match(r.root.innerHTML, /<nav class="nav" id="nav">/);
  }
});

test('Your training offers adding a child and logging out when there is no child, and Back when there is', () => {
  const topBar = hasChild => build('js/screen-adult.js', 'function adultTopBar(){', 'adultTopBar', { H, hasActiveAthlete: () => hasChild })();
  const none = topBar(false), some = topBar(true);
  assert.match(none, /id="adultAddChild">Add your child</);
  assert.match(none, /id="adultLogout">Log out</);
  assert.doesNotMatch(none, /adultBack/, 'Back would lead to Account, which needs a child');
  assert.match(some, /id="adultBack"/);
  assert.doesNotMatch(some, /adultAddChild|adultLogout/);

  // Wire the no-child header the way the screen does, then press its buttons.
  const clicks = {}, calls = [];
  const el = id => ({ set onclick(fn) { clicks[id] = fn; } });
  const screenDoc = { querySelectorAll: () => [] };   // bindAdultChrome also wires the Training | Eating switch
  build('js/screen-adult.js', 'function bindAdultChrome(){', 'bindAdultChrome', {
    $: sel => (sel === '#screen' ? screenDoc : ['#adultAddChild', '#adultLogout'].includes(sel) ? el(sel) : null),
    renderApp: t => calls.push('renderApp:' + t), startChildSetup: () => calls.push('startChildSetup'),
    logOutOfApp: () => calls.push('logOutOfApp'), state: {},
  })();
  clicks['#adultAddChild']();
  clicks['#adultLogout']();
  assert.deepEqual(calls, ['startChildSetup', 'logOutOfApp'], 'neither button goes to Account');
});

test('adding a child from Your training joins the existing household when there is one, and clears #adult first', async () => {
  const run = async familyId => {
    const calls = [];
    const setup = build('js/auth.js', 'async function startChildSetup(){', 'startChildSetup', {
      history: { replaceState: (s, t, url) => calls.push('replace:' + url) }, location: { pathname: '/', search: '?x=1', hash: '#adult' },
      myFamilyId: async () => familyId, document: { body: { classList: { remove() {} } } }, setAppBg() {},
      obReset: o => calls.push('obReset:' + o.mode + ':' + o.familyId), obStep: () => calls.push('obStep'),
      renderOnboarding: () => calls.push('renderOnboarding'),
    });
    await setup();
    return calls;
  };
  assert.deepEqual(await run('fam-1'), ['replace:/?x=1', 'obReset:addChild:fam-1', 'obStep']);
  assert.deepEqual(await run(null), ['replace:/?x=1', 'renderOnboarding'], 'never mints a second household for someone who has one');
});

test('the way in appears only for Adult Training accounts', () => {
  const obChild = allowed => build('js/onboarding.js', 'function obChild(){', 'obChild', {
    H, esc: s => String(s), todayISO: () => '2026-09-14', ob: { athlete: { first: '', bd: '' }, teamName: '' },
    state: { user: { id: 'u' } }, adultTrainingOn: () => allowed,
  })();
  assert.match(obChild(true), /Just here for your own training\? <a href="#" id="obAdult"/);
  assert.doesNotMatch(obChild(false), /obAdult/);
  const signedOut = build('js/onboarding.js', 'function obChild(){', 'obChild', {
    H, esc: s => String(s), todayISO: () => '2026-09-14', ob: { athlete: { first: '', bd: '' }, teamName: '' },
    state: { user: null }, adultTrainingOn: () => true,
  })();
  assert.doesNotMatch(signedOut, /obAdult/, 'a brand-new signup has no account to open Your training with');

  const auth = read('js/auth.js');
  const login = extract(auth, 'async function afterLogin(){');
  const stash = login.indexOf('return finishOnboarding();'), deepLink = login.indexOf("if((location.hash||'')==='#adult' && adultTrainingOn()) return renderApp('adult');");
  assert.ok(stash > 0 && deepLink > stash, 'a half-finished child profile is still finished first');
  // The stash branch reads the household too, so the household step is the last lookup, not the first.
  assert.ok(deepLink < login.lastIndexOf('const familyId = await myFamilyId();'), 'before the household step');
  assert.match(extract(auth, 'function renderNoAccess(){'), /\$\{adultTrainingOn\(\)\?'<button class="btn ghost" id="naAdult">Go to your training<\/button>':''\}/);
});

test('Your training still never reads the child', () => {
  for (const file of ['js/screen-adult.js', 'js/screen-adult-eating.js']) assert.doesNotMatch(read(file), /state\.active/, file);
  assert.match(read('js/shell.js'), /function hasActiveAthlete\(\)\{ return !!\(state && state\.active\); \}/);
});
