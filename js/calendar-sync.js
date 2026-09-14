// ===================================================================
//  GOOGLE CALENDAR SYNC — the coming weeks, in a calendar the parent owns
// ===================================================================
// Step 3 of the device connections plan. A parent presses "Sync now". This browser asks Google for a token that can
// reach only calendars this app creates (calendar.app.created), finds or makes a calendar named "Parent Playbook", and
// writes each child's next four weeks as all-day events: practices, games, home sessions and rest days.
//
// Nothing is stored on Parent Playbook's servers. The token lives in this page until it expires; the device remembers
// only which calendar the sync made and when it last ran. The plan stores days, not times, so every event is all day
// and marked free. An event's id is derived from the child, the day and what is planned, so syncing again changes
// nothing that has not changed, replaces a day whose plan did, and removes what the plan no longer holds. Edits made
// in Google are replaced by the next sync, and the sheet says so. Past days are left alone.
//
// Each week is built by planForWeek() in js/program.js, the same function the Week screen uses, so the calendar and
// the app cannot disagree about a week.
//
// Off until GOOGLE_CALENDAR_CLIENT_ID holds a web OAuth client id created in Google Cloud for this site's origin.

const GOOGLE_CALENDAR_CLIENT_ID = '';
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const CALENDAR_SYNC_WEEKS = 4;
const CALENDAR_SYNC_NAME = 'Parent Playbook';
const CALENDAR_SYNC_STORE = 'pp_gcal_calendar';
const CALENDAR_SYNC_LAST = 'pp_gcal_last';
const CALENDAR_KIND = Object.freeze({ practice:'Practice', game:'Game day', train:'Home session', gym:'Home session', rest:'Rest day' });

function calendarClientId(){
  if (GOOGLE_CALENDAR_CLIENT_ID) return GOOGLE_CALENDAR_CLIENT_ID;
  // tools/adult-harness sets a synthetic id so the flow can be driven against its stand-in for Google; nothing else does.
  return (typeof window !== 'undefined' && window.__harness && window.__harness.calendarClientId) || '';
}
function calendarSyncAvailable(){ return !!calendarClientId(); }

// FNV-1a, 32-bit, as eight hex digits. An event id only has to be stable and use Google's allowed characters (0-9 and
// a-v), and hex is a subset. A child is named in an id by this hash, never by their record id.
function calendarHash(text){
  let h = 0x811c9dc5;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// The day after a YYYY-MM-DD date, worked out on the calendar itself: an all-day event ends the next day.
function calendarNextDay(on){
  const [y, m, d] = String(on).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0');
}

// The events a child's plan asks for, from today on. days: [{ date, t, title, sub }]. A day the plan moved or dropped
// has no event of its own.
function calendarEventsFor(athlete, days, today){
  return (days || []).filter(d => d && d.date >= today && Object.hasOwn(CALENDAR_KIND, d.t)).map(d => {
    const title = d.t === 'rest' ? 'Rest day' : (d.title || CALENDAR_KIND[d.t]);
    const child = calendarHash(athlete.id);
    return {
      id:'pp' + d.date.replace(/-/g, '') + child + calendarHash(d.t + '|' + title),
      summary:athlete.first_name + ' · ' + title,
      description:[d.sub || '', CALENDAR_KIND[d.t] + ' from ' + athlete.first_name + '’s plan in Parent Playbook. Change the plan in the app; the next sync replaces edits made here.'].filter(Boolean).join('\n\n'),
      start:{ date:d.date }, end:{ date:calendarNextDay(d.date) },
      transparency:'transparent',
      extendedProperties:{ private:{ ppSync:'1', ppDate:d.date, ppChild:child } },
    };
  });
}

// What a sync has to do: add what is missing, rewrite what changed, remove what the plan no longer holds.
function calendarSyncPlan(desired, existing){
  const want = new Map((desired || []).map(e => [e.id, e]));
  const have = new Map((existing || []).filter(e => e && e.status !== 'cancelled').map(e => [e.id, e]));
  const same = (a, b) => a.summary === b.summary && (a.description || '') === (b.description || '')
    && a.start.date === (b.start && b.start.date) && a.end.date === (b.end && b.end.date);
  const insert = [], update = [];
  for (const e of desired || []) { const h = have.get(e.id); if (!h) insert.push(e); else if (!same(e, h)) update.push(e); }
  const remove = [...have.keys()].filter(id => !want.has(id));
  return { insert, update, remove, unchanged:(desired || []).length - insert.length - update.length };
}

// A child's next CALENDAR_SYNC_WEEKS weeks, day by day, built the way the Week screen builds this one.
async function calendarPlanFor(athlete){
  const monday = mondayOfThisWeek();
  const last = new Date(monday); last.setDate(monday.getDate() + 7 * CALENDAR_SYNC_WEEKS - 1);
  const from = isoDay(monday), to = isoDay(last);
  const [sportsRes, goalsRes, cancelRes, heightRes, changeRes] = await Promise.all([
    sb.from('athlete_sports').select('*').eq('athlete_id', athlete.id),
    sb.from('goals').select('*').eq('athlete_id', athlete.id).eq('status', 'active').order('created_at'),
    sb.from('schedule_exceptions').select('on_date,kind').eq('athlete_id', athlete.id).gte('on_date', from).lte('on_date', to),
    sb.from('measurements').select('metric_key,value,measured_on').eq('athlete_id', athlete.id).eq('metric_key', 'height').order('measured_on', { ascending:false }).limit(12),
    // Missing on a database the week-changes migration has not reached; then there are simply no changes.
    sb.from('week_exceptions').select('week_start,op,from_day,from_title,to_day,replacement_title').eq('athlete_id', athlete.id).gte('week_start', from).lte('week_start', to),
  ]);
  if (sportsRes.error) throw sportsRes.error;
  const nameOf = k => ((state.ref && state.ref.sports || []).find(s => s.key === k) || {}).name || k;
  const days = [];
  for (let w = 0; w < CALENDAR_SYNC_WEEKS; w++) {
    const start = new Date(monday); start.setDate(monday.getDate() + 7 * w);
    const dates = [0, 1, 2, 3, 4, 5, 6].map(i => { const d = new Date(start); d.setDate(start.getDate() + i); return isoDay(d); });
    const cancelledIdx = [0, 1, 2, 3, 4, 5, 6].filter(i => (cancelRes.data || []).some(r => r.on_date === dates[i]));
    const { prog } = planForWeek({ age:ageFrom(athlete.birthdate), goals:goalsRes.data || [], sports:sportsRes.data || [], cancelledIdx,
      weekStart:dates[0], weekEnd:dates[6], heightRows:heightRes.data || [], weekIndex:weeksSince(athlete.created_at) + w, nameOf });
    const change = ((!changeRes.error && changeRes.data) || []).find(r => r.week_start === dates[0]) || null;
    applyWeekChange(prog.days, prog, change).days.forEach((d, i) => days.push({ ...d, date:dates[i] }));
  }
  return days;
}

function calendarLoadGoogle(){
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google sign-in could not load. Check your connection and try again.'));
    document.head.appendChild(s);
  });
}

// A token for calendars this app creates, from Google's own sign-in window. Kept in memory for this sync only.
function calendarToken(){
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id:calendarClientId(), scope:GOOGLE_CALENDAR_SCOPE,
      callback:r => {
        if (!r || r.error || !r.access_token) return reject(new Error((r && (r.error_description || r.error)) || 'Google did not grant calendar access.'));
        if (r.scope && !String(r.scope).split(' ').includes(GOOGLE_CALENDAR_SCOPE)) return reject(new Error('Google did not grant access to the Parent Playbook calendar.'));
        resolve(r.access_token);
      },
      error_callback:e => reject(new Error((e && e.message) || 'Google sign-in was closed before it finished.')),
    });
    client.requestAccessToken();
  });
}

async function calendarApi(token, method, path, body){
  const res = await fetch(GOOGLE_CALENDAR_API + path, {
    method, headers:{ Authorization:'Bearer ' + token, ...(body ? { 'Content-Type':'application/json' } : {}) },
    body:body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status:res.status, data };
}
function calendarFailure(r, doing){
  const why = r && r.data && r.data.error && r.data.error.message;
  return new Error('Google Calendar would not ' + doing + (why ? ': ' + why : ' (status ' + (r && r.status) + ').'));
}

// The calendar this device made before, or one Google lists as made by this app, or a new one.
async function calendarEnsure(token){
  let remembered = null;
  try { remembered = localStorage.getItem(CALENDAR_SYNC_STORE); } catch (e) {}
  if (remembered) {
    const r = await calendarApi(token, 'GET', '/calendars/' + encodeURIComponent(remembered));
    if (r.status === 200) return remembered;
  }
  const list = await calendarApi(token, 'GET', '/users/me/calendarList?minAccessRole=owner');
  const found = list.status === 200 && ((list.data && list.data.items) || []).find(c => c.summary === CALENDAR_SYNC_NAME);
  let id = found && found.id;
  if (!id) {
    const created = await calendarApi(token, 'POST', '/calendars', { summary:CALENDAR_SYNC_NAME,
      description:'Plans from Parent Playbook, added when you press Sync now in the app. Edits made here are replaced by the next sync.',
      timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone });
    if (created.status !== 200 || !created.data || !created.data.id) throw calendarFailure(created, 'make the Parent Playbook calendar');
    id = created.data.id;
  }
  try { localStorage.setItem(CALENDAR_SYNC_STORE, id); } catch (e) {}
  return id;
}

// The events this app wrote to the calendar, for the days a sync covers.
async function calendarExisting(token, calendarId, from, to){
  const out = [];
  let page = '';
  do {
    const q = '?privateExtendedProperty=' + encodeURIComponent('ppSync=1') + '&singleEvents=true&showDeleted=false&maxResults=2500'
      + '&timeMin=' + encodeURIComponent(from + 'T00:00:00Z') + '&timeMax=' + encodeURIComponent(calendarNextDay(calendarNextDay(to)) + 'T00:00:00Z')
      + (page ? '&pageToken=' + encodeURIComponent(page) : '');
    const r = await calendarApi(token, 'GET', '/calendars/' + encodeURIComponent(calendarId) + '/events' + q);
    if (r.status !== 200) throw calendarFailure(r, 'list its events');
    ((r.data && r.data.items) || []).forEach(e => {
      const on = e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.ppDate;
      if (on && on >= from && on <= to) out.push(e);
    });
    page = r.data && r.data.nextPageToken;
  } while (page);
  return out;
}

async function syncGoogleCalendar(athletes, today){
  await calendarLoadGoogle();
  const token = await calendarToken();
  const calendarId = await calendarEnsure(token);
  let desired = [];
  for (const a of athletes || []) desired = desired.concat(calendarEventsFor(a, await calendarPlanFor(a), today));
  const monday = mondayOfThisWeek();
  const last = new Date(monday); last.setDate(monday.getDate() + 7 * CALENDAR_SYNC_WEEKS - 1);
  const plan = calendarSyncPlan(desired, await calendarExisting(token, calendarId, today, isoDay(last)));
  const events = '/calendars/' + encodeURIComponent(calendarId) + '/events';
  for (const e of plan.insert) {
    let r = await calendarApi(token, 'POST', events, e);
    // An id Google has seen before (an event deleted in Google, say) cannot be inserted again, only rewritten.
    if (r.status === 409) r = await calendarApi(token, 'PUT', events + '/' + e.id, e);
    if (r.status !== 200) throw calendarFailure(r, 'add ' + e.summary);
  }
  for (const e of plan.update) {
    const r = await calendarApi(token, 'PUT', events + '/' + e.id, e);
    if (r.status !== 200) throw calendarFailure(r, 'update ' + e.summary);
  }
  for (const id of plan.remove) {
    const r = await calendarApi(token, 'DELETE', events + '/' + id);
    if (r.status !== 204 && r.status !== 200 && r.status !== 404 && r.status !== 410) throw calendarFailure(r, 'remove an event the plan no longer holds');
  }
  try { localStorage.setItem(CALENDAR_SYNC_LAST, new Date().toISOString()); } catch (e) {}
  return { calendarId, added:plan.insert.length, updated:plan.update.length, removed:plan.remove.length, unchanged:plan.unchanged };
}

function openCalendarSync(){
  const kids = (state.athletes || []).map(a => a.first_name).filter(Boolean);
  const names = kids.length > 1 ? kids.slice(0, -1).join(', ') + ' and ' + kids[kids.length - 1] : (kids[0] || 'your child');
  let last = null;
  try { last = localStorage.getItem(CALENDAR_SYNC_LAST); } catch (e) {}
  const bg = sheet(H`<h3>Google Calendar</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">Adds ${esc(names)}’s next four weeks to a separate calendar called “Parent Playbook” in your Google account: practices, games, home sessions and rest days, as all-day events.</p>
    <div class="card app-pad">
      <div class="mrow"><span><b>Only its own calendar</b><small>Google is asked for access to calendars this app creates. Your other calendars stay out of reach.</small></span></div>
      <div class="mrow"><span><b>It updates when you press Sync</b><small>Nothing changes on its own. Sync again after the plan changes; edits made in Google are replaced.</small></span></div>
      <div class="mrow"><span><b>What Google receives</b><small>Your children’s first names and each day’s plan, sent from this device to your Google account. Parent Playbook keeps no Google sign-in or token.</small></span></div>
      <div class="mrow"><span><b>To stop</b><small>Delete the “Parent Playbook” calendar in Google Calendar, and remove Parent Playbook’s access in your Google account’s security settings.</small></span></div>
    </div>
    <p class="muted-note" id="gcalStatus">${last ? 'Last synced ' + esc(new Date(last).toLocaleString()) + ' on this device.' : 'Not synced from this device yet.'}</p>
    <div class="err" id="gcalErr"></div>
    <button class="btn" id="gcalSync">Sync now</button>`);
  const btn = bg.querySelector('#gcalSync'), err = bg.querySelector('#gcalErr'), status = bg.querySelector('#gcalStatus');
  btn.onclick = async () => {
    err.textContent = ''; btn.disabled = true; status.textContent = 'Syncing…';
    try {
      const r = await syncGoogleCalendar(state.athletes || [], todayISO());
      status.textContent = 'Synced: ' + r.added + ' added, ' + r.updated + ' updated, ' + r.removed + ' removed, ' + r.unchanged + ' already up to date.';
      toast('Google Calendar is up to date');
    } catch (e) {
      console.error(e);
      if (typeof reportError === 'function') reportError(e, 'calendar:sync');
      err.textContent = e.message || 'The sync did not finish. Try again.';
      status.textContent = '';
    }
    btn.disabled = false;
  };
}
