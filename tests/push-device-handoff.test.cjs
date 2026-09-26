// A push endpoint belongs to the BROWSER, not to whoever is signed in.
//
// push_subscriptions.endpoint is UNIQUE, and enablePush() wrote with
// `{ onConflict:'endpoint', ignoreDuplicates:true }` — ON CONFLICT DO NOTHING. Nothing in
// the app ever removed a row when someone logged out. So on a shared iPad:
//
//   1. Parent A turns on reminders. Row: (A, endpoint E).
//   2. A logs out. The row stays. The browser's subscription stays live.
//   3. Parent B signs in and turns on reminders. The insert collides with A's row and does
//      nothing. PostgREST returns no error, so B is told "Notifications on 🔔".
//   4. B never receives a reminder. A's weekly reminder still arrives on that iPad, and
//      notify-weekly writes it as "<child's first name>'s week is ready" — a title that
//      shows on a locked screen, to whoever is holding the device now.
//
// This is fixed in two places, and both are exercised here.
//
// Logging out releases the endpoint: the departing parent deletes their own row (which is
// all ps_delete permits) and unsubscribes the browser. That covers the ordinary case.
//
// It does not cover a session that was simply abandoned, so enablePush no longer upserts at
// all. It calls public.claim_push_subscription, which takes the endpoint from another
// guardian ONLY when the caller can also produce the subscription's own p256dh and auth
// keys — which the browser holding it reports unchanged whoever is signed in, and which
// someone who merely saw an endpoint in a log cannot produce. It returns false rather than
// raising when it will not, so there is a truthful answer to show either way.
//
// The fake PostgREST below enforces the unique constraint, each row-level policy as the
// migration writes it, and the function's own logic. The SQL itself is tested separately
// and executably in tests/db/security-tests.cjs, group `push-claim`.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');

// ---- a PostgREST that behaves like the migrations say ---------------------------------
//
// 20260806173442_push_and_payment_columns.sql:
//   endpoint text not null unique
//   ps_select / ps_insert / ps_delete, each gated on user_id = auth.uid()
//   ...and NO update policy, which is why an upsert could never rebind the row.
// 20260911160000_push_subscription_claim.sql:
//   claim_push_subscription(endpoint, p256dh, auth) -> boolean, SECURITY DEFINER
function fakePostgrest(db, session) {
  const visible = r => r.user_id === session.id;
  return {
    rpc(name, args) {
      assert.equal(name, 'claim_push_subscription', 'unexpected function: ' + name);
      const { p_endpoint, p_p256dh, p_auth } = args;
      if (!session.id) {
        return Promise.resolve({ data: null, error: { code: '42501', message: 'a push subscription can only be claimed by a signed-in guardian' } });
      }
      if (!p_endpoint || p_endpoint.length > 2048 || !p_p256dh || !p_auth) {
        return Promise.resolve({ data: null, error: { code: '22023', message: 'endpoint and both subscription keys are required' } });
      }
      const held = db.find(r => r.endpoint === p_endpoint);
      if (!held) {
        db.push({ id: 'row-' + (db.length + 1), user_id: session.id, endpoint: p_endpoint, p256dh: p_p256dh, auth: p_auth });
        return Promise.resolve({ data: true, error: null });
      }
      if (held.user_id === session.id) {
        held.p256dh = p_p256dh; held.auth = p_auth;
        return Promise.resolve({ data: true, error: null });
      }
      // Held by someone else: only the holder of the subscription's keys may displace it.
      if (held.p256dh !== p_p256dh || held.auth !== p_auth) {
        return Promise.resolve({ data: false, error: null });
      }
      db.splice(db.indexOf(held), 1);
      db.push({ id: 'row-' + (db.length + 1), user_id: session.id, endpoint: p_endpoint, p256dh: p_p256dh, auth: p_auth });
      return Promise.resolve({ data: true, error: null });
    },
    from(table) {
      assert.equal(table, 'push_subscriptions', 'unexpected table: ' + table);
      return {
        select() {
          const where = {};
          const q = {
            eq(col, val) { where[col] = val; return q; },
            limit() { return q; },
            then(onOk, onErr) {
              const data = db
                .filter(r => visible(r) && Object.entries(where).every(([c, v]) => r[c] === v))
                .map(r => ({ id: r.id }));
              return Promise.resolve({ data, error: null }).then(onOk, onErr);
            },
          };
          return q;
        },
        delete() {
          return {
            eq(col, val) {
              for (let i = db.length - 1; i >= 0; i--) {
                if (db[i][col] === val && visible(db[i])) db.splice(i, 1);
              }
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

// ---- a browser with one push registration ---------------------------------------------
function fakeBrowser(opts) {
  const o = opts || {};
  const log = { toasts: [], reported: [], unsubscribed: 0 };
  const KEYS = o.keys || { p256dh: 'p256dh-AAA', auth: 'auth-AAA' };
  const ENDPOINT = o.endpoint || 'https://push.example.test/endpoint/AAA';
  const make = (applicationServerKey) => ({
    endpoint: ENDPOINT,
    options: { applicationServerKey: applicationServerKey || null },
    toJSON: () => ({ keys: { ...KEYS } }),
    unsubscribe() { log.unsubscribed++; sub = null; return Promise.resolve(true); },
  });
  let sub = o.subscribed === false ? null : make(null);
  const pushManager = {
    getSubscription: () => Promise.resolve(sub),
    subscribe(cfg) { sub = make(cfg.applicationServerKey); return Promise.resolve(sub); },
  };
  const registration = { pushManager };
  const navigator = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140 Safari/537.36',
    serviceWorker: {
      ready: Promise.resolve(registration),
      getRegistration: () => Promise.resolve(o.registered === false ? undefined : registration),
    },
  };
  return { log, navigator, registration, currentSub: () => sub, KEYS, ENDPOINT };
}

function loadPwa(browser, session, db) {
  const Notification = { permission: 'granted', requestPermission: () => Promise.resolve('granted') };
  const win = { PushManager: function () {}, Notification, matchMedia: () => ({ matches: false }) };
  const ctx = vm.createContext({
    console, Promise, Uint8Array, Error, Object, JSON, Math, String, Number, Array, Date,
    setTimeout, atob: s => Buffer.from(s, 'base64').toString('binary'),
    window: win, navigator: browser.navigator, document: {}, Notification,
    localStorage: { getItem: () => null, setItem: () => {} },
    sb: fakePostgrest(db, session),
    state: { user: session },
    toast: m => browser.log.toasts.push(m),
    reportError: (e, where) => browser.log.reported.push(where + ': ' + (e && e.message)),
    sheet: () => ({ querySelector: () => ({}) }),
  });
  vm.runInContext(fs.readFileSync(path.join(base, 'js', 'pwa.js'), 'utf8'), ctx, { filename: 'pwa.js' });
  return ctx;
}

test('THE CASE: the next parent on a shared browser gets the endpoint', () => {
  // This is what used to fail silently. B never logged A out; the row is still A's, and the
  // browser reports the same subscription it always had. B can produce its keys, so B takes
  // it — and, crucially, A stops receiving reminders on a device A no longer uses.
  const db = [];
  const session = { id: 'parent-A' };
  const browser = fakeBrowser({ subscribed: false });
  const ctx = loadPwa(browser, session, db);

  return ctx.enablePush().then(first => {
    assert.equal(first, true, 'the first parent subscribes normally');
    assert.equal(db.length, 1);
    assert.equal(db[0].user_id, 'parent-A');

    session.id = 'parent-B';
    return ctx.enablePush().then(second => {
      assert.equal(second, true, 'the second parent now succeeds instead of being told a lie');
      assert.equal(db.length, 1, 'and there is still exactly one row for this browser');
      assert.equal(db[0].user_id, 'parent-B', 'which belongs to whoever is signed in now');
      assert.match(browser.log.toasts[browser.log.toasts.length - 1], /Notifications on/);
    });
  });
});

test('NEGATIVE: an endpoint without its keys cannot be taken', async () => {
  // The reason the function asks for the keys and not just the endpoint. An endpoint can
  // leak into a log or an error report; the keys stay in the browser that holds the
  // subscription. Someone with only the endpoint would otherwise be able to stop a
  // stranger's reminders and have their own delivered to that stranger's lock screen.
  const db = [{ id: 'row-1', user_id: 'parent-A', endpoint: 'https://push.example.test/endpoint/AAA',
                p256dh: 'the-real-p256dh', auth: 'the-real-auth' }];
  const session = { id: 'attacker' };
  const browser = fakeBrowser({ keys: { p256dh: 'guessed', auth: 'guessed' } });
  const ctx = loadPwa(browser, session, db);

  assert.equal(await ctx.enablePush(), false, 'the claim is refused');
  assert.equal(db.length, 1);
  assert.equal(db[0].user_id, 'parent-A', 'and the rightful owner keeps their reminders');
  assert.match(browser.log.toasts[browser.log.toasts.length - 1], /another account/i,
    'the caller is told what is actually wrong rather than "Notifications on"');
  assert.ok(browser.log.reported.some(r => /push:subscribe/.test(r)),
    'and it is reported, because silent reminder loss is invisible otherwise');
});

test('logging out still releases the endpoint, which is the ordinary path', async () => {
  const db = [];
  const session = { id: 'parent-A' };
  const browser = fakeBrowser({ subscribed: false });
  const ctx = loadPwa(browser, session, db);

  assert.equal(await ctx.enablePush(), true);
  assert.equal(db.length, 1);

  // This runs while A still has a token — which is why it has to come before signOut()
  // and not after: ps_delete is gated on auth.uid().
  await ctx.releasePushOnThisDevice();
  assert.equal(db.length, 0, 'the row goes with the parent who is leaving');
  assert.equal(browser.log.unsubscribed, 1, 'and the browser-side subscription is dropped too');
  assert.equal(browser.currentSub(), null);
});

test('a parent can only release their own row, never somebody else\'s', async () => {
  // ps_delete is `using (user_id = auth.uid())`. The claim function deliberately did not
  // loosen this: taking an endpoint requires the keys, and plain deletion still does not
  // reach another guardian's row at all.
  const db = [];
  const session = { id: 'parent-A' };
  const browser = fakeBrowser({ subscribed: false });
  const ctx = loadPwa(browser, session, db);
  await ctx.enablePush();

  session.id = 'stranger';
  await ctx.releasePushOnThisDevice();
  assert.equal(db.length, 1, "a stranger's release must not touch it");
  assert.equal(db[0].user_id, 'parent-A');
});

test('releasing on a browser with no service worker returns instead of hanging', async () => {
  // navigator.serviceWorker.ready never resolves when nothing is registered. Awaiting it
  // here would hang the logout button forever on a fresh browser, which is why the helper
  // uses getRegistration().
  const db = [];
  const browser = fakeBrowser({ registered: false });
  const ctx = loadPwa(browser, { id: 'parent-A' }, db);
  await ctx.releasePushOnThisDevice();   // must settle
  assert.equal(browser.log.unsubscribed, 0);
});

test('releasing with a registration but no subscription is a no-op', async () => {
  const db = [{ id: 'row-1', user_id: 'parent-A', endpoint: 'https://push.example.test/endpoint/ZZZ' }];
  const browser = fakeBrowser({ subscribed: false });
  const ctx = loadPwa(browser, { id: 'parent-A' }, db);
  await ctx.releasePushOnThisDevice();
  assert.equal(db.length, 1, 'nothing is subscribed here, so there is nothing to release');
});

test('enablePush claims through the function and never upserts the table', () => {
  const src = fs.readFileSync(path.join(base, 'js', 'pwa.js'), 'utf8');
  assert.match(src, /sb\.rpc\('claim_push_subscription',\{/,
    'the subscribe path should go through the function');
  assert.ok(!/from\('push_subscriptions'\)\.upsert/.test(src),
    'the ON CONFLICT DO NOTHING upsert must be gone, not merely bypassed');
  assert.match(src, /if\(claimed!==true\)\{/,
    'a false return is not success and must not be treated as one');
});

test('device status requires a subscription saved for the signed-in account',async()=>{
  const db=[],session={id:'parent-A'},browser=fakeBrowser({subscribed:false});
  const ctx=loadPwa(browser,session,db);
  assert.equal(await ctx.pushIsOn(),false);
  await ctx.enablePush();assert.equal(await ctx.pushIsOn(),true);
  session.id='parent-B';assert.equal(await ctx.pushIsOn(),false,'another account does not inherit enabled status');
  session.id='parent-A';db.length=0;
  assert.equal(await ctx.pushIsOn(),false,'a browser subscription without its saved row needs re-enabling');
});

test('checking push status returns with no worker instead of awaiting an unresolved ready promise',async()=>{
  const browser=fakeBrowser({registered:false});
  browser.navigator.serviceWorker.ready=new Promise(()=>{});
  const ctx=loadPwa(browser,{id:'parent'},[]);
  assert.equal(await ctx.pushIsOn(),false);
});

test('every sign-out path releases this device first', () => {
  // The release is only worth anything if it is on every exit. Six places call signOut().
  const sites = [
    ['js/shell.js', '#logout'],
    ['js/account.js', '#acctLogout'],
    ['js/auth.js', '#naOut and Your training, both through logOutOfApp()'],
    ['js/init.js', '#owOut'],
    ['js/onboarding.js', '#obLogout'],
    ['js/sheets.js', 'account deletion'],
  ];
  for (const [file, where] of sites) {
    const text = fs.readFileSync(path.join(base, file), 'utf8');
    const signOut = text.indexOf('sb.auth.signOut()');
    assert.ok(signOut > 0, file + ' should still sign out at ' + where);
    const release = text.indexOf('releasePushOnThisDevice()');
    assert.ok(release > 0, file + ' (' + where + ') must release this device on the way out');
    assert.ok(release < signOut,
      file + ' (' + where + ') must release BEFORE signOut, while the token still authorizes the delete');
  }
});

test('nothing else calls signOut without releasing', () => {
  // A seventh sign-out added later would reopen this silently. Count them.
  const dir = path.join(base, 'js');
  const found = [];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const n = (text.match(/sb\.auth\.signOut\(\)/g) || []).length;
    if (n) found.push([file, n]);
  }
  const total = found.reduce((a, [, n]) => a + n, 0);
  assert.equal(total, 6,
    'the sign-out paths changed (' + JSON.stringify(found) + '); each one needs releasePushOnThisDevice() before it');
});

test('the migration grants the function to authenticated and nobody else', () => {
  const sql = fs.readFileSync(
    path.join(base, 'supabase', 'migrations', '20260911160000_push_subscription_claim.sql'), 'utf8');
  assert.match(sql, /security definer/, 'it has to bypass RLS to delete a row RLS protects');
  assert.match(sql, /set search_path = ''/, 'and a definer function must pin its search_path');
  assert.match(sql, /revoke all on function public\.claim_push_subscription\(text, text, text\) from public;/,
    'EXECUTE is granted to PUBLIC by default, which includes anon');
  assert.match(sql, /grant execute on function public\.claim_push_subscription\(text, text, text\) to authenticated;/);
  assert.match(sql, /and ps\.p256dh = p_p256dh\s*\n\s*and ps\.auth = p_auth;/,
    'displacing another guardian must require both keys, not just the endpoint');
});

test('the helper ships to the browser and survives offline', () => {
  const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
  assert.ok(html.includes('/js/pwa.js'), 'index.html must load js/pwa.js');
  const sw = fs.readFileSync(path.join(base, 'sw.js'), 'utf8');
  assert.ok(sw.includes('/js/pwa.js'), 'the service worker must cache js/pwa.js');
});
