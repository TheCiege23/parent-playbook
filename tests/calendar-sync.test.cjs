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
  assert.deepEqual([...new Set(stored)].sort(), ['CALENDAR_SYNC_LAST', 'CALENDAR_SYNC_OWN', 'CALENDAR_SYNC_STORE']);
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

test("a parent's own workouts: named Your training, from today over four weeks, stable, and never a record id", () => {
  const { ctx } = context();
  const items = [
    { id: '00000000-0000-4000-8000-0000000000b1', weekday: 0, title: 'Lift', kind: 'strength', duration_min: 40 },
    { id: '00000000-0000-4000-8000-0000000000b2', weekday: 6, title: 'Long walk', kind: 'walk', duration_min: null },
    { id: '00000000-0000-4000-8000-0000000000b3', weekday: 9, title: 'Not a day', kind: 'other', duration_min: 10 },
  ];
  const events = plain(ctx.calendarOwnEventsFor(items, '2026-09-28', '2026-09-29'));
  assert.deepEqual(events.map(e => [e.start.date, e.summary]), [
    ['2026-10-04', 'Your training · Long walk'],
    ['2026-10-05', 'Your training · Lift'], ['2026-10-11', 'Your training · Long walk'],
    ['2026-10-12', 'Your training · Lift'], ['2026-10-18', 'Your training · Long walk'],
    ['2026-10-19', 'Your training · Lift'], ['2026-10-25', 'Your training · Long walk'],
  ], "nothing before today, across the month's end, and nothing for a weekday that does not exist");
  for (const e of events) {
    assert.match(e.id, /^[a-v0-9]{5,1024}$/);
    assert.equal(e.transparency, 'transparent');
    assert.equal(e.extendedProperties.private.ppSync, '1');
    assert.match(e.description, /the next sync replaces edits made here\.$/);
  }
  assert.match(events[1].description, /^40 min · Strength\n\n/);
  assert.match(events[0].description, /^Walk\n\n/);
  assert.deepEqual([events[1].end.date, events[0].end.date], ['2026-10-06', '2026-10-05']);
  assert.equal(new Set(events.map(e => e.id)).size, events.length);
  assert.doesNotMatch(JSON.stringify(events), /0000-4000-8000/, "the workout's record id never leaves");
  const renamed = plain(ctx.calendarOwnEventsFor([{ ...items[0], title: 'Heavy lift' }], '2026-09-28', '2026-09-29'));
  assert.equal(renamed[0].id, events[1].id, 'a renamed workout is the same event, rewritten');
  const sam = plain(ctx.calendarEventsFor({ id: '00000000-0000-4000-8000-0000000000c1', first_name: 'Sam' }, [{ date: '2026-10-05', t: 'train', title: 'Lift' }], '2026-09-29'));
  assert.notEqual(sam[0].id, events[1].id, "a parent's workout and a child's session on the same day are different events");
  // Every event id has one shape: pp, the day, who it is for (a child, or the parent as "self"), then what it is.
  for (const id of [...events.map(e => e.id), sam[0].id]) assert.match(id, /^pp\d{8}[0-9a-f]{16}$/, id);
  assert.equal(events[1].id.slice(10, 18), ctx.calendarHash('self'));
  assert.deepEqual(plain(ctx.calendarOwnEventsFor(null, '2026-09-28', '2026-09-29')), []);
});

test('end to end: ticking Include my workouts adds them beside the children, and unticking takes only them off', async () => {
  const { ctx } = context('?scenario=family&adult=1');
  const h = vm.runInContext('window.__harness', ctx);
  assert.equal(h.WITH_ADULT, true);
  assert.ok(!h.MISSING_TABLES.includes('adult_schedule_items') && h.MISSING_TABLES.includes('week_exceptions'));
  const sam = h.db.athletes[0];
  const today = vm.runInContext('todayISO()', ctx);
  vm.runInContext('state.user = window.__harness.USER;', ctx);
  await vm.runInContext(`sb.from('adult_schedule_items').insert([
    { guardian_id: state.user.id, weekday: 0, title: 'Synthetic lift', kind: 'strength', duration_min: 40 },
    { guardian_id: state.user.id, weekday: 3, title: 'Synthetic walk', kind: 'walk', duration_min: 30 },
    { guardian_id: '00000000-0000-4000-8000-0000000000ff', weekday: 2, title: 'Someone else', kind: 'other', duration_min: 10 },
  ])`, ctx);
  const mine = h.db.adult_schedule_items.filter(i => i.guardian_id === h.USER.id);
  const expected = plain(ctx.calendarOwnEventsFor(mine, vm.runInContext('isoDay(mondayOfThisWeek())', ctx), today)).length;
  assert.ok(expected >= 6, 'four weeks of two workouts, less any already past this week');

  const children = plain(await ctx.syncGoogleCalendar([sam], today));
  const withOwn = plain(await ctx.syncGoogleCalendar([sam], today, ctx.calendarOwnSchedule));
  assert.deepEqual([withOwn.added, withOwn.updated, withOwn.removed, withOwn.unchanged], [expected, 0, 0, children.added]);
  const live = () => Object.values(h.gcal.events[children.calendarId]).filter(e => e.status !== 'cancelled');
  assert.equal(live().filter(e => /^Your training · Synthetic (lift|walk)$/.test(e.summary)).length, expected);
  assert.ok(!live().some(e => /Someone else/.test(e.summary)), "only this parent's schedule is read");

  const again = plain(await ctx.syncGoogleCalendar([sam], today, ctx.calendarOwnSchedule));
  assert.deepEqual([again.added, again.updated, again.removed], [0, 0, 0]);
  const off = plain(await ctx.syncGoogleCalendar([sam], today, null));
  assert.deepEqual([off.added, off.updated, off.removed, off.unchanged], [0, 0, expected, children.added]);
  assert.ok(!live().some(e => /^Your training · /.test(e.summary)));
  assert.ok(live().some(e => /^Sam · /.test(e.summary)), "the children's events stay");
});

test('a schedule that cannot be read stops the sync before the calendar is touched', async () => {
  const { ctx } = context('?scenario=family');
  const h = vm.runInContext('window.__harness', ctx);
  vm.runInContext('state.user = window.__harness.USER;', ctx);
  const today = vm.runInContext('todayISO()', ctx);
  await assert.rejects(ctx.syncGoogleCalendar([h.db.athletes[0]], today, ctx.calendarOwnSchedule), /schedule could not be read, so the calendar was left as it was/);
  assert.deepEqual(Object.keys(h.gcal.calendars), [], 'no calendar made');
  assert.ok(!h.gcal.requests.some(r => r[0] !== 'GET'), 'nothing written to Google');
});

test('the box shows only with Your training, and Connections opens the sync for a parent with Your training and no child', () => {
  const src = read('js/calendar-sync.js');
  assert.match(src, /const canOwn = typeof adultTrainingOn === 'function' && adultTrainingOn\(\);/);
  assert.match(src, /\$\{canOwn \? H`<label class="card app-pad"[^`]*<input type="checkbox" id="gcalOwn"/);
  assert.match(src, /const ownSource = withOwn \? calendarOwnSchedule : null;/);
  assert.match(src, /sb\.from\('adult_schedule_items'\)\.select\('id,weekday,title,kind,duration_min'\)\.eq\('guardian_id', state\.user\.id\)/);
  const ctx = vm.createContext({ console, Object, Array, String, JSON });
  vm.runInContext(`const H=(s,...v)=>s.reduce((a,x,i)=>a+x+(v[i]??''),''); function esc(v){return String(v??'');}`, ctx);
  vm.runInContext(read('js/connections.js'), ctx);
  const adultOnly = ctx.connectionsMarkup({ adultTraining: true, hasChild: false, calendarSync: true });
  assert.match(adultOnly, /<b>Google Calendar sync<\/b><small>[^<]*you can add your own workouts too\.[^<]*<\/small><\/span>\s*<button class="btn sm ghost" data-connection="google_calendar">Set up</);
  assert.doesNotMatch(ctx.connectionsMarkup({ adultTraining: false, hasChild: false, calendarSync: true }), /data-connection="google_calendar"|own workouts/);
  assert.doesNotMatch(ctx.connectionsMarkup({ adultTraining: true, hasChild: false, calendarSync: false }), /data-connection="google_calendar"/);
  assert.match(read('privacy.html'), /If you use Your training and tick Include my workouts, it also sends the names, days and lengths of your own scheduled workouts\./);
});
