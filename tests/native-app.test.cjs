// The App Store and Play Store builds (js/native.js, tools/native/build-www.mjs, app-return.html,
// the link-verification files). The website must behave exactly as before, and inside the app every
// link that leaves the phone must point at playbookbp.com rather than at the app's own
// capacitor://localhost origin.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const base = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(base, f), 'utf8');

// A fake Capacitor runtime: registerPlugin returns recording stubs.
function fakeCapacitor(platform, overrides = {}) {
  const calls = [];
  const listeners = {};
  const plugin = name => new Proxy({}, {
    get(_, method) {
      if (method === 'then') return undefined;
      if (overrides[name] && overrides[name][method]) return (...args) => { calls.push([name, method, ...args]); return overrides[name][method](...args); };
      if (method === 'addListener') return (event, fn) => { (listeners[name + ':' + event] ||= []).push(fn); calls.push([name, 'addListener', event]); return Promise.resolve({ remove() {} }); };
      return (...args) => { calls.push([name, method, ...args]); return Promise.resolve({}); };
    },
  });
  return {
    calls, listeners,
    runtime: { isNativePlatform: () => true, getPlatform: () => platform, registerPlugin: plugin },
  };
}

function load({ capacitor = null, origin = 'https://playbookbp.com', extra = {} } = {}) {
  const loc = new URL(origin + '/');
  const replaced = [];
  const documentListeners = [];
  const store = new Map();
  const ctx = {
    console, URL, URLSearchParams, Blob, setTimeout, clearTimeout, Promise,
    location: {
      get origin() { return loc.origin; }, get pathname() { return loc.pathname; }, get search() { return loc.search; },
      get hash() { return loc.hash; }, set hash(v) { loc.hash = v; }, get href() { return loc.href; },
      replace(u) { replaced.push(u); },
    },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    sessionStorage: { getItem: () => null, setItem() {} },
    document: { documentElement: { classList: { add() {} } }, addEventListener: (...a) => documentListeners.push(a), body: { appendChild() {} } },
    toasts: [],
    ...extra,
  };
  ctx.toast = m => ctx.toasts.push(m);
  ctx.window = ctx;
  if (capacitor) ctx.Capacitor = capacitor.runtime;
  vm.createContext(ctx);
  vm.runInContext(read('js/native.js'), ctx, { filename: 'native.js' });
  return { ctx, replaced, documentListeners, store };
}

test('on the website nothing changes: no native mode, own origin, no Stripe return hint', () => {
  const { ctx } = load({ origin: 'https://playbookbp.com' });
  assert.equal(ctx.isNativeApp(), false);
  assert.equal(ctx.nativePlatform(), 'web');
  assert.equal(ctx.publicOrigin(), 'https://playbookbp.com');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.nativeReturnTo())), {});
  assert.equal(ctx.nativePlugin('Browser'), null);
  assert.equal(ctx.openInAppBrowser('https://example.com'), false, 'the caller keeps its normal behaviour');
});

test('in the app, links that leave the phone use playbookbp.com, not capacitor://localhost', () => {
  const cap = fakeCapacitor('ios');
  const { ctx } = load({ capacitor: cap, origin: 'capacitor://localhost' });
  assert.equal(ctx.isNativeApp(), true);
  assert.equal(ctx.nativePlatform(), 'ios');
  assert.equal(ctx.publicOrigin(), 'https://playbookbp.com');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.nativeReturnTo())), { return_to: 'app' });
});

test('incoming Universal Links and the Stripe return scheme become a load of the bundled app', () => {
  const { ctx } = load({ capacitor: fakeCapacitor('ios'), origin: 'capacitor://localhost' });
  const local = u => ctx.nativeLocalUrlFor(u);
  assert.equal(local('https://playbookbp.com/?invite=abc123'), '/?invite=abc123');
  assert.equal(local('https://playbookbp.com/?token_hash=xyz&type=email'), '/?token_hash=xyz&type=email');
  assert.equal(local('https://www.playbookbp.com/?team=BEARS26'), '/?team=BEARS26');
  assert.equal(local('parentplaybook://return?paid=6f1c'), '/?paid=6f1c');
  assert.equal(local('https://playbookbp.com/privacy'), null, 'legal pages stay in the browser');
  assert.equal(local('https://evil.example/?invite=x'), null, 'another site cannot drive the app');
  assert.equal(local('not a url'), null);
});

test('handleNativeUrl reloads with the link, closes the Stripe sheet, and ignores a bare open', () => {
  const cap = fakeCapacitor('android');
  const { ctx, replaced } = load({ capacitor: cap, origin: 'https://localhost' });
  ctx.handleNativeUrl('https://playbookbp.com/');
  assert.deepEqual(replaced, [], 'opening the app from its own homepage link does not reload it');
  ctx.handleNativeUrl('parentplaybook://return?paycancel=b1');
  assert.deepEqual(replaced, ['/?paycancel=b1']);
  assert.ok(cap.calls.some(c => c[0] === 'Browser' && c[1] === 'close'));
});

test('a tapped reminder opens the screen it names, and only paths inside the app', () => {
  const { ctx, replaced } = load({ capacitor: fakeCapacitor('ios'), origin: 'capacitor://localhost' });
  ctx.nativeOpenPath('/#week');
  assert.equal(ctx.location.hash, '#week');
  ctx.nativeOpenPath('https://evil.example/#x');
  assert.deepEqual(replaced, []);
});

test('legal pages, outside links and downloads are intercepted in the app only', async () => {
  const cap = fakeCapacitor('ios', { Filesystem: { writeFile: async () => ({ uri: 'file:///cache/report.csv' }) } });
  const fetched = [];
  const { ctx, documentListeners } = load({
    capacitor: cap, origin: 'capacitor://localhost',
    extra: {
      fetch: async u => { fetched.push(u); return { ok: true, blob: async () => new Blob(['a,b']) }; },
      FileReader: class { readAsDataURL() { this.result = 'data:text/csv;base64,YSxi'; this.onload(); } },
    },
  });
  ctx.initNativeShell();
  const [type, handler, capture] = documentListeners.find(l => l[0] === 'click');
  assert.equal(type, 'click');
  assert.equal(capture, true, 'capture phase, so it runs before the app’s own handlers');
  const click = (href, attrs = {}) => {
    let prevented = false;
    const a = { getAttribute: n => (n === 'href' ? href : attrs[n] ?? null), hasAttribute: n => n in attrs };
    handler({ defaultPrevented: false, target: { closest: () => a }, preventDefault() { prevented = true; } });
    return prevented;
  };
  assert.equal(click('/privacy'), true);
  assert.ok(cap.calls.some(c => c[0] === 'Browser' && c[1] === 'open' && c[2].url === 'https://playbookbp.com/privacy'));
  assert.equal(click('https://www.cdc.gov/growthcharts/'), true);
  assert.equal(click('#week'), false, 'in-app navigation is left alone');
  assert.equal(click('mailto:support@playbookbp.com'), false);
  assert.equal(click('blob:capacitor://localhost/1', { download: 'report.csv' }), true);
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(fetched, ['blob:capacitor://localhost/1']);
  const share = cap.calls.find(c => c[0] === 'Share' && c[1] === 'share');
  assert.ok(share, 'the file goes to the share sheet');
  assert.deepEqual([...share[2].files], ['file:///cache/report.csv']);
  assert.ok(cap.calls.some(c => c[0] === 'Filesystem' && c[1] === 'writeFile' && c[2].directory === 'CACHE' && c[2].path === 'report.csv'));
});

test('turning reminders on registers the device token as an fcm: endpoint through claim_push_subscription', async () => {
  const rpc = [];
  const deleted = [];
  let registration;
  const cap = fakeCapacitor('android', {
    PushNotifications: {
      checkPermissions: async () => ({ receive: 'prompt' }),
      requestPermissions: async () => ({ receive: 'granted' }),
      register: async () => { setTimeout(() => registration({ value: 'fcm-token-1' }), 0); },
    },
  });
  const sb = {
    rpc: async (name, args) => { rpc.push([name, args]); return { data: true, error: null }; },
    from: () => ({ delete: () => ({ eq: async (col, v) => { deleted.push(v); return { error: null }; } }) }),
  };
  const { ctx, store } = load({ capacitor: cap, origin: 'https://localhost', extra: { sb, state: { user: { id: 'g1' } } } });
  ctx.initNativeShell();
  registration = cap.listeners['PushNotifications:registration'][0];
  assert.equal(await ctx.nativePushEnable(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(rpc)), [['claim_push_subscription', { p_endpoint: 'fcm:fcm-token-1', p_p256dh: 'native', p_auth: 'native' }]]);
  assert.equal(store.get('pp_native_push_token'), 'fcm:fcm-token-1');
  assert.deepEqual(ctx.toasts, ['Notifications on 🔔']);

  await ctx.nativePushRelease();
  assert.deepEqual(deleted, ['fcm:fcm-token-1'], 'logging out removes this phone’s row');
  assert.equal(store.has('pp_native_push_token'), false);
});

test('a refused permission is said plainly and registers nothing', async () => {
  const cap = fakeCapacitor('ios', {
    PushNotifications: { checkPermissions: async () => ({ receive: 'denied' }), register: async () => { throw new Error('must not register'); } },
  });
  const { ctx } = load({ capacitor: cap, origin: 'capacitor://localhost', extra: { sb: {}, state: { user: { id: 'g1' } } } });
  assert.equal(await ctx.nativePushEnable(), false);
  assert.match(ctx.toasts[0], /Settings/);
});

test('pwa.js hands push, the service worker and the install banner to the native versions', () => {
  const pwa = read('js/pwa.js');
  for (const line of ['if(ppNative()) return nativePushIsOn();', 'if(ppNative()) return nativePushRelease();',
    'if(ppNative()) return nativePushEnable();', 'function registerServiceWorker(){\n  if(ppNative()) return;',
    'function initInstallBanner(){\n  if(ppNative()) return;']) assert.ok(pwa.includes(line), line);
});

test('native.js loads before every other app script, and init.js starts it', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script src="(\/js\/[^"]+)"/g)].map(m => m[1]);
  assert.equal(scripts[0], '/js/native.js');
  assert.match(read('js/init.js'), /if\(typeof initNativeShell==='function'\) initNativeShell\(\);/);
});

test('email sign-in links verify a token hash and keep the invite they started from', () => {
  const init = read('js/init.js');
  assert.match(init, /sb\.auth\.verifyOtp\(link\)/);
  assert.match(init, /PP_EMAIL_LINK_TYPES = \['email','signup','recovery','invite','magiclink','email_change'\]/);
  for (const f of ['emails/confirm-email.html', 'emails/reset-password.html']) {
    const html = read(f);
    assert.doesNotMatch(html, /href="\{\{ \.ConfirmationURL \}\}"/, f + ' still redirects through Supabase, which never opens the app');
    assert.match(html, /\{\{ \.SiteURL \}\}\/\?token_hash=\{\{ \.TokenHash \}\}&amp;type=(email|recovery)/, f);
  }
});

test('the app bundle rewrites every CDN library the website loads', async () => {
  const { REWRITES } = await import(pathToFileURL(path.join(base, 'tools/native/build-www.mjs')).href);
  for (const [file, pairs] of Object.entries(REWRITES)) {
    const src = read(file);
    for (const [from] of pairs) assert.ok(src.includes(from), `${file} no longer contains the text tools/native/build-www.mjs rewrites:\n${from}`);
  }
  const cdnFiles = ['index.html', ...fs.readdirSync(path.join(base, 'js')).map(f => 'js/' + f)]
    .filter(f => /cdn\.jsdelivr\.net|unpkg\.com/.test(read(f)) && !/^\s*\/\//.test(read(f).match(/.*(cdn\.jsdelivr\.net|unpkg\.com).*/)[0]));
  assert.deepEqual(cdnFiles.sort(), Object.keys(REWRITES).sort(), 'a new CDN reference needs a rewrite for the app bundle');
});

test('Stripe sends the app to app-return, and app-return hands back only known result fields', async () => {
  const { stripeReturnBase } = await import(pathToFileURL(path.join(base, 'supabase/functions/_shared/stripe-return.mjs')).href);
  assert.equal(stripeReturnBase('https://playbookbp.com', {}), 'https://playbookbp.com/');
  assert.equal(stripeReturnBase('https://playbookbp.com', { return_to: 'app' }), 'https://playbookbp.com/app-return');
  assert.equal(stripeReturnBase('https://playbookbp.com', { return_to: 'https://evil.example' }), 'https://playbookbp.com/');
  const page = read('app-return.html');
  assert.match(page, /var allowed = \['paid','paycancel','stripe','premium'\];/);
  assert.match(page, /parentplaybook:\/\/return/);
  assert.doesNotMatch(page, /<script src=/, 'the return page loads nothing');
});

test('Universal Links and App Links claim only the app root, and the site serves both files', () => {
  const aasa = JSON.parse(read('.well-known/apple-app-site-association'));
  const detail = aasa.applinks.details[0];
  assert.equal(detail.appIDs[0], 'U52ZD3QY7V.com.playbookbp.app');
  assert.deepEqual(detail.components.map(c => c['/']), ['/']);
  const links = JSON.parse(read('.well-known/assetlinks.json'));
  assert.equal(links[0].target.package_name, 'com.brownpig.parentplaybook');
  const docker = read('Dockerfile');
  assert.match(docker, /COPY \.well-known\/apple-app-site-association \.well-known\/assetlinks\.json \.\/\.well-known\//);
  assert.match(docker, /app-return\.html/);
  assert.match(read('Caddyfile'), /@applinks path \/\.well-known\/apple-app-site-association \/\.well-known\/assetlinks\.json/);
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:autoVerify="true"/);
  assert.match(manifest, /android:host="playbookbp.com" android:path="\/"/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(read('ios/App/App/App.entitlements'), /applinks:playbookbp\.com/);
});

test('every iOS permission the app can trigger has a purpose string', () => {
  const plist = read('ios/App/App/Info.plist');
  for (const key of ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription', 'NSPhotoLibraryAddUsageDescription', 'NSMicrophoneUsageDescription']) {
    const m = plist.match(new RegExp('<key>' + key + '</key>\\s*<string>([^<]+)</string>'));
    assert.ok(m && m[1].length > 40, key + ' must explain itself; App Review rejects a vague or missing purpose string');
  }
  assert.match(plist, /<string>parentplaybook<\/string>/);
  assert.match(read('ios/App/App/AppDelegate.swift'), /capacitorDidRegisterForRemoteNotifications/);
});
