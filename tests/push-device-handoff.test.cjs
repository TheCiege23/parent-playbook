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
//      notify-weekly writes it as "<child>'s first name>'s week is ready" — a title that
//      shows on a locked screen, to whoever is holding the device now.
//
// Two faults, fixed separately here: logging out now releases the endpoint, and enablePush
// reads the row back instead of trusting a write that is allowed to do nothing.
//
// These drive the real js/pwa.js against a fake browser and a fake PostgREST that enforces
// both the unique constraint and the row-level policies as written in the migration, so the
// scenario above runs end to end rather than being asserted about.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');

// ---- a PostgREST that behaves like the migration says --------------------------------
//
// supabase/migrations/20260806173442_push_and_payment_columns.sql:
//   endpoint text not null unique
//   ps_select / ps_insert / ps_delete, each gated on user_id = auth.uid()
//   ...and NO update policy, which is why the upsert cannot rebind the row.
function fakePostgrest(db, session) {
  const visible = r => r.user_id === session.id;
  return {
    from(table) {
      assert.equal(table, 'push_subscriptions', 'unexpected table: ' + table);
      return {
        upsert(row, opts) {
          const clash = db.find(r => r.endpoint === row.endpoint);
          if (clash) {
            // ON CONFLICT DO NOTHING. No error, no write, no hint that anything happened.
            if (opts && opts.ignoreDuplicates) return Promise.resolve({ error: null });
            // The other branch would need an update policy, and there isn't one.
            return Promise.resolve({ error: { code: '42501', message: 'new row violates row-level security policy' } });
          }
          if (row.user_id !== session.id) {
            return Promise.resolve({ error: { code: '42501', message: 'new row violates row-level security policy' } });
          }
          db.push({ id: 'row-' + (db.length + 1), ...row });
          return Promise.resolve({ error: null });
        },
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
  let sub = o.subscribed === false ? null : {
    endpoint: 'https://push.example.test/endpoint/AAA',
    options: { applicationServerKey: null },
    toJSON: () => ({ keys: { p256dh: 'p256dh-AAA', auth: 'auth-AAA' } }),
    unsubscribe() { log.unsubscribed++; sub = null; return Promise.resolve(true); },
  };
  const pushManager = {
    getSubscription: () => Promise.resolve(sub),
    subscribe(cfg) {
      sub = {
        endpoint: 'https://push.example.test/endpoint/AAA',
        options: { applicationServerKey: cfg.applicationServerKey },
        toJSON: () => ({ keys: { p256dh: 'p256dh-AAA', auth: 'auth-AAA' } }),
        unsubscribe() { log.unsubscribed++; sub = null; return Promise.resolve(true); },
      };
      return Promise.resolve(sub);
    },
  };
  const registration = { pushManager };
  const navigator = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140 Safari/537.36',
    serviceWorker: {
      ready: Promise.resolve(registration),
      getRegistration: () => Promise.resolve(o.registered === false ? undefined : registration),
    },
  };
  return { log, navigator, registration, currentSub: () => sub };
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

test('the leak, reproduced: without a release the second parent is told a lie', async () => {
  // This is the pre-fix behaviour of the WRITE, kept as the negative control. The upsert
  // still silently declines — that is the database doing what the policy says — and the
  // test shows that the read-back is the only thing standing between that and "on".
  const db = [];
  const session = { id: 'parent-A' };
  const browser = fakeBrowser({ subscribed: false });
  const ctx = loadPwa(browser, session, db);

  assert.equal(await ctx.enablePush(), true, 'the first parent subscribes normally');
  assert.equal(db.length, 1);
  assert.equal(db[0].user_id, 'parent-A');

  // Parent B signs in on the same browser. Same endpoint, because the endpoint is the
  // browser's. A never logged out, so A's row is still there.
  session.id = 'parent-B';
  const ok = await ctx.enablePush();
  assert.equal(ok, false, 'enablePush must not report success it did not achieve');
  assert.equal(db.length, 1, 'the collision wrote nothing, exactly as ON CONFLICT DO NOTHING says');
  assert.equal(db[0].user_id, 'parent-A', "and the row still belongs to the parent who left");
  assert.match(browser.log.toasts[browser.log.toasts.length - 1], /another account/i,
    'the parent is told what is actually wrong');
  assert.ok(browser.log.reported.some(r => /push:subscribe/.test(r)),
    'and it is reported, because silent reminder loss is invisible otherwise');
});

test('logging out releases the endpoint, and the next parent gets it', async () => {
  const db = [];
  const session = { id: 'parent-A' };
  const browser = fakeBrowser({ subscribed: false });
  const ctx = loadPwa(browser, session, db);

  assert.equal(await ctx.enablePush(), true);
  assert.equal(db.length, 1);

  // A logs out. This runs while A still has a token — which is why it has to come before
  // signOut() and not after.
  await ctx.releasePushOnThisDevice();
  assert.equal(db.length, 0, "the row goes with the parent who is leaving");
  assert.equal(browser.log.unsubscribed, 1, 'and the browser-side subscription is dropped too');
  assert.equal(browser.currentSub(), null);

  session.id = 'parent-B';
  assert.equal(await ctx.enablePush(), true, 'the next parent subscribes cleanly');
  assert.equal(db.length, 1);
  assert.equal(db[0].user_id, 'parent-B', 'and the reminders now go to the right person');
});

test('a parent can only release their own row, never somebody else\'s', async () => {
  // ps_delete is `using (user_id = auth.uid())`. If that ever stopped being true, one
  // guardian could switch off another's reminders by knowing an endpoint.
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

test('every sign-out path releases this device first', () => {
  // The fix is only worth anything if it is on every exit. Six places call signOut().
  const sites = [
    ['js/shell.js', '#logout'],
    ['js/account.js', '#acctLogout'],
    ['js/auth.js', '#naOut'],
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

test('the helper ships to the browser and survives offline', () => {
  const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
  assert.ok(html.includes('/js/pwa.js'), 'index.html must load js/pwa.js');
  const sw = fs.readFileSync(path.join(base, 'sw.js'), 'utf8');
  assert.ok(sw.includes('/js/pwa.js'), 'the service worker must cache js/pwa.js');
});
