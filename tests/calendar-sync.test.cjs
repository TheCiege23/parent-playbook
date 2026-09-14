// Google Calendar sync: a parent's own button that writes the coming weeks to a "Parent Playbook" calendar in their
// Google account. These pin what it may ask Google for, what it sends, that syncing twice changes nothing, that a plan
// change is carried across, and that the calendar and the Week screen build a week the same way. The end-to-end test
// runs the real module against the stand-ins in tools/adult-harness (a synthetic family, and an in-memory Google).
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));

function context(search = '?scenario=family') {
  const store = {};
  const ctx = vm.createContext({
    console, Number, Math, String, Date, JSON, Set, Map, Array, Object, Promise, Intl, URL, URLSearchParams, isNaN, parseInt, parseFloat,
    setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto, location: { search },
    localStorage: { getItem: k => (Object.hasOwn(store, k) ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  });
  ctx.window = ctx;
  vm.runInContext("function esc(v){return String(v??'');}", ctx);
  vm.runInContext(read('js/dates.js'), ctx);
  vm.runInContext(read('js/program.js'), ctx);
  vm.runInContext(read('js/core.js').match(/function ageFrom\(bd\)\{[\s\S]*?return a; \}/)[0], ctx);
  vm.runInContext(read('tools/adult-harness/fake-supabase.js'), ctx);
  vm.runInContext("const sb = supabase.createClient(); const state = { ref:{ sports:[{ key:'football', name:'Football' }] }, athletes:[] };", ctx);
  vm.runInContext(read('js/calendar-sync.js'), ctx);
  return { ctx, store };
}

test('off until a client id is set, asking Google only for calendars it creates, and keeping no token', () => {
  const src = read('js/calendar-sync.js');
  assert.match(src, /\nconst GOOGLE_CALENDAR_CLIENT_ID = '';\n/);
  assert.match(src, /const GOOGLE_CALENDAR_SCOPE = 'https:\/\/www\.googleapis\.com\/auth\/calendar\.app\.created';/);
  assert.equal((src.match(/googleapis\.com\/auth\//g) || []).length, 1, 'one scope, and only that one');
  assert.equal(context('').ctx.calendarSyncAvailable(), false, 'without a client id, and outside the harness, it is off');
  assert.equal(context().ctx.calendarSyncAvailable(), true, 'the harness family scenario supplies a synthetic id');
  // The device keeps which calendar and when; never the token, and nothing about Google reaches the database.
  const stored = [...src.matchAll(/localStorage\.setItem\(([A-Z_]+),/g)].map(m => m[1]);
  assert.deepEqual([...new Set(stored)].sort(), ['CALENDAR_SYNC_LAST', 'CALENDAR_SYNC_STORE']);
  assert.doesNotMatch(src, /sessionStorage|indexedDB|document\.cookie|sb\.from\('[a-z_]*(google|calendar|token)/);
  assert.doesNotMatch(src, /state\.[a-zA-Z]*[Tt]oken/);
});

test('each planned day is an all-day, free event with an id Google accepts, stable, and naming no record', () => {
  const { ctx } = context();
  const sam = { id: '00000000-0000-4000-8000-0000000000c1', first_name: 'Sam' };
  const days = [
    { date: '2026-09-13', t: 'train', title: 'Yesterday' },
    { date: '2026-09-14', t: 'train', title: 'Reliable hands', sub: '15 min' },
    { date: '2026-09-15', t: 'practice', title: 'Football practice', sub: 'Coach leads — nothing extra at home' },
    { date: '2026-09-16', t: 'moved', title: 'Speed ladder' },
    { date: '2026-09-19', t: 'game', title: 'Game day' },
    { date: '2026-09-20', t: 'rest', title: 'Full rest' },
    { date: '2026-12-31', t: 'gym', title: 'Strength circuit' },
  ];
  const events = plain(ctx.calendarEventsFor(sam, days, '2026-09-14'));
  assert.deepEqual(events.map(e => e.summary), ['Sam · Reliable hands', 'Sam · Football practice', 'Sam · Game day', 'Sam · Rest day', 'Sam · Strength circuit'],
    'nothing before today, nothing for a moved day');
  for (const e of events) {
    assert.match(e.id, /^[a-v0-9]{5,1024}$/, 'Google allows 0-9 and a-v in an event id');
    assert.equal(e.transparency, 'transparent');
    assert.equal(e.extendedProperties.private.ppSync, '1');
    assert.match(e.description, /the next sync replaces edits made here\.$/);
  }
  assert.deepEqual(events.map(e => [e.start.date, e.end.date]).slice(-1)[0], ['2026-12-31', '2027-01-01']);
  assert.equal(new Set(events.map(e => e.id)).size, events.length);
  assert.deepEqual(plain(ctx.calendarEventsFor(sam, days, '2026-09-14')).map(e => e.id), events.map(e => e.id), 'the same plan gives the same ids');
  assert.notEqual(plain(ctx.calendarEventsFor({ ...sam, id: 'someone-else' }, days, '2026-09-14'))[0].id, events[0].id);
  assert.notEqual(plain(ctx.calendarEventsFor(sam, [{ ...days[1], title: 'Soft hands' }], '2026-09-14'))[0].id, events[0].id, 'a changed day is a different event');
  assert.doesNotMatch(JSON.stringify(events), /0000-4000-8000/, "the child's record id never leaves");
});

test('a sync adds what is missing, rewrites what changed and removes what the plan no longer holds', () => {
  const { ctx } = context();
  const e = (id, summary, date = '2026-09-15') => ({ id, summary, description: 'd', start: { date }, end: { date: '2026-09-16' } });
  const plan = plain(ctx.calendarSyncPlan(
    [e('keep', 'Same'), e('change', 'New title'), e('new', 'Added'), e('back', 'Deleted in Google')],
    [e('keep', 'Same'), e('change', 'Old title'), e('gone', 'No longer planned'), { ...e('back', 'Deleted in Google'), status: 'cancelled' }]));
  assert.deepEqual(plan.insert.map(x => x.id), ['new', 'back']);
  assert.deepEqual(plan.update.map(x => x.id), ['change']);
  assert.deepEqual(plan.remove, ['gone']);
  assert.equal(plan.unchanged, 1);
});

test('the Week screen and the sync build a week with the same function', () => {
  assert.match(read('js/screen-week.js'), /const plan = planForWeek\(\{ age, goals:goals\|\|\[\], sports:sports\|\|\[\], cancelledIdx, weekStart, weekEnd, heightRows:heightRows\|\|\[\], weekIndex:weeksIn, nameOf \}\);/);
  assert.match(read('js/calendar-sync.js'), /const \{ prog \} = planForWeek\(\{/);
  const { ctx } = context();
  const football = { sport_key: 'football', is_primary: true, positions: ['RB'], practice_days: [1, 3], game_day: 5, season_start: '2026-09-01', season_end: '2026-11-30' };
  const week = (weekStart, weekEnd, cancelledIdx = []) => plain(ctx.planForWeek({ age: 11, goals: [], sports: [football], cancelledIdx, weekStart, weekEnd, heightRows: [], weekIndex: 3, nameOf: k => k }));
  const inSeason = week('2026-09-14', '2026-09-20');
  assert.equal(inSeason.inSeason, true);
  assert.equal(inSeason.prog.days[5].t, 'game');
  assert.deepEqual(inSeason.prog.days.map(d => d.t).filter(t => t === 'practice').length, 2);
  const preseason = week('2026-08-17', '2026-08-23');
  assert.equal(preseason.preseason, true);
  assert.notEqual(preseason.prog.days[5].t, 'game', 'no game day before the season opens');
  assert.deepEqual(week('2026-09-14', '2026-09-20', [1]).sched.cancelled, [1]);
});

test('every field of planForWeek the Week screen uses is declared there, so the screen cannot throw on one', () => {
  const program = read('js/program.js');
  const returned = program.match(/return \{ (primary, roster, sched, prog, seasonStart, seasonEnd, preseason, offseason, inSeason, growth) \};/)[1].split(', ');
  const week = read('js/screen-week.js');
  const body = week.slice(week.indexOf('async function screenWeek(){'));
  const declared = new Set();
  for (const m of body.matchAll(/const \{ ([^}]+) \} = plan;/g)) m[1].split(',').map(s => s.trim()).forEach(n => declared.add(n));
  for (const m of body.matchAll(/const ([A-Za-z_$][\w$]*)\s*=/g)) declared.add(m[1]);
  const used = returned.filter(name => new RegExp('(^|[^\\w$.])' + name + '(?![\\w$:])').test(body.replace(/const \{ [^}]+ \} = plan;/, '')));
  assert.deepEqual(used.filter(name => !declared.has(name)), [], 'used in screenWeek without being declared');
  assert.ok(used.includes('offseason') && used.includes('preseason'), 'the check sees the fields the screen really reads');
});

test('end to end: the first sync fills the calendar, the second changes nothing, and a plan change is carried across', async () => {
  const { ctx, store } = context();
  const h = vm.runInContext('window.__harness', ctx);
  const sam = h.db.athletes[0];
  const today = vm.runInContext('todayISO()', ctx);

  const first = plain(await ctx.syncGoogleCalendar([sam], today));
  assert.ok(first.added >= 7, 'at least a week of events from today');
  assert.deepEqual([first.updated, first.removed], [0, 0]);
  assert.equal(Object.keys(h.gcal.calendars).length, 1);
  assert.equal(Object.values(h.gcal.calendars)[0].summary, 'Parent Playbook');
  assert.equal(store.pp_gcal_calendar, first.calendarId, 'the device remembers the calendar, not the token');
  assert.ok(!Object.values(store).some(v => /synthetic-google-token/.test(v)));

  const second = plain(await ctx.syncGoogleCalendar([sam], today));
  assert.deepEqual([second.added, second.updated, second.removed, second.unchanged], [0, 0, 0, first.added]);
  assert.equal(Object.keys(h.gcal.calendars).length, 1, 'the same calendar is reused');

  // Practice moves from Tuesday and Thursday to Wednesday: the old practice days go and the new one arrives.
  h.db.athlete_sports[0].practice_days = [2];
  const third = plain(await ctx.syncGoogleCalendar([sam], today));
  assert.ok(third.added >= 1 && third.removed >= 1, JSON.stringify(third));
  const live = Object.values(h.gcal.events[first.calendarId]).filter(e => e.status !== 'cancelled');
  assert.ok(live.filter(e => /practice/i.test(e.summary)).every(e => new Date(e.start.date + 'T12:00:00Z').getUTCDay() === 3), 'every practice left is on a Wednesday');

  // An event deleted in Google comes back on the next sync, through a rewrite because Google keeps its id.
  const victim = live[0];
  h.gcal.events[first.calendarId][victim.id].status = 'cancelled';
  const fourth = plain(await ctx.syncGoogleCalendar([sam], today));
  assert.equal(fourth.added, 1);
  assert.ok(h.gcal.requests.some((r, i, all) => r[0] === 'POST' && r[2] === 409 && all[i + 1] && all[i + 1][0] === 'PUT' && all[i + 1][2] === 200),
    'the 409 was answered with a PUT');
  assert.ok(h.gcal.requests.every(r => r[3] === 'Bearer synthetic-google-token'), 'every call carried the token');
});

test('Connections offers it only once a client id is set, and the privacy page says what Google receives', () => {
  const ctx = vm.createContext({ console, Object, Array, String, JSON });
  vm.runInContext(`const H=(s,...v)=>s.reduce((a,x,i)=>a+x+(v[i]??''),''); function esc(v){return String(v??'');}`, ctx);
  vm.runInContext(read('js/connections.js'), ctx);
  const on = ctx.connectionsMarkup({ adultTraining: false, hasChild: true, calendarSync: true });
  const off = ctx.connectionsMarkup({ adultTraining: false, hasChild: true, calendarSync: false });
  assert.match(on, /<b>Google Calendar sync<\/b>[\s\S]*?data-connection="google_calendar">Set up</);
  assert.doesNotMatch(off, /data-connection="google_calendar"/);
  assert.match(off, /<b>Google Calendar sync<\/b>[\s\S]*?Planned/);
  assert.match(read('js/connections.js'), /if \(c\.action\.open === 'calendar'\) return openCalendarSync\(\);/);
  const privacy = read('privacy.html');
  assert.match(privacy, /<h3>Google Calendar, only if you turn on calendar sync<\/h3>/);
  assert.match(privacy, /It asks Google only for calendars it creates\. We do not receive or keep your Google sign-in or access token\./);
  const index = read('index.html');
  const at = name => index.indexOf('<script src="/js/' + name + '"></script>');
  assert.ok(at('program.js') < at('calendar-sync.js') && at('connections.js') < at('calendar-sync.js') && at('calendar-sync.js') < at('init.js'));
  assert.match(read('sw.js'), /'\/js\/connections\.js','\/js\/calendar-sync\.js',/);
});
